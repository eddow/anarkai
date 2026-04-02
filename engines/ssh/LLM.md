## Hives
Set of (hex-)adjacent alveolii. All alveolus should be reachable from any other alveolus in the same hive, moving one tile at a time. No two hives should be adjacent.
## Locales
Translations are merged in memory. `assets/locales` serves as a base, and `src/locales` can override/extend it.
- `assets/locales/*.json`: Base translations.
- `src/locales/*.json`: Source code translations.
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