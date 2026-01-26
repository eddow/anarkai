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