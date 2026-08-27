# Revision-less job planner

Status: **implemented (2026-08-26)** — the four revision *counters* are gone; the caches now derive
from local `Version`/`Cell` cells. The *global-sort retirement* (Phase 3 behavioral change) is still
pending and tracked in `plans/emergent-planning-architecture.md`. Direct follow-up to
`sandbox/version-token-hack-analysis.md` (which concluded the model revisions are the *last* residue
of the version-token workaround) and `plans/emergent-planning-architecture.md` (which retires the
global sort the revisions were keying).

## 1. The principle

> **The mutation is the invalidation — and the core never runs *through* mutts.**

A revision counter is a proxy for "some non-reactive state changed — please re-derive." It exists for
exactly two reasons, and only two:

1. **`@inert` reads** — `runInert`/`wrapInert`/`@inert` bump `inertDepth`, so anything read inside an
   `@inert` getter is *not* registered as a reactive dependency. The author must hand-signal "changed"
   because mutts can't.
2. **Non-reactive model state** — plain `Map`/`AxialKeyMap`/`Set` mutated in place (`movingGoods`,
   `pathCache`, `roadTypes`, deposits) that mutts cannot observe.

Both facts are **accepted**, not worked around: the core stays `@inert`, and mutts is reserved for the
UI reading *from* the core. The invalidation is a first-class, ad-hoc mechanism of its own — a
locally-owned **`Version` cell** (§5.1) that the mutator bumps and that `Derived` caches read:

- **`Cell` / `Version` / `Derived`** — the kernel's only cache. A `Derived` declares its deps (a
  `Version` cell, a `Cell`, or another `Derived`) and recomputes lazily when a dep's version advances.
  The mutator calls `version.bump()` (or `cell.set(...)`) in the same method that changes the guarded
  state. No counter, no compare against a global revision, and no `clear()` the author could forget.
- **Read fresh** — anything cheap (O(1) coord/flag/claim-slot lookups) is not memoized at all; it is
  read from authoritative state every time.

Every kernel revision is a **local, owned** `Version` cell (bumped by the mutation it guards), not a
global counter on `Game`/`Hive`. UI-only revision (the `work-planning.changed` presentation mirror)
stays in mutts, reading *from* the kernel.

## 2. The exact coupling to break

### 2.1 The `@inert` sites (9 total)

```
alveolus.ts:307  getJob
tile.ts:130      getJob
hive.ts:652      (hive pathfinding)
hive.ts:3301     (findNearest)
character.ts:863  findAction
character.ts:932/938  rankedWorkCandidates / resolveBestJobMatch
advertisement.ts:63   (advertisement read)
```

These `@inert` annotations are the *reason* `workPlanningRevision`/`conveyPlanningRevision`/
`candidateRevision` exist. Every one of them wraps a read of a `RevisionedCache` keyed on a counter.

**Decision:** keep **all nine** `@inert` sites. `@inert` is the correct tool: the planner/pathfinding
core must not pay mutts proxy overhead, and it must not register reactive deps it doesn't need. mutts
is reserved for the UI reading *from* the core. The revision counters are removed by giving the core
its **own** invalidation (per-entity `Cell`/`Version`/`Derived` + read-fresh), not by moving the core into mutts.

### 2.2 The non-reactive collections

| State | Today | Reads | Change |
|---|---|---|---|
| `board.contents` | ✅ `reactive(Map)` (§3.7) | tile content / burden / working | already reactive |
| `movingGoods` | `AxialKeyMap` (plain) | `hasConveyNearby`, convey jobs | **stay plain**; bump a convey `Version` at the `movement.*` mutators |
| `pathCache` | plain `Map` | `getPathDistance` | keep plain; `clear()` at topology mutators — the same pattern, could become a `Version` too |
| storage `stock` | `reactive([])` | measure/load/unload candidates | already reactive (UI-side); candidate `Derived`s over a storage `Version` |
| deposits / `UnBuiltLand.deposit` | plain fields | harvest targets | **stay plain**; bump a harvest `Version` at the deposit mutators |

## 3. Three replacement mechanisms (not "cached vs not-cached")

The earlier "hybrid / all-cached / all-recomputed" framing was an artifact of the counter. With the
counter gone there are three disjoint mechanisms, chosen by **what the value depends on**, not by
"is it a job". None of them is mutts reactivity — the core stays `@inert`:

| Mechanism | Applies to | Invalidation |
|---|---|---|
| **Retire** | the global sort / global scan (`rankedWorkCandidates`, `workPlannerSnapshot`, `collectTileWorkPicks`, vehicle `proposedJobs` global pick) | n/a — the machinery is deleted |
| **`Cell`/`Version`/`Derived`** | scalar authoritative state + owned change signals + lazy derived values — the kernel's only cache (spatial flood/path, convey over `movingGoods`, per-entity job lists) | version-compare on read — recomputes only when a declared dep advanced; no manual invalidate |
| **Read fresh** | cheap economic checks (burden/working flag, claim slot, `movingGoods` coord lookup) | none — no memo, so nothing to invalidate |

> **Naming.** §4's tables use "`Cell`/`Derived`" for scalar-backed per-entity inputs and "`Version` +
> `Derived`" for collection/graph-backed caches (`movingGoods`, geometry). A `Version` is just a
> bump-only `Cell` — the owned "revision" — so both are the same primitive: the kernel's own cell,
> compared on read.

## 4. Site-by-site elimination

### 4.1 `workPlanningRevision` (the job planner) — 10 read sites → all eliminated

| Read site | What it is | Mechanism |
|---|---|---|
| `character.ts:940` `rankedWorkCandidatesCached` | memo of the **global sort** | **retire** (Phase 3: ads replace the sort) |
| `character.ts:215` `workPlannerSnapshotCache` | snapshot of the ranked plan | **retire** |
| `character.ts:992,1100` | `workPlanningRevision` in trace/job metadata | delete the field |
| `alveolus.ts:268` `proposedJobsCache` | per-tile job list | **`Derived`** — over the tile's own `Cell`s/`Version` (§5.1) |
| `alveolus.ts:316` `jobByCharacterCache` | per-character job | **read fresh** — authoritative claim state (§5.3) |
| `vehicle/entity.ts:339` `proposedJobsCache` | per-vehicle job list | **`Derived`** — over the vehicle's own `Cell`s/`Version` |
| `vehicle/entity.ts:353` `advertisedJobsCache` | per-vehicle ads | **`Derived`** — same |
| `tile-work.ts:78` `pathToTileCache` | per-(character,tile) path for inspector | **`Derived`** — a pathfind over `transitVersion` |
| `tile-work.ts:108` `tileWorkPicksCache` | inspector's per-tile ranked list | **retire** — the inspector reads per-tile ads + per-character plan |
| `work.ts:324` | `workPlanningRevision` carried on a job | delete the field |

### 4.2 `candidateRevision` (vehicle candidates) — 4 read sites → `Cell`/`Derived` + `Version` + read-fresh

`candidateRevision` was introduced (2026-08-26) to separate "ownership" from "board/storage" changes.
That whole distinction evaporates: ownership is authoritative state read fresh (§5.3), and the
candidate lists become `Derived` over the storage/goods/zones state (a `Version` bumped by those
mutators), so they recompute only when a real input changes.

| Read site | What it is |
|---|---|
| `freight-stop-utility.ts:583` `memoizedStopMeasure` | `measureFreightStop{Needed,Provided}Goods` → `Derived` over a storage `Version` |
| `vehicle-run.ts:469` `pickInitialVehicleServiceCandidate` | → `Derived` over storage/goods/zones `Version` |
| `vehicle-work.ts:1165` `loadUnloadCandidatesCache` | → `Derived` over storage/goods `Version` |
| `vehicle-zone-browse.ts:355` zone-browse candidates | → `Derived` over zones/storage `Version` |

### 4.3 `transitRevision` (spatial) — 3 read sites → a single `transitVersion` cell ✅ done

Spatial caches depend only on geometry (tile content blocking, walk cost, roads), which changes rarely
and is shared across all readers. `Game` owns a `transitVersion: Version` (bumped by
`invalidateTransit`, called from `setTileContent`/`setRoadType`/terrain/`HexBoard.reset`); each cache is
a `Derived` over it that yields a fresh `Map` per geometry and populates lazily per key.

| Read site | What it is | Invalidation |
|---|---|---|
| `board.ts` `vehicleNeighborsMemo` | per-tile transit neighbours | `Derived(() => new Map(), [transitVersion])` |
| `board.ts` `unboundedServicePathCache` | unbounded vehicle service path | same |
| `vehicle-work.ts` reachability flood cache | `maintenanceReachabilityFlood` | `Derived(() => new Map(), [game.transitVersion])` |

The precedent was `hive.ts:872 invalidatePathCache() { this.pathCache.clear() }`; the `Version` cell is
that pattern made compare-on-read: the mutator bumps one owned cell, the caches recompute lazily, and
there is no `clear()` to forget.

### 4.4 `conveyPlanningRevision` (convey) — 7 read sites → a `conveyVersion` cell + read-fresh

The convey mutations are already centralized as methods on `Hive` (claim/hop/finish/abort/offload/
discard/forget/untrack/track) — they are the co-located mutation points. `movingGoods` stays a plain
`AxialKeyMap`; `Hive` owns a `conveyVersion: Version` bumped by those same methods, and the convey
`Derived`s declare it as a dep. Cheap coord lookups (`hasConveyNearby`) are read fresh (no memo).
`invalidateConveyPlanning(reason)` becomes `this.conveyVersion.bump()` at the same call sites.

| Read site | What it is |
|---|---|
| `alveolus.ts:232` `conveyNearbyCache` | O(1) `movingGoods` lookup → **read fresh**, no memo |
| `alveolus.ts:323` `jobByCharacterCache` convey key | **read fresh** claim state (§5.3) |
| `alveolus.ts:408` `goodMovementCache` | **`Derived`** over `conveyVersion` |
| `alveolus.ts:635` `incomingGoodsCache` | **`Derived`** over `conveyVersion` |
| `alveolus.ts:268` (convey half of the key) | same |
| `vehicle/entity.ts:353` (convey half) | same |
| `hive.ts:564` `invalidateConveyPlanning` + ~25 call sites | become `conveyVersion.bump()` (same call sites) |

## 5. The revision-less data model

### 5.1 `Cell` / `Derived` — the kernel's own reactivity (mutts-free, Rust-portable)

The kernel primitive is a versioned **cell** and a lazily-computed **derived** value over a
*statically-declared* set of deps. No mutts: no proxy, no read-time dependency tracking, no listener.
The invalidation is a version compare on read. (Full source: `utils/cell.ts`.)

```ts
interface Versioned { versionOf(): number }

class Cell<T> implements Versioned {
  private value: T
  private version = 0
  constructor(value: T) { this.value = value }
  get(): T { return this.value }                 // plain read — inert-safe, registers nothing
  set(next: T): void {                           // the ONLY write path
    if (Object.is(next, this.value)) return
    this.value = next
    this.version++
  }
  versionOf(): number { return this.version }
}

class Version implements Versioned {            // a bump-only Cell: the owned "revision"
  private version = 0
  bump(): void { this.version++ }               // called in the same method that mutates the guarded collection
  versionOf(): number { return this.version }
}

class Derived<T> implements Versioned {
  private cached!: T
  private has = false
  private lastDepsSum = 0
  private version = 0
  constructor(
    private readonly compute: () => T,
    private readonly deps: readonly Versioned[]  // deps DECLARED, not tracked
  ) {}
  get(): T {                                      // lazy: recompute only if a dep advanced
    const v = this.depsSum()
    if (!this.has || v !== this.lastDepsSum) {
      const next = this.compute()
      if (!this.has || !Object.is(next, this.cached)) { this.cached = next; this.version++ }
      this.lastDepsSum = v
      this.has = true
    }
    return this.cached
  }
  versionOf(): number { return this.version }
  // Sum (NOT max): versions are monotonic, so the sum changes iff any dep advanced. Max would miss
  // a non-max dep advancing (e.g. [1000,1] → [1000,2] leaves max unchanged → stale).
  private depsSum(): number {
    let s = 0
    for (const d of this.deps) s += d.versionOf()
    return s
  }
}
```

On the entity:

```ts
// deposit.amount becomes a Cell; writers call set(), readers call get()
readonly amount = new Cell(100)

// alveolus.proposedJobs becomes a Derived over its cells
proposedJobs = new Derived(() => this.computeProposedJobs(), [this.working, this.deposit.amount])
```

**The rules that make this safe:**

1. **The cell owns the value.** A memoized input is a `Cell`; code may only mutate it through `set()`.
   Exposing a getter-only property (`get amount() { return this.#amountCell.get() }`) makes a write a
   compile error. In Rust this is the same: the field is private, only the cell methods touch it.
2. **References held by a cell are treated as immutable.** If a `Cell` holds an array/object, code
   replaces it with `set()` (never mutates in place) and readers see a `readonly` view. The cell is
   the only write path.
