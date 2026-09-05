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

- `createDraft` / `updateDraft` — draft editing only; return `{ project, duplicate? }`
  so the UI surfaces layout duplicates instead of silently merging them. Archived
  projects never match dedup.
- `commit` — structural + claim-conflict validation, then freeze `draft → working`.
  The conflict check lives in `ProjectCollection.commit` (the freeze authority);
  `Game.commitProject` adds the board-occupancy check before materializing.
- `archive` / `unarchive` / `remove` (delete drafts and archived projects only).
- `setSourcingMode` — editable in `draft` **and** `working` (quotas stay tunable while running).
- Completion auto-archives: `Game.projectProgress` archives a `working` project as
  `obsolete` once every entry and road reads `done`, releasing its claims.

## Validation (instant)

Commit runs `validateProjectStructure` (rejects empty / unknown alveolus type / missing
named configuration — disconnected entries are allowed and group into several hives
after commit) plus a board-occupancy check (`canInteract(build:)` + `isClear`), then freezes
`draft → working` in the same call. There is **no** `validating` stage and no research work — the
`engineer.research` "study" variant produces no jobs. Science/study is a separate deferred surface; see
[`../plans/science.md`](../plans/science.md).

## Collision & conflict

Construction collides against the **present board + footprint** — there are no per-structure edge cases:

- **Roads** may *terminate* at a freight bay (its border is the dock) but never *cross* a bay's tile,
  exactly like any other alveolus. A planned (in-project) bay is treated the same: it ends a road but
  blocks one passing through. (`isRoadTerminusTile` / endpoint-aware `canBuildRoadThroughTile`.)
- **No cross-project checks.** A project never checks another project — not even for collision. Each
  project is validated against the **live board + its own footprint** only (internal consistency). Two
  draft plans may plan the same cell; whichever commits first materializes onto the board, and the
  other is caught by the board-occupancy check — or re-checked against the board when re-opened, since
  the board changed. A project's claims (`projectClaimKeys`) are recorded purely to drive the
  `projectClaims` bounding-box event (NPC-growth / netcode invalidation), **not** conflict detection.

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
  tile (so two segments sharing an anchor build sequentially). An occupied anchor keeps the
  segment pending — roads are never instant-built, so every segment costs materials. Built
  segments stay in `project.roads` (the stable build list) so progress keeps a stable denominator.

## Sourcing

Each bill good is **taken** from the local economy or **bought** automatically:

- `take` — await locally: self-haul it from an own hive, or bring it yourself with a
  player-authored import line (including an NPC trade-stop line to choose the buying place).
  The transport automation never auto-buys it, and any player line already covering the need
  suppresses automated orders (dedupe).
- `buy` — auto-buy it via outside delivery: the automation buys from the best-ranked NPC sell
  offer (cheapest `priceVp`, nearest on price ties) and pays `priceVp × qty` from the wallet;
  an NPC brings it (currently an instant credit, no physical carrier yet). The automation never
  self-hauls it.

`Project.sourcing` is `Partial<Record<GoodType, 'take' | 'buy'>>` — **explicit per-good overrides only**.
An unset good has no override and falls back to the automation's internal-first + external-fallback
behaviour (both branches active, gated as usual). The transport spawners read the override:
`trySpawnConstructionLines` (self-haul) skips a `buy` good, `trySpawnConstructionDeliveries` (outside
delivery) skips a `take` good.

The UI is a **single, bill-only, availability-sorted list with a "take / buy" divider**
(`ProjectSourcingEditor`): goods are sorted *nearest → not produced* (`measureGoodAvailability` — a hive
with stock above reserve → `produced`, below reserve → `held`, none → `unproduced`), the **default** split
puts produced/held goods above the line and unproduced below it, and the player resolves the whole project
in one click via **"Take all" / "Buy all"**, flips a single good by click or drag across the line, and can
drag the divider to move the default cutoff.

**Forward declaration.** A working project's **deferred** (not-yet-materialized) entry bills and
unbuilt road-segment recipes are added
to the deficit ledger's demand side (`ProjectForwardNeed`), so the deficit reads the true forward demand
even before a demolition clears the tile or an anchor frees. Delivery skips forward-declared needs (no live storage); once
materialized, the shell advertises the same demand. Road sites advertise through the normal
construction-demand path (self-haul and delivery both serve them). A construction plan **produces nothing** — cleared
resources and demolition leftovers are not accounted against the project, so the ledger's `surplus`
stays `0` for construction demand.

**Operating demand is out of scope.** A construction project never manages *functioning* goods (storage
buffers, transform inputs) — those belong to the live hive/commerce, which already advertises its own
operating demand once built, not to the plan's bill.

## Hives

After commit, the project's placed alveoli are grouped into **hives** — maximal connected components
over hex adjacency (`groupProjectEntriesIntoHives`, the same flood-fill as the hive-plan connectivity
validation). This is a read-only grouping (done *after* commit, so it never has to be recomputed during
draft editing) and is shown in the committed project's contents tree. A draft shows its alveoli flat.

## Progress

The **bill** is the expected totals (`validationProgress.requiredGoods` — the frozen draft
bill). Committed projects show **live** progress (`Game.projectProgress`, read from the board — not the frozen
plan): an aggregate `ConstructionProgressBar` (`completed` / `total`) plus per-item state
(`pending` / `building` / `done`) for each alveolus entry and road segment, and the goods-still-missing
count (`remainingNeeds` summed across materialized shells). An entry counts `done` only when the
tile holds the planned alveolus type/variant; a road site counts only for its owning project.

## Interface

The project window is `project-manager.tsx` (opened via `openProjectsPanel` / the "Open projects"
palette tool):

- **Sidebar** — New; stage filters (all / draft / working / archived); project list with a preview radio (click again to clear).
- **Detail** — name (draft-editable), contents tree (alveoli flat in draft, grouped into hives after
  commit, plus roads grouped by type; entry configuration shown read-only), **bill** (expected totals), **sourcing** (the availability-
  sorted take/buy list with "Take all" / "Buy all"), **progress** (working), **build tools** (hives /
  alveoli + variants / roads / bulldoze), and **actions** (commit / archive / unarchive / delete drafts and archived).
