# Rust Migration Continuation — Move Only Proved Algorithms

Status: analysis (2026-08-25). Complements `docs/rust-core.md`.

## TL;DR

Generation (population / settlements / board) and terrain (noise, erosion, hydrology, affordances)
are already in `engines/core`. The next candidate people reach for is **pathfinding /
reachability** (`findPath`, `findReachable`, `reachableForVehicle`). It is **not proved yet** and
should **not** be ported as-is. The blocker is that it reads live, mutable board state on every
node expansion (it already runs *inert* via `wrapInert` — no reactive dependency tracking — but it
still reads `isBurdened`, which scans every vehicle, and allocates per node). The port becomes safe
and fast only after we (a) snapshot the transit grid once per planning revision, (b) prove the
target-bounded flood + caching strategy in TypeScript, then (c) port the *pure* flood over that
snapshot to Rust. Everything else in this doc is a catalogue of what "proved" means and the
sequence to follow.

---

## 1. What "proved" means (the gate)

An algorithm is eligible for Rust migration only when **all** of these hold:

1. **Deterministic + testable.** Pure function of explicit inputs; there is a TS unit suite and a
   golden/determinism test (same seed → same bytes), and — for cross-language parity — a Rust test
   that asserts identical output on the same inputs. The FNV-1a `coord_hash` (see
   `docs/rust-core.md`) is the existing model: it exists to make TS↔Rust parity provable.
2. **Inputs fully enumerated.** The function reads no ambient/reactive state. Everything it needs
   arrives as flat parameters (slices), so the binding is a 1:1 mapping with no hidden reads.
3. **1:1 mapping.** The TS↔Rust boundary is "flat in / flat out" (like `wasm_generate_board`'s
   packed `Uint8Array`), not an object graph.
4. **Measured hotspot.** We have a profile (`profile.proposedJobs.begin?.(...)`) showing it's
   actually expensive, not a guess.

Only meet the bar → move. Meet half the bar → prove the missing half in TS first, then move.

---

## 2. Inventory

### Already moved and proved (keep as the reference pattern)

| Algorithm | Rust | Binding | Parity |
|---|---|---|---|
| Character placement | `generation/population.rs` | `wasm_generate_character_positions` | TS fallback kept |
| Settlement scoring/placement | `generation/settlements.rs` | `wasm_place_settlements` | TS fallback kept |
| Deposit + goods | `generation/board.rs` | `wasm_generate_board` | **primary path** |
| Noise / FBM / domain warp | `noise.rs` | `wasm_*_sample` | pure |
| Terrain (continents, erosion, drainage, lakes, affordances, biome) | `terrain/*` | `wasm_generate_sector_fields_packed` etc. | pure |

These are the *model*: pure modules in `src/`, WASM bindings only in `lib.rs`, flat packed
transfers.

### Proved-in-Rust but not yet wired into the live game

- **Terrain pipeline.** The Rust terrain modules are implemented and tested (`cargo test`), but the
  live game still uses the TS `GameGenerator`/`BoardGenerator` fallback in places. This is the
  safest "next move" — it is already proved, we just need to finish wiring and delete TS fallbacks.
  Do this **before** attempting anything new.
- **Population / settlements.** WASM functions exist but the TS adapters still call the TS
  fallback. Finishing this is also low-risk and removes duplication.

### NOT proved (do not port yet)

- **Pathfinding / reachability** — `engines/ssh/src/lib/utils/pathfinding.ts`
  (`findPath`, `findReachable`) and `HexBoard.reachableForVehicle` /
  `findPathForVehicleServiceBorder` in `engines/ssh/src/lib/board/board.ts`. Reasons:
  - Reads `tile.content`, `tile.isBlockingSpace`, `tile.effectiveWalkTime`, `getRoadType`, and
    `isBurdened` (which loops over `game.vehicles`) **during the search**, per node.
  - No determinism/parity test vs Rust.
  - The cost model (`walkTimeBetween` with road multiplier × burden interplay) is still coupled to
    mutable, frame-varying state.
  - It is a genuine hotspot — but the hotspot fix is *caching + snapshotting*, which must be proven
    in TS first (see the companion analysis in
    `engines/ssh/plans/vehicle-maintenance-reachability-perf.md`).

---

## 3. The structural blocker (and the unifying fix)

The reason pathfinding is both **slow in TS** and **unportable** is the same:

> The search reads live mutable board state on every node expansion.

Note: `findReachable` / `findPath` are wrapped in `wrapInert` (mutts `runInert`), so the reads
already bypass reactive dependency tracking — reactivity is **not** the cost and never was. The
remaining per-node cost is (a) allocation churn in `tile.walkNeighbors` (fresh 6-element array +
6 objects every call) and (b) `walkTimeBetween` → `roadEffectAvailable` → `isBurdened`, which
iterates **all** vehicles (O(V)) on every road-adjacent border.

`findReachable` calls `getNeighborsForVehicle` → `getWalkNeighborsFromTile` →
`tile.walkNeighbors` → `tile.effectiveWalkTime` → `walkTimeBetween` → `getRoadType` +
`isBurdened` (which iterates all vehicles). Each of these is an allocation and/or an O(V) scan,
paid per neighbor per node.

