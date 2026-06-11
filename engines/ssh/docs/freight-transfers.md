# Freight transfers

This note names the seam between the demand economy and the offer economy.

The goal is not to replace the hive convey system in one step. The current `TrackedMovement` already
contains most of the runtime state a transfer needs. The missing piece is the explicit local reason a
good is moving: which immediate demand or route promise it serves, which line or vehicle owns that
intent, and whether the transfer is allowed to block a stop.

This is intentionally not a final-destination freight model. Goods should not need to know where
they will ultimately be consumed before a hive starts moving them. The design target is ant-like:
local advertisements and local line policies produce useful global movement as an emergent result.
Player-authored lines, buffers, storage rules, and priorities are the tuning surface.

## Problem

Freight currently rediscovers demand and offer through several views:

- a vehicle service knows which line and stop the vehicle is serving;
- dock candidates infer which goods could move at a docked vehicle halt;
- hive advertisements create offer and demand relations;
- tracked movements reserve and move goods;
- virtual goods count storage reservations and allocations;
- worker claims decide whether a convey token is executable.

Those views are useful, but none of them fully owns the junction between "someone needs concrete"
and "this storage can offer concrete". When they drift, a vehicle can wait on a virtual or claimed
movement that no worker can execute, or reserved cargo can accidentally look like generic local
offer.

## Vocabulary

### Demand

A demand is a local reason a good should exist somewhere.

Examples:

- a construction site needs concrete;
- a transform process needs wood;
- a downstream freight stop needs concrete on a vehicle;
- a line served by this hive needs wood forwarded elsewhere.

Demand does not move goods. It only says what this local context can currently accept. A downstream
or forwarding demand may be derived from a line, but the good does not need to carry the identity of
the eventual building or settlement that may consume it.

### Offer

An offer is material or capacity that can satisfy demand.

Examples:

- storage has concrete available;
- a vehicle carries wood that is not reserved for a later stop;
- a market can sell concrete;
- a transform can produce planks.

Offer does not move goods by itself. It only says what can be used.

### Transfer

A transfer is the match between a demand and an offer for one movement step.

It answers:

- what good and quantity is being moved;
- which offer and demand are being connected;
- where this step starts and ends;
- whether the target is consuming, stocking, forwarding, loading, or unloading;
- which line, stop, vehicle, or hive owns the immediate reason;
- whether this transfer blocks a vehicle halt or line advancement.

Transfers are the first-class junction. Advertisements, proposed jobs, movement claims, and virtual
goods should be views or execution state for a transfer, not competing truths.

Transfers are local. A transfer may know "load concrete into this vehicle because the line has later
concrete demand" or "store wood here because this hive has a forwarding line that can use it." It
does not need to know "this exact concrete belongs to foundation X" unless a future feature chooses
to add that specificity for a special economy rule.

## In-transit reservations for fixed-quantity consumers

### Problem

Fixed-quantity consumers (construction sites, foundations) need an exact amount of each good. When
a vehicle loads goods for a downstream construction stop, the stop's raw `remainingNeeds` does not
reflect that the goods are already in transit. Two vehicles may both measure "needs 1 stone" and
both load 1 stone — one of them will arrive to find the site satisfied and be left with stranded
cargo occupying a storage slot indefinitely.

Streaming consumers (transformers, storage buffers) do not suffer from this because their demand
regenerates continuously as goods are consumed.

### Model

Each construction site carries a module-level `WeakMap` of `InTransitReservation` records:

```ts
interface InTransitReservation {
    readonly vehicleUid: string
    readonly goodType: GoodType
    readonly quantity: number
    readonly expiresAtTick: number
}
```

When a vehicle commits to loading goods that will be consumed by a downstream construction stop,
the reservation is created against that site. The site's **effective** remaining needs subtract
all active reservations:

```ts
effectiveRemainingNeeds[g] = max(0, rawRemainingNeeds[g] - sum(inTransit[g]))
```

All load-decision callers use `effectiveRemainingNeeds` instead of raw `remainingNeeds`, so a
second vehicle measuring the same site sees reduced need and avoids double-loading.

### Lifecycle

- **Creation**: when a zone-browse load job or dock-anchor load commits goods for a downstream
  fixed-quantity consumer.
