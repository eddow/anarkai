# Next Directions

This is the central place for deciding what Anarkai should manage next.

Hive management and vehicle/freight management are now far enough along that the next step is less about
finishing a single obvious subsystem and more about choosing the next gameplay frontier. The options below
are deliberately broad; each one can become its own implementation plan once chosen.

## Current Baseline

Already landed or mostly landed:

- Hive construction, attachment, merging, storage flow, harvesting, transforms, transit, and build loops.
- Vehicle-backed freight management, including freight bays, exchange-route line definitions, legacy
  gather/distribute segment helpers, line inspectors, and docked vehicle work.
- Selectable custom named-zone objects with a Zones palette entry, zone inspectors, tile/alveolus links, and board masks. Built-in residential/harvest remain ordinary tile markers.
- Zone inspectors show compact icon stats for tile count and physical area using the documented `3m` hex side scale.
- Transform alveoli can keep a configured product ratio, with rule defaults and per-alveolus inspector controls for the input good, output good, and slider threshold.
- Deterministic streamed terrain generation and Pixi continuous-terrain rendering.
- Browser client panels for inspecting and editing the active simulation.

Still architecturally important:

- Off-screen gameplay unloading is deferred until a larger-world feature needs it.
- Freight line diagnostics can still deepen once playtesting exposes confusing failures.

## Details to add

- alveoli configurations (ex storage buffer/allowance) should be able to be memorized, given a name and re-used with a combo-box containing all applicable configurations, "specific" = for this alveoli only or the ability to create a new configuration (no add button, just entering a text in the combo and checking for conflict)
- We'll need to add config for: locale, measure units (1 tile-border = 3m = 10feet), decimal/duo-decimal
- we should have bay-less roads (from zone to zone)
- freight lines should complete the exchange-route refactor: cyclic route order, zone-local exchange,
  and candidate checks that no longer depend on gather/distribute as line kinds
- "lines" management widget with filters: "have bay" (yes/all/no) and "visible" (only-intersecting-the-game-view:bool)
- find a way to show the content of the docked vehicles. Perhaps add a check-box/button to show/hide vehicle content (docked and non-docked)
- line edition widget (reflections still ongoing):
  - the line stop (bay/zone/...) should only be editable like on add: the set should have a sub-menu (bay/circle/named zone)
  - The add stop should allow the selection (indeed, for now it adds something but the change is not visible without refreshing the widget)
  - the widget is always a bit too wide and has a horizontal scroll for 1~2px
  - the "open zone" button seems quite useless as the stop is shown as a link (it is for the bay and should be for the zone)
- roads & velocity calculation. Some vehicles can just not drive beside roads. There should be a multiplier somewhere as well as a `min(road-max-velocity, vehicle/character-ax-velocity)`. How to calculate exactly the velocity for it to be realistic somehow but still simple ?
- When providing to an external building (residence/construction/commerce), the vehicle should indeed stop on the border and unloading the vehicle in the building should indeed be a convey-hop-like action (character in the center of the tile, visible moving good)

## Recommended Next Tranche

Gameplay streaming ownership is now baseline. The strongest next tranche is therefore a gameplay-facing
choice: roads/path infrastructure if the goal is a larger map, shops/markets if the goal is demand, or a
small content chain if the goal is more immediate play texture.

## Candidate Directions

### 1. Roads and path infrastructure

Roads v1/v1.5 is already landed as instantly authored, border-owned `path` roads with textured rendering and
walking cost modifiers. Roads remain a natural bridge between hive logistics and larger world management.

Potential next scope:

- Builder/project workflow for road construction instead of instant placement.
- Route-benefit UI for characters and vehicles.
- More road kinds/materials and road-rank rules.
- Road-aware vehicle routing and line summaries.
- Lane/band metadata and markings.
- Optional maintenance/degradation later.

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
   the player can choose a seller. The purchase spends value points from the shared team account, sends a
   vehicle/worker to the seller, parks at the seller tile border, performs a convey-hop-like shop transfer
   that spawns the bought material, then brings it back to the construction/site/storage that needs it.
   Player-owned storage may buffer imported goods so later needs can consume local stock before buying.
2. **Industry commerce and arbitrage.** Once procurement is reliable, the player can buy near producers
   where goods are cheap and sell near demanders where goods are expensive, such as buying wood near a
   forester and selling it to an NPC sawmill complex.
3. **People transport.** Transporting people between settlements, work, homes, and services is a later
   system and should not block goods commerce.

Important first-level boundaries:

- The shared player/team account is the common pot. Player characters use player-owned goods freely; NPC
  purchases add value points to this account.
- Selling from player inventory should eventually happen through commercial zones or resale points near or
  inside settlements, but the resale-point gameplay can come after purchase procurement works.
- Buying should not force micromanagement per building. District/project views should surface missing
  useful goods, possible sellers, and purchase actions.
- External building loading/unloading should use the border-parking plus convey-hop interaction already
  planned for shops, construction, and other non-freight-bay endpoints.

### 3. More game content

More harvesters, producers, transformers, storage types, and goods can make the existing systems feel like a
game faster.

Potential scope:

- New deposits: clay, ore, grain, berries, fish, herbs.
- New harvesters: quarry, mine, farm, fisher, gatherer variants.
- New transformers: kiln, bakery, smelter, workshop, loom.
- New goods: stone blocks, bricks, flour, bread, tools, textiles.
- Tiered construction requirements.

Good follow-up to:

- Current hive and freight management, because the underlying loops already exist.

Risks:

- Pure content can expose balancing and UX gaps quickly.
- Too many chains before roads/markets/settlements may just create larger internal logistics puzzles.

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

Vehicle management and route authoring exist, but diagnostics can still make routes easier to debug.

Potential scope:

- Better line diagnostics: blocked pickup, missing unload, no eligible goods, no vehicle.
- Route health summaries for multi-segment lines.
- Exchange-route summaries that explain which halt rotations are actionable on cyclic lines.
- Optional road-aware route benefit summaries now that border roads can affect travel cost.

Good follow-up to:

- The current freight v2 editor.
- Roads, if road-aware routing becomes visible in the line editor.

Risks:

- Mostly improves an existing subsystem rather than opening a new gameplay loop.
- Diagnostics can become noisy if the route rules are still changing.

## Suggested Ordering

1. Roads and path infrastructure.
2. One small content tranche that proves roads matter.
3. Shops/markets or NPC villages, depending on whether the next desired feeling is "internal economy" or
   "inhabited world".
4. Terrain generation rework when settlements, roads, and resource placement need stronger geography.
5. Freight-line authoring depth as needed whenever route complexity starts slowing playtesting.

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
- **Market v1:** one shop consumes one good type and creates a visible demand/satisfaction signal.
- **Content v1:** add one new raw resource, one transformer, one produced good, and one construction recipe that uses it.
- **Village v1:** generate one persisted external village with one import need and one export good.
- **Terrain v1:** add biome-weighted deposit distribution and a seed debug panel.
- **Freight diagnostics v1:** show blocked pickup, missing unload, no eligible goods, and no vehicle signals on existing lines.
