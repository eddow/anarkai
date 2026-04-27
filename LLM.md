# Anarkai Workspace Documentation

## Overview
Anarkai is a modular monorepo driven by a custom game engine (`engines/ssh`) and UI framework (`packages/sursaut-ts`). It relies heavily on `mutts` for reactivity.

## Architecture
- **State Management**: Using `mutts` reactive proxies.
- **UI Framework**: `sursaut-ts` (React-like JSX but with fine-grained reactivity, NO VDOM diffing in the React sense).
- **Game Engine**: `ssh` encapsulates domain logic, using `npcs` for behaviors.
- **Sursaut rebuild fence**: avoid hoisting reactive reads from JSX into top-level locals inside a component body. For state such as `state.goodRules` / `state.tagRules`, that can make the component root depend on reactive values and trigger rebuild-fence warnings instead of normal child updates.

## Project Structure
- `apps/`: Consumers (e.g., `browser`).
- `engines/`: Core logic (e.g., `ssh`).
- **Libraries**: Shared libraries (`mutts`, `sursaut-ts`, `npcs`, `omni18n`) are located in `~/dev/ownk` and linked via the workspace.

## Development
- **Install**: `pnpm install`
- **Dev**: `pnpm dev` (starts all). Targeted: `pnpm dev:browser`.
- **Test**: `pnpm test` (using Vitest).

## Pixi / terrain
- `PixiGameRenderer` initialization is wrapped in `mutts.root`: renderer-created visual effects are owned by `PixiGameRenderer.destroy()`, not by the Sursaut/Dockview widget render effect that happens to construct the renderer. Do not replace this with `untracked`; that preserves parent cleanup ownership and can leave Pixi containers visible with dead movement effects after Dockview panel refreshes.
- Sector-baked **resource** sprites (`TerrainVisual` in `engines/pixi`) only rebuild when sectors are dirtied. After changing `UnBuiltLand.deposit` or `Deposit.amount` in gameplay, call `Game.notifyTerrainDepositsChanged(tile)` so `renderer.invalidateTerrain(coord)` runs (see `engines/ssh` tests `deposit-terrain-notify.test.ts`).
- **Rivers**: sector bake draws procedural **quarter / half-dragea** geometry from `buildRiverTileNode` in `engines/pixi/src/river-quarter-model.ts` (not the old full-hex river sprites). `river-topology.ts` remains for texture-key / rotation helpers and tests; overlay composition lives in `terrain-sector-baker.ts` (`buildRiverOverlay`). Half-drageas share a **tile hub** at the hex geometric center so inner ends meet; edge **tangent** sign uses the paired edge midpoint so bends open toward the wedge (avoids flipped bank curves). **Through** tiles use **hub-blended inner width** `(W1+W2)/2` (scaled with tile monotone width) so width eases across the hex; **coastal mouth** land/water arms use the same idea plus a **narrower water inner** toward the sea. **Sampled fill** `halfDrageaSampledFillPolygonWorld` includes **both** bank curves through **t=1** on the right quarter so the polygon does not “cut” at the hub. **Mouth lip** water fills use **lower alpha** (~0.28) to read as fading into the water tile; **fanned** delta arms use mid alpha (~0.44). **Source** closed caps use a slightly wider inner (~0.12× outer) so springs are visible. A lone **`inlandTerminal`** gets a rotated-ellipse basin (`singleInlandTerminalBasinPolygonLocal`); multi-tile fused terminals use an inflated convex hull (`INLAND_HULL_INFLATE_FACTOR`).
 
 ## Content Locations
 - **Game rules (authoritative)**: `engines/rules` (`engine-rules` workspace package: terrain/deposits/alveoli/goods, job balance, character/planner tuning, terrain defaults)
 - **SSH typed re-exports**: `engines/ssh/assets/game-content.ts` (wraps `engine-rules` with `Ssh.*` contract `satisfies`)
 - **Visual Definitions**: `engines/pixi/assets/visual-content.ts` (sprites, icons)
 - **Translations**: `engines/ssh/assets/locales/*.json` (en, fr, etc.)
 - **Visual Assets**: `engines/pixi/assets/buildings/`, `engines/pixi/assets/goods/`, etc.

## Construction workflow (engines/ssh)