- **Cancellation on delivery**: when the vehicle arrives and the convey worker deposits goods
  into the construction site's storage, the reservation is cleared (the goods are no longer in
  transit — they are delivered).
- **Cancellation on service end**: `VehicleEntity.endService()` iterates all construction sites
  and cancels reservations from that vehicle, so line reassignment, deletion, or maintenance
  fallback does not leave ghost reservations.
- **Expiry (algorithm bug guard)**: each reservation carries `expiresAtTick = now + 2 × route cycle ticks`.
  The game tick loop scans all construction sites every 2 seconds for expired reservations. An
  expired reservation means the vehicle never delivered what it reserved — an algorithm bug — and
  **logs a warning trace** (`traces.vehicle.warn('inTransit.stale', ...)`). It does not silently
  eat the error.

### Surplus offload as safety net

Even with in-transit reservations, edge cases exist (cancelled reservations, bugs, line changes
mid-route). Zone stops now allow surplus offload: if a vehicle has `surplusLoadedGoods` (cargo
no downstream stop needs), any zone stop with a valid sink (construction, storage, unload tile)
can accept the surplus, not just distribute-unload stops. This is the last-resort safety net.

### Quantity capping in zone browse loads

`pickZoneLoadSelection` and `zoneBrowseJobFromTileLooseLoad` now compute an explicit quantity
capped by downstream need:

```ts
quantity = min(tileAvailable, downstreamNeed, vehicleRoom)
```

This prevents a zone browse load from picking up 5 loose stones when downstream stops need 1.

The same-tile loose-load path (`zoneBrowseJobFromTileLooseLoad`) also gates by downstream need
and skips goods whose `remainingNeededGoods[g] <= 0`.

### Relevant code

| Concern | File |
|---|---|
| Reservation type, registration, effective needs, expiry | `engines/ssh/src/lib/build-site.ts` |
| Load-decision callers use `effectiveRemainingNeeds` | `construction-demand.ts`, `freight-stop-utility.ts` |
| Quantity cap in zone browse loads | `vehicle-zone-browse.ts`, `vehicle-work.ts` |
| Surplus offload at any zone stop | `vehicle-zone-browse.ts` |
| `endService()` cancels reservations | `population/vehicle/entity.ts` |
| Tick-based stale reservation check | `game/game.ts` |

## Transit

A hive may accept a good it does not locally consume when it is responsible for forwarding that good.
That is a transit transfer. Transit is still local: the receiving hive only needs to know that the
good is accepted because a local line/storage policy can forward it, not the final consumer.

Example:

1. A later line segment advertises wood demand.
2. Forest storage offers wood.
3. The route passes through the ChopSaw hive.
4. ChopSaw accepts wood with purpose `transit`, not because ChopSaw consumes wood, but because one
   of its local line policies can forward wood.
5. The wood is stored as transit cargo for that local forwarding promise.
6. The next transfer moves the wood from ChopSaw to the next local hop.

The important invariant is that transit cargo is not generic local offer. It is reserved for an
active route or forwarding promise until that promise is completed or cancelled.

## Vehicle line intent

The vehicle should own the interpretation of the line it is serving.

The line defines stops, filters, buffers, and roles. The wider economy exposes local and downstream
demand and offer. The vehicle asks: given my current line stop and downstream route, what transfers
make sense now?

For a docked vehicle at a line anchor, the vehicle intent can be:

```ts
{
	kind: 'load',
	goodType: 'concrete',
	quantity: 1,
	source: 'ChopSaw:storage',
	target: 'ChopSaw:wheelbarrow',
	reason: 'downstream-need',
	blocking: true,
}
```

The freight bay hosts the physical exchange, but the vehicle owns why the exchange exists.

## Docked vehicle advertisement calculation

This section is the normative calculation for a docked line vehicle. It is deliberately written as
state derivation, not as a heuristic. The same rule must work for a wheelbarrow, truck, cart, boat,
or any later freight vehicle.

### Inputs

At a docked anchor stop, calculate vehicle advertisements from these inputs:

- `currentAds`: the current hive advertisements visible at this bay.
- `futureAds`: the advertisements of hives/stops further on this vehicle's line, in service order.
- `stock[g]`: physical goods currently in the vehicle storage.
- `reserved[g]`: physical vehicle goods already reserved for a transfer or downstream purpose.
- `allocated[g]`: target allocations on the vehicle, meaning goods that are already promised to
  arrive.
