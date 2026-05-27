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
- compact browser stop-table editing with drag reorder, delete, readonly stop locations, per-stop policies, and stop-level settlement reserve controls where imports are possible
- `+ Add stop` is a board-pick tool: click a freight bay, city hall, or custom named-zone tile, or drag from an ordinary tile to create a radius stop
- settlement city halls are first-class NPC trade halt targets while remaining tile-native board selections
- board previews for freight lines, zones, hives, and stops are hover-driven; opening an inspector does not draw a persistent board highlight by itself
- freight stop commerce diagnostics explain allowed policies, local need/provide state, downstream demand, import/export opportunities, and no-trade reasons
- line inspectors can assign and unassign compatible freight vehicles
- docked vehicle work is surfaced through cheap provider-side advertised jobs for inspectors, while
  character-scoped planner search stays in job claiming/ranking paths

Details and constraints are documented in [`./freight-lines.md`](./freight-lines.md).

### Roads

Roads v1/v1.5 is landed as border-owned road infrastructure:

- the `road:path` and `road:asphalt` palette tools preview a straight tile trace and commit instantly on release
- road state is stored per border on `HexBoard` and saved as grouped coordinates, for example
  `roads: { path: [[q, r]], asphalt: [[q, r]] }`
- walking/pathfinding receives a type-specific cost reduction only when crossing a roaded border
- Pixi bakes textured road overlays into terrain sectors using the road material for each road type
- generated settlement roads are emitted as `asphalt`
- road authoring rejects traces through hive/alveolus tiles except `freight_bay`, residential/dwelling tiles,
  and construction projects
- Chopsaw includes a sample road from `-3,1` to `1,1`

Deferred road work: builder/project workflows, multiple road kinds, lanes/markings, route-benefit UI, and
physical multi-hex corridors.

Details and future lane/corridor vocabulary are documented in [`./roads.md`](./roads.md).

### Settlements and Commerce

Districts have been removed as a gameplay, UI, API, and save concept:

- build, zone, and road tools are direct toolbar actions
- save files no longer write district member or procurement fields
- material procurement is not routed through area buckets
- concrete is a foundation-only construction good in this slice
- the shared player account exists and is shown in the toolbar

Commerce V1 is now line-based and physical:

- each generated settlement has a deterministic city-hall tile, forced to the generated `civic` zone, which acts as the V1 settlement trade target
- settlement material markets include all current `basic-materials`: `wood`, `stone`, `planks`, and `concrete`
- settlement market UI shows one price per good; the same price is used for buying from and selling to that settlement
- NPC settlement freight stops can export allowed carried goods, then import allowed goods when later stops have real demand and the stop reserve permits the purchase
- storage room alone does not create settlement purchase demand; a bay can still unload already-carried
  surplus cargo into accepted storage, while cargo needed by a later stop is protected as line buffer cargo
- stop `loadSelection` and `unloadSelection` remain the goods controls; trade policy does not name materials
- money changes only at the settlement stop when goods cross the player/NPC boundary
- storage buffer settings are the preferred import contract; construction/foundation demand and hive use demand are also measured by line diagnostics
- optional NPC trade transfer presentation data records exported goods, imported goods, credited VP, and spent VP when a trade happens
- ChopSaw includes a regression fixture line, `ChopSaw materials loop`, cycling between the `0,0` bay and the Melindbury city hall with an assigned SUV; it can sell basic materials such as planks and import concrete only when downstream demand exists

Deferred commerce work: route-level explanations for retained/surplus cargo and idle cyclic routes, richer
line history/last-transfer display, generated shop targets beyond city halls, market analysis based on price
and settlement position, consumption goods, residential/shop delivery, and long-route hunger/snack behavior.

### Verification

As of 2026-05-20, recent focused verification includes:

```bash
pnpm --filter ssh test -- tests/unit/roads.test.ts tests/unit/chopsaw-example.test.ts
pnpm --filter engine-pixi test
pnpm --filter ssh-browser test
git diff --check
```

For the line-based commerce finish, the focused green checks are:

```bash
pnpm --filter ssh check
pnpm --filter ssh-browser check
pnpm --filter ssh exec vitest run tests/unit/freight-stop-utility.test.ts tests/unit/npc-trade-stop.test.ts tests/unit/chopsaw-example.test.ts --reporter verbose
pnpm --filter ssh-browser exec vitest run src/components/FreightStopList.spec.tsx src/components/properties/SettlementProperties.spec.tsx --reporter verbose
pnpm --filter ssh-browser exec vitest run src/components/properties/FreightLineProperties.spec.tsx src/lib/i18n.spec.ts --reporter verbose
git diff --check
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
Line inspectors show the route on the board only while the inspector itself is hovered; unpinned line
widgets close when selection moves elsewhere, matching the rest of the lightweight inspector behavior.

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

1. Playtest the ChopSaw materials loop: bay buffer demand, Melindbury prices, planks/wood/stone export,
   concrete import, already-carried surplus unloading, retained later-stop cargo, and whether the stop
   diagnostics explain idle/done cases clearly enough.
2. Revisit market analysis: settlement positions, price comparison, and how generated shops should extend
   the city-hall trade target model.
3. Playtest the forester/North Grove slice: assigned planting zones, harvestable named zones, sparse tree
   generation, and rock/tree harvesting inside named zones.
4. Restore the full `ssh` unit suite to green, or mark/remove stale expectations if they are intentionally
   obsolete.
5. Design off-screen gameplay unloading later, after at least one larger-world feature needs it.
