# Alveolus Variants — Implementation Plan

Plan to reach `engines/ssh/docs/alveoli-variants.md`

## Scope (MVP)

- Variant-capable types: `pile`, `engineer` only.
- Nested variants supported (e.g., `pile.wood.extra`).
- Tool/equipment (axe/chainsaw) is **not** part of variants; handled by a separate equipment system.
- Construction queue supports multi-hop paths (e.g., `UnBuiltLand -> pile -> pile.wood -> pile.wood.extra`).
- Save/load persists `variantId`; missing variants fall back to root (incomplete but present).
- UI: minimal plumbing to accept/provide `variantId`; no full picker implementation in this pass (document stubs/TODOs).

## Milestones

1) Rules and data model
2) Construction queue + targeting
3) Runtime resolution + factory + shells
4) Save/load + plan integration
5) UI/renderer stubs
6) Cleanup (remove obsolete docs, sanity checks)

## Work Breakdown

### 1) Rules and data model
- Update [`engines/rules/src/content/alveoli.ts`](engines/rules/src/content/alveoli.ts:1):
  - Add `pile` root with nested variants `wood`, `wood.extra`, `planks`, `planks.extra` and their construction recipes.
  - Rewrite `engineer` to use variants (`building`, `research`, `road`) with action sets/specifications; root has no action set beyond dispatch type.
  - Remove legacy `woodpile` if obsolete or leave intact but unused.
- Types (ssh):
  - [`construction-state.ts`](engines/ssh/src/lib/construction-state.ts:23): `ConstructionTarget` gains `variantId?: string`; `constructionTargetFromProject` parses variantId; `createConstructionRecipe` selects target node construction.
  - Define `ConstructionRecipe` helper for `{ time: number } & Partial<Record<GoodType, number>>` if not present.
  - Introduce a reusable `resolveAlveolusVariant(alveolusType, variantId?)` that returns `{ definition, construction }` (merged behavior, target construction recipe). Reuse across shells/factory.

### 2) Construction queue + targeting
- Introduce per-tile construction queue:
  - In [`unbuilt-land.ts`](engines/ssh/src/lib/board/content/unbuilt-land.ts:60), allow `setProject(project, constructionSite?, variantId?)` to seed a queue with the target path (default single step to root or variant).
  - In [`tile.ts`](engines/ssh/src/lib/board/tile.ts:230), extend `build(alveolusType, variantId?)` to pass variantId into `setProject`.
- Queue semantics (MVP):
  - Represent the requested target path as an array of variant segments; expand to adjacent jobs: `current -> ancestor (implicit) -> descendants (queued)`. For now, implement as a linear queue stored on `ConstructionSiteState` or a small companion structure on the shell.
  - Active job uses the head of the queue; completion pops and advances.

### 3) Runtime resolution + factory + shells
- [`hive/index.ts`](engines/ssh/src/lib/hive/index.ts:5): `createAlveolus(alveolusType, tile, variantId?)` resolves variant definition (merged behavior) and instantiates the appropriate class by action type.
- [`board/content/alveolus.ts`](engines/ssh/src/lib/board/content/alveolus.ts:64): store `variantId?: string`; expose `resolvedDefinition` (merged behavior) if needed.
- [`construction-shell.ts`](engines/ssh/src/lib/construction-shell.ts:48): shells carry `variantId`; `finalizeConstructionShell` passes variantId to `createAlveolus`.
- [`hive/build.ts`](engines/ssh/src/lib/hive/build.ts:21): `BuildAlveolus` stores `variantId`, uses the target construction recipe for its storage/init, and registers work seconds against that recipe.

### 4) Save/load + plan integration
- [`game.ts`](engines/ssh/src/lib/game/game.ts:199): serialize/deserialize `variantId` for alveoli; ensure missing variant falls back to root (incomplete but present) with logging.
- [`hive-plan.ts`](engines/ssh/src/lib/hive-plan.ts:16): `HivePlanEntry` gains `variantId`; plan placement/validation uses the resolved construction recipe for previews.
- [`construction-state.ts`](engines/ssh/src/lib/construction-state.ts:23): ensure normalization preserves `variantId`; when reconstructing from project strings, recover variantId if encoded.

### 5) UI/renderer stubs (minimal)
- Browser client: accept optional `variantId` where project/build is issued; if not provided, default to root.
- Document TODOs for:
  - Palette/plan editor variant picker.
  - Inspector "Change Variant" action.
  - Construction overlay showing queued jobs and combined costs.
- Pixi renderer: allow optional sprite override by variant key (stub hook; no asset changes now).

### 6) Cleanup
- Add validation stubs (future): ensure authored variant trees are well-formed (no orphan nodes, required `construction.time` present).

## Compatibility & Fallbacks
- Save fallback: if a saved `variantId` is missing in rules, load as root (incomplete) and surface variant choices in UI.
- Project string encoding: if variantId is included, use delimiter `#` (`build:alveolusType#variant.path`). If absent, assume root.
- Existing saves without variantId continue to load as root variants (incomplete for variant-capable types until upgraded).

## Acceptance Criteria
- Can start a project for `pile` and choose `pile.wood` or `pile.wood.extra`; construction consumes the correct recipes and results in the correct specialized behavior.
- Can start a project for `engineer` and choose `building`/`research`/`road`; resulting alveolus exposes only the declared action set/specifications.
- Save/load round-trips `variantId` without data loss; missing variants fall back to root.
- Construction queue executes ordered jobs for multi-segment requests (e.g., `UnBuiltLand -> pile -> pile.wood -> pile.wood.extra`).
- Non-variant types remain unaffected.

## File Touch List (expected)
- `engines/rules/src/content/alveoli.ts`
- `engines/ssh/src/lib/construction-state.ts`
- `engines/ssh/src/lib/board/content/unbuilt-land.ts`
- `engines/ssh/src/lib/board/tile.ts`
- `engines/ssh/src/lib/construction-shell.ts`
- `engines/ssh/src/lib/hive/index.ts`
- `engines/ssh/src/lib/board/content/alveolus.ts`
- `engines/ssh/src/lib/hive/build.ts`
- `engines/ssh/src/lib/hive-plan.ts`
- `engines/ssh/src/lib/game/game.ts`
- UI stubs (comments/TODOs only): relevant files where build/project calls are issued

## Risks / Notes
- Construction queue is new; ensure backward compatibility when only one job exists.
- Action dispatch depends on `action.type`; retain `action.type: 'engineer'` on the root for factory dispatch even if the root has no action set/specs.
- Keep merges **shallow** for behavior; construction recipes are per-target-state, not cumulative.
