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
- SSH-owned gameplay frontier materialization and persistence rules for streamed gameplay tiles

### Gameplay Streaming

Gameplay streaming is owned by `ssh`:

- `Game.requestGameplayFrontier(center, radius, { maxBatchSize })` is the renderer-facing gameplay
  materialization API
- untouched streamed gameplay tiles are retained in `streamedFrontier`
- mutated streamed tiles are saved through ordinary patches instead of staying in `streamedFrontier`
- terrain-only render samples remain owned by `TerrainProvider`
- off-screen gameplay unloading is intentionally deferred

### Freight Lines and Named Zones

`ssh` now includes a transport bridge based on freight lines and freight stops:

- first-class line data in save patches with ordered stops
- freight lines are moving toward an **exchange route** model: each halt can be configured for load,
  unload, or both, with gather/distribute kept as legacy directional helpers
- planned cyclic lines evaluate rotated halt orders so a vehicle can begin at any halt
- radius zones and saved named tile zones as freight stop authority
- named custom zones alongside built-in residential/harvest markers, with legacy save compatibility
- selectable custom-zone objects (`zones`, `zone:<zoneId>`) with a dedicated Zones palette entry and zone inspectors; residential/harvest remain built-in tile markers rather than named-zone objects
- `freight_bay` stop content backed by a non-storage dock plus `VehicleFreightDock`
- synthetic inspector objects for line selection and editing
- compact browser stop-table editing with add/remove, drag reorder, bay/radius/named-zone stops, and per-stop policies
- board previews for selected lines and hovered stops
- docked vehicle work is surfaced through cheap provider-side advertised jobs for inspectors, while
  character-scoped planner search stays in job claiming/ranking paths

Details and constraints are documented in [`./freight-lines.md`](./freight-lines.md).

### Verification

`engines/ssh` unit-only verification is fast enough for routine perf/checkpoint use:

```bash
pnpm --filter ssh exec vitest run tests/unit
```

On 2026-05-06 this ran **80 files / 454 tests** in **44.75s** (`real 45.174s`) on the local
workspace.

### Browser Client

`apps/browser` is the active client. It uses Sursaut UI with Dockview-based panels and Pixi-backed world rendering.
Zones are managed as selectable inspector objects rather than inside freight-line properties; tile/alveolus inspectors link back to the owning zone when a tile is painted.

### Rendering

`engine-pixi` owns the continuous terrain surface and object visuals while reacting to simulation state from `ssh`.

## Review Notes

The main drift in the repository is documentation, not implementation. Several top-level docs still described:

- packages that are not in this repository
- an older UI stack
- TODOs that were written before terrain generation and hive behavior were actually completed

Sandbox notes also contained resolved debugging sessions that are now better represented by code and tests.

## Baseline Status

For the broader menu of possible next tranches, see [`./next-directions.md`](./next-directions.md).

The architectural baseline is now landed: terrain is deterministic, gameplay materialization and
retention policy live in `ssh`, and Pixi only asks for visibility-driven frontier expansion.

## Suggested Near-Term Work

1. Use [`./next-directions.md`](./next-directions.md) to choose whether the next gameplay-facing tranche should be roads, shops/markets, content chains, NPC settlements, or terrain generation.
2. Continue freight diagnostics only if route failures become hard to understand during playtesting.
3. Design off-screen gameplay unloading later, after at least one larger-world feature needs it.
