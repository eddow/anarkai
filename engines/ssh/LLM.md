## Hives
Set of (hex-)adjacent alveolii. All alveolus should be reachable from any other alveolus in the same hive, moving one tile at a time. No two hives should be adjacent.
## Locales
Translations are merged in memory. `assets/locales` serves as a base, and `src/locales` can override/extend it.
- `assets/locales/*.json`: Base translations.
- `src/locales/*.json`: Source code translations.

## Residential (v1 slice)
- Zoned `UnBuiltLand` can receive `residential:basic_dwelling` as a `project` string; it maps to a `ConstructionTarget` of kind `dwelling` (`construction-state.ts`).
- `BuildDwelling` is a tile-backed construction shell (not an `Alveolus`, not hive-attached) and reuses the `buildAlveolusMarker` hook so engineers can `construct` it like `BuildAlveolus`.
- Completed housing is `BasicDwelling` (`board/content/basic-dwelling.ts`) with a single home slot; characters prefer reserving it over raw residential tiles (`npcs/context/find.ts`).
- Save/load persists dwellings via `SaveState.dwellings` (`DwellingPatch`) applied after `projects` in `game.generate` / `generateAsync`.
- Automatic project creation is driven by `trySpawnResidentialProject` (`residential/demand.ts`) on a ticked `ResidentialDemandTicker` registered on the `Game`.
- Engineers pick **ready construction shells first**, then **foundation** (`hive/engineer.ts` two-pass `findNearest`) so a nearer queued foundation cannot starve a farther `BuildDwelling` that is already material-ready.
- **Shared construction shells**: `ssh/build-site.ts` now defines the structural `BuildSite` contract, installs shared prototype accessors (`installBuildSitePrototype`) on both `BuildAlveolus` and `BuildDwelling`, centralizes material math (`materialRemainingNeeds`, …), and owns phase sync (`registerConstructionMaterialPhaseEffect`). Inspector snapshots and `constructionStep()` operate on that shared shell model.
- **Freight routes (engine)**: `FreightLineDefinition` is an ordered `stops[]` of **`FreightStop`** route steps. Each step has optional `loadSelection` / `unloadSelection` (`GoodSelectionPolicy`) and **either** `anchor: FreightBayAnchor` (bay tile) **or** `zone: FreightZoneDefinition` (radius area) — not both. Gather vs distribute is inferred from geometry (`findGatherRouteSegments` / `findDistributeRouteSegments`: gather = radius zone then bay anchor at the **same** coordinates; distribute = bay anchor pickup that is not a gather unload, then anchor/zone unload). `normalizeFreightLineDefinition` trims ids/coords/policies; `GamePatches.freightLines` / `replaceFreightLine` use **`FreightLineDefinition`**. Longer overview: `docs/freight-lines.md`; handoff / UI gaps: `sandbox/freight-handoff.md`.
- **Segment-specific runtime authority**: Use `gatherSegmentAllowsGoodTypeForSegment` / `distributeSegmentAllowsGoodTypeForSegment` with the active segment in loops. Line-wide `gatherSegmentAllowsGoodType` / `distributeSegmentAllowsGoodType` OR across segments (broad checks). `distributeSegmentWithinRadius` / `distributeSegmentBayTile` take a concrete segment. `freightLineAllowsGoodType` is UI-oriented. Residential delivery/requisition use the `ForSegment` helpers.
- **Freight distribute to dwelling materials**: `findFreightDeliverJob` iterates distribute segments and uses `distributeSegmentAllowsGoodTypeForSegment`, `distributeSegmentBayTile`, `distributeSegmentWithinRadius` (per segment; no whole-line radius helper).
- **Bay requisition**: `augmentFreightBayGoodsRelationsForResidential` uses the same segment-scoped helpers.
- **Multi-line freight bays**: `findGatherFreightLines` / `findDistributeFreightLines` match stops touching **gather** vs **distribute route segments**. `StorageAlveolus` (`road-fret`) uses `gatherSegmentAllowsGoodType` for `2-use` provide ads, uses `distributeLinesAllowGoodType` (which delegates to `distributeSegmentAllowsGoodType`) at the bottom of `workingGoodsRelations`, and gates `canTake` so gather-only bays stay closed to convey intake while gather+distribute bays accept goods any distribute segment allows.
- **Bay inspector freight UI**: `apps/browser/.../AlveolusProperties.tsx` shows a bay-specific "Lines at this bay" block for `freight_bay` + `road-fret`. Add gather / add distribute calls `createExplicitFreightLineDraftForFreightBay` + `Game.replaceFreightLine`. **Delete** an explicit line from the **line** inspector (`FreightLineProperties`, `Game.removeFreightLineById`; implicit `:implicit-gather:` ids are refused in engine). Locale keys live under `bay.*` / `line.deleteLine.*` in `engines/ssh/assets/locales/*.json`.
- **Later (generic freightDeliver discovery)**: `findFreightDeliverJob` still lives in `freight/residential-freight-deliver.ts` but the `FreightDeliverJob` type and `work.freightDeliver` NPC path are already generic. A future pass should move job *discovery* next to shared `BuildSite` / `materialRemainingNeeds` so hive under-construction, residential, and commercial shells share one finder; keep the residential file as a thin bridge until then.
- Debug: `traces.residential?.log(...)` is wired in residential lifecycle hotspots; keep `//traces.residential = console` commented in-repo (Vitest worker serialization can overflow if `console` is assigned into `traces.*`).
## Memoization
All previously commented-out `@memoize` decorators have been rehabilitated and identified with the `// REHABILITATED MEMOIZE` marker.
- **Runtime Guard**: `mutts.reactiveOptions.onMemoizationDiscrepancy` is configured in `debug.ts` to trigger a `debugger` and throw an error if a discrepancy is detected.
- **Test Enforcement**: This detection is enforced in all unit/integration tests (via `test-setup.ts`) and is captured in browser E2E tests via the `console-trap` (initialized in `App.tsx`).

