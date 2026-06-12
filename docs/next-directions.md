# Next Directions

This is the central place for deciding what Anarkai should manage next.

Hive management and vehicle/freight management are now far enough along that the next step is less about
finishing a single obvious subsystem and more about choosing the next gameplay frontier. The options below
are deliberately broad; each one can become its own implementation plan once chosen.

## Current Baseline

See [`./current-status.md`](./current-status.md) for what is already landed.

## Details to add

- alveoli configurations (ex storage buffer/allowance) should be able to be memorized, given a name and re-used with a combo-box containing all applicable configurations, "specific" = for this alveoli only or the ability to create a new configuration (no add button, just entering a text in the combo and checking for conflict)
- We'll need to add config for: locale, measure units (1 tile-border = 3m = 10feet), decimal/duo-decimal
- we should have bay-less roads (from zone to zone)
- complete the exchange-route refactor: rename gather/distribute helpers and update route summaries / UI
  vocabulary to reflect per-stop load/unload selection rather than legacy segment concepts.
- roads & velocity calculation. Some vehicles can just not drive beside roads. There should be a multiplier somewhere as well as a `min(road-max-velocity, vehicle/character-ax-velocity)`. How to calculate exactly the velocity for it to be realistic somehow but still simple ?
- market analysis for settlement trade: compare settlement prices and positions, surface why Melindbury is
  or is not a good source/sink, and keep the view focused on route decisions rather than finance UI.
- generate material shops, cafes, and other commerces as separate trade targets beyond city halls,
  using the same board-pick model.
- generated settlement zoning should move from simple center/ring assignment to a rules-owned civic /
  residential / commercial / industrial mix. Civic must stay small and central, commercial can be mixed around
  the core and road frontage, and larger residential/commercial areas should emerge farther out. Every occupied
  generated settlement tile should neighbor an internal road/path; generate the street skeleton before assigning
  parcels so roads structure zones instead of deleting them after the fact.
- long freight errands and hunger. A driver stopped in an NPC city should probably keep using the vehicle
  after loading/unloading; decide whether route planning should reserve carried snacks, schedule a meal
  before departure, or allow temporary off-route eating near a stop. Note: this could wait for commercial zones so characters could "buy a snack"
- When providing to an external building (residence/construction/commerce), the vehicle should indeed stop on the border and unloading the vehicle in the building should indeed be a convey-hop-like action (character in the center of the tile, visible moving good)
- extend the forester tile-room rule into a general physical-load rule for future crops, generated loose
  goods, and harvesting output.
- specific commerces will have to be generated in settlements, trade should depend on the present commerces and the vehicle using the road should go to the commerce - again (un)loading to/from a vehicle: vehicle goes on the shop border's and a convey-hop-like occur, transaction is when the character in the center of the shop spawn(buy)/unspawn(sell) good
- SUVs and wheelbarrows are off-road vehicles. Pickup trucks are road-only, so their lines should have a road available.
- harvesting/generation output should eventually obey the same tile physical-load model as forester
  planting, so rock/tree/crop outputs avoid overfilling already-burdened tiles.
- add player-facing bay queue authoring: select several freight bays in the same hive, group them as
  one shared dock operating area, name that group, and see the shared approach/queue overlay. The UI
  should expose service bays, detected approach branches, and optional waiting areas/parking/sidings;
  the internal queue graph should be derived from those choices rather than authored as nodes and edges
  directly. Wire vehicle job completion and service/exit lifecycle hooks to the registry.
- unify external-work radius across all external-work alveoli (construction, foundation laying, road work,
  harvesting). Decide how vehicle objects extend or constrain reach as configuration/equipment attached to
  the hive or alveolus, rather than as a variant-only field.
- When changing the variant, the alveolus storage should be emptied before re-construction

## Recommended Next Tranche

The strongest immediate tranche is commerce and freight diagnostics polish: line-level idle/done
explanation text, line-level cargo intent rollup, market price comparison, widget reorg (collapsible
sections, header one-liner, line-click-from-bay fix), and the standalone `CommercialOverview` widget
are now landed. The remaining piece is exchange-route vocabulary cleanup. After that, roads/path
infrastructure is the natural larger-map move, shops/markets deepen demand, and a small content
chain can add immediate play texture.

## Candidate Directions

### 1. Roads and path infrastructure

Roads remain a natural bridge between hive logistics and larger world management.

Potential next scope:

- City halls are "on" the road. Though, they are buildings. Beside, settlements should have all their residential/market/civil tiles connected to the road (in a settlement, 1-lane can be allowed)
- Treat generated settlement streets as road/path infrastructure: all civic, residential, commercial, and light
  industrial parcels should sit beside neighboring road-carrier tiles, not have roads entering their own tile,
  while through-roads and larger corridors should stay distinguishable from narrow local lanes.
- Generated inter-settlement asphalt roads should pass through or directly touch the settlement center/core;
  local `path` streets can branch around them for block and parcel access.