- `capacity[g]`: free room in the vehicle for each good.
- `linePolicy`: stop filters, load/unload authority, priority tiers, cyclic/non-cyclic order, and
  whether this stop is allowed to exchange with the current hive.

The vehicle must not read only the bay hive's local need. It must compare the present stop with the
future line contract.

### Normalize line ads

For each good `g`, split future line advertisements into two counters:

```ts
futureDemand[g] = sum futureAds demand quantities for g that this vehicle may unload/provide to
futureSupply[g] = sum futureAds provide quantities for g that this vehicle may load from
```

Then cancel supply and demand in route order:

```ts
routeNeed[g] = max(0, futureDemand[g] - futureSupplyBeforeThatDemand[g])
routeSupply[g] = max(0, futureSupply[g] - futureDemandBeforeThatSupply[g])
```

The route-order wording matters. A supply after a demand cannot satisfy that earlier demand unless
the line is cyclic and the cyclic order explicitly wraps through that supply before the next service
cycle's demand.

For cyclic lines, `futureAds` means the ordered suffix after the current stop plus the wrapped prefix
up to, but not including, the current stop. For non-cyclic lines, it is only the suffix after the
current stop.

This route-order normalization should live behind one function, conceptually:

```ts
futureTransfer = computeFutureFreightTransfer(game, line, currentStopIndex)
```

That function owns cyclicity, stop ordering, stop good rules, and future ad collection. After it
returns `routeNeed`, `routeSupply`, and matched in-route transfers, callers must not branch on
cyclicity again.

### Project vehicle cargo

The vehicle's line obligation is based on cargo it has now plus cargo already allocated to arrive:

```ts
projectedOnVehicle[g] = stock[g] + allocated[g]
```

Reserved cargo is still physical stock, but it is not free local offer:

```ts
freeVehicleStock[g] = max(0, stock[g] - reserved[g])
```

Cargo already assigned to future route need is:

```ts
routeReservedCargo[g] = min(projectedOnVehicle[g], routeNeed[g])
surplusCargo[g] = max(0, freeVehicleStock[g] - max(0, routeNeed[g] - allocated[g]))
remainingRouteNeed[g] = max(0, routeNeed[g] - projectedOnVehicle[g])
```

Interpretation:

- `routeReservedCargo` rides with the vehicle. It must not advertise as generic local provide at the
  current stop.
- `surplusCargo` may be unloaded/provided at the current stop if the current stop has a compatible
  sink.
- `remainingRouteNeed` may be loaded from the current stop if the current stop has a compatible
  source.

### Current hive source and sink

For each good `g`, derive current-stop capability from `currentAds` and stop authority:

```ts
currentSupply[g] = quantity of currentAds provide(g) reachable from this bay
currentDemand[g] = quantity of currentAds demand(g) reachable from this bay

currentCanSource[g] =
	currentSupply[g] > 0 &&
	linePolicy allows loading g at this stop &&
	capacity[g] > 0

currentCanSink[g] =
	currentDemand[g] > 0 &&
	linePolicy allows unloading/providing g at this stop
```

Current storage room without demand is not automatically a sink for line-reserved cargo. Generic
storage may accept true surplus, but it must not compete with future route demand.

### Advertisement output

The vehicle advertises demand to load goods only for unsatisfied future route need:

```ts
vehicleDemand[g] =
	currentCanSource[g]
		? min(capacity[g], currentSupply[g], remainingRouteNeed[g])
		: 0
```

The vehicle advertises provide to unload goods only for cargo not needed by the future route:

```ts
vehicleProvide[g] =
	currentCanSink[g]
		? min(currentDemand[g], surplusCargo[g])
		: 0
```

Then emit at most one side per good:

```ts
if vehicleDemand[g] > 0 and vehicleProvide[g] > 0:
	// This is a policy error. It means current/future ads were merged incorrectly.
	// Resolve by preserving future route demand first:
	vehicleProvide[g] = 0

if vehicleDemand[g] > 0:
	advertise demand(g, quantity = vehicleDemand[g], purpose = 'line-load')
else if vehicleProvide[g] > 0:
	advertise provide(g, quantity = vehicleProvide[g], purpose = 'line-unload')
else:
	advertise nothing for g
```

