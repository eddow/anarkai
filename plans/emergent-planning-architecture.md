# Emergent planning — replacing global optimization with local decisions

Status: Phases 0, 2, 3 (first increment), and 4 are **landed** (2026-08-26). Remaining: the rest of
Phase 3's behavioral core (ad-driven matching + retiring the global sort) and Phase 5. Follows the
`canReach` optimization rounds in `engines/ssh/plans/vehicle-maintenance-reachability-perf.md`.

## Landed

- **Phase 0 — hex-distance score, deferred pathfind.** `tailorProposedJob` scores by `axial.distance`;
  `startBestJobFrom` pathfinds once for the winner and falls back to `wander()` if unreachable. Hex
  distance is the **final** scoring primitive (§5a).
- **Phase 4 — commitment + hysteresis.** Deduped the 3× `rankedWorkCandidates()` per `findAction`
  (`rankedWorkCandidatesCached`); added a game-time-keyed re-plan throttle
  (`idleReplanIntervalSeconds = 0.5`, `tuning/characters.ts`).
- **Phase 4 — sticky job-target commitment.** `Character.committedWork` (reference-based, no string
  key) + `resolveCommittedJobMatchFrom` keep the last-chosen target unless a new top beats it by more
  than `jobCommitmentHysteresis` (0.15, `tuning/planner.ts`).
- **Phase 2 — candidate-set locality.** `proposedWorkJobs` scans `tilesAround(position, sensingRadius=8)`
  (bounded O(R²)) instead of `maxWalkTime=24` (1657 tiles); `nearestUnreservedHomePath` now uses one
  `findNearestForCharacter` over the residential coord set.
- **Hot-path sweeps I & II.** Cached `pickInitialVehicleServiceCandidate` + `memoizedStopMeasure`;
  deferred the vehicle-approach/offload pathfinds to winner-only (hex-distance score). ⚠️ Latent:
  `findVehicleApproachJob` still pathfinds per vehicle, currently gated out of the hot path.
- **Phase 3 — first increment.** `WorkAdvertisement` + `Tile.workAdvertisements` publication surface,
  and claim-at-selection (`assignedWorker` ↔ `assignedAlveolus` bound synchronously, claim-first-wins).

## Do not redo

- **Phase 1 was cancelled** — the distance field / source index is an unbounded-cost regression. Tile
  browsing is O(R²) (radius-tunable); job-list browsing is O(jobs) (unbounded). Keep the tile scan,
  shrink the radius.
- **Do not add a reachability pre-filter back into `tailorProposedJob`.** Hex-distance scoring is
  intentional; a near-but-walled target self-corrects (character wanders, retried later). If it proves
  bad on obstacle-dense boards, the remedy is Phase 1 *fields*, not a per-candidate pathfind.
- **Commitment is behavioral, not CPU.** It reduces job-flapping, not the `rankedWorkCandidates` re-scan
  (the Slice-2 memo still re-scans on `workPlanningVersion` bump).

## Remaining

- **Phase 3 — behavioral core:** (1) sinks publish ads directly (avoid materializing `ProposedJob` for
  unclaimed work); (2) characters consume ads via `selectMovement`-style matching (rank by
  `urgency/(distance+1)` over `workAdvertisements`, then materialize the winner); (3) retire
  `rankedWorkCandidates` / `workPlannerSnapshot` global sort. Goal: merge work discovery
  (`Tile.proposedJobs` → global sort) with goods movement (`AdvertisementManager` + `Hive.selectMovement`).
  Design: `WorkAdvertisement = { kind, targetTile, urgency }` (priority dropped — duplicates urgency);
  the ad is a claim token (claim-first-wins); `assignedAlveolus` is subsumed by the claim token.
- **Phase 5 — coarse-graph routing + Rust port** (fields/routing into `engines/core`). Not started.

## TL;DR

