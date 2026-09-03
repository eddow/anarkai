# Construction projects

A **project** is a planned, connected set of construction entries authored *before* any tile is built.
It is the design surface for a future hive (and its roads): place alveoli (with variants and
configuration), bulldoze mistakes, then **commit** it onto the board where it materializes as
construction sites and builds over time.

Working notes and the remaining TODO list live in [`../plans/projects.md`](../plans/projects.md);
this document records the decisions and the current specification.

## Concept

- A project is authored as **entries** (absolute board coordinates), not as live tiles. Nothing is
  built until it is committed.
- It is the authoring unit for buildings **and** roads, and (later) city interfaces whose cost may
  include demolishing existing structures.
- It is a **forward declaration of demand**: the bill (`validationProgress.requiredGoods`) is known
  before anything exists, which is what lets commerce plan imports (see [commerce.md](./commerce.md)).

## Data model

`Project` (placement) and `HivePlan` (template) are two registries on `Game`:

- `game.projects` — `ProjectCollection`; owns the lifecycle stage machine.
- `game.hivePlans` — `HivePlanCollection`; static templates (the "Plans" panel), no lifecycle.

```ts
type ProjectStage = 'draft' | 'working' | 'archived'   // `validating` deferred (instant for now)

interface Project {
	name: string
	stage: ProjectStage
	entries: ProjectEntry[]                              // ABSOLUTE board coords (placed alveoli)
	roads: RoadPatch[]                                   // pending road segments (built via sites)
	demolitions: Array<readonly [number, number]>        // structures to bulldoze on commit
	roadDemolitions: RoadPatch[]                         // board road segments to bulldoze on commit
	sourcing: ProjectSourcingPolicy                      // per-good auto / take / buy
	validationProgress: HivePlanValidationProgress       // the bill (required/delivered goods)
	knownnessFingerprint: string                         // position-independent dedup
	archiveReason?: 'manual' | 'obsolete'
}

// A project entry is structurally identical to a template entry; the difference is that
// ProjectEntry.coord is ABSOLUTE while HivePlanEntry.coord is RELATIVE (template coords).
type ProjectEntry = HivePlanEntry

interface HivePlan { name: string; entries: HivePlanEntry[]; knownnessFingerprint: string }
```

`RoadPatch` is `{ coord: [q, r], type: 'path' | 'asphalt' }`. For display, roads are **grouped** —
"1 road" = one connected component of the *same* road type (`groupRoadsByConnectedType`).

## Entry

An entry is `{ coord, alveolusType, variant?, configuration? }`:

- `alveolusType` + `variant` resolve to the concrete building and its construction recipe.
- `configuration` names a shared config (`{ scope: 'named', name }`) or embeds an individual
  `AlveolusConfiguration` — the same config the finished alveolus runs with (storage buffers, working,
  transform ratios, …).

## Lifecycle

Stages: `draft → working → archived`. Validation is **instant** (see below).

| Stage | Meaning | Editable |
|---|---|---|
| `draft` | private intent; no board demand, no construction | yes |
| `working` | **committed** — materializes as construction sites on the board | name/entries locked; sourcing tunable |
| `archived` | retired (`manual` / `obsolete`); restorable to `draft` | no |

Transitions (`ProjectCollection`):

- `createDraft` / `updateDraft` — draft editing only.
- `commit` — structural + occupancy validation, then freeze `draft → working`.
- `archive` / `unarchive`.
- `setSourcingMode` — editable in `draft` **and** `working` (quotas stay tunable while running).

## Validation (instant)

Commit runs `validateProjectStructure` (rejects empty / disconnected / unknown alveolus type / missing
named configuration) plus a board-occupancy check (`canInteract(build:)` + `isClear`), then freezes
`draft → working` in the same call. There is **no** `validating` stage and no research work — the
`engineer.research` "study" variant produces no jobs. Science/study is a separate deferred surface; see
[`../plans/science.md`](../plans/science.md).

## Placement

`Game.commitProject` materializes a `draft` project:

- Every **entry** becomes a construction shell (`BuildAlveolus`) linked to the project
  (`shell.project === project`), unless it sits on a demolition tile — those entries are **deferred**
  until the structure there is bulldozed (`materializeDeferredEntriesAt`).
- Every **road** stays in `project.roads` and becomes a `RoadConstructionSite` on its anchor tile
  (see "Roads" below).

## Demolition

A project can plan to bulldoze existing board content. The sequence is
**bulldoze → clean → foundation → construction**:

- `Project.demolitions` (structures) and `Project.roadDemolitions` (board road segments) are authored
  by the bulldoze tool ("bulldozing a tile = destroying all segments on its borders").
- Building engineers run `demolish` jobs (`Alveolus.deconstruct` + storage clean-up + ~50% material
  refund as loose goods); road engineers run `demolishRoad` jobs (one segment at a time, ~50% refund as
  loose goods on the border's anchor tile).
- Refunded goods land on the tile as loose goods and are re-used by the economy.

## Roads

Roads build **like any other building** — one segment at a time, not instantly:

- A road segment is `construction.road[type]` = `{ goods, time }` (`path`: stone; `asphalt`: stone +
  planks). Roads have **no concrete foundation**.
- Each segment's construction site is a `RoadConstructionSite` on the border's **anchor tile** (the
  lexicographically-smaller endpoint, so build-side and demolition-refund-side are the same tile). It
  is a full `ConstructionSiteShell` — it advertises material demand through the normal path, receives
  goods into its own storage, and, once ready, a road engineer works and `finalize()`s it (placing the
  segment and restoring the tile).
- `materializePendingRoadSites` is called on commit and whenever a site finalizes and frees its anchor
  tile (so two segments sharing an anchor build sequentially).

## Sourcing

Each bill good has a per-good **sourcing mode** (`Project.sourcing: Partial<Record<GoodType, mode>>`):

- `auto` (default) — internal-first self-haul, external buy fallback (the internality slider).
- `take` — self-haul only (own hive → site); never bought externally.
- `buy` — outside delivery only (NPC settlement → site); never self-hauled.

The transport automation (`trySpawnConstructionLines` / `trySpawnConstructionDeliveries`) reads the mode:
a `take` good is skipped by the delivery branch, a `buy` good is skipped by the self-haul branch. Unset
goods fall back to `auto` (current behaviour). The toggle is surfaced in the project detail's bill.

## Progress

Committed projects show **live** progress (`Game.projectProgress`, read from the board — not the frozen
plan): an aggregate `ConstructionProgressBar` (`completed` / `total`) plus per-item state
(`pending` / `building` / `done`) for each alveolus entry and road segment, and the goods-still-missing
count (`remainingNeeds` summed across materialized shells).

## Interface

The project window is `project-manager.tsx` (opened via `openProjectsPanel` / the "Open projects"
palette tool):

- **Sidebar** — New; stage filters (all / draft / working / archived); project list with a preview radio.
- **Detail** — name (draft-editable), contents tree (alveoli flat + roads grouped), **bill** with
  per-good sourcing toggle, **progress** (working), **build tools** (hives / alveoli + variants / roads /
  bulldoze), and **actions** (commit / archive / unarchive).