This prevents the concrete loop: a vehicle carrying or receiving concrete for a later line need may
continue to demand more concrete up to that need, but the same concrete must not also be advertised
as local provide at the current stop.

### Priority

The base priority is the priority of the demand being served, not the priority of the current storage
hop.

For loading:

```ts
priority(vehicleDemand[g]) = max priority among future route demands for g still unsatisfied
```

For unloading:

```ts
priority(vehicleProvide[g]) = priority of the compatible current sink for g
```

A current `0-store` sink must not outrank a future `2-use` demand. If the only current sink is
generic storage and future route demand still exists, the vehicle must keep the cargo.

### Transfer creation

An advertisement is not completion state. When a hive match creates a transfer:

- a `vehicleDemand` match creates a load transfer from a current provider to the vehicle dock;
- a `vehicleProvide` match creates an unload transfer from the vehicle dock to a current demander;
- the transfer records `vehicleUid`, `lineId`, `stopId`, `goodType`, `quantity`, `purpose`,
  `blocking`, and the immediate route demand or current sink it serves;
- only that transfer's live movement/reservation/allocation may block this stop.

This metadata is not a final destination label. It is a local promise label. It exists so the dock
does not reinterpret the same cargo as both "needed later" and "available now."

Dock candidates may explain why an advertisement should exist, but a candidate with no executable
source/sink is not a blocker.

### Forbidden states

These are invalid states, not edge cases to paper over:

- The same vehicle advertises both `demand(g)` and `provide(g)` at the same stop.
- Cargo counted in `routeReservedCargo[g]` advertises as current local provide.
- A current generic storage sink drains cargo while `remainingRouteNeed[g]` or
  `routeReservedCargo[g]` is positive.
- `allocated[g]` on the vehicle is ignored when calculating future route need.
- A dock stop blocks only because `vehicleDemand[g]` or `vehicleProvide[g]` was possible. It blocks
  only because a concrete transfer/reservation/movement exists.

## Blocking

Dock candidates should not block a vehicle by themselves.

A candidate means "this transfer would be useful if executable." It is not proof that the vehicle
must wait. Blocking should come only from explicit execution state:

- a blocking transfer;
- a live tracked movement for that transfer;
- a source or target reservation belonging to that transfer;
- virtual goods derived from that transfer.

If a stop has only unresolvable candidates, the vehicle may advance or replan according to the line
policy.

## Migration

Do not build a second transfer system beside `TrackedMovement`. Promote movement metadata toward an
explicit freight transfer record.

1. Add transfer metadata to dock-created tracked movements.
2. Record `vehicleUid`, `lineId`, `stopId`, `bayUid`, `direction`, `purpose`, and `blocking`.
3. Record local route promise data when available, such as `routeNeed`, `lineId`, or `nextStopId`;
   do not require a final consumer id.
4. Make vehicle advertised jobs and dock proposed jobs derive from the transfer metadata.
5. Make stale claim cleanup operate on transfer identity, not only provider/demander.
6. Replace dock blocking checks with "blocking transfer exists".
7. Keep `virtualGoodsCount` as a derived/debug completion signal, not the semantic owner.
8. If the metadata grows too large, extract a wrapper type around `TrackedMovement`.

## Named invariants

### `freight.transfer.blocking-transfer-has-executable-job`

If a docked vehicle has a blocking load or unload transfer, either an executable convey job exists
for its source side, or the transfer is claimed by a live worker executing that transfer.

### `freight.transfer.claim-has-live-convey-owner`

A claimed transfer must be owned by a worker currently running `work.convey` or `work.conveyStep`
for that transfer id.

### `freight.transfer.reserved-cargo-is-not-local-offer`

Cargo reserved for an ultimate demand or downstream line stop must not advertise as generic local
provide at the current stop.

### `freight.transfer.candidates-are-not-blockers`

Dock candidates may explain why a transfer should exist, but they do not block line advancement
unless a blocking transfer, reservation, or movement exists.

### `freight.transfer.transit-has-local-route-promise`

A transfer with purpose `transit` must name the local route, forwarding policy, or commitment it
serves. It does not need to name the final consumer. The receiving hive only needs enough local
intent to distinguish transit cargo from generic stock.
