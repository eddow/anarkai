# Science / study (validation) — deferred

> Open questions and future design. Currently **out of scope**; validation is instant.

## Decision (2026-09-03)

Validation is **instant** for now. There is **no** `validating` stage, no research work-seconds,
no `engineer.research` "study" job. `commit` runs structural validation
(`validateProjectStructure`) + board-occupancy checks and freezes `draft → working` in the same
call. The `engineer.research` variant exists in content but currently produces no jobs.

## Why deferred

"Science/study" is a whole separate design surface: does research *gate* commit, is it a per-good
sink consuming the bill's goods + work-seconds, is it per-plan novelty (reusing a known layout is
cheaper than a novel one), and does "buy research" exist? Until those are decided, a `validating`
stage would be speculative machinery.

## What a future "study" system would need

- **A `validating` stage** between `draft` and `working` (restore it to `ProjectStage`).
- **A research sink**: the `engineer.research` variant consuming the bill's goods (survey materials)
  + work-seconds, via a `ValidateProjectJob` (`job: 'validateProject'`) and a `work.validateStep`.
- **Novelty cost**: `knownnessFingerprint` already exists for dedup; a "novel vs known layout"
  multiplier would make first-builds costlier to study than re-stamped layouts.
- **"Buy research"**: an external/instant-credit branch, mirroring `trySpawnConstructionDeliveries`.

See `plans/projects.md` §"Deferred" and `docs/projects.md` §"Lifecycle".
