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
type ProjectStage = 'draft' | 'working' | 'archived'   // `validating` (research/study) deferred — TODO

interface Project {
	name: string
	stage: ProjectStage
	entries: ProjectEntry[]               // ABSOLUTE board coords (placed alveoli)
	roads: RoadPatch[]                    // ABSOLUTE board coords (roads live on the project)
	sourcing: SourcingEntry[]             // per-good buy / take-from-local-storage
	validationProgress: HivePlanValidationProgress   // bill over the placed entries
	knownnessFingerprint: string          // position-independent dedup across projects
	archiveReason?: 'manual' | 'obsolete'
}

// A project entry is structurally identical to a template entry; the difference is that
// ProjectEntry.coord is ABSOLUTE while HivePlanEntry.coord is RELATIVE (template coords).
type ProjectEntry = HivePlanEntry

interface HivePlan {                      // abstract template (the "Plans" widget)
	name: string
	entries: HivePlanEntry[]               // RELATIVE coords ("wood chopper beside the bay")
	knownnessFingerprint: string           // rotation-invariant, for dedup / novelty memory
}
```

`HivePlan` (template) and `Project` (placement) are **separate registries** on `Game`:
`game.hivePlans` (templates, static — no lifecycle) and `game.projects` (placements, owns the stage
machine). A project is authored by **stamping** templates onto the board
(`stampHivePlanEntries(hivePlan, anchor, rotation, mirror)` → absolute entries); the project stores the
alveoli, not the template.

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
- [x] Introduce the `Project` type + `ProjectCollection` as the **top-level** register on `Game`
      (replacing `HivePlanCollection` as the primary list; `HivePlanCollection` folded into `ProjectCollection`).

### Phase 1 — `Project` data model (engine)

- [x] `Project` shape: `name`, `stage`, `hivePlans: HivePlan[]`, `roads: RoadPatch[]`,
      `sourcing: SourcingEntry[]`, `validationProgress` (aggregate), `knownnessFingerprint`,
      `archiveReason?`.
- [x] Demote `HivePlan` to a cluster template: keep `name` + `entries` + `knownnessFingerprint`; move
      `stage` / `validationProgress` / `archiveReason` up to `Project`.
- [ ] Roads on the project: a flat `roads: RoadPatch[]` (no plan wrapper). Provide
      `groupRoadsByConnectedType(roads)` (same-type connected components) for display.
- [x] Aggregate bill: `Project.validationProgress.requiredGoods` = Σ over `hivePlans`
      (`hivePlanValidationRequirements`) + road cost (0 for now — roads build instantly).
- [x] `ProjectCollection` CRUD: `createDraft`, `updateDraft`, `sendToValidation`, `archive`, `unarchive`,
      `applyResearchWork`, `findDuplicate`, `serialize`/`deserialize` (nested `hivePlans` + `roads` +
      `sourcing`), keeping `indexOf`/`byIndex` (project) + `planIndexOf`/`planByIndex` (flattened plan)
      as the save/load provenance seam. (`commit` lands in Phase 2.)
- [x] Migrate all `game.hivePlans` call sites → `game.projects`: `hive/engineer.ts`, `jobs/action-job-registry.ts`,
      `npcs/context/work.ts` (validate-job flow), `game/exampleGames.ts`, `game/game.ts`, serialization +
      `save-indexes.ts`, `apps/browser` (plan-manager widget + tests). Also renamed the legacy
      `GamePatches.projects` map form → `siteMap` (and `applyProjectPatches` → `applySiteMapPatches`).
- [x] Update `hive-plan.test.ts` (collection → `ProjectCollection`, placement provenance, bill) +
      `soviet-example.test.ts` + `plan-manager.spec.tsx`. (A dedicated `project.test.ts` is still TODO.)

### Phase 2 — Lifecycle: commit + placement (engine)

- [x] **Validation deferred (TODO).** The `engineer.research` "study engineer" variant exists in content, but
      projects do **not** trigger research yet — no `validating` stage, no `sendToValidation`/
      `applyResearchWork`/`validatingProjects`, no `validateProject` job (`ValidateProjectJob`, `JobType`/
      `GenericWorkPlan.job`, `action-job-registry.ts` `research` case, `work.ts`, `work.npcs`). The
      `research` engineer case is a no-op for now; "researching at home" (and any "buy research" option)
      is a later slice — recorded in §Deferred.
- [x] `ProjectCollection.commit(project)` = structural check → freeze `draft → working` (no research gate).
- [x] `Game.commitProject(project)` materializes a **`draft`** project: validate structure + board occupancy,
      place every **entry** as a construction shell (linked to the project) + apply every road instantly
      (`hex.setRoadType`), then freeze to `working`. Note: `Project.entries` are already **absolute**
      (not a template), so commit needs no anchor/rotation/mirror.
- [x] **Mirror** (hex reflection) lives in `stampHivePlanEntries(hivePlan, anchor, rotation, mirror)` — the
      authoring-time template→project stamp (rotate + mirror + offset → absolute entries). `previewHivePlanPlacement`
      (the old direct "place a single hive on the board" flow) remains rotation-only; that flow is superseded.
- [x] Placement conflict check: `commitProject` reuses the `canInteract(build:)` + `isClear` semantics of
      `previewHivePlanPlacement` (blocks existing alveoli / cleared-burden tiles). Road-border vs tile
      occupancy conflict is a later refinement.
- [x] Link placed shells back to the owning project: `BuildAlveolus.project?: Project` (object reference),
      serialized as `SitePatch.projectIndex` / `AlveolusPatch.projectIndex` (symmetric to `hivePlanIndex`).

### Phase 3 — Project detail UI (tree view + build tools)

- [x] New **`project-manager.tsx`** widget (registered as `projectManager`, opened via
      `openProjectsPanel` + the palette "Open projects" tool). Sidebar lists `Project`s (stage filters
      all/draft/validating/working/archived) + New; detail shows name (draft-editable), a **tree view**
      (alveoli flat + roads grouped by same-type-connected via `groupRoadsByConnectedType`), the **bill
      (goods)**, **build tools**, and **actions** (Validate / Commit / Archive / Unarchive).
- [x] `groupRoadsByConnectedType(roads)` pure helper (same-type connected components; "1 road = same type
      + connected") + unit tests. This is the **lighter** grouping — the "project hive" level is deferred.
- [x] `projectEditingState { project, tool }` added to `interactive-state.ts` (re-exported via globals);
      build-tool buttons set it (`build:<type>` / `road:<type>` / `bulldoze`). Hive buttons list
      `alveolusTypes`; road buttons list `ROAD_TYPES`.
- [x] Build tools divided by **kind** into collapsible categories: **Hives** (list of `game.hivePlans.plans`,
      stamps a template via `projectEditingState.tool='hive'` + `hivePlan`, with rotate/mirror controls),
      **Alveoli** (`build:<type>`), **Roads** (`road:<type>` + bulldoze). Expand/collapse state is local.
- [x] Hive stamping wired into board-click placement: `game.tsx handleProjectEditClick` stamps
      `stampHivePlanEntries(plan, anchor, rotation, mirror)` and merges by absolute coord (a stamped
      alveolus replaces an existing entry there). `R`/`Q` rotate, `M` mirror (`game:project-hive-keys`).
- [ ] Variant picker on build buttons (reuse `getAppShellBuildableAlveoli` / `getAppShellBuildToolbarRoots`).
- [ ] Editing routes build/road actions into the project editor (add/remove alveoli, add/remove road
      segments) — the **board-click placement** is wired in Phase 5 (the buttons set the tool now).
- [ ] Remove build + road actions from the palette `selectedAction` values (already visually hidden) —
      confirm the palette no longer lists them.

### Phase 4 — Bill + per-good buy/take (sourcing) in the editor

- [x] Show the **bill (in goods)** at authoring time in the project detail (from
      `Project.validationProgress.requiredGoods`) — first increment renders `delivered / required` per good.
- [ ] Per-good **buy vs take-from-local-storage** toggle → seed `Project.sourcing` (a
      `SourcingEntry[]` / `SourcingPolicy` override), binding the existing `trySpawnConstructionDeliveries`
      (buy) vs `trySpawnConstructionLines` (self-haul) spawners.
- [ ] Show the **goods-still-missing count** = `requiredGoods − deliveredGoods` (live, per good).

### Phase 5 — Board preview (radio button per project)

- [x] One **preview radio** per project; checked by default when a project widget is opened
      (`projectPreviewState { project, active }`; the widget's select/effect previews the selected project).
- [x] When checked, draw the project's planned **buildings** as a board overlay ghost (reuses the
      existing `dragPreview` overlay; `game:project-preview` effect). Road-overlay ghost is a follow-up.
- [x] Only one preview active at a time (radio group); unchecking hides the overlay.
- [x] **Board-click placement**: `projectEditingState` tools route into `objectClick` (build/bulldoze via
      `applyHivePlanToolAction` → `projects.updateDraft({ entries })`) and `roadDrag` (border coords via
      `roadBordersForTrace` → `projects.updateDraft({ roads })`), taking precedence over the palette action.

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

- [ ] **"Project hive" grouping** — a project-level grouping of placed alveoli into named hives, used for
      hive **deletion/configuration** and **progress-bar grouping**. Adding/removing alveoli requires hive
      reconstruction (hives must stay internally connected). The board-runtime `Hive` clustering (which
      already groups connected alveoli live) is a *separate* concept. This project-level grouping is the
      tree-view "hives" level and is deferred — Phase 3 ships the **lighter** tree: project → alveoli
      (flat) + roads (grouped by same-type-connected).
- [ ] **Research / validation ("study engineer")** — the `engineer.research` variant exists, but projects
      don't trigger research yet and there's no "buy research" option. "Researching at home" (a research
      engineer consuming the bill's goods + work-seconds to promote `draft → working`) is a later slice:
      decide whether it gates commit, whether it's a per-good sink, and its UX.
- [ ] Authoring a project on top of an ongoing project (the explicit "TODO").
- [ ] Road construction progress (roads build instantly for now — a committed tree shows roads as a static list).
- [ ] Merge semantics (how two projects' bills combine/conflict).
- [ ] Operating demand in the bill (storage buffers / transform inputs).
- [ ] Reusable / scattered clones (stamp the same hive N times; shared vs forked config).
- [ ] City demolition cost model.
- [ ] Feed the committed bill into the group deficit ledger on push.