We drove pathfinding from ~830 ms down to ~85 ms in the bench (5 chars × 5 vehicles, radius-14) — a
~10× win — but **the asymptotics did not change**. The planner is still
`O(characters × candidates × pathfind)` per re-plan, and a "candidate" is, at worst, every tile
within `maxWalkTime` (radius 24 = **1657 tiles**). Rust makes the constant smaller; it cannot make the
exponent go away. At hundreds of characters and vehicles the loop is dead regardless of language.

The break-through is to **stop computing a global optimum and let local decisions produce an emergent
optimum** — the "ants" model. The codebase already contains the seed of this: the **advertisement
system** already moves goods by matching provide/demand ads rather than by having each character scan
the board (though — see §3 — it *does* still pathfind per candidate; it survives because it routes on a
coarse graph and caches). The proposal is to extend that pattern to *character work selection*, and to
separate "decide what to do" (local, cheap) from "compute how to get there" (amortized, shared, on a
coarse graph).

---

## 1. The diagnosis — why this cannot scale

The current per-character decision (`Character.findAction`) is:

```
rankedWorkCandidates()
  proposedWorkJobs()                          // gather ALL jobs
    for tile in tilesAround(position, 24)      // 1657 tiles
      collect tile.proposedJobs
    collectVehicleWorkPicks()                 // V vehicle candidates + floods + scans
  tailorProposedJob(job)                       // per candidate
    sameTilePath(target)                        // findPathForCharacter(...) ← PATHFIND
  sort by score = urgency / (pathLength + 1)    // GLOBAL optimum
```

Two structural facts make this `O(N × board × pathfind)`:

1. **The scoring primitive is a pathfind.** `proposedJobScore = urgency / (pathLength + 1)`
   (`jobs/offers.ts`). To rank, you must know `pathLength`, so you must pathfind to *every* candidate.
2. **The candidate set is global.** `tilesAround(position, 24)` sweeps the whole reachable disc every
   re-plan, and `workPlanningRevision` bumps on almost any mutation, forcing eager re-planning.

The `canReach` rounds only reduced the *constant* (fewer floods, cached floods, cheaper nodes). They
left the *shape* intact. Every re-plan still does per-candidate pathfinding, and the number of
re-plans scales with the population.

The one genuinely sublinear lever already in the code is the **advertisement system**: a hive advertises
"provide wood / demand wood" by good type, and `selectMovement` matches a provider to a demander
**without any character scanning the board**. That is the template for everything else — but see the
correction below: it is *not* pathfind-free, and the reason it scales is easy to misattribute.

---

## 2. The conceptual shift

| Today (global optimization) | Target (local + emergent) |
|---|---|
| Enumerate every job in range | Sense a small local neighbourhood |
| Pathfind to each, sort, pick best | Read a shared signal, pick greedily / by auction |
| Pathfinding is the *decision* primitive | Pathfinding happens once, at execution, lazily |
| Re-plan eagerly on every mutation | Commit + hysteresis; re-decide only on invalidation |
| Cost `O(N × board × pathfind)` | Cost `O(board)` once + `O(N × local)` |

The ants principle: an ant does not solve the global shortest-path assignment problem. It follows a
locally-visible gradient, deposits/reads pheromone, and commits. The colony optimum **emerges** from
many cheap local decisions. We do the same by giving agents:

- **shared, precomputed fields** to read (cheap), instead of per-agent pathfinding (expensive),
- **commitment** so they don't re-decide every tick,
- **locality** so their sensing cost is constant, not proportional to the board.

---

## 3. The mechanisms (grounded in the existing code)

### ⚠️ Correction: the advertisement system is **not** pathfind-free — it is **coarse-graph + cached**

An earlier draft of this document claimed `selectMovement` "matches a provider to a demander locally —
no pathfinding". **Verified against the code, that is wrong**, and the correction matters because the
whole plan leans on the advertisement system as the template.

The actual call chain in `hive.ts` is:

```
selectMovement (hive.ts:3531)
  → findNearest (hive.ts:964)            // loops over EVERY candidate storage
      → getPathDistance (hive.ts:955)
          → getPath (hive.ts:908)
              → findPath(getNeighborsForGood, from, to, Infinity)   // ← a real A* per candidate
```

So the freight layer *also* uses **"pathfind to score"** — it pathfinds to every candidate storage to
rank by `distance`, the same anti-pattern this plan criticizes in the character planner. It does not
melt down for two specific reasons:

1. **It routes on a coarse graph, not the 120k-tile hex grid.** `getNeighborsForGood` (hive.ts:3160)
   expands only alveolus **gates** and relay **borders**, so the search space is the small logistics
   graph, not the tile graph.
2. **`pathCache`** (hive.ts:920) memoizes `from→to→goodType` paths, so the per-candidate A* is paid
   once per (pair, good), not per selection.

**This inverts the lesson, in a way that strengthens the plan.** The coarse graph is not a Phase-5
optimization to bolt on at the end — it is the *existing, load-bearing* reason the freight layer
already scales. The character planner's true defect is not merely that it "pathfinds to score"; it is
that it pathfinds **per candidate on the full hex grid**. The fastest correct move is therefore not
"replace pathfinding with fields everywhere"; it is **"make character work-selection route on a coarse
graph and cache like `pathCache`"** — the exact mechanism the codebase already proves out — and *then*
layer fields/commitment on top. The phases below are unchanged; only the justification is corrected.

### 3.1 Fields replace per-candidate pathfinding

For each "signal class" (e.g. `demand:wood`, `demand:any`, `burden`, `work-available`), compute a
scalar **distance field** once per `transitRevision` with a multi-source BFS over the tile graph:

```
field[good] = distance to nearest tile advertising "demand good" (or provide, or burden)
```

- Cost: `O(board)` per field per revision, **amortized across all characters** (they all read the same
  field). Today each character re-derives this per re-plan.
- Selection becomes: "read `field[good][here]`; if it's within my sensing radius and my hysteresis
  threshold, walk down the gradient." No A\*, no candidate enumeration.
- This is exactly `transitRevision`-cacheable (fields depend only on blocking/walk-cost/ads), and is the
  natural thing to compute in Rust/WASM later (flat arrays, parallel BFS).

### 3.2 Advertisements extend from "goods" to "work"

