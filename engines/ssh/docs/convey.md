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
3. The worker allocates room at the **next** hop (`hopAlloc`) unless this is the terminal hop.
4. The worker **fulfills the source reservation** — the good is removed from whatever storage it was sitting on.
5. The worker calls `hop()` — the path shifts, and `from` becomes the next coordinate.
6. If the movement has more hops remaining, `place()` re-indexes it at the new position so another worker at the next tile can pick it up.
7. A loose good visual is created and animated along the hop.
### Handoff at intermediate borders
When a good lands on a border gate and still has hops left:
1. The first worker finishes their animation and runs the `.finished` callback.
2. The `hopAlloc` at the border is **fulfilled** (the room that was reserved is now actually occupied).
3. A new **source reservation** is created on the border gate storage via `reserve` — the good is now "sitting" at this border.
4. The claim is released.
5. The movement is now visible to workers at the neighboring alveolus, who can pick it up for the next hop.
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
- Pre-allocates room at each hop,
- Fulfills all sources in order,
- Hops all movements in one batch.
This breaks the deadlock because the worker skips individual `hopAlloc` preflight for the non-leader movements in the cycle (the leader's hop frees room for the next).
## Watchdog

- Watchdog should *not* be on `setInterval` as game-time is not the same as computer-time
- Watchdog *should* be on `seInterval` for the time we develop and solidify conveying algorithm so its behavior stands out from the remaining
- Ideally, when the algorithm is robust enough, we don't need the watchdog anymore

A background watchdog scans for stalled or broken state:
| Scan                 | What it catches                                                                 |
| -------------------- | ------------------------------------------------------------------------------- |
| Stalled exchanges    | Provider can give, demander needs, no movement exists yet after a settle period |
| Stuck claims         | A movement has been claimed too long with no active convey worker               |
| Detached allocations | Source/target allocations that belong to movements no longer tracked            |
The watchdog recreates stalled movements, releases orphaned claims, and cancels ghost allocations. It is suppressed during hive topology reconstruction.
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

When a worker picks up the good and initiates a hop, the good transitions from "backed by source reservation" to "backed by hop-target allocation":

```
  Before pickup:
    [source storage: reserve] ←── good

  Worker claims + preflight:
    [next-hop storage: allocate] ←── good    (new)
    [source storage: reserve]   ←── good     (about to fulfill)

  After source fulfill:
    [next-hop storage: allocate] ←── good    (good is now in flight)

  During animation (step executor):
    good is step-executor-bound, paired with the hop allocation
```

The good in a step executor is **not** a loose good. It is a good whose storage backing is the `allocate` token at the hop destination. Logically the good already occupies that destination slot — it is just not physically placed there yet.

### Reservation-side cardinality

A good in flight may pair with **up to two** allocation tokens:

1. **Target allocation** — the `allocate` on the final destination storage (created at movement birth). This persists for the entire movement lifetime.
2. **Hop allocation** — the `allocate` on the intermediate border or next tile (created during preflight). This covers the current hop and is fulfilled when the good lands.

Both are `allocate` tokens (room promises), not `reserve` tokens. The good does not need a `reserve` anywhere while in flight — it has already left its source. The two allocations represent "this room is taken" at two different levels: the final destination, and the immediate next step.

### Job visibility rule

A convey job (movement visible for pickup via `aGoodMovement`) must only surface when the hop preflight can succeed. If a worker at tile S sees a movement that wants to hop onto border B, but border B has no room, that movement must not appear as an actionable job from tile S.

This is safe because:
- If a good arrived at tile S from tile X, it is because it needs to pass through S on its way to its destination.
- That arrival itself creates a convey job at S.
- If border B is full, the job correctly stays blocked — another good at S that *does* have room on its next hop will surface instead, or the cycle resolver will handle it.
- Jobs never silently disappear; a blocked job remains blocked until room opens.

### Loose goods are only for failures

A good becomes a loose good **only** when a hop is cancelled mid-flight (step executor interrupted). In that case:
- The hop allocation is cancelled,
- The target allocation is cancelled,
- The good is dropped at its last committed position as a loose good for the player or another system to collect.

During normal operation, goods are never loose. They are either storage-reserved (at rest) or step-executor-bound (in flight, answering an allocation).

### Parity invariants (summary)

1. **Every good in the convey system is backed by at least one storage token at all times** — either a `reserve` (at rest) or an `allocate` (in flight).
2. **Goods in flight are step-executor-bound, not loose** — they logically occupy the hop target's allocation.
3. **A convey job only surfaces when its immediate next hop has room** — blocked movements stay in the blocked list.
4. **Twin allocation is maintained end-to-end** — the target `allocate` persists from creation to delivery; intermediate `allocate` tokens cover each hop segment.
5. **Loose goods are exclusively a failure mode** — they signal that a hop was interrupted and allocations were cancelled.

