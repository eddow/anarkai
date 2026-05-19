# Current Status

## What Is Landed

### Terrain

`engine-terrain` now provides deterministic field generation, hydrated region generation, biome classification, and snapshot merge/prune helpers for streamed worlds.

### Hive Gameplay

`ssh` contains the core colony simulation:

- alveolus building logic
- hive attachment/merging
- harvesting, gathering, transit, transform, and build flows
- the first zone-assigned caring alveolus, `forester`, which plants sparse visible tree deposits in assigned named forest zones
- planted tree metadata on `UnBuiltLand`; planted tree deposit amount is the visible tree count, trees age into maturity, and mature planted trees yield multiple wood when cut
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
- named zones can carry a persisted `harvestable` flag; harvest alveoli treat harvestable named zones like the built-in harvest zone without being assigned to them
- selectable custom-zone objects (`zones`, `zone:<zoneId>`) with a dedicated Zones palette entry and zone inspectors; residential/harvest remain built-in tile markers rather than named-zone objects
- forester alveolus inspectors expose assigned named-zone controls, with zone chips linking back to the zone inspector
- `freight_bay` stop content backed by a non-storage dock plus `VehicleFreightDock`
- synthetic inspector objects for line selection and editing
- compact browser stop-table editing with add/remove, drag reorder, bay/radius/named-zone stops, and per-stop policies
- board previews for selected lines and hovered stops
- docked vehicle work is surfaced through cheap provider-side advertised jobs for inspectors, while
  character-scoped planner search stays in job claiming/ranking paths

Details and constraints are documented in [`./freight-lines.md`](./freight-lines.md).

### Roads

Roads v1/v1.5 is landed as border-owned `path` infrastructure:

- the `road:path` palette tool previews a straight tile trace and commits instantly on release
- road state is stored per border on `HexBoard` and saved as grouped coordinates, for example
  `roads: { path: [[q, r]] }`
- walking/pathfinding receives a cost reduction only when crossing a roaded border
- Pixi bakes textured road overlays into terrain sectors using the `brick_moss` road material
- road authoring rejects traces through hive/alveolus tiles except `freight_bay`, residential/dwelling tiles,
  and construction projects
- Chopsaw includes a sample road from `-3,1` to `1,1`

Deferred road work: builder/project workflows, multiple road kinds, lanes/markings, route-benefit UI, and
physical multi-hex corridors.

Details and future lane/corridor vocabulary are documented in [`./roads.md`](./roads.md).

### Districts and Commerce

Districts are now the player planning layer above hives:

- every game has a default player district (`district:default`)
- district-scoped build, zone, and road actions record member coordinates
- NPC settlements remain separate selectable trade actors with deterministic read-only market offers
- concrete is a foundation-only construction good in this slice
- the shared player account exists and is shown in the toolbar

District procurement V0.9 is landed as read-only purchase intent:

- districts own auto-buy and budget-reserve policy
- planned/blocked purchase requests are derived from missing construction/foundation goods and storage buffer
  demand
- source settlement choice is automatic for now: cheapest seller, then nearest, then stable id tie-break
- account balance is not debited and no goods move yet
- buffer quantities are configured on storage alveoli, not on district policy; for example, ChopSaw reserves
  one concrete storage slot, which means three concrete units because that storage slot capacity is three

Deferred commerce work: choose one source settlement per district (V1), optional per-good source overrides
(V2), vehicle pickup/payment, convey-hop shop loading, delivery to site/storage, resale points, and NPC
buyers.

### Verification

As of 2026-05-12, the current green road-adjacent verification set is:

```bash
pnpm -r check
pnpm --filter ssh test -- tests/unit/roads.test.ts tests/unit/chopsaw-example.test.ts
pnpm --filter engine-pixi test
pnpm --filter ssh-browser test
git diff --check
```

The full `ssh` unit suite is not currently green. `pnpm --filter ssh test -- tests/unit` reports **9 failing
tests / 546 passing tests** across hydrology fixtures, construction fixture setup, freight summary wording,
one proposed-job path expectation, and one vehicle service invariant. Those failures are outside the roads
slice but should be treated as a standing cleanup item before using full-suite green as a release signal.

For the district procurement slice, the focused green checks are:

```bash
pnpm --filter ssh test -- tests/unit/district-construction.test.ts
pnpm --filter ssh check
pnpm --filter ssh-browser check
pnpm --filter ssh-browser test -- src/widgets/district.spec.tsx
pnpm --filter engine-rules test
```

For the forester, planted-tree, and harvestable named-zone slice, recent focused green checks are:

```bash
pnpm --filter ssh exec vitest run tests/unit/harvest-zones.test.ts tests/unit/forester.test.ts
pnpm --filter ssh-browser exec vitest run src/components/properties/AlveolusProperties.spec.tsx
pnpm --filter ssh-browser exec vitest run src/components/properties/CharacterProperties.spec.tsx
pnpm --filter engine-pixi exec vitest run --config vitest.config.ts src/renderers/static-resource-sprites.test.ts
pnpm --filter ssh exec tsc --noEmit --pretty false
pnpm --filter ssh-browser exec tsc --noEmit --pretty false
pnpm --filter engine-pixi exec tsc --noEmit --pretty false
git diff --check
```

### Browser Client

`apps/browser` is the active client. It uses Sursaut UI with Dockview-based panels and Pixi-backed world rendering.
Zones are managed as selectable inspector objects rather than inside freight-line properties; tile/alveolus
inspectors link back to the owning zone when a tile is painted, and zone inspectors show tile-count and
area stats using the documented `3m` hex side scale.
Forester inspectors can assign named zones through the existing dropdown/chip pattern; assigned-zone chips
open the corresponding zone inspector. Job/planner rows translate forester work as "Plant trees" rather
than exposing the raw job id.

### Rendering

`engine-pixi` owns the continuous terrain surface and object visuals while reacting to simulation state from `ssh`.
Planted tree deposits render one sprite per visible tree slot, with sprite choice derived from planted-tree
age; generated legacy deposits keep the existing aggregate deposit rendering. The forester building uses a
transparent `64x64` PNG icon.

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

1. Playtest district procurement V0.9 and decide whether the next commerce move is V1 source-settlement
   selection or vehicle pickup/payment execution.
2. Playtest the forester/North Grove slice: assigned planting zones, harvestable named zones, sparse tree
   generation, and rock/tree harvesting inside named zones.
3. Restore the full `ssh` unit suite to green, or mark/remove stale expectations if they are intentionally
   obsolete.
4. Continue freight diagnostics only if route failures become hard to understand during playtesting.
5. Design off-screen gameplay unloading later, after at least one larger-world feature needs it.