Today `Hive` advertises provide/demand **between storage parties**, and characters are driven by the
separate `rankedWorkCandidates`. Merge the two: **sinks advertise work** (a burdened tile advertises
"needs clearing"; a hungry hive advertises "needs wood carried"; a construction site advertises "needs
stone"). Characters are *consumers* of those ads, exactly like the existing `selectMovement` consumers.

- The ad already carries `priority` (0-store / 1-buffer / 2-use) — the **urgency** signal. The
  priority *channel* (`AdvertisementManager` bucketing, advertisement.ts:44) is genuinely
  pathfind-free; only the *final provider pick* pathfinds today (see correction above).
- Matching is a priority-ordered pick — the same code path as `selectMovement`, including its existing
  reservation (`tryReservePendingMovementIntent`) and post-validation (`canGive`/`canTake`) — the
  "auction/claim" pattern is already present, no new mechanism needed.
- Vehicles stay scarce: keep an **auction/token** — a vehicle advertises "can move X from A→B, price =
  cached distance", characters pick the cheapest advertised price without re-pathfinding. The vehicle
  computes its own distance field **once**, not per character.

### 3.3 Commitment + hysteresis kill the re-plan cascade

The biggest hidden cost is *frequency*, not per-call cost: `workPlanningRevision` bumps on
operator/service/assignment (intra-sweep), and `wakeWanderingWorkersNear` re-runs `findAction` for idle
workers near any movement. `applyActivityHysteresis` (findNextActivity.ts:395) exists but is narrow —
it only reorders the *activity kinds* (wander/eat/home/work) by a utility threshold; it does **not**
commit a character to a specific job target, so the work re-plan still cascades on every bump.

Extend the idea into true **job commitment**: once an agent commits to a target, it does not re-decide
unless (a) the target disappears, or (b) a *materially* better signal appears (threshold, not any
improvement). This is the stigmergy/commitment core of the ants model — and it is what turns `O(N)`
*per tick* into `O(N)` *per meaningful change*.

### 3.4 Locality is the scaling knob

Replace `maxWalkTime=24` sensing with a **small sensing radius** (3–6 tiles). Long-range logistics are
handled by the *goods movement chain* (hive → hive), not by a single character walking 24 tiles. A
character only ever does the **last mile**. This caps the candidate set at a constant (≤ 91 tiles)
regardless of board size, and is the direct descendant of the `offloadRange=6` work already done.

### 3.5 Pathfinding becomes a bounded, coarse-graph, amortized concern

Even "one pathfind at execution" is `O(board)` worst-case on the 120k board. So:

- **Route on a coarse graph** (sectors / road network / hive-gates), not the full hex grid — `O(nodes)`
  instead of `O(tiles)`, and the coarse graph is tiny (hundreds of nodes, cacheable, Rust/WASM-ready).
- **Stream the path**: compute only the next N steps toward the gradient/next graph node; recompute
  lazily. Agents rarely need a full path, only "which neighbour to step into next".
- `findPathForCharacter` for the last mile becomes a tiny bounded search within the local radius.

---

## 4. Scaling math (why this is the break-through)

Let `N` = characters, `B` = board tiles, `L` = local sensing radius (constant), `R` = re-plan frequency.

- Today: `N × R × (B_scan + candidates × A*)` — dominated by `N × R × B`.
- Target: `(fields: B) + N × R' × (L + 1 field read) + execution pathfind (coarse graph)` — dominated by
  `B` once per revision + `N × L` per *committed change*.

The key differences: (1) the `B` term is **once and shared**, not `×N`; (2) `R' ≪ R` because of
commitment; (3) `L` is a constant, not `maxWalkTime=24`. This is asymptotically sublinear in the
population, which is the property that survives hundreds/thousands of agents.

---

## 5. Phased migration (de-risk the big change)

A big-bang rewrite is too risky. Land it as successive, independently-shippable layers, each with a
measurable cost-curve improvement and a fallback:

1. **Fields for selection only** (no behavior change). Precompute distance fields per signal class on
   `transitRevision`; use them *only* to short-circuit `tailorProposedJob` (skip pathfinding for
   candidates whose field distance already exceeds the current best score). Pure win, zero semantics
   change. Proves the field infra.
2. **Candidate-set locality.** Cap the work candidate scan at a small radius; route long-range via the
   existing goods-movement chain. Visible as "characters no longer walk across the map".
3. **Advertisement-driven work.** Sinks advertise work; characters consume ads via the existing
   `selectMovement` path. Retire `rankedWorkCandidates` global sort. This is the behavioral core.
4. **Commitment + hysteresis.** Stop re-deciding on every revision bump. Frequency collapse.
5. **Coarse-graph routing + Rust.** Move field computation + coarse routing into `engines/core` (flat
   arrays, parallel BFS/Dijkstra). This is where the "prove in TS, port pure to Rust" discipline from
   `plans/rust-migration-continuation.md` pays off — fields are exactly the pure-function shape.

Each phase keeps the existing tests green and can be reverted independently.

### 5a. Refinement — pull the coarse graph forward (it is proven, fields are not)

The correction in §3 changes the *priority*, not the direction. The phased list above treats the
coarse graph as Phase 5 (a Rust-port concern). But the freight layer **already** routes on a coarse
graph (`getNeighborsForGood`, gates + relay borders) and **already** caches per-pair (`pathCache`) —
that is the one mechanism in the codebase that is *known* to scale, because it is running in
production today. Fields, by contrast, are new infra.

So the cheapest, lowest-risk first step is not Phase 1 (fields). It is a **Phase 0**: make
`tailorProposedJob` / `sameTilePath` score candidates by a **coarse-graph distance** (or even hex
distance as a first cut) instead of a full per-candidate `findPathForCharacter`, with a
`pathCache`-style memo. That alone removes the per-candidate pathfind from the scoring loop — the
single biggest constant — using only mechanisms the codebase already trusts. Fields (Phase 1) then
become the *shared, cross-character* generalization of that cache, and commitment (Phase 4) collapses
the frequency. Sequence: **0 (hex-distance score) → 4 (commitment) → 1 (fields) → 2–3 (locality +
ad-driven work) → 5 (Rust)**. Phases 2–3 are the behavioral core and stay where they are; 0 and 4 are
the cheap wins that de-risk them.

#### ✅ Phase 0 implemented (2026-08-26) — hex distance is the final choice

Landed the hex-distance scoring. Two edits in `engines/ssh/src/lib/population/character.ts`:

1. **`tailorProposedJob`** (non-vehicle branch): scores candidates by `axial.distance(from, to)`
   instead of `sameTilePath` (`findPathForCharacter`). Returns a deferred empty `path` and
   `pathLength = hexDistance`. The `'no-path'` pre-filter is gone — reachability is checked at
   execution, not per candidate.
2. **`startBestJobFrom`**: computes the real path **once**, for the chosen non-vehicle job only, via
   `sameTilePath(match.targetTile)`; if unreachable the character falls back to `wander()` (matching
   the existing unreachable-handling pattern). Vehicle jobs are untouched (they already carry a cached
   `approachPath`).

**Documented decision (final):** scoring by hex distance is *intentional*, not a placeholder for a
coarse-graph memo. The alternative — a reachability pre-filter or a coarse-graph distance with a
`pathCache` memo — would reintroduce pathfinding (or its cost) into the decision loop, defeating the
point of the phase. The accepted trade-off: a near-but-walled-off target can outrank a farther-but-
reachable one, the character walks into the wall, `startBestJobFrom` finds no path, and it wanders.
That is *emergent, self-correcting* behaviour (the walled target is retried later or another agent
picks it), not a bug. **Do not add a reachability check back into `tailorProposedJob`**; if the
behaviour proves visibly bad on obstacle-dense boards, the remedy is Phase 1 fields (a shared, cheap
signal), not a per-candidate pathfind.

Verified: `tsc` clean; `proposed-jobs`, `work_vs_wander_planner`, `forester`, `reactive_boundaries`
(21 tests) and `chopsaw-example`, `vehicle-hop-path-execution`, `vehicle-approach-job`,
`vehicle-service-arbitration`, `vehicle-offload-job` (75 tests) all pass.

---

## 6. What survives, what is retired

**Survives (keep):** the advertisement system (`AdvertisementManager`, `selectMovement`, priorities),
the coarse logistics graph (`getNeighborsForGood` gates/borders) and `pathCache`, the
reservation/validation pattern (`tryReservePendingMovementIntent`, `canGive`/`canTake`), the
script/NPC step machinery, tile occupancy/queueing, the `transitRevision` / `candidateRevision`
invalidation split, the flood oracle for last-mile reachability. `applyActivityHysteresis` is kept but
**extended** from activity-kind reordering into true job-target commitment.

**Retired (replaced):** the global `rankedWorkCandidates` sort with per-candidate
`findPathForCharacter`, the `tilesAround(position, maxWalkTime=24)` full-disc candidate scan, and the
"pathfind to score" pattern (`proposedJobScore = urgency / pathLength`).

**Net:** decisions become *local, signal-driven, committed*; pathfinding becomes *amortized, coarse,
and execution-only*; and the whole loop becomes sublinear in the population — which is what "hundreds
or thousands of characters and vehicles" actually requires.

---

## Related

- `engines/ssh/plans/vehicle-maintenance-reachability-perf.md` — the rounds that got us here
- `plans/rust-migration-continuation.md` — "prove in TS, port pure to Rust"
- `engines/ssh/src/lib/utils/advertisement.ts` — the existing emergent-matching seed
- `engines/ssh/src/lib/jobs/offers.ts` — `proposedJobScore` (the pathfind-as-score primitive)
- `engines/ssh/src/lib/population/character.ts` — `findAction` / `rankedWorkCandidates` / `tailorProposedJob`
