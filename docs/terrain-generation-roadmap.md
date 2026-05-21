# Terrain generation correction roadmap

## Goal

Before generating NPC entities, terrain generation should answer a practical question:

```text
Where can roads, settlements, production hives, trade points, resources, and traffic plausibly exist?
```

The next terrain pass should therefore focus less on visual variety and more on **world affordances**:
stable, queryable facts that NPC generation can use.

NPC groups will not be isolated decorative dots. They should generate traffic between each other:

- people moving between inhabited areas, markets, work sites, and public services;
- goods moving between production hives, settlement trade points, depots, and border gateways;
- vehicles using road corridors between NPC groups;
- later, player logistics sharing, crossing, improving, or competing with those routes.

That means roads must be generated or at least planned before NPC entities are fully materialized.

## Current pressure

The current terrain system is deterministic and streamable, which is the right foundation. But NPC
generation needs stronger geography than raw biome labels.

Missing or weak concepts:

- stable road corridor suitability;
- settlement suitability;
- production-site suitability;
- water access as a placement fact;
- resource/deposit regions tied to terrain;
- generated road skeletons between outside groups;
- a way to persist generated NPC/road decisions so later terrain tuning does not move existing worlds.

Hydrology is especially important. Rivers are currently architecturally present but disabled in hydrated
generation. NPC settlements can still start without perfect rivers, but they need at least coarse water
and coast affordances.

## Phase 1: Terrain affordance fields

Add derived affordance scoring over generated terrain tiles. These fields can be computed from raw height,
biome, humidity, terrain type, local neighborhood roughness, and water/coast proximity.

Candidate shape:

```ts
interface TerrainAffordance {
  buildability: number
  roadability: number
  settlementSuitability: number
  productionSuitability: number
  waterAccess: number
  slopePenalty: number
  resourcePotential: Partial<Record<ResourceKind, number>>
}
```

Important rules:

- Keep raw terrain fields deterministic per tile.
- Derived affordances may use a local neighborhood, but must be stable for the same seed and region.
- Affordances should be debug-renderable.
- Start with floats or coarse scores, not hard placement decisions.

Useful first heuristics:

- avoid ocean, lake, snow, very rocky, and very steep tiles for settlements;
- prefer grass/forest edge/wetland-adjacent land for settlements;
- prefer flat or gently rolling land for roads;
- allow some production hives on rougher terrain if their industry wants it;
- give ports high suitability near coast or navigable water;
- give farms high suitability on flat grass/wetland-adjacent land;
- give mines/quarries high suitability near rocky/mountain areas.

## Phase 2: Water and coast correction

NPC settlements need water logic even before detailed river simulation is perfect.

Minimum useful output:

- ocean/coast classification;
- lake/wetland classification;
- river or stream corridor hints;
- water-access score for nearby tiles;
- bridge/ferry pressure where roads cross water corridors.

Implementation options:

- Reactivate the existing hydrology pass with conservative settings.
- Or add a cheaper temporary `waterAccess`/`coastDistance` pass from existing biome and height fields.
- Or generate coarse regional water corridors first, then let detailed hydrology improve visuals later.

The important part is not beautiful rivers yet. It is giving village, port, road, and farm placement a
reason to prefer some places over others.

## Phase 3: Road corridor generation

Before NPC entities are fully generated, produce a road skeleton that can connect them.

This should not be the same as player-authored roads. It is a worldgen layer:

- long-distance corridors between major inhabited areas;
- short access roads from production hives to the nearest corridor or settlement;
- settlement streets that may cross and branch inside `NpcInhabitationArea` footprints;
- service roads inside or around `NpcProductionHive` footprints;
- optional border gateways for abstract outside-world connections.

Road generation should use terrain costs:

```text
roadCost = base
  + slopePenalty
  + biomePenalty
  + waterCrossingPenalty
  - corridorPreference
```

Rules:

