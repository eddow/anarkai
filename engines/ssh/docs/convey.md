# Convey System
This document describes how goods move between alveoli inside a hive. The convey system is the logistics backbone: it decides *what* needs to move, *where* it goes, and then physically relays it border-by-border until it arrives.
## Overview
A convey pipeline is a chain of cooperative steps:

```
Advertisement → Movement Creation → Worker Pickup → Border Hops → Delivery
```

There is no central scheduler dispatching goods. Instead, each alveoli pair negotiates transfers through an **advertisement board**, workers pick up work from whatever movement is waiting at their tile, and the good hops across border gates until it reaches its destination.
## Advertisement Board
Every hive runs an advertisement board where alveoli publish what they **provide** (surplus goods) and what they **demand** (goods they need). This is the sole mechanism that triggers new movements.
### How a match happens
1. An alveolus computes its `goodsRelations` — for each good type it knows, it decides whether it is a provider or a demander, and at what priority.
2. The hive's `advertise()` method registers the alveolus into a per-good-type bucket keyed by priority (`0-store`, `1-buffer`, `2-use`).
3. When a provider and a demander for the same good type appear on opposite sides of the board, the system tries to match them. It picks the nearest reachable partner via pathfinding and calls `createMovement`.
### Priority tiers
| Priority   | Meaning               | Typical user                           |
| ---------- | --------------------- | -------------------------------------- |
| `0-store`  | Internal buffer drain | Transit tiles pulling from a warehouse |
| `1-buffer` | Medium urgency        | Transforms feeding downstream          |
| `2-use`    | Direct consumption    | A sawmill demanding wood               |
Higher-priority providers serve higher-priority demanders first. Lower-tier demanders are invisible to `0-store` providers to prevent warehouses from routing goods sideways instead of downstream.
### General storage fallback
If no direct provider-demander match exists, the hive tries routing through its general-purpose storage alveoli. This lets producers dump goods into a warehouse even when no consumer is currently online, and lets consumers pull from that same warehouse later. Storage-to-storage routing via this fallback is explicitly forbidden.
## Twin Allocation
Before a movement is created, two reservations must succeed atomically:
| Side                  | Operation  | Meaning                                      |
| --------------------- | ---------- | -------------------------------------------- |
| **Source** (provider) | `reserve`  | Locks 1 unit of the good as "about to leave" |
| **Target** (demander) | `allocate` | Locks 1 unit of room as "about to arrive"    |
Both must succeed or both are rolled back. This **twin allocation** prevents:
- Orphaned reservations that sit forever on a provider,
- Phantom room reservations that block a demander from accepting other goods.
Once both tokens are held, the movement is committed and placed on the board.
## Movement Lifecycle
A `TrackedMovement` goes through these states:

```
tracked → claimed → delivering → completed ↘ aborted
```

### Birth: `createMovement`
1. Find a path through the hive's border network.
2. Twin-allocate source reservation + target room.
3. Create the movement object with the full hop path.
4. `place()` the movement at the provider tile — it becomes visible to workers via `movingGoods`.
### Pickup: `conveyStep` (worker)
When a worker's NPC script calls `conveyStep`:
1. The worker scans `aGoodMovement` on their assigned alveolus — this collects any unclaimed movement sitting on the tile or its surrounding borders.
2. The worker **claims** the movement (sets `claimed = true`, `claimedBy = self`). This prevents any other worker from touching it.
3. The worker **fulfills the source reservation** — the good is removed from whatever storage it was sitting on.
4. The worker calls `hop()` — the path shifts, and `from` becomes the next coordinate.
5. If the movement has more hops remaining, `place()` re-indexes it at the new position so another worker at the next tile can pick it up.
6. A loose good visual is created and animated along the hop.

**No preflight hop allocation.** Unlike the old system, the worker does *not* pre-allocate room at the next hop before starting the animation. Instead, hop allocation is deferred to the step's `onFulfilled` callback (see below). This means:
- No capacity is held during transit — the good is in the character's hands (as a `LooseGood`).
- If there's no room at the next hop when the character arrives, the allocation fails in `onFulfilled`, which throws `ConveyStaleBookkeepingError`. This is an invariant failure, not a recovery path.
- No separate `hopCommitment` object is needed — the step itself (`MultiMoveStep`, which extends `Commitment`) serves as the allocation commitment.
### Handoff at intermediate borders
When a good lands on a border gate and still has hops left:
1. The first worker finishes their animation and runs the step's `onFulfilled` callback.
2. The step (a `MultiMoveStep`, which extends `Commitment`) allocates room at the next hop via `nextStorage.allocate({ [goodType]: 1 }, step)`. The step itself is the commitment — when the step fulfills, the allocation is committed; if the step were cancelled, the allocation would roll back.
3. A new **source reservation** is created on the border gate storage via `reserve` — the good is now "sitting" at this border.
4. The claim is released.
5. The movement is now visible to workers at the neighboring alveolus, who can pick it up for the next hop.

