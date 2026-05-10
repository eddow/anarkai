# Construction Workflow

This document records the current understanding of construction in `engines/ssh`.
It is intentionally descriptive rather than final: use it as a map while fixing the
construction cycle, and correct it as the model becomes clearer.

## Main Model

Construction is represented by a `ConstructionSiteState` from
`src/lib/construction-state.ts`.

That state carries:

- the target to build (`alveolus` or `dwelling`)
- the target-derived recipe (`goods` and `workSeconds`)
- the current phase
- required, delivered, and consumed goods snapshots
- construction work seconds already applied
- blocking reasons for inspector/UI snapshots

The target is derived from a project string:

- `build:<alveolusType>` becomes an alveolus target
- `residential:basic_dwelling` becomes a dwelling target

Recipes are target-derived, not arbitrary runtime data. Alveolus recipes come from
`engine-rules` alveolus definitions. Basic dwellings currently use a local recipe in
`construction-state.ts`.

## Stages

The runtime phases are:

- `planned`
- `foundation`
- `waiting_materials`
- `waiting_construction`
- `building`
- `failed`

The normal path is:

1. A tile starts as `UnBuiltLand`.
2. A project is assigned with `UnBuiltLand.setProject(...)`.
3. The tile waits as a planned/foundation candidate.
4. An engineer runs `foundationStep()`.
5. The tile content is replaced by a build shell.
6. Materials are delivered into the build shell storage.
7. Once materials are complete, an engineer runs `constructionStep()`.
8. The build shell is finalized into the target building.

## Planned Land

`UnBuiltLand` can hold both:

- `project?: string`
- `constructionSite?: ConstructionSiteState`

Calling `setProject(...)` creates or accepts a construction site state. For
construction targets, the state starts as `planned`.

`UnBuiltLand` owns the pre-foundation phase sync. While a project exists:

- if the tile is burdened, phase is `planned`
- otherwise phase is `foundation`

"Burdened" means the tile is not clear enough for foundation work, for example
because loose goods still occupy the tile. The inspector path reports this as
`tile_not_clear`.

Alveolus construction projects clear the tile zone. Residential dwelling
construction keeps the residential zone marker.

## Foundation

Foundation work is an NPC work step in `src/lib/npcs/context/work.ts`.

`foundationStep()` expects the character to stand on an `UnBuiltLand` tile with a
project. It skips if:

- the content is not project land
- the tile is burdened
- the project string cannot map to a construction target

When foundation starts, it sets the construction site phase to `foundation` and
returns a fixed `DurationStep(3, 'work', 'foundation')`.

On completion:

- concrete terrain is applied
- `createConstructionShell(...)` creates the runtime shell from `constructionSite.target`
- the existing `ConstructionSiteState` is passed into the new shell

This state handoff is important. The shell should continue the same construction
site state rather than creating an unrelated second state.

## Build Shells

In-progress construction shells share the structural `ConstructionSiteShell` contract from
`src/lib/build-site.ts`.

Current shell classes are:

- `BuildAlveolus` in `src/lib/hive/build.ts`
- `BuildDwelling` in `src/lib/board/content/build-dwelling.ts`

They differ in inheritance:

- `BuildAlveolus` is an `Alveolus` and belongs to hive topology
- `BuildDwelling` is tile-backed standalone content, not an `Alveolus`

They share construction semantics through `installBuildSitePrototype(...)`.
Shared accessors include:

- `requiredGoods`
- `remainingNeeds`
- `advertisedNeeds`
- `isReady`
- `workingGoodsRelations`
- `canTake(...)`
- `canGive(...)`

`isReady` means all required materials are present in the shell storage and the
shell is not destroyed.

Construction-facing code should use `isConstructionSiteShell(...)` instead of checking
for specific shell classes. `BuildSite` remains as a compatibility alias.

Standalone shell detection uses `isStandaloneConstructionSiteShell(...)`, which
excludes hive-attached `BuildAlveolus`. This matters for freight-line construction
delivery: standalone construction demand can be scanned separately from hive demand.

## Material Flow

Build shells have storage sized from the construction recipe.

The shared material helpers compute demand from:

- `constructionSite.requiredGoods`
- current shell storage
- destroyed/working state

Build shells can take goods only when they are working, not destroyed, and still
advertise room for that good.

`registerConstructionMaterialPhaseEffect(...)` keeps the construction site state
in sync with shell storage:

- `deliveredGoods` mirrors shell storage stock
- incomplete materials normally set phase to `waiting_materials`
- complete materials normally set phase to `waiting_construction`
- destroyed incomplete shells become `failed`
- the effect does not overwrite an active `building` phase

## Construction Work

Construction work is also an NPC work step in `src/lib/npcs/context/work.ts`.

`constructionStep()` expects the character to stand on a `ConstructionSiteShell`.
It asserts that the site is ready before starting.

The amount of work comes from `constructionSite.recipe.workSeconds`.
Progress is stored in both:

- `site.constructionWorkSecondsApplied`
- `site.constructionSite.workSecondsApplied`

The step uses remaining work time:

```text
remaining = recipe.workSeconds - constructionWorkSecondsApplied
```

When work starts, phase becomes `building`.

If the step completes:

- consumed goods are recorded from required goods
- work seconds are set to the recipe total
- `finalizeConstructionShell(...)` finalizes from `constructionSite.target`

If the step is cancelled:

- partial elapsed work is credited
- phase returns to `waiting_construction`

This means interrupted construction should resume later instead of restarting
from zero.

## Finalization

Finalization lives in `src/lib/construction-shell.ts`.

For alveoli, `finalizeConstructionShell(...)` replaces the shell with the requested
target alveolus.

For dwellings, `finalizeConstructionShell(...)` replaces the shell with a
`BasicDwelling`.

Both paths are tile-content replacement paths. Anything observing construction
must be prepared for the shell object to disappear when construction completes.

## Inspector Snapshot

`queryConstructionSiteView(game, tile)` in `src/lib/construction.ts` is the read
path for UI and diagnostics. It is intended to be a pure snapshot query, not the
authoritative phase synchronizer.

It handles:

- `UnBuiltLand` with a construction site
- any content matching `isConstructionSiteShell(...)`

For planned land, it reports:

- `planned` when the tile is burdened
- `foundation` when foundation can theoretically proceed
- blocking reasons such as `tile_not_clear`, `no_engineer_in_range`, and
  `engineer_hive_paused`

For build shells, it reports:

- `failed` if destroyed
- `waiting_materials` if materials are incomplete
- `building` if the state is actively building
- `waiting_construction` when materials are ready but work has not started

The snapshot also reports delivered goods and construction work progress.

## Persistence

Save/load stores in-progress construction differently depending on the target.

Hive/alveolus patches can store:

- `underConstruction`
- `constructionPhase`
- `constructionWorkSecondsApplied`

Dwelling patches have equivalent under-construction fields for `BuildDwelling`.

On load, under-construction entries recreate the appropriate build shell, restore
the saved phase, and restore applied work seconds on both the shell and the
construction site state.

Project land is also persisted as project data. On load, project patches recreate
`UnBuiltLand.project` and its construction site state before foundation.

## Current Gotchas

- There are two construction object shapes before and after foundation:
  `UnBuiltLand` with a project, then a `BuildSite` shell.
- The same `ConstructionSiteState` should flow from project land into the build
  shell during foundation.
- Phase authority is split by lifecycle:
  `UnBuiltLand` syncs pre-foundation phases, build-shell effects sync material
  phases, and `constructionStep()` owns the active `building` phase.
- `queryConstructionSiteView(...)` should stay a snapshot path. If a fix needs to
  mutate phase or material state, it probably belongs on the runtime object/effect,
  not in the query.
- `BuildAlveolus` is hive-attached, while `BuildDwelling` is standalone. Shared
  helpers should target the `BuildSite` contract when possible.
- Construction progress is intentionally partial-credit on cancellation. Bugs that
  recreate shells must take care not to lose `constructionWorkSecondsApplied`.
- Freight delivery to standalone construction sites relies on standalone build-site
  scanning; hive construction demand is part of the hive/alveolus world.

## Main Files

- `src/lib/construction-state.ts` - construction state, target mapping, recipes
- `src/lib/construction.ts` - construction inspector snapshot
- `src/lib/build-site.ts` - shared construction-shell contract and material helpers
- `src/lib/construction-shell.ts` - construction shell creation and finalization
- `src/lib/board/content/unbuilt-land.ts` - project land and pre-foundation phase sync
- `src/lib/hive/build.ts` - `BuildAlveolus`
- `src/lib/board/content/build-dwelling.ts` - `BuildDwelling`
- `src/lib/npcs/context/work.ts` - `foundationStep()` and `constructionStep()`
- `src/lib/game/game.ts` - save/load construction patch handling
- `src/lib/freight/construction-demand.ts` - standalone construction demand scanning
