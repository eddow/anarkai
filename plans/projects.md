# Projects — working notes

> Decisions, TODO, unresolved questions, and reflections. Conclusions go to
> [`../docs/projects.md`](../docs/projects.md).

## Decisions (2026-08-30)

Answers to the open questions that were blocking. **Project** is now a real top-level container that
owns several **hives** (clusters of alveoli) *and* the **roads**; it is the single authoring + lifecycle
unit. The former "`HivePlan` ≡ project" identity is retired.

1. **A `Project` spans N hives + roads.** `Project` holds `hivePlans: HivePlan[]` (each `HivePlan` is
   one "hive" = one contiguous list of alveoli to build) plus `roads: RoadPatch[]`. The stage machine
   moves up to `Project`; `HivePlan` becomes a subordinate cluster/template.
2. **Roads have no plans.** Roads live *directly* on the `Project` (the project *is* the plan for the
   borders we pave). No `HivePlan` wrapper, no sharing of the hive-connectivity validation.
3. **"Placing a hive" = "placing a bunch of alveoli".** The project does **not** remember the placed
   hive instance — it only remembers the list of alveoli (the template). Placing stamps the template as
   construction sites.
4. **Placement is rotatable *and* mirrorable**, and only allowed when it does not conflict with other
   alveoli / district / road.
5. **Commit = make it work.** The button may be named "Commit" but it *is* the existing
   `draft → working` transition (freeze + materialize). `validating` (the survey / novelty work-seconds
   "study/science" stage) is **out of scope for now** — commit goes straight from draft to building.
6. **Road progress is deferred.** Roads are built **instantly** on commit (no road construction sites,
   no per-tile road progress) — the committed tree shows roads as a static list.
7. **Buy vs take = existing sourcing.** "Buy" = external `trySpawnConstructionDeliveries`
   (outside-carrier delivery); "take from local storage" = `trySpawnConstructionLines`
   (radius-local self-haul). Surfaced as a **per-good** choice in the project detail, seeded into
   `Project.sourcing`. No new mechanism.
8. **Authoring a project on top of an ongoing project is a deferred TODO.**
9. **The bill (in goods) is shown at authoring time**, with the per-good buy/take config beside it.

## Naming

"Project" currently means two things; we rename the **tile-level** one.

- **`Project`** (new, primary) — the top-level plan container: a plan full of hives + roads.
- **`HivePlan`** (kept) — one "hive" = a cluster/template of alveoli. User-facing label: "hive".
- **`site`** (rename) — the tile-level "project" = the purple-border planified tile
  (`UnBuiltLand.project: string`, e.g. `"build:sawmill"`), i.e. a per-tile pending-build designation.

Rename surfaces (mechanical, cross-cutting): `UnBuiltLand.project` → `site`, `setProject()` →
`setSite()`, `constructionTargetFromProject()` → `constructionTargetFromSite()`,
`residentialBasicDwellingProject` → `residentialBasicDwellingSite`, `ProjectSitePatch` → `SitePatch`
(serialization), `work.project.*` traces → `work.site.*`, the pink/purple `colorCode` override in
`UnBuiltLand`, and the `!this.project` / `land.project` guards in `unbuilt-land.ts` + `canInteract`.

## Data model (target)

```ts
type ProjectStage = 'draft' | 'working' | 'archived'      // `validating` dropped for now

interface Project {
	name: string
	stage: ProjectStage
	hivePlans: HivePlan[]                 // each = one "hive" (a contiguous list of alveoli)
	roads: RoadPatch[]                    // roads live directly on the project (no plan wrapper)
	sourcing: SourcingEntry[]             // per-good buy / take-from-local-storage
	validationProgress: HivePlanValidationProgress   // aggregate bill over hivePlans
	knownnessFingerprint: string          // dedup across projects
	archiveReason?: 'manual' | 'obsolete'
}

interface HivePlan {                      // demoted to a cluster template
	name: string
	entries: HivePlanEntry[]               // "the list of alveoli to build"
	knownnessFingerprint: string           // per-cluster, for novelty/dedup
	// stage / validationProgress / archiveReason move up to Project
}
```