**Why defer allocation?** The old system used preflight allocation — it created a separate `hopCommitment` and called `nextStorage.allocate()` *before* the character started walking. This had several problems:
- Capacity at the next hop was held during the entire transit duration.
- If the allocation failed (no room), the character never started walking — but the error handling was complex.
- A separate `Commitment` object was needed per movement, tracked in `MovementData.hopAlloc`.
- The cycle leader had a special `skipPreflight` path that deferred allocation to `onFulfilled`, creating two code paths.

The deferred approach eliminates all of these: no capacity held during transit, no separate hop allocation object, and all movements (including cycle leader) allocate identically in `onFulfilled`.
### Delivery: `finish`
When the last hop lands on the demander tile:
1. The target allocation is **fulfilled** — the room reservation becomes real stock.
2. The source allocation auto-fulfills (the good is gone from wherever it last was).
3. The movement is removed from tracking and completes.
### Failure: `abort`
If anything goes wrong (path broken, storage destroyed, allocation invalid), the movement is aborted:
- Both source and target allocations are cancelled.
- The good is dropped as a loose good at its last known position.
## Path Structure
Convey paths live on a **dual graph** of tiles and border edges:

```
Provider Tile → Border Gate → Border Gate → ... → Demander Tile
```

The path is computed once at movement creation and stored verbatim. Its shape is:
- Zero or more border coordinates (hops across `AlveolusGate` edges),
- Ending with exactly one tile coordinate (the demander).
A border gate sits between two tiles. Each gate has a `SlottedStorage` that acts as a **relay buffer** — a tiny staging area where goods park between hops. Gates exist only where two alveoli in the same hive are direct neighbors.
Pathfinding traverses tile → gate → tile → gate → ... by checking:
- Can a good exit this tile? (tile must have a gate toward the neighbor)
- Can a good enter the next tile? (must be a relay-eligible alveolus or the destination)
## Worker Job Selection: `aGoodMovement`
An alveolus exposes `aGoodMovement` — the set of movements a worker there can act on right now. It checks:
1. **Border movements first** — scan all surrounding borders for unclaimed movements.
2. **Tile movements** — check for movements sitting at the tile center itself.
3. **Advance check** — can the movement actually take its next step? (Is there room at the next border?)
4. If a movement is blocked (no room at next hop), it goes into a `blocked` list instead.
5. **Cycle detection** — if all movements are blocked, run a DFS to detect circular deadlocks. If a cycle is found, return the entire cycle so the worker can resolve it atomically in a single `conveyStep`.
### Cycle resolution
When multiple movements form a circular blockade (A's next hop is B's position, B's next hop is C's position, C's next hop is A's position), a single worker picks up **all** movements in the cycle simultaneously. The worker:
- Fulfills all sources in order,
- Hops all movements in one batch.

**No special cycle leader path.** Unlike the old system, there is no `skipPreflight` or `cycleLeaderHandled` logic. All movements in the cycle allocate identically in `onFulfilled` — the step itself is the allocation commitment. This works because the step's `onFulfilled` runs after the animation completes, at which point the cycle leader's hop has already freed room for the next movement.
## Watchdog

A background watchdog scans for stalled or broken state:

| Scan                 | What it catches                                                                 |
| -------------------- | ------------------------------------------------------------------------------- |
| Stalled exchanges    | Provider can give, demander needs, no movement exists yet after a settle period |
| Stuck claims         | A movement has been claimed too long with no active convey worker               |
| Detached allocations | Source/target allocations that belong to movements no longer tracked            |

The watchdog does not recreate or repair movements. Non-structural movement violations throw so tests and manual dev runs expose broken bookkeeping immediately. Structural teardown can still cancel allocations and discard movements for removed topology. The watchdog is suppressed during hive topology reconstruction.

### Scope reduction with Option B

With the deferred hop allocation (Option B), the watchdog no longer needs to handle preflight allocation failures:

- **No orphaned hop allocations** — the step itself is the allocation commitment; its lifecycle (fulfill/cancel) automatically governs the allocation.
- **No preflight failure recovery** — if allocation fails in `onFulfilled`, it throws `ConveyStaleBookkeepingError`.
- **No `skipPreflight`/`cycleLeaderHandled` paths** — all movements allocate identically in `onFulfilled`.

