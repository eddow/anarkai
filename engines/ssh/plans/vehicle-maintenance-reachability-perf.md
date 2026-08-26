# `pickMaintenanceForVehicle` → `canReach` — performance analysis

Status: analysis + **measured & optimized across 5 rounds** (2026-08-26). Sandbox scratch doc; the plan
that follows is `plans/rust-migration-continuation.md`.

> Measured figures come from `tests/unit/zz-maintenance-bench.test.ts` (radius-14 concrete board,
> 5 wheelbarrows on a gather line, 5 characters, loose wood), output in `sandbox/maintenance-bench.txt`.
> Trajectory (`collectVehicleWorkPicks` ×5): **~830 → 422 → 313 → 148 → 108 ms**.

## The `canReach` architecture problem (the recurring 1.6s frames)

`canReach` is called once per candidate tile, per candidate scan, per vehicle, per character. It used
to split on tile kind:

- non-blocking tile → `reachable.has(goal)` (O(1) against the flood), **but**
- blocking tile → `findPathForVehicleServiceBorder` → `findPathForVehicle` = a **full A\***.

A village has many blocking tiles (alveoli, dwellings), and the load scan is the only one that reaches
them (`pickOffloadForTile` considers `Alveolus` content; unload/park pre-filter via
`isVehicleOffloadDestinationEligible`). So a single `pickMaintenanceForVehicle` could run a board-wide
A\* once per blocking tile in the ring — × V vehicles × C characters. That is the >1s frame.

## The fix (architecture + algorithm)

**Architecture**: the flood is the **single reachability oracle**. `canReach` never runs a fresh A\*;
every answer — blocking or not — derives from one `reachable` map built per vehicle.

