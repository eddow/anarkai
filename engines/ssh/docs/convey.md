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
3. The worker begins a hop step (`ASingleStep`, currently `MultiMoveStep`). This step is also a `Commitment`.
4. The movement's current source commitment is finalized against the source storage — the good is removed from whatever storage it was sitting on.
5. The movement's source-commitment slot is rebound to the hop step while the good is in flight.
6. The worker calls `hop()` — the path shifts, and `from` becomes the next coordinate.
7. If the movement has more hops remaining, `place()` re-indexes it at the new position so another worker at the next tile can pick it up after the landing handoff.
8. A loose good visual is created and animated along the hop.

**Source commitment continuity.** A movement should always have a live, unfinished source commitment. At rest this commitment is registered as a `reserve` on storage. During a hop, the source commitment is the hop step itself. The visual `LooseGood` is only a renderer for that in-flight commitment; it is not the authoritative carrier of the good.

**No separate hop allocation object.** The hop step itself (`MultiMoveStep`, which extends `Commitment`) serves as the in-flight source commitment. If the hop reserves or allocates storage capacity, that storage bookkeeping is registered on the step commitment. The movement should keep referring to that same live source commitment while the hop is active.
### Handoff at intermediate borders
When a good lands on a border gate and still has hops left:
1. The first worker finishes their animation and runs the step's `onFulfilled` callback.
2. The hop step finalizes its storage bookkeeping at the destination. If it had an incoming allocation there, fulfilling the step commits that allocation into real stock.
3. A new **source reservation** is created on the border gate storage via `reserve` — the good is now "sitting" at this border.
4. The movement's source-commitment slot is rebound from the fulfilled hop step to this new border reservation commitment.
5. The claim is released.
6. The movement is now visible to workers at the neighboring alveolus, who can pick it up for the next hop.

The important invariant is not that the good is always represented by a storage reservation. It is that `TrackedMovement` always has a source commitment which has not yet been fulfilled or cancelled. That commitment may be registered on storage (`reserve`) or may be the active hop step (`ASingleStep`) while the good is in flight.
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
5. **Source commitment tracks the good** — `movement.allocations.source` is the current live commitment for the good. At rest it is a storage reservation; in flight it is the hop step commitment; after landing it is rebound to a new storage reservation at the landing storage.
6. **Movements survive hive reconstruction** — movement identity is preserved through topology changes as long as a valid path still exists. See [hive-refresh-and-good-movements.md](./hive-refresh-and-good-movements.md).

## Allocation Parity

At every point in a movement's life, the good must be **backed by a live source commitment**. A good is never logically orphaned, even when being animated between tiles.

A commitment can be registered against storage bookkeeping (`reserve` or `allocate`), but the storage bookkeeping is not the durable object. The durable reference is the `Commitment` stored on the movement.

### Booking at rest

When a movement sits at a tile or border (created, or after a hop completed and the claim was released):

```
  [source: reserve] ←── good ──→ [target: allocate]
```

The source storage holds a `reserve` token (outgoing promise). The target storage holds an `allocate` token (incoming room). The good exists in source storage's stock, reserved.

In movement terms:

```
movement.allocations.source = source reservation commitment
movement.allocations.target = final target allocation commitment
```

### Booking during a hop (in flight)

When a worker picks up the good and initiates a hop, the good transitions from "backed by source reservation" to "backed by the hop step commitment":

```
  Before pickup:
    movement.allocations.source
      └── registered as source storage reserve

  Worker claims + source fulfill:
    source storage reserve is fulfilled

  During animation:
    movement.allocations.source = hop step commitment
```

The good in a step executor is **not** a loose good. It is a good whose source commitment is the active hop step. The visual loose good is a display artifact. Logically, the good is in transit and still belongs to the same movement.

When the hop finishes, the hop step finalizes the destination storage mutation, then the movement replaces that fulfilled step commitment with a new source reservation commitment on the storage where the good landed.

### Source-commitment cardinality

A movement should have exactly one current source commitment:

1. **At rest** — the source commitment is registered as `reserve` on the storage currently holding the good.
2. **In flight** — the source commitment is the active hop step (`ASingleStep` / `MultiMoveStep`).
3. **After landing** — the fulfilled hop step is replaced by a new source reservation commitment on the landing storage.

The movement also keeps the **target allocation** for the final destination. That `allocate` on the demander storage is created at movement birth and persists for the movement lifetime.

The source commitment and target allocation are different roles. The source commitment follows the good's current carrier/location. The target allocation reserves final destination capacity.

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

During normal operation, goods are never loose. They are either storage-reserved (at rest) or step-commitment-bound (in flight).

### Parity invariants (summary)

1. **Every good in the convey system is backed by one live source commitment at all times** — either a storage `reserve` commitment (at rest) or the hop step commitment (in flight).
2. **Goods in flight are step-commitment-bound, not loose** — they logically occupy the step's lifecycle.
3. **A convey job only surfaces when its immediate next hop has room** — blocked movements stay in the blocked list.
4. **Twin allocation is maintained end-to-end** — the target `allocate` persists from creation to delivery; the source commitment is finalized and rebound as the good moves.
5. **Loose goods are exclusively a failure mode** — they signal that a hop was interrupted and allocations were cancelled.
