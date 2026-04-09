# Project Inventory

## Applications

### `apps/browser`

The active browser client. It combines Sursaut UI, Dockview-based panels, and the Pixi renderer over the shared `ssh` simulation.

## Engines

### `engines/ssh`

The gameplay engine. It owns the board model, alveoli, hives, NPC logic, storage semantics, save/load, and streamed gameplay materialization.

### `engines/pixi`

The renderer package. It turns `ssh` state into visuals and renders continuous terrain sectors generated from `engine-terrain`.

### `engines/terrain`

The terrain engine. It produces deterministic tile fields, hydrology, biome hints, and snapshot operations for streamed generation.

## External Linked Dependencies

Some core libraries are consumed through local links rather than living in this repo:

- `mutts`
- `npc-script`
- `omni18n`
- `@sursaut/*`
- `pure-glyf`

These are part of the effective runtime architecture, but they are not workspace packages inside this repository.

## Notes

- There is no `browser-vue` app in this repo.
- There is no `packages/` workspace directory in this repo.
- Old sandbox notes were useful during debugging, but they should not be treated as the source of truth for current architecture.