- Local settlement paths should all connect back to the main road/core graph and should avoid fully roaded 2x2
  tile blocks; roads can cross river-influenced tiles but cannot reuse the river's own tile-border.
- Settlement size and zone fill should stay rules-tuned: villages are no longer extremely tiny by default, and
  residential/commercial/light industrial parcels should use more available road frontage statistically without
  forcing every eligible tile to become occupied.
- Allow several-lanes roads: each lane should have his direction (one-way or both) - ex. 2-lanes = 2 one-way lane. Find a way to fill gap between lanes with markings.
- Texture: while Alpha is calculate, u,v could just be a projection of x,y in the seamless texture
- Builder/project workflow for road construction instead of instant placement.
- Route-benefit UI for characters and vehicles. Forbid some vehicles (not 4x4) to drive off-road (no vehicle can traverse an occupied tile: alveolus, residence, market, industry, ...) - beside bays. For (un)loading an occupied tile, the vehicle puts itself on the border of the tile and the character makes a convey-hop-like ASingleStep (he goes on the center, then move the good from the border=vehicle to the center or vice-versa)
- More road kinds/materials and road-rank rules. The rules are for drawing (an interaction with 2 different roads show the highest-rank) One rule is that one-lane road allow crossing (a vehicle in each direction) only with 30kph (thus, not inter-settlements) Drawing should consider borders of lane: side-walks, white markings, ...
- Road-aware vehicle routing and line summaries.
- Lane/band metadata and markings.

Good follow-up to:

- Gameplay streaming, because roads may span outside the current viewport.
- Freight v1, because roads make vehicle behavior more legible and tunable.

Risks:

- Builder workflows may need clearer rules for blocking projects on buildings, zones, and deposits.
- Route-benefit UI can become noisy if it exposes every cost detail too early.

### 2. Shops, markets, and consumption

Describe "commercial" zoning as internal distribution, not money commerce: people take durable carry
goods, consumables, dwelling supplements, and amusement/culture services from the commons. Actual
commerce happens at the boundary with NPC groups: production sites, villages, towns, cities, and other
settlements.

Potential scope:

- Distribution zones for shops, markets, cafes, canteens, amusement, and household/personal pickup.
- Dwelling stock targets versus public shelf targets, with freight lines able to satisfy either.
- NPC production sites and inhabited settlements that produce some goods, demand others, and expose trade
  interfaces.
- Local price fields based on nearest production/demand influence.
- Import/export policies, protected reserves, and purchase orders for goods the group does not produce.

Good follow-up to:

- Freight v1, because trade interfaces and distribution points can reuse exchange-route concepts.
- Roads, because distance and route quality should matter for outside commerce.
- More game content, because imported goods can bootstrap chains before local production exists.

Risks:

- "Shop" language can imply internal money commerce unless UI copy keeps the commons/distribution model
  explicit.
- Automatic export can accidentally starve internal needs unless protected reserves are first-class.
- Price fields need to be legible enough to guide route/source choices without becoming finance UI.

See [`./commerce.md`](./commerce.md).

#### Commerce levels

Commerce should land in three levels, with the first one serving construction and daily play rather than
trying to become Simutrans all at once.

1. **Useful procurement for our team.** When a needed good is missing, such as concrete for a foundation,
   storage buffers and construction/hive demand advertise the need. A freight line can visit a settlement
   city hall, sell allowed surplus cargo, buy allowed missing materials if the stop reserve permits it, and
   bring those goods back as ordinary vehicle cargo.
2. **Industry commerce and arbitrage.** Once procurement is reliable, the player can buy near producers
   where goods are cheap and sell near demanders where goods are expensive, such as buying wood near a
   forester and selling it to an NPC sawmill complex.
3. **People transport.** Transporting people between settlements, work, homes, and services is a later
   system and should not block goods commerce.

Important first-level boundaries:

- Useful procurement status:
  - **Next V1.x:** route/market comparison by settlement position and price, last-transfer/history
    display, and better visibility into docked vehicle intent: retained cargo, surplus cargo, actionable
    rotations, and why a line is idle or done.
  - **Later V2:** generated shop targets beyond city halls, source/sink suggestions, commercial/resale
    points, and consumption goods delivered to residential or shop areas.
- Project and construction views should surface missing useful goods and possible physical supply routes
  without becoming direct purchase surfaces again.
- External building loading/unloading should use the border-parking plus convey-hop interaction already
  planned for shops, construction, and other non-freight-bay endpoints.

### 3. More game content

More harvesters, producers, transformers, storage types, and goods can make the existing systems feel like a
game faster.

Potential scope:

- New deposits: clay, ore, grain, berries, fish, herbs.
- New harvesters: quarry, mine, farm, fisher, gatherer variants.
- New zone-assigned caring actors: wheat planter, fertilizer, harvester support actors, and forester follow-ups such as tree species/terrain preferences.
- New transformers: kiln, bakery, smelter, workshop, loom.
- New goods: stone blocks, bricks, flour, bread, tools, textiles.
- Tiered construction requirements.