`RoadPatch` stays `{ coord: [q, r], type: 'path' | 'asphalt' }` (`board/roads.ts`). For display, roads
are **grouped**: "1 road" = one connected component of the *same* road type (a display grouping, not a
storage rule).

## Work plan

Ordered so each phase lands and stays testable. Phases 0–1 are the engine/data-model seam; 2–6 build
the UI/behavior on top.

### Phase 0 — Naming (mechanical rename)

- [x] Rename tile-level `project` → `site`: `UnBuiltLand.project`/`setProject`, `constructionTargetFromProject`,
      `residentialBasicDwellingProject`, `ProjectSitePatch` (save/load), `work.project.*` traces, the
      pink/purple `colorCode` override, and the `!project`/`land.project` guards + `canInteract` zone gate.
- [ ] Introduce the `Project` type + `ProjectCollection` as the **top-level** register on `Game`
      (replacing `HivePlanCollection` as the primary list; keep `HivePlanCollection` or fold it in).

### Phase 1 — `Project` data model (engine)

- [ ] `Project` shape: `name`, `stage`, `hivePlans: HivePlan[]`, `roads: RoadPatch[]`,
      `sourcing: SourcingEntry[]`, `validationProgress` (aggregate), `knownnessFingerprint`,
      `archiveReason?`.
- [ ] Demote `HivePlan` to a cluster template: keep `name` + `entries` + `knownnessFingerprint`; move
      `stage` / `validationProgress` / `archiveReason` up to `Project`.
- [ ] Roads on the project: a flat `roads: RoadPatch[]` (no plan wrapper). Provide
      `groupRoadsByConnectedType(roads)` (same-type connected components) for display.
- [ ] Aggregate bill: `Project.validationProgress.requiredGoods` = Σ over `hivePlans`
      (`hivePlanRequiredGoods`) + road cost (0 for now — roads build instantly).
- [ ] `ProjectCollection` CRUD: `createDraft`, `updateDraft`, `commit`, `archive`, `unarchive`,
      `findDuplicate`, `serialize`/`deserialize` (nested `hivePlans` + `roads` + `sourcing`), keeping
      `indexOf`/`byIndex` as the save/load provenance seam.
- [ ] Migrate all `game.hivePlans` call sites → `game.projects`: `hive/engineer.ts`, `jobs/action-job-registry.ts`,
      `npcs/work.ts` (validate-job flow), `game/exampleGames.ts`, `game/game.ts`, serialization +
      `save-indexes.ts`, `apps/browser` (widgets, globals, tests).
- [ ] Update `hive-plan.test.ts` + add `project.test.ts` (aggregate bill, commit freeze, dedup).

### Phase 2 — Lifecycle: commit + placement (engine)

- [ ] Simplify stages to `draft → working → archived` (drop `validating` for now). `sendToValidation` is
      retired or becomes a no-op alias; `commit(project)` = validate structure → freeze → materialize.
- [ ] `commit(project)` materializes: place every `hivePlan` (construction shells via
      `createConstructionSiteForHivePlanEntry`) + apply every road instantly (`applyRoadTrace` /
      `setRoadType`).
- [ ] Add **mirror** (hex reflection) alongside `rotation` to `previewHivePlanPlacement` +
      `hivePlanPlacementState` (currently rotation-only). "Placing a hive" = placing its bunch of
      alveoli at anchor + rotation + mirror.
- [ ] Placement conflict check extends to **alveoli / district / road** occupancy (extend
      `previewHivePlanPlacement` cells beyond `isClear`/`canInteract`).
- [ ] Link placed shells back to the owning project for the committed treeview: extend the shell
      provenance (`shell.hivePlan` already exists) with `shell.project` (or resolve hivePlan → owning
      project). Decided: **object reference**, matching the existing `hivePlan` identity seam.

