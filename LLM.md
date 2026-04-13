# Anarkai Workspace Documentation

## Overview
Anarkai is a modular monorepo driven by a custom game engine (`engines/ssh`) and UI framework (`packages/sursaut-ts`). It relies heavily on `mutts` for reactivity.

## Architecture
- **State Management**: Using `mutts` reactive proxies.
- **UI Framework**: `sursaut-ts` (React-like JSX but with fine-grained reactivity, NO VDOM diffing in the React sense).
- **Game Engine**: `ssh` encapsulates domain logic, using `npcs` for behaviors.

## Project Structure
- `apps/`: Consumers (e.g., `browser`).
- `engines/`: Core logic (e.g., `ssh`).
- **Libraries**: Shared libraries (`mutts`, `sursaut-ts`, `npcs`, `omni18n`) are located in `~/dev/ownk` and linked via the workspace.

## Development
- **Install**: `pnpm install`
- **Dev**: `pnpm dev` (starts all). Targeted: `pnpm dev:browser`.
- **Test**: `pnpm test` (using Vitest).

## Pixi / terrain
- Sector-baked **resource** sprites (`TerrainVisual` in `engines/pixi`) only rebuild when sectors are dirtied. After changing `UnBuiltLand.deposit` or `Deposit.amount` in gameplay, call `Game.notifyTerrainDepositsChanged(tile)` so `renderer.invalidateTerrain(coord)` runs (see `engines/ssh` tests `deposit-terrain-notify.test.ts`).
 
 ## Content Locations
 - **Game Definitions**: `engines/ssh/assets/game-content.ts` (stats, timing, costs)
 - **Visual Definitions**: `engines/pixi/assets/visual-content.ts` (sprites, icons)
 - **Translations**: `engines/ssh/assets/locales/*.json` (en, fr, etc.)
 - **Visual Assets**: `engines/pixi/assets/buildings/`, `engines/pixi/assets/goods/`, etc.

## `engines/ssh` freight lines (v1)
- `Game.freightLines` is a **plain array** (not a reactive `Map`) merged from save patches plus implicit gather lines derived from hive alveolus patches (`implicitGatherFreightLinesFromHivePatches` in `src/lib/freight/freight-line.ts`).
- Gather radius is now **line-owned**: the `gather` alveolus definition no longer carries a radius, and implicit one-stop gather lines use the single `DEFAULT_GATHER_FREIGHT_RADIUS` constant in `src/lib/freight/freight-line.ts`.
- Synthetic inspector line objects use stable uids derived from line ids (`freight-line:${encodeURIComponent(id)}`) and are resolved through `Game.getObject(uid)` without becoming board-registered interactive objects.
- `movement.finish` / `movement.hop` invariants allow a **fulfilled (invalid) source allocation** via `allowFulfilledSourceAllocation` — after pickup the source reservation is fulfilled while the good is in-flight.
- Follow-on compatibility note: `freight_bay` is now the named gather-stop building and reuses the old `buildings.load` icon. The `gather` alveolus content key is gone; old hive patches using `gather` are migrated to `freight_bay` during load while the runtime still uses `GatherAlveolus` semantics as a bridge.

## Hive inspector (browser)
- Synthetic hive uids are anchored to the **tile** hosting the alveolus: `hive:${encodeURIComponent(tileUid)}` (`hiveUidForAnchorTile`, `engines/ssh/src/lib/hive/hive-inspector.ts`). `Game.getObject` resolves them like freight lines; the live `Hive` instance comes from `resolveHiveFromAnchorTile` so pinned panels **retarget** after hive topology refresh as long as that tile still has an alveolus in a hive.
- Inspector UI: tile alveolus header uses `HiveAnchorButton` → `showProps(syntheticHive)`. The button now uses a **glyph icon** from `pure-glyf/icons` rather than a borrowed building sprite, so avoid reintroducing hive-specific art in `visual-content.ts` unless you truly want terrain/rendered world usage too.

