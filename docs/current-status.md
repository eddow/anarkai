# Current Status

## What Is Landed

### Terrain

`engine-terrain` now provides deterministic field generation, hydrated region generation, biome classification, and snapshot merge/prune helpers for streamed worlds.

### Hive Gameplay

`ssh` contains the core colony simulation:

- alveolus building logic
- hive attachment/merging
- harvesting, gathering, transit, transform, and build flows
- storage reservations and allocations
- save/load coverage and many regression tests around stalled conveyance and job selection

### Browser Client

`apps/browser` is the active client. It uses Sursaut UI with Dockview-based panels and Pixi-backed world rendering.

### Rendering

`engine-pixi` owns the continuous terrain surface and object visuals while reacting to simulation state from `ssh`.

## Review Notes

The main drift in the repository is documentation, not implementation. Several top-level docs still described:

- packages that are not in this repository
- an older UI stack
- TODOs that were written before terrain generation and hive behavior were actually completed

Sandbox notes also contained resolved debugging sessions that are now better represented by code and tests.

## Next Direction

The strongest next tranche is **gameplay streaming completion**.

Terrain already streams well, but gameplay still sits in a transitional state where the renderer helps drive world materialization. The next step should make `ssh` the clear owner of gameplay frontier policy:

1. Formalize requested, active, and retained gameplay frontier regions.
2. Coalesce and deduplicate generation requests behind a stable `Game` API.
3. Define persistence rules for off-screen gameplay state versus deterministic terrain.
4. Keep Pixi responsible for visibility and visuals, but not gameplay lifecycle policy.

## Suggested Near-Term Work

1. Finish the gameplay frontier contract around [`engines/ssh/src/lib/game/gameplay-frontier.ts`](/home/fmdm/dev/anarkai/engines/ssh/src/lib/game/gameplay-frontier.ts).
2. Define save/load retention rules for streamed but mutated tiles.
3. Review hive split/removal semantics, especially movement cleanup when an alveolus disappears.
4. Add one concise roadmap doc instead of accumulating more sandbox handoff notes.