### Phase 3 — Project detail UI (tree view + build tools)

- [ ] Rework `plan-manager.tsx` into a **project manager**: sidebar lists `Project`s (stage filters
      `draft/working/archived`); the detail is a **tree view**.
- [ ] Tree structure (expandable): `Project` → hive plans → alveoli; plus roads grouped by
      same-type-connected component (`roads → tiles`); each node expandable/collapsible.
- [ ] Build tools live **in the tree**, not the palette: **hive buttons** (alveolus types + variants,
      reuse `getAppShellBuildableAlveoli` / `getAppShellBuildToolbarRoots` from `app-shell-controls`) and
      **road buttons** (`road:path`, `road:asphalt`).
- [ ] Editing routes build/road actions into the project editor (add/remove alveoli, add/remove road
      segments) via the project tree, not `interactionMode.selectedAction`.
- [ ] Remove build + road actions from the palette `selectedAction` values (already visually hidden) —
      confirm the palette no longer lists them.

### Phase 4 — Bill + per-good buy/take (sourcing) in the editor

- [ ] Show the **bill (in goods)** at authoring time in the project detail (from
      `Project.validationProgress.requiredGoods`).
- [ ] Per-good **buy vs take-from-local-storage** toggle → seed `Project.sourcing` (a
      `SourcingEntry[]` / `SourcingPolicy` override), binding the existing `trySpawnConstructionDeliveries`
      (buy) vs `trySpawnConstructionLines` (self-haul) spawners.
- [ ] Show the **goods-still-missing count** = `requiredGoods − deliveredGoods` (live, per good).

### Phase 5 — Board preview (radio button per project)

- [ ] One **preview radio** per project; checked by default when a project widget is opened.
- [ ] When checked, draw the project's planned buildings (+ roads) as a **board overlay** ghost,
      anchored near the current POV center (or reuse the placement ghost anchor once placement is
      active). Mirror/rotation controls affect both preview and placement.
- [ ] Only one preview active at a time (radio group); unchecking hides the overlay.

### Phase 6 — Committed project (read-only progress)

- [ ] Committed project detail = overall `ConstructionProgressBar` (aggregate) + a **treeview of
      individual progress bars** (hive → alveolus, road → tile) + the goods-still-missing count.
- [ ] Read live per-item progress from the placed construction shells (via the `project`/`hivePlan`
      shell link), not from the frozen plan. Roads render as instant/complete (deferred progress).
- [ ] Committed projects are **not editable** (name/entries/roads/sourcing locked).

## Reflections

- The stage machine is the right register for "planned vs committed" demand — only `working` advertises
  to the board. Moving it up to `Project` (not `HivePlan`) matches "a project is a forward declaration".
- Projects invert demand direction: today demand is emergent (placed alveoli advertise); projects make
  it a forward declaration. The `requiredGoods` bill is the existing seam for this.
- The bill + "buy all not produced" is the same net-deficit computation as commerce; projects are a
  *demand origin*, not a separate trading mechanism.
- Roads stay **parallel** to hives (not `HivePlanEntry`s) so they never pollute
  `validateHivePlanStructure`'s connectivity check or the `knownnessFingerprint` dedup.
- "Placing a hive = placing a bunch of alveoli" keeps the plan a *stamp/template*: the project stores
  the alveoli list, never the placed instance — the blueprint model, with per-placement clone deferred.

## Deferred / still open

- [ ] Authoring a project on top of an ongoing project (the explicit "TODO").
- [ ] Road construction progress (roads build instantly for now).
- [ ] `validating` survey / novelty work-seconds ("study/science").
- [ ] Merge semantics (how two projects' bills combine/conflict).
- [ ] Operating demand in the bill (storage buffers / transform inputs).
- [ ] Reusable / scattered clones (stamp the same hive N times; shared vs forked config).
- [ ] City demolition cost model.
- [ ] Feed the committed bill into the group deficit ledger on push.