## Pathfinding and Reactivity
- Pathfinding must never register reactive dependencies on traversed tiles, borders, loose goods, or scoring targets.
- Any board scan or path search is a transient query, not a reactive derivation.
- The shared pathfinding utilities in `src/lib/utils/pathfinding.ts` are wrapped in `untracked(...)` so callers cannot accidentally subscribe to every visited node.
- Do not put pathfinding-based availability checks behind `@memoize` unless they depend only on stable, coarse invalidation signals.
## Advertising / Movement
- Movement selection is deferred in `src/lib/hive/hive.ts` to avoid reactive cycles, so anything that treats a selected partner as an already-created movement is suspect.
- Optional stalled-exchange recovery lives in `src/lib/globals.ts` as `options`; when enabled, hives rescan for stable provide+demand pairs that still have no active `movingGoods` and re-advertise them.
- Convey visuals in `src/lib/npcs/context/work.ts` must use the pre-`hop()` origin snapshot for interpolation; `MovingGood.hop()` mutates `mg.from` to the destination immediately.
- `MovingGood.claimed` prevents two workers from picking up the same movement simultaneously. `conveyStep()` sets it to `true` immediately; `finished()` clears it after re-reserving the next hop; `canceled()` and `cleanupFailedConveyMovement()` also clear it. `aGoodMovement` skips claimed movements.
- Convey paths are **border-to-border across relay tiles**, ending on the demander tile. For non-terminal hops, `conveyStep` **allocates the next gate** before `fulfillMovementSource` (preflight), so a full gate blocks pickup instead of mutating the world first. Multi-movement **cycles** skip preflight for the first movement (the "cycle leader"), freeing one gate slot so subsequent members can allocate. The deferred allocation is retried in the `.finished()` callback.
- In `TrackedMovement` methods, do not mix the closed-over raw object with the runtime receiver for bookkeeping. Keep removal/retracking id-based in hive helpers and use `this` consistently inside `hop()` / `place()` / `finish()` / `abort()`, otherwise reactive proxy receivers can produce stale `movingGoods` bucket skew (`tracked-at-wrong-position`).

## Board / module graph
- `isTileCoord` lives in `src/lib/board/tile-coord.ts` (re-exported from `board.ts`). `alveolus.ts` must import it from there, not from `board.ts`, otherwise `alveolus` / `HexBoard` circular evaluation can leave `Alveolus` undefined when `EngineerAlveolus` (or other hive modules) load.

## Vitest / integration harness
- `tests/test-engine/mocks.ts` must register `vi.mock(...)` at module top level (Vitest hoisting). `test-setup.ts` imports `./tests/test-engine/mocks` first so `engine-rules` never loads before overrides.
- When tests override `traces.advertising`, **never** `{ ...console, warn: ... }`: shallow-copying `console` can make Vitest 3.2's worker `postMessage` serialization recurse until `RangeError: Maximum call stack size exceeded`. Prefer a tiny stub (`log/info/debug/error` no-ops + `warn` sink) cast to `typeof console`.
- Full-suite runs can still hit a Vitest worker teardown bug after all tests pass; `vitest.config.ts` sets `dangerouslyIgnoreUnhandledErrors: true` with an inline rationale. Revisit when upgrading Vitest (4.x+) or if the RPC serialization issue is fixed upstream.
- The former `it.fails` BUG block in `convey_bookkeeping_resilience.test.ts` was removed (comment points to git history). The border **source rebind** regression is kept (currently skipped) in `tests/integration/convey_bookkeeping_border_handoff.test.ts` because running it alone can still trigger the same RPC overflow unless Vitest is upgraded.