The fix that serves both goals:

1. **Snapshot the transit grid once per planning revision** into a flat, inert array:
   - `blocked: Uint8Array` (per tile) — from `isBlockingSpace`
   - `walkCost: Float32Array` or `Uint8Array` (per tile) — from `effectiveWalkTime`
   - `roadMultiplier: Float32Array` (per border) — from `getRoadType` × `isBurdened`, precomputed
     with a per-revision vehicle-position index so `isBurdened` is O(1), not O(V)
2. **Run the flood over the snapshot** (pure function of `start` + the arrays). No allocations, no
   O(V) scans inside the search (reads were already inert; this removes the *work*, not tracking).
3. **Memoize** the flood per `(startKey, workPlanningRevision)`.

This is exactly the "pure Rust module + flat binding" shape. Once the TS flood operates on a
snapshot, the same snapshot can be passed to WASM and the flood ported verbatim.

---

## 4. Recommended sequence

Only proved algorithms, in order:

1. **Finish wiring already-proved Rust (terrain + population + settlements).** Delete the TS
   fallbacks where the Rust path is verified deterministic. This is the lowest-risk win and removes
   duplication. *Gate: existing Rust unit tests + TS integration tests already pass.*

2. **Prove the pathfinding optimization in TS.** Deliver the optimizations in
   `engines/ssh/plans/vehicle-maintenance-reachability-perf.md`:
   - ~~target-bounded flood~~ ✅ done — `findReachableTargets` + `HexBoard.reachableForVehicleTargets`;
     `vehicleMaintenanceReachability` floods only the `offloadRange=6` candidate ring; resume path
     uses a single bounded A*. Parity proven in `tests/unit/pathfinding.test.ts`.
   - ~~blocking-tile oracle + load-scan reorder~~ ✅ done — the flood settles blocking tiles' neighbours,
     `canReach` answers blocking tiles with O(6) flood lookups (no per-tile A*), load scan runs the cheap
     `pickOffloadForTile` before `canReach`.
   - ~~transit token + per-vehicle flood cache~~ ✅ done — `Game.transitRevision` (bumped by content/roads/
     terrain only, **not** operator/storage) keys a per-`(vehicle, revision)` flood cache, collapsing C×V → V.
   - ~~candidate token + zone-browse & load/unload caches~~ ✅ done — `Game.candidateRevision` (all
     `invalidateWorkPlanning` + transit, minus operator/service/assignment via `invalidateWorkPlanningAllocation`)
     keys the zone-browse and load/unload candidate caches, collapsing the remaining C×V → V.
   - ~~transit snapshot~~ ✅ done — `HexBoard.memoizedVehicleTransitNeighbors` (per-tile vehicle neighbours
     keyed by `transitRevision`) removes per-node allocation + O(V) `isBurdened`; `findPathForVehicleServiceBorderUnbounded`
     caches the unbounded planner searches. Flood ~6.6 → ~3.2 ms/vehicle.
   - ~~line-service candidate cache~~ ✅ done — `pickInitialVehicleServiceCandidate` cached per
     `(vehicle, candidateRevision)`; its distribute-segment `game.hex.tiles` (all ~120k tiles) loop was
     the 178 ms/call `findVehicleOffloadJob` cost, now C×V → V.
   - ⚠️ Do **not** memoize on `workPlanningRevision`: it bumps intra-sweep (`allocateVehicleServiceForJob`
     during `findAction`, `releaseOperator` during `abandonAnd`) and for changes irrelevant to reachability —
     measured as a net regression, reverted, then replaced by the fine-grained transit token.
   *Gate: `profile` shows the flood time collapsing; determinism is preserved (tests pass).*

3. **Add a determinism test** that pins the snapshot + flood output for a fixed board (like the
   board/population determinism tests). This is what makes the algorithm *provable*.

4. **Port the pure flood to Rust.** New module `engines/core/src/pathfinding/` (or
   `common/reachability.rs`), pure: `reachable(starts: &[HexCoord], blocked, walk_cost,
   road_multiplier, max_time) -> packed results`. Export `wasm_reachable_for_vehicles` taking all
   starts in one call (batched, like `wasm_generate_board`). The TS side builds the snapshot once
   per revision and passes it in.
   *Gate: TS determinism test has a Rust twin that asserts byte-identical output.*

5. **Do NOT** port `isBurdened`, road semantics, or the planner logic itself. Those are policy, not
   algorithm, and they change often. Keep them in TS; only the flood crosses the boundary.

---

## 5. "Move only proved algorithms" — checklist for any future port

Before proposing a Rust port, ask:

- [ ] Does it read only explicit inputs, or ambient/reactive state?
- [ ] Is there a TS test that pins its output byte-for-byte?
- [ ] Can the binding be flat-in/flat-out?
- [ ] Is it a measured hotspot (profile, not intuition)?
- [ ] Is the algorithm *stable* (not mid-refactor)?

If any box is unchecked, the port is premature. Prove it in TS first — the TS proof *is* the
migration spec.

## Related

- `docs/rust-core.md` — existing Rust/WASM architecture + generation module reference
- `engines/ssh/plans/vehicle-maintenance-reachability-perf.md` — the concrete case this gate
  applies to
