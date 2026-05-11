# Next Directions

This is the central place for deciding what Anarkai should manage next.

Hive management and vehicle/freight management are now far enough along that the next step is less about
finishing a single obvious subsystem and more about choosing the next gameplay frontier. The options below
are deliberately broad; each one can become its own implementation plan once chosen.

## Current Baseline

Already landed or mostly landed:

- Hive construction, attachment, merging, storage flow, harvesting, transforms, transit, and build loops.
- Vehicle-backed freight management, including freight bays, line definitions, gather/distribute segments,
  line inspectors, and docked vehicle work.
- Selectable custom named-zone objects with a Zones palette entry, zone inspectors, tile/alveolus links, and board masks. Built-in residential/harvest remain ordinary tile markers.
- Deterministic streamed terrain generation and Pixi continuous-terrain rendering.
- Browser client panels for inspecting and editing the active simulation.

Still architecturally important:

- Off-screen gameplay unloading is deferred until a larger-world feature needs it.
- Freight line diagnostics can still deepen once playtesting exposes confusing failures.

## Details to add

- alveoli configurations (ex storage buffer/allowance) should be able to be memorized, given a name and re-used with a combo-box containing all applicable configurations, "specific" = for this alveoli only or the ability to create a new configuration (no add button, just entering a text in the combo and checking for conflict)
- named zones, selectable zone inspectors, line board previews, hovered-stop highlights, and a compact stop table are now landed for freight authoring v2

## Recommended Next Tranche

Gameplay streaming ownership is now baseline. The strongest next tranche is therefore a gameplay-facing
choice: roads/path infrastructure if the goal is a larger map, shops/markets if the goal is demand, or a
small content chain if the goal is more immediate play texture.

## Candidate Directions

### 1. Roads and path infrastructure

Roads are a natural bridge between hive logistics and larger world management.

Potential scope:

- Road tile/project type.
- Pathfinding cost modifiers for roaded tiles.
- Builder workflow for road construction.
- Road-aware vehicle routing and line summaries.
- Optional maintenance/degradation later.

Good follow-up to:

- Gameplay streaming, because roads may span outside the current viewport.
- Freight v1, because roads make vehicle behavior more legible and tunable.

Risks:

- If roads are added before streaming policy is settled, road persistence at the frontier will be awkward.
- If they only change visuals and not pathfinding, they may feel cosmetic.

### 2. Shops, markets, and consumption

Shops turn production chains into visible demand instead of pure stockpiling.

Potential scope:

- Shop alveoli or market buildings with accepted goods and local demand.
- NPC purchase/consume jobs.
- Prices or simple priority weights.
- Food/material consumption by citizens, villages, or visiting NPCs.
- UI for demand, stock, and satisfaction.

Good follow-up to:

- Existing storage, transform, and freight systems.
- NPC settlement work, if shops become the interface between player production and external populations.

Risks:

- Needs a clear model for who consumes goods.
- Can become economy design before the world has enough actors to make demand feel alive.

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
- Terrain affordances for roads, settlements, and resource chains.
- Seed debugging tools and comparison snapshots.

Good follow-up to:

- Gameplay streaming, because terrain and gameplay persistence need a clean boundary.
- NPC settlements, because villages need plausible placement.

Risks:

- Terrain tuning can absorb a lot of time without directly improving moment-to-moment play.
- Changing terrain semantics may require migration or test fixture updates.

### 6. Freight-line diagnostics depth

Vehicle management and route authoring exist, but diagnostics can still make routes easier to debug.

Potential scope:

- Better line diagnostics: blocked pickup, missing unload, no eligible goods, no vehicle.
- Route health summaries for multi-segment lines.
- Optional road-aware route benefit summaries when roads land.

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

- **Roads v1:** build road projects, make pathfinding prefer them, and show route benefit in vehicle travel.
- **Market v1:** one shop consumes one good type and creates a visible demand/satisfaction signal.
- **Content v1:** add one new raw resource, one transformer, one produced good, and one construction recipe that uses it.
- **Village v1:** generate one persisted external village with one import need and one export good.
- **Terrain v1:** add biome-weighted deposit distribution and a seed debug panel.
- **Freight diagnostics v1:** show blocked pickup, missing unload, no eligible goods, and no vehicle signals on existing lines.