- Public roads may cross and structure NPC inhabitation areas.
- Public through-roads should not normally cut through NPC production hives.
- Production hives can contain internal service roads or yards.
- Trade points should sit on or near road-accessible edges.
- The generated road graph must be persisted once accepted into the world.

This road skeleton gives NPC traffic somewhere believable to move.

## Phase 4: NPC placement candidates

Generate placement candidates from terrain and road affordances.

For `NpcInhabitationArea`:

- prefer road corridors, crossroads, river crossings, coasts, valleys, and flat land;
- allow roads to pass through and define the settlement shape;
- reserve room for trade points and public/commercial areas;
- keep internal residential/commercial detail abstract at first.

For `NpcProductionHive`:

- prefer resource or terrain suitability;
- place near roads, water, deposits, or settlement labor/market areas depending on industry;
- keep a bounded footprint;
- connect to public roads through trade points or service access;
- avoid treating the footprint as a pass-through settlement grid.

For `NpcTradePoint`:

- place on the contact surface between the NPC group and the road/logistics network;
- choose labels from parent group type: bay, depot, market, dock, town gate, station;
- support both player trade and background NPC traffic.

## Phase 5: NPC-to-NPC traffic layer

Once roads and NPC candidates exist, generate traffic demands between NPC groups.

Traffic does not need full simulation at first. It can begin as abstract flows:

- goods flow from producer to demander;
- people flow from settlements to work/service/commercial destinations;
- vehicles appear on roads according to route demand;
- traffic intensity affects visuals first, then later congestion, road wear, trade availability, or safety.

Candidate flow fields:

```ts
interface NpcTrafficDemand {
  fromGroupId: string
  toGroupId: string
  kind: 'goods' | 'people' | 'service'
  goodType?: string
  intensity: number
  preferredRouteId?: string
}
```

Start simple:

- connect each production hive to the nearest compatible settlement or trade corridor;
- connect settlements to nearby larger settlements;
- connect demanded goods to nearest producers by road cost, not Euclidean distance;
- generate visual/background vehicles only on known road routes.

This makes the world feel alive while keeping NPC economies abstract.

## Phase 6: Persistence and streaming boundaries

Terrain can remain deterministic, but generated NPC entities and roads should become persisted world facts.

Persist:

- generated NPC group ids, archetypes, footprints, metadata, and trade points;
- generated road graph edges and road kinds;
- generated traffic demand pairs or reproducible route seeds;
- resource/deposit patches that have gameplay state;
- player modifications and destroyed/changed generated state.

Avoid:

- recomputing NPC locations every time a chunk streams in;
- letting later terrain tuning move existing settlements;
- coupling traffic simulation to visible chunks only.

Streaming rule of thumb:

- terrain fields are regenerated from seed;
- world decisions derived from terrain are generated once and saved;
- active simulation can be loaded/unloaded later, but authored/generated identity persists.

## Phase 7: Debug and tuning tools

Terrain and NPC generation will be hard to tune blind.

Add debug views for:

- buildability;
- roadability;
- settlement suitability;
- production suitability by archetype;
- water access;
- resource potential;
- generated road corridors;
- candidate NPC placements;
- chosen NPC placements;
- NPC traffic demand intensity.

Also useful:

- seed comparison snapshots;
- "why here?" explanations for selected generated entities;
- regenerate-preview commands before persistence;
- small deterministic fixture seeds for tests.

## Suggested first playable slice

The smallest slice that proves the direction:

1. Add terrain affordance scoring for buildability, roadability, settlement suitability, and production
   suitability.
2. Generate two `NpcInhabitationArea` candidates and one `NpcProductionHive` candidate on a test seed.
3. Generate a road corridor connecting them.
4. Place one `NpcTradePoint` per group on the road-accessible side.
5. Create one abstract goods-flow demand and one people-flow demand between them.
6. Render/debug the chosen sites, roads, and flow intensity.

At that point, the map has a reason to contain roads before the player touches it.