- **First-class runtime state**: `UnBuiltLand.constructionSite` and `BuildAlveolus.constructionSite` now share the same `ConstructionSiteState` object (`ssh/construction-state`) instead of the UI inferring phases from loose `project` / build-shell facts.
- **Runtime sync vs query**: `queryConstructionSiteView(game, tile)` is now a pure snapshot read in `ssh/construction`; authoritative phase and delivered-goods synchronization live on the runtime objects themselves (`UnBuiltLand` and `BuildAlveolus`).
- **Persistence**: in-progress build shells save via hive patch `underConstruction` + `constructionPhase` + `constructionWorkSecondsApplied`; `constructionStep` uses one `DurationStep` for remaining time and credits partial seconds on **cancel** (interrupted work resumes later).
- **Browser presentation**: construction phase/blocking/progress formatting is shared through `apps/browser/src/lib/construction-view.ts` so `UnBuiltProperties`, `AlveolusProperties`, and `HiveProperties` stay aligned.

## `engines/ssh` freight lines (v1)
- **Route model**: `FreightLineDefinition` is an ordered `stops[]` of **`FreightStop`**: each step has `op: 'load'|'unload'`, optional `goodsSelection`, and **either** `anchor` (bay) **or** `zone` (radius) — not both. Legacy V1 `mode`+`stops` and nested `{ anchor, instructions[] }` rows normalize to flat stops (`normalizeFreightLineDefinition` in `src/lib/freight/freight-line.ts`). Full description: `docs/freight-lines.md`.
- Restrictive **goods** policy applies on the segment’s **`load`** stop (gather: zone load; distribute: bay load). Legacy `filters` migrates into `goodsSelection` on load.
- `Game.freightLines` is a **plain array** merged from save patches plus implicit gather lines from hive patches (`implicitGatherFreightLinesFromHivePatches`).
- **One bay, many lines**: several lines may reference the same `freight_bay`. Prefer `findGatherFreightLines` / `findDistributeFreightLines`. **Runtime loops** should use `gatherSegmentAllowsGoodTypeForSegment` / `distributeSegmentAllowsGoodTypeForSegment` with the active segment; `freightLineAllowsGoodType` is UI/summary-only. `road-fret`: gather ads + distribute gating unchanged in spirit (`storage.ts`).
- **Explicit line lifecycle**: `Game.removeFreightLineById` (not implicit ids). `createExplicitFreightLineDraftForFreightBay` + bay inspector add/remove.
- **Gather radius** lives on the **zone** step of a gather segment (`DEFAULT_GATHER_FREIGHT_RADIUS` for implicit lines); distribute delivery cap is an optional **zone on the unload** step of a distribute segment.
- Synthetic inspector line objects use stable uids derived from line ids (`freight-line:${encodeURIComponent(id)}`) and are resolved through `Game.getObject(uid)` without becoming board-registered interactive objects.
- `movement.finish` / `movement.hop` invariants allow a **fulfilled (invalid) source allocation** via `allowFulfilledSourceAllocation` — after pickup the source reservation is fulfilled while the good is in-flight.
- Multi-hop convey paths are **trimmed routes** `tile -> border -> ... -> border -> demander tile` (no `border -> tile -> border` bridge hops). Relay **transit** across a tile is modeled as **border-to-border** steps; traversability does not depend on relay storage room or whether the relay alveolus stores the passing good. A full gate or a typed storage mismatch on a relay tile must not block **routing** (only the destination gate/tile needs room for the next allocation).
- Cyclic gate deadlock (multi-movement convey): when `aGoodMovement` returns a cycle (>= 2 movements), the **first** movement skips the preflight gate allocation (no `hopAlloc`). This frees one gate slot so subsequent cycle members can allocate normally. On `finished()`, the deferred allocation is retried (the cycle frees room by then).
- Follow-on compatibility note: `freight_bay` is now the named gather-stop building and reuses the old `buildings.load` icon. The `gather` alveolus content key is gone; old hive patches using `gather` are migrated to `freight_bay` during load while the runtime still uses `GatherAlveolus` semantics as a bridge.

## Hive inspector (browser)
- Synthetic hive uids are anchored to the **tile** hosting the alveolus: `hive:${encodeURIComponent(tileUid)}` (`hiveUidForAnchorTile`, `engines/ssh/src/lib/hive/hive-inspector.ts`). `Game.getObject` resolves them like freight lines; the live `Hive` instance comes from `resolveHiveFromAnchorTile` so pinned panels **retarget** after hive topology refresh as long as that tile still has an alveolus in a hive.
- Inspector UI: tile alveolus header uses `HiveAnchorButton` → `showProps(syntheticHive)`. The button now uses a **glyph icon** from `pure-glyf/icons` rather than a borrowed building sprite, so avoid reintroducing hive-specific art in `visual-content.ts` unless you truly want terrain/rendered world usage too.
- Hive metadata is now two-layered: alveolus `working` remains the local flag/config, while effective runtime activity is `alveolus.configuration.working && hive.working`. Hive `name`/`working` are preserved through save-load and topology rebuilds; rebuilt names must go through `generateRebuiltHiveName(...)` instead of open-coding suffixes.