3. **Collections stay plain → guarded by a `Version`, not a `Cell`.** `movingGoods`, `board.contents`,
   storage arrays are mutated in place and cannot be `Cell`s (you'd re-`set` the whole map each tick).
   They are guarded by a `Version` bumped by their mutator; the consumers are `Derived`s that declare
   the `Version` and yield a fresh container per version (§4.3/§4.4). Scalar state → `Cell`; collection
   state → `Version`. Both are the same version-compare-on-read primitive.

`Version`+`Derived` is the kernel's whole invalidation model: same lazy pull, same inert-safety, and
the "forgotten invalidation" bug is **structurally impossible** for scalar state (the `Cell` owns the
value and `set()` auto-bumps) — deps are declared and compared by version on read, so a reader can
never go stale.

A fourth convenience helper, **`GenerationCache<T>`** (`utils/cell.ts`), wraps the common
"`Derived` that yields a fresh `Map` per version, populated lazily per key" shape — the direct
replacement for the deleted `KeyedRevisionedCache`. `getOrCompute(owner, version, key, compute)`
keyed the per-owner `Derived` by `owner` (a `WeakMap`) and compares the owner's `Version` on read.

### 5.2 Identity at claim, not at creation

`Job` stays a lightweight **derived** value with no stable identity (it is produced by the `Derived`
value, and its identity is "the getter's current output"). Identity is introduced only at the claim
edge:

- `character.job` (0..1) — the claimed job, authoritative.
- `alveolus.executedJob` (0..1) — the at-most-one-worker slot (subsumes the current
  `assignedWorker`/`assignedAlveolus` single-slot mutual exclusion, per emergent-plan Q4).
- optional `job.source` (alveolus | tile | vehicle | undefined).

Unclaimed jobs are never stored as entities; claiming *is* the only place a job becomes a stable,
referenceable object. Reservation-based suppression (goods reserved, `executedJob` set) makes the
`Derived` value naturally return "nothing" for already-claimed work, instead of
`computeJobForCharacter` reading `assignedWorker` and returning `undefined`.

### 5.3 Authoritative state is read fresh — no cache, no invalidation

Operator/service/assignment, goods reservations, `executedJob`, construction progress, hive needs are
plain fields (mutts-reactive only where the UI reads them; the core reads them `@inert`). The decision
loop reads them O(1). `invalidateWorkPlanningAllocation`
(`character.assignment`, `vehicle.operator/service`) is deleted — the mutation is the invalidation.

## 6. Migration order (each step green, independently revertible)

1. **Introduce `Cell` / `Version` / `Derived`** (no behavior change): `utils/cell.ts`, purely additive.
   Both TS and (later) Rust mirror this exact shape. ✅ done.
2. **Introduce the `transitVersion` cell + convert the spatial caches** (§4.3): add
   `Game.transitVersion` (a `Version`), bump it in `invalidateTransit`, and make `vehicleNeighborsMemo`,
   `unboundedServicePathCache`, reachability flood `Derived`s over it. Delete `_transitRevision`. ✅ done.
3. **Introduce a `conveyVersion` cell + convert the convey caches** (§4.4): replace
   `invalidateConveyPlanning` with `conveyVersion.bump()` at the existing `movement.*` call sites;
   `conveyNearby` becomes read-fresh. Delete `_conveyPlanningRevision` (the `conveyPlanningRevision`
   getter stays as a `versionOf()` shim). ✅ done.
4. **Convert the per-entity job/candidate caches to `Cell`/`Version`/`Derived`** (§4.2, §5.1):
   `memoizedStopMeasure`, `pickInitialVehicleServiceCandidate`, `loadUnloadCandidatesCache`,
   zone-browse, `Alveolus`/`Vehicle.proposedJobs`. Delete `_candidateRevision` (replaced by
   `candidateVersion` cell) and the `RevisionedCache`/`KeyedRevisionedCache` utility. ✅ done.
5. **Eliminate `workPlanningRevision` + convert the job caches** (§4.1): replace `_workPlanningRevision`
   with `workPlanningVersion` cell; convert `proposedJobs`/`advertisedJobs`/`jobByCharacter`/
   `pathToTile`/`tileWorkPicks`/`vehicleWorkPicks`/`rankedWorkCandidatesCached`/`workPlannerSnapshot`
   to `Derived`/`GenerationCache`; the `workPlanningRevision` getter stays as a `versionOf()` shim for
   the `work-planning.changed` event + the invalidation-semantics tests. ✅ done.
6. **Retire the global sort** (§4.1, emergent-plan Phase 3): per-tile ad getters + ad consumption;
   delete `rankedWorkCandidates` / `rankedWorkCandidatesCached` / `workPlannerSnapshot` /
   `resolveBestJobMatch` / `collectTileWorkPicks`. **Deferred** — this is the behavioral core, not a
   revision-elimination concern; tracked in `emergent-planning-architecture.md`. When it lands, the
   `workPlanningRevision` shim getter + the `work-planning.changed` presentation event can also be
   retired (the inspector then reads per-tile ads + per-character plan reactively).

Note: **no step makes the core reactive.** `movingGoods`, deposits, `pathCache` stay plain; the core
stays `@inert` throughout. mutts remains UI-only.

## 7. Risks / measurement

- **Forgotten `bump()` on a collection — the only residual failure mode, and it is a co-located omission.**
  Scalar state has *no* such risk: the `Cell` owns the value, so the only write path is `set()`, which
  auto-bumps — a stale read is structurally impossible. The risk survives only for **collection/graph
  state** guarded by a `Version` (`movingGoods`, geometry): the collection is mutated in place, so a
  mutator could change it without calling `version.bump()`, and the `Derived` (which compares the
  version) would then not recompute.

  Concretely, a reachability flood `Derived` over `transitVersion`:

  ```ts
  // The promise that must never be broken (collection-state only):
  tile.content = wall              // (1) the geometry change…
  game.invalidateTransit('x')      // (2) …and the version bump, together
  ```

  If someone adds a *new* geometry mutation that reaches line 1 but forgets line 2, the flood keeps
  returning the pre-wall reachability — a character walks into a wall forever. The old *global* counter
  hid this bug (any bump re-derived everything); the *local* `Version` makes the `bump()` a single,
  visible, co-located call — and every one of those mutation sites already exists today (they call
  `invalidate*`), so the surface area does not grow.

  Mitigations, in order of strength:
  1. **Co-locate** — put the `bump()` in the *same method* as the mutation, so the pair is one unit.
  2. **Prefer `Cell` over `Version`** — push as much state into `Cell`s (value-owned, auto-bump) as
     possible; reserve `Version` for genuinely in-place collections.
  3. **Read-fresh by default** — only memoize a value that is *expensive* and *read many times between
     changes*. Cheap flags (`hasConveyNearby`, claim slots, `isBurdened`) are read fresh and therefore
     *cannot* go stale.
- **Deriving/memoizing something cheap** is the other failure mode (same as the old "don't precompute
  an O(1) function" rule). `hasConveyNearby` and claim-slot reads must stay read-fresh, not become
  `Cell`/`Version`/`Derived`.
- **No mutts coupling in the core.** Keep `Cell`/`Version`/`Derived` plain classes (no `effect`, no
  `memoize`, no reactive deps), and `markRaw` the `Version` instances stored on `@reactive` objects. A
  future Rust port reproduces them as `Cell<T> { value, version }` / `Version { version }` / `Derived<T>`
  — zero reactive machinery to re-implement.
- **Flood caches stay `@inert`** + `Derived` over `transitVersion`: they are the hot, shared, expensive
  path where a plain memo is wanted and mutts reactivity is not.

## 8. What is deleted vs. what survives

**Deleted:** the four integer counters `_workPlanningRevision` / `_candidateRevision` /
`_transitRevision` / `_conveyPlanningRevision`, and the `RevisionedCache`/`KeyedRevisionedCache`
utility (replaced by `Cell`/`Version`/`Derived` + `GenerationCache`).

**Repurposed:** `invalidateWorkPlanning` / `invalidateWorkPlanningAllocation` now bump
`workPlanningVersion`; `invalidateTransit` bumps `transitVersion` (+ `candidateVersion`);
`invalidateConveyPlanning` bumps `conveyVersion` (+ `invalidateWorkPlanning`). The `workPlanningRevision`
and `conveyPlanningRevision` **getters survive as `versionOf()` shims** — read by the
`work-planning.changed` presentation event, the invalidation-semantics tests
(`work-planning-revision.test.ts`, `script_execution_regressions.test.ts`), and the maintenance bench.

**Survives (unchanged):** the `@inert` core, the flood/pathfind machinery (now `Derived` over
`transitVersion`), `pathCache`, reactive `board.contents` + storage (UI-side), the advertisement system,
the claim/reservation pattern (`tryReservePendingMovementIntent`, `canGive`/`canTake`), and the
`work-planning.changed` presentation event (its `revision` now sourced from `workPlanningVersion`).

## Related

- `sandbox/version-token-hack-analysis.md` — the inventory this plan closes out (§3.4/§3.5 "retained"
  items are the ones reversed here).
- `plans/emergent-planning-architecture.md` — Phase 3 (ad-driven work) + Q1–Q4; this plan is its
  invalidation spine.
- `engines/ssh/src/lib/utils/cell.ts` — `Cell` / `Version` / `Derived`, the kernel primitive.
- `engines/ssh/src/lib/hive/hive.ts:872` — `invalidatePathCache()`, the pre-existing clear-at-mutator
  pattern the `Version` cell generalizes.