The watchdog still handles structural teardown:
- **Structural teardown** — alveolus destroyed mid-convey, movement needs cleanup.
## Key Invariants
1. **Twin allocation is atomic** — a movement never exists with only one side reserved.
2. **One active movement per (provider, demander, goodType)** — `hasActiveMovement` prevents duplicate movements for the same triplet.
3. **Claimed movements are invisible to other workers** — `aGoodMovement` skips `claimed === true` entries.
4. **Border gates are the only relay points** — goods never sit on arbitrary positions, only on tile centers or gate borders.
5. **Source allocation tracks where the good currently is** — as the good hops, the source allocation is re-assigned to the new border/tile storage.
6. **Movements survive hive reconstruction** — movement identity is preserved through topology changes as long as a valid path still exists. See [hive-refresh-and-good-movements.md](./hive-refresh-and-good-movements.md).

## Allocation Parity

At every point in a movement's life, the good must be **backed by at least one storage token**. A good is never logically orphaned, even when being animated between tiles.

### Booking at rest

When a movement sits at a tile or border (created, or after a hop completed and the claim was released):

```
  [source: reserve] ←── good ──→ [target: allocate]
```

The source storage holds a `reserve` token (outgoing promise). The target storage holds an `allocate` token (incoming room). The good exists in source storage's stock, reserved.

### Booking during a hop (in flight)

When a worker picks up the good and initiates a hop, the good transitions from "backed by source reservation" to "backed by the step executor":

```
  Before pickup:
    [source storage: reserve] ←── good

  Worker claims + source fulfill:
    good is now in flight (loose good visual)

  During animation (step executor):
    good is step-executor-bound, no separate hop allocation
```

The good in a step executor is **not** a loose good. It is a good whose storage backing will be established when the step fulfills. Logically the good is in transit — the step's `onFulfilled` callback will allocate room at the next hop using the step itself as the commitment.

**Key difference from the old system:** There is no separate hop allocation during transit. The old system created a `hopAlloc` (a separate `Commitment`) during preflight, which held capacity at the next hop for the entire transit duration. The new system defers allocation to `onFulfilled`, so no capacity is held during transit.

### Reservation-side cardinality

A good in flight may pair with **one** allocation token:

1. **Target allocation** — the `allocate` on the final destination storage (created at movement birth). This persists for the entire movement lifetime.

The hop allocation is no longer a separate token. Instead, the step's `onFulfilled` callback allocates room at the next hop using the step itself as the commitment. This means:
- The step's lifecycle governs the allocation: when the step fulfills, the allocation is committed; if the step is cancelled, the allocation rolls back.
- No capacity is held during transit.
- All movements (including cycle leader) use the same allocation path.

### Job visibility rule

A convey job (movement visible for pickup via `aGoodMovement`) must only surface when the hop preflight can succeed. If a worker at tile S sees a movement that wants to hop onto border B, but border B has no room, that movement must not appear as an actionable job from tile S.

This is safe because:
- If a good arrived at tile S from tile X, it is because it needs to pass through S on its way to its destination.
- That arrival itself creates a convey job at S.
- If border B is full, the job correctly stays blocked — another good at S that *does* have room on its next hop will surface instead, or the cycle resolver will handle it.
- Jobs never silently disappear; a blocked job remains blocked until room opens.

### Loose goods are only for failures

A good becomes a loose good **only** when a hop is cancelled mid-flight (step executor interrupted). In that case:
- The step's `onCancelled` callback releases the claim and cancels the movement.
- The good is dropped at its last committed position as a loose good for the player or another system to collect.

During normal operation, goods are never loose. They are either storage-reserved (at rest) or step-executor-bound (in flight, awaiting allocation on fulfillment).

### Parity invariants (summary)

1. **Every good in the convey system is backed by at least one storage token at all times** — either a `reserve` (at rest) or an `allocate` (in flight, or at the final destination).
2. **Goods in flight are step-executor-bound, not loose** — they logically occupy the step's lifecycle, and the hop allocation is deferred to `onFulfilled`.
3. **A convey job only surfaces when its immediate next hop has room** — blocked movements stay in the blocked list.
4. **Twin allocation is maintained end-to-end** — the target `allocate` persists from creation to delivery; intermediate hop allocations are created on step fulfillment.
5. **Loose goods are exclusively a failure mode** — they signal that a hop was interrupted and allocations were cancelled.