**Algorithm**:
1. `vehicleMaintenanceReachability` settles, as flood targets: every non-blocking ring tile **and** the
   non-blocking neighbours of every blocking ring tile (dedup'd). A blocking tile is never itself a
   target (it would never settle and would degenerate the flood to a full-board scan).
2. `maintenanceReachabilityCanReach` answers a blocking tile as "any non-blocking neighbour is in
   `reachable`" — an O(6) lookup. Faithful because `findPathForVehicleServiceBorder(start, blockingTile)`
   exists iff `findPathForVehicle(start, N)` exists for some non-blocking neighbour N, and both the A\*
   and the flood share the same integer `start` coord.
3. Load scan reordered: cheap `pickOffloadForTile` before `canReach`, so reachability is only consulted
   for tiles that actually carry loadable goods.

Result: the A\* path from `maintenanceReachabilityCanReach` is eliminated entirely. Measured:
`pickLoadTarget` 64 → 30 ms (bench), and the stack trace shown by the user
(`canReach → findPathForVehicleServiceBorder → findPathForVehicle`) no longer exists.

### Measured results (`sandbox/maintenance-bench.txt`, 2026-08-26)

Per-call spans from the radius-14 bench (5 vehicles × 5 chars, 25 `pickMaintenanceForVehicle`
calls):

| Span | avg | max | note |
|---|---|---|---|
| `maintenanceReachability` (the flood) | **5.55 ms** | 9.45 ms | was 23.7 ms full flood → ~4.7× |
| `pickLoadTarget` | 1.23 ms | 2.19 ms | was 64 ms before the O(6) blocking fix |
| `initialVehicleServiceCandidate` | 3.35 ms | 4.67 ms | now the largest per-call child |
| `pickUnloadTarget` / `pickParkingTarget` | — | — | small; see bench |
| `approachPath` (`findPathForCharacter`) | 0.125 ms | — | per-character, cheap |
| `collectVehicleWorkPicks` ×5 (one sweep) | 426 ms total | — | down from ~830 ms baseline |

The flood is no longer the dominant per-call cost; `initialVehicleServiceCandidate` →
`pickVehicleZoneBrowseSelection` (its unbounded `findPathForVehicleServiceBorder(∞)`) is. The flood's
remaining cost is the C×V recomputation (below), not per-call slowness.

**Bench caveat (JIT warm-up).** The `-- micro --` section shows vehicle 0 at `4.12 ms/call` vs
vehicles 1–4 at `~21 ms/call` for identical `targets=127`. That 5× spread is cold-start JIT/GC on the
first profiled call, not a real per-vehicle difference — trust the span averages above, not any single
micro reading. If the bench is reused, add a warm-up pass before timing.

## Still open (the next lever)

**A1 — fine-grained tokens + per-vehicle caches ✅ implemented (rounds 3–5).** The flood and the
character-independent candidate discovery (zone-browse, load/unload) were recomputed C×V times.
`workPlanningRevision` is the wrong token (it bumps intra-sweep on operator/service — measured). Two
dedicated counters fix it:

- `Game.transitRevision` — bumps on content / roads / terrain (first-order flood inputs) **only**.
  Keys the per-vehicle flood cache (`vehicleMaintenanceReachability`), collapsing C×V → V floods *and*
  target builds.
- `Game.candidateRevision` — bumps on everything `invalidateWorkPlanning` bumps **plus** transit,
  **minus** operator/service/assignment (routed through `invalidateWorkPlanningAllocation`). Keys the
  zone-browse cache (`pickVehicleZoneBrowseSelection`) and the load/unload candidate cache
  (`pickLoadUnloadCandidatesForVehicle`).

**A2 — transit snapshot + unbounded-path cache ✅ implemented (round 6).**

- `HexBoard.memoizedVehicleTransitNeighbors` — per-tile vehicle-transit neighbours keyed by
  `transitRevision`. Removes the fresh 6-object allocation per flood node and amortizes the O(V)
  `isBurdened` road-nullification scan (once per tile per revision). Flood ~6.6 → ~3.2 ms/vehicle.
- `HexBoard.findPathForVehicleServiceBorderUnbounded` — caches the three unbounded
  `findPathForVehicleServiceBorder(…, Infinity)` planner sites (gather-anchor begin-service, hop trade
  stop, begin-service leg) per (start, target, transitRevision), collapsing C×V×stops → V×stops.

**A3 — line-service candidate cache ✅ implemented (round 7).** `pickInitialVehicleServiceCandidate`
is character-independent (every zone-browse call passes explicit `vehicle.effectivePosition`; the
trade-stop `stopHasPotentialVehicleTransfer` is character-free), yet was recomputed per
(character × vehicle). Worse, its distribute-segment loop iterates `game.hex.tiles` — **all ~120k
tiles** on a radius-200 board when the unload stop is an anchor. This was the 178 ms/call
`findVehicleOffloadJob` cost the profile showed (with no visible children — it was uninstrumented).
Cached per `(vehicle, candidateRevision)`.

## Remaining (scale gap, not algorithm)

The default board is **radius 200 (~120k tiles)**, so the flood's radius-24 worst case (1657 nodes) is
far larger than my radius-14 bench (547-node cap). The remaining real-game costs are:

- `approachPath` — `findPathForCharacter(character → vehicle)` per (character × vehicle), ~0.14 ms each
  in the bench but scaling with board size. Character-dependent, so it can't use the vehicle caches.
- `findVehicleHopJob` per character (~3.5 ms) — approach + hop selection.
- `pickMaintenanceForVehicle` per-call overhead (the character gates).

These are the next targets. See `plans/rust-migration-continuation.md`.

> ⚠️ **Transit token must subscribe to road edits.** `applyRoadTrace` does **not** bump
> `workPlanningRevision` today (roads only *add* reachability, so a stale flood is a conservative
> miss). A dedicated transit token keyed to a flood cache is the opposite: serving a stale flood
> after a road is built or removed is a **correctness hazard**, not a conservative miss. The token
> must be bumped on road build/remove as a first-class input, alongside blocking / walkTime /
> burden-set changes — this is easy to get subtly wrong.

## TL;DR

`pickMaintenanceForVehicle` (and its siblings `pickUnloadTargetForVehicle`,
`pickParkingTargetForVehicle`) do not pathfind per candidate — they build one **target-bounded
Dijkstra flood** of the board, then answer each `canReach(tile)` with an O(1) (or O(6) for blocking
tiles) map lookup. The flood is **not cached at all**: it is rebuilt every time `pickMaintenanceForVehicle`
runs, which is once per vehicle per character (and per re-plan). Each flood also re-scans the whole
vehicle list inside `isBurdened` per road-adjacent node. So even with few characters and vehicles it
is `C × V` floods × `O(tiles × V)` burden checks — that is the "blocks the whole game each time" spike.

The fix is **not** "move to Rust" first. It is: (1) make the flood target-bounded (settle only the
≤ `offloadRange` candidate tiles + blocking tiles' neighbours, ~5-18× cheaper), (2) make the flood the
single reachability oracle so `canReach` never runs a fresh A\*, (3) snapshot the transit grid once so
`isBurdened` is O(1) and the flood is a pure function, and only then (4) consider caching on a
*fine-grained* transit token — not `workPlanningRevision`. Rust is the *last* step, over the snapshot.

---

## 1. Call graph

```
Character planner (per character, per workPlanningRevision)
  proposedWorkJobs()
    collectVehicleWorkPicks(game, character)        // cached by (game, char, revision)
      findVehicleOffloadJob(game, character)        // profile.proposedJobs.begin('findVehicleOffloadJob')
        findVehicleOffloadJobApproach(game, character)
          for (const vehicle of game.vehicles) {            // ← V vehicles
            pickMaintenanceForVehicle(game, vehicle, character)   // vehicle-work.ts:1037
              vehicleMaintenanceReachability(game, vehicle, character)   // :697
                game.hex.reachableForVehicleTargets(start, maxWalkTime, targets)  // board.ts
                  findReachableTargets(getNeighborsForVehicle, start, 24, targets) // pathfinding.ts
                    // target-bounded Dijkstra flood (stops when all targets settle)
              canReach = (tile) => maintenanceReachabilityCanReach(reachability, tile)  // :713
                // non-blocking tile: reachability.reachable.has(goal)  → O(1)
                // blocking tile:     O(6) flood lookup over non-blocking neighbours (was: full A*)
          }
```

`findVehicleOffloadJobDriving` (driving characters) calls `pickMaintenanceForVehicle` the same way.

### Numbers

- `maxWalkTime = 24` — `engines/rules/src/tuning/characters.ts:66`
- `offloadRange = 6` — `engines/rules/src/content/vehicles.ts:2`
- Tiles in a radius-R hex disc = `3·R·(R−1)+1`:
  - full flood region (radius 24): **1657 tiles**
  - candidate region (radius 6): **91 tiles**

So one flood explores up to 1657 nodes in open terrain. With C characters and V vehicles, a single
re-plan runs **C × V** floods = up to `C × V × 1657` node expansions.

---

## 2. Where the time goes

### 2.1 Per-node cost (inside `findReachable`)

For each popped node, `getNeighborsForVehicle` (`board.ts:408`) →
`getVehicleTransitNeighborsFromTile` → `getWalkNeighborsFromTile`:

- `fromTile.walkNeighbors` getter (`tile.ts:272`) allocates a fresh 6-element array + 6 objects
  every call ("fresh by design" — no reactive dep, but pure allocation churn). Each element reads
  `getTile` + `tile.effectiveWalkTime`.
- `walkTimeBetween` (`board.ts:229`) is then called **6× per node** — but only when the board has
  roads (`getWalkNeighborsFromTile` returns `walkNeighbors` directly when `roadTypes.size === 0`,
  skipping the road lookup entirely). When roads exist it does `getRoadType` on every border, and
  where a road exists also calls `roadEffectAvailable` → `from.isBurdened || to.isBurdened`.
- `isBurdened` (`tile.ts:216`) loops `for (const vehicle of game.vehicles)` — **O(V) per call**, and
  it fires once per endpoint (`from` / `to`) so up to **2× per road-adjacent border**. `walkTimeBetween`
  early-returns `Infinity` before the road check, so the burden scan is skipped for unwalkable edges;
  it only runs on road-adjacent borders with finite base cost.

So per node ≈ 6× `getTile` + 6× `getRoadType` (road boards only) + (road-adjacent × 2× O(V) burden
scan) + heap ops O(log n). On a road-heavy board the O(V) burden scan dominates and is invisible in a
naive profile because it's nested inside "pathfinding". The roadless fast-path removes the road
lookups on empty boards but does nothing for the burden scan once roads exist — which is exactly why
**A** (snapshot + O(1) burden) is the real next lever.

### 2.2 Multiplicative fan-out (and where `workPlanningRevision` does / doesn't appear)

`collectVehicleWorkPicks` (the function that *contains* `findVehicleOffloadJob`) is the only thing
that is revision-cached: a `KeyedRevisionedCache` keyed by `(game, character)` with revision
`game.workPlanningRevision` (`vehicle-work.ts:2112`). The flood inside it is **not** keyed to any
revision — it runs fresh every time `pickMaintenanceForVehicle` runs.

So the flood recomputation count is driven by *how often `collectVehicleWorkPicksUncached` runs*:

- once per `workPlanningRevision` bump, **and**
- once per distinct character, even within the same revision (the cache key includes the character).

The flood depends only on the vehicle's rounded position and the board transit state — **not** on
the character — so across C characters the same flood is recomputed ~C times.

And the fan-out is wider than just the character planner: `collectVehicleWorkPicks` is also called in
a `for (const character of game.population)` loop from `collectVehicleProposedJobs`
(`vehicle-work.ts:2209`) and from `collectTileWorkPicksUncached` (`tile-work.ts:138`), so the
per-character re-flood also happens from the vehicle-provider and tile-provider paths.

### 2.3 The `canReach` check was NOT cheap for blocking tiles — now fixed

Unload/park candidates are filtered by `isVehicleOffloadDestinationEligible` →
`tile.content instanceof UnBuiltLand`, so they only ever reach **non-blocking** tiles and hit the
`reachable.has(goal)` O(1) branch. But the **load** scan (`pickOffloadForTile` on `Alveolus` content)
reaches blocking tiles, and the old `canReach` answered each one with
`findPathForVehicleServiceBorder` → `findPathForVehicle` — a **full board-wide A\*** per blocking tile.
This is the exact stack trace the user captured (1.6s frames):

```
maintenanceReachabilityCanReach (blocking branch) → findPathForVehicleServiceBorder → findPathForVehicle
```

So the "blocking branch is rare" assumption in earlier drafts was **wrong** — in a village with many
alveoli/dwellings it runs dozens of times per `pickMaintenanceForVehicle`, × V vehicles × C characters.

**Fix (implemented)**: the flood settles blocking tiles' non-blocking neighbours as targets, and
`canReach` answers a blocking tile as "any non-blocking neighbour is in `reachable`" — an O(6) flood
lookup, no A\*. The load scan was also reordered to run the cheap `pickOffloadForTile` before `canReach`.
The A\* path from `maintenanceReachabilityCanReach` is now gone entirely.

---

## 3. Fix options (ranked by impact ÷ risk)

### A. Snapshot the transit grid once per revision (highest impact, enables B/C/Rust)

Precompute per revision:
- `blocked` per tile (from `isBlockingSpace`)
- `walkCost` per tile (from `effectiveWalkTime`)
- `roadMultiplier` per border (from `getRoadType` × burden), using a per-revision
  `coord → vehicle count` index so `isBurdened` is O(1).

The flood then reads only flat arrays — no allocations, no O(V) scans inside the search (the reads
are already inert via `wrapInert`, so reactivity was never the per-node cost; allocation + the
`isBurdened` scan are). This alone removes 2.1's hidden cost.

### B. Memoize the flood per `(startKey, workPlanningRevision)` — ⚠️ tried, made it worse

The flood is deterministic for a given `start` and board state, so this looks safe:

```ts
const reachabilityCache = new KeyedRevisionedCache<string, AxialKeyMap<number>>()
function vehicleMaintenanceReachability(game, vehicle, _character) {
  const start = axial.round(toAxialCoord(vehicle.effectivePosition))
  if (!start) return undefined
  const reachable = reachabilityCache.get(
    axial.key(start),
    game.workPlanningRevision,
    () => game.hex.reachableForVehicle(start, maxWalkTime)
  )
  return { game, start, reachable }
}
```

But this was **implemented and reverted** — it made frames ~10% worse. Two reasons, both stemming from
`workPlanningRevision` being a *coarse* token:

1. **It bumps intra-sweep.** `wakeWanderingWorkersNear` loops the population and calls
   `worker.findAction()`. The first worker that switches plans runs `abandonAnd` →
   `releaseVehicleFreightWorkOnPlanInterrupt` → `releaseOperator()` →
   `invalidateWorkPlanning('vehicle.operator')`. Every subsequent worker sees a new revision → the
   cache never hits across the sweep, only within one worker.
2. **It bumps for changes irrelevant to the flood.** `releaseOperator` mutates `service.operator`,
   which `isBurdened` does **not** read (it reads service presence / `docked`, not the operator). So
   the flood is *stable* across the bump, yet the coarse token invalidates it.

So memoizing on `workPlanningRevision` only adds overhead (map lookups, string keys, plus the eager
`park` scan below) without hits. A reachability cache would need a **fine-grained transit token**
(§5), which is a separate change — and is unnecessary once the flood itself is cheap (D).

### C. Split at the character/vehicle boundary (the "in between" layer) — right shape, wrong token

`collectVehicleWorkPicksUncached` → `findVehicleOffloadJob` → `findVehicleOffloadJobApproach` is
where the character dependency is introduced, but most of the work it triggers is
**character-independent**. Inside `pickMaintenanceForVehicle(game, vehicle, character)` the split
is clean:

| Work | Character-dependent? |
|---|---|
| `vehicleMaintenanceReachability` (the flood) | **No** — `_character` is unused |
| `pickOffloadForTile` load scan over `tilesAround(origin, 6)` | **No** |
| `pickUnloadTargetForVehicle` | **No** |
| `pickParkingTargetForVehicle` | **No** |
| top skip / `currentLineCandidate` / `isJointLineLoadCandidate` / `lineCandidate` (all via `pickInitialVehicleServiceCandidate`) | **Yes** — line-service context |
| `findPathForCharacter(character → vehicle)` in `findVehicleOffloadJobApproach` | **Yes** — the approach path |

So B (memoize just the flood) is necessary but not sufficient: the three candidate scans over
`tilesAround` (each ~91 tiles, reading loose goods + board state) are **also** character-independent
and get recomputed C×V times.

The refactor: split into a vehicle-scoped core and a character-scoped wrapper, with a
`KeyedRevisionedCache` on the core.

```ts
type VehicleMaintenanceCandidates = {
  reachability: MaintenanceReachability
  load?: LoadCandidate
  unload?: UnloadCandidate
  park?: ParkCandidate
}

const maintenanceCandidatesCache = new KeyedRevisionedCache<string, VehicleMaintenanceCandidates>()

// character-free: flood + load/unload/park discovery
function pickMaintenanceForVehicleCandidates(game, vehicle): VehicleMaintenanceCandidates {
  const reachability = vehicleMaintenanceReachability(game, vehicle) // drop `_character`
  const canReach = (tile) => maintenanceReachabilityCanReach(reachability, tile)
  return {
    reachability,
    load: pickBestLoadCandidate(game, vehicle, canReach),
    unload: pickUnloadTargetForVehicle(game, vehicle, canReach),
    park: pickParkingTargetForVehicle(game, vehicle, canReach),
  }
}

// character-aware: cached core + the 4 line-service gates
function pickMaintenanceForVehicle(game, vehicle, character) {
  const core = maintenanceCandidatesCache.get(
    vehicleCacheKey(game, vehicle),
    game.workPlanningRevision,
    () => pickMaintenanceForVehicleCandidates(game, vehicle)
  )
  // …apply the character-dependent gates (skip, joint-line-load, lineCandidate) over `core`…
}
```

This collapses the whole character-independent core from **C×V → V per revision**: V floods (not
C×V) and V×91 candidate scans (not C×V×91). Only the approach path and the line-service gates stay
per-character.

Correctness / subtlety: the top skip can return `undefined` before candidates are needed, so an
eager cache would compute candidates for vehicles a given character would skip. That is fine — it is
paid once per revision, not per character, and the inputs (`vehicle.storage`, `loose-good.*`,
`vehicle.*`, content) all already bump `workPlanningRevision` (§4), so the per-`(vehicle, revision)`
candidate cache is exactly as fresh as the existing `collectVehicleWorkPicks` cache.

Note the line-service gates (`pickInitialVehicleServiceCandidate`) also contain their own expensive,
partly-character-independent pathfinding (`findPathForVehicleServiceBorder(vehicle → stop, ∞)` from
`findBeginServiceActionableWork`) — but that is entangled with `pickVehicleZoneBrowseSelection` /
`stopHasPotentialVehicleTransfer` which **are** character-dependent, so it is a separate, lower-yield
candidate for later splitting. Don't fold it into this refactor.

### D. Target-bounded flood (the actual fix — highest impact, provably correct) ✅ implemented

Today `findReachable` floods everything within radius 24 (1657 tiles), but the planner only ever
asks about tiles within `offloadRange = 6` (≤ 91 candidates). Replace "full reachable set" with a
**multi-target best-first search** that terminates when all candidate tiles are settled (or the
frontier min-cost exceeds `maxWalkTime`):

- collect the candidate tile keys up front (the eligible tiles from `tilesAround(origin, 6)`),
- run Dijkstra, pop from the pending-target set as targets settle,
- stop when pending is empty or the open heap is exhausted under `maxWalkTime`.

Typical open-terrain cost drops from ~1657 to ~91–300 node expansions (≈ 5–18×), and worst case is
bounded by today's 1657, so it is never slower. Semantics are **identical**: Dijkstra settles nodes
in non-decreasing cost, so a target not settled when the search stops (pending empty) is genuinely
unreachable within `maxWalkTime`. This is a *new* `findReachableTargets(getNeighbors, start,
maxTime, targets)` alongside `findReachable` — it does not change the shared `reachableForVehicle`
used by the blocking-tiles tests.

Implemented:
- `findReachableTargets` in `utils/pathfinding.ts` (wrapped in `wrapInert`, same as `findReachable`).
- `HexBoard.reachableForVehicleTargets(start, maxTime, targets)` in `board.ts`.
- `vehicleMaintenanceReachability` builds the target ring from `tilesAround(vehicle.tile.position,
  offloadRange)` and calls the target-bounded flood.
- Resume path (`findVehicleOffloadJobApproach`, single `service.targetCoord`) now uses a direct
  `findPathForVehicleServiceBorder` A* (bounded `maxWalkTime`) + same-hex shortcut — no flood.

Parity proven in `tests/unit/pathfinding.test.ts` (3 new tests): `findReachableTargets` matches
`findReachable` on every target's `.has()`/`.get()`, excludes over-budget targets, and includes the
start when it is the only target.

### E. Don't port the policy — only the flood (Rust, last)

Only after D (and optionally A) are proven in TS and a determinism test pins them, port the *pure*
flood over the snapshot to `engines/core` (batched: all vehicle starts in one WASM call). Keep
`isBurdened`, road semantics, and planner logic in TS. See `plans/rust-migration-continuation.md`.

---

## 4. Cache correctness — and why `workPlanningRevision` is the wrong token

The flood result depends on:

| Input | Source | Invalidation |
|---|---|---|
| `start` | `vehicle.effectivePosition` rounded | cache key |
| blocking | `tile.isBlockingSpace` = `!!content && !(content instanceof UnBuiltLand)` | construction finalize / content changes → `invalidateWorkPlanning` |
| walk cost | `effectiveWalkTime` = `content.walkTime × riverMultiplier` | content/terrain changes |
| road multiplier | `getRoadType(border)` × `roadEffectAvailable` | `invalidateWorkPlanning('freight-line.edit')`; road build/remove |
| burden (road nullifier) | `isBurdened` (loose goods + vehicles) | `invalidateWorkPlanning('loose-good.add/remove')`, `vehicle.create/remove`, `vehicle.service` |

But `invalidateWorkPlanning` is also called for **operator** and **storage** changes
(`vehicle.operator`, `vehicle.storage`, `convey`, …) that do **not** affect `isBurdened` and hence
not the flood. And it is called **inside the population sweep** (`releaseOperator` during
`abandonAnd`). So `workPlanningRevision` is simultaneously too broad (invalidates for irrelevant
changes) and too noisy (bumps mid-sweep). Memoizing the flood on it is a net loss — measured.

A correct reachability memo would need a dedicated **transit token** bumped only when `isBlockingSpace`,
`effectiveWalkTime`, `getRoadType`, or the vehicle-set-for-`isBurdened` actually change — and it
becomes unnecessary once D makes the flood cheap enough that recomputation is acceptable.

---

## 5. Measurement

The profiler spans are in place (see *Measured results* above for the current numbers):

```ts
setProfileLevel('proposedJobs', 'summary')
```

`pickMaintenanceForVehicle` carries child spans (`maintenanceReachability`, `pickLoadTarget`,
`pickUnloadTarget`, `pickParkingTarget`, `initialVehicleServiceCandidate`, `approachPath`), so flood
time is attributable separately from the planner. In the browser: `profile.proposedJobs.setLevel('summary')`
→ run frames → `profile.proposedJobs.display()`; `.reset()` / `setLevel(undefined)` to clear.

The **D** flood bound and the **O(6) blocking fix** are already measured (flood 23.7 → ~5.5 ms/call).
Remaining levers: **A** (transit snapshot) removes the per-node O(V) `isBurdened` scan + allocation
churn; a *correct* flood cache (needs the transit token, §4) drops flood count C×V → V.

---

## 6. Related files

- `engines/ssh/src/lib/freight/vehicle-work.ts:697-730` — `vehicleMaintenanceReachability` /
  `maintenanceReachabilityCanReach`
- `engines/ssh/src/lib/freight/vehicle-work.ts:1037-1170` — `pickMaintenanceForVehicle`
- `engines/ssh/src/lib/board/board.ts:408-466` — `getNeighborsForVehicle` / `walkTimeBetween` /
  `reachableForVehicle`
- `engines/ssh/src/lib/utils/pathfinding.ts:154` — `findReachable`
- `engines/ssh/src/lib/board/tile.ts:216-238` — `isBurdened`
- `engines/ssh/src/lib/utils/revisioned-cache.ts` — `KeyedRevisionedCache`
- `plans/rust-migration-continuation.md` — the Rust port gate + sequence