Good follow-up to:

- Current hive and freight management, because the underlying loops already exist.

Risks:

- Pure content can expose balancing and UX gaps quickly.
- Too many chains before roads/markets/settlements may just create larger internal logistics puzzles.
- Planting/caring actors need clear scope rules: named zones provide spatial assignment, while harvestability remains a separate zone flag for harvesters.

### 4. NPC cities and villages

External settlements would make the world feel inhabited and give logistics a reason to cross distance.

Potential scope:

- Generated villages/cities as persisted world entities.
- Settlement needs, exports, and reputation or affinity.
- Trade stops or depots connected by freight lines.
- Population growth, specialization, and simple local simulation.
- Visual settlement generation in Pixi.

Good follow-up to:

- Gameplay streaming ownership.
- Roads and shops, if settlements use them as interfaces.

Risks:

- Large design surface: generation, persistence, AI, economy, and UI.
- Needs careful boundaries so settlements do not become full hives too early.

### 5. Terrain generation rework

Terrain quality now matters more because gameplay can spread across the map.

Potential scope:

- Better macro biomes and regional identity.
- Rivers, lakes, coasts, wetlands, and mountain ranges with gameplay implications.
- Deposit distribution tied to biome and elevation.
- Terrain affordances for roads, settlements, production hives, trade points, and resource chains.
- Generated road corridors that can carry NPC goods, people, and vehicle traffic between NPC groups.
- Seed debugging tools and comparison snapshots.

Good follow-up to:

- Gameplay streaming, because terrain and gameplay persistence need a clean boundary.
- NPC settlements, because villages need plausible placement.
- Commerce/NPC groups, because background traffic needs roads before NPC entities can feel connected.

Risks:

- Terrain tuning can absorb a lot of time without directly improving moment-to-moment play.
- Changing terrain semantics may require migration or test fixture updates.

See [`./terrain-generation-roadmap.md`](./terrain-generation-roadmap.md).

### 6. Freight-line diagnostics depth

Some diagnostics are already landed (see [`current-status.md`](./current-status.md)).

Remaining:

- **Exchange-route vocabulary cleanup.** Rename `findGatherRouteSegments` /
  `findDistributeRouteSegments` and update `freightLineSummary()` to reflect load/unload
  exchange model rather than pickup/delivery.
- **Road-aware vehicle pathfinding.** Make vehicle routing read road state so road-only vehicles
  (`pickup_truck`) require roads and off-road vehicles (`wheelbarrow`, `suv`) are unrestricted.
- **Vehicle compatibility explanations.** Show *why* a vehicle is or isn't compatible with a line
  (e.g. "requires roads" / "off-road capable").

Good follow-up to:

- Roads, because road-aware routing needs road data before it can produce diagnostics.
- Market analysis, because price comparison feeds directly into route decisions.

Risks:

- Mostly improves an existing subsystem rather than opening a new gameplay loop.
- Diagnostics can become noisy if the route rules are still changing.

## Suggested Ordering

1. Commerce/freight diagnostics polish: clean up exchange-route vocabulary (line-level idle/done
   explanation, cargo intent rollup, and settlement price comparison are now landed).
2. Roads and velocity, especially where vehicle route choice should change the commerce outcome.
3. One small content tranche that proves roads and imported materials matter.
4. Shops/markets or NPC villages, depending on whether the next desired feeling is "internal economy" or
   "inhabited world".
5. Terrain generation rework when settlements, roads, and resource placement need stronger geography.
6. Freight-line authoring depth as needed whenever route complexity starts slowing playtesting.

## Decision Prompts

Use these when choosing the next implementation plan:

- Should the next milestone make the map feel bigger, the economy feel deeper, or the UI feel more manageable?
- Does the work require off-screen gameplay state? If yes, do streaming ownership first.
- Does the feature create new player decisions, or mostly add new assets to existing decisions?
- What is the smallest playable slice that proves the direction?
- Which subsystem will become harder to change after this lands?

## First Playable Slices

Small slices worth considering:

- **Roads v2:** turn instant roads into build projects, add route-benefit summaries, and add at least one
  upgraded road kind/material.
- **Commerce polish v1:** clean up exchange-route vocabulary (price comparison widget,
  cargo diagnostics, and collapsible line widget are now landed).
- **Market v1:** one shop consumes one good type and creates a visible demand/satisfaction signal.
- **Content v1:** add one new raw resource, one transformer, one produced good, and one construction recipe that uses it.
- **Village v1:** generate one persisted external village with one import need and one export good.
- **Terrain v1:** add biome-weighted deposit distribution and a seed debug panel.
- **Freight route health v1:** add road-aware vehicle routing and line-level route benefit summaries
  (idle/done explanation and cargo rollup are now landed).
