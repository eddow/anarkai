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
- Deterministic streamed terrain generation and Pixi continuous-terrain rendering.
- Browser client panels for inspecting and editing the active simulation.

Still architecturally important:

- Gameplay streaming should move fully under `ssh` ownership instead of being shaped by renderer needs.
- Save/load rules for mutated streamed gameplay tiles need to be clear.
- Freight line editing still has deeper route-authoring work after the v1 management bridge.

## Details to add

- alveoli configurations (ex storage buffer/allowance) should be able to be memorized, given a name and re-used with a combo-box containing all applicable configurations, "specific" = for this alveoli only or the ability to create a new configuration (no add button, just entering a text in the combo and checking for conflict)
- named zones should be possible, editable like residential/harvest/... and applicable as zones for lines
- lines should be displayable on the board (we could imagine it displays on line property widow mouse-move, like selection highlight for selectable objects) and the mouse-hovered line-stop should be double-highlighted
- line editor should be refactored to have a table where each stop takes 1~2 lines of a table max, show a summary of the resources management and allow configuration popups, re-ordering with d&d, intensify usage of tool-tipped icons to reduce area usage, ...

## Recommended Next Tranche

### Gameplay streaming ownership

This is the strongest foundational next step because it affects almost every larger game feature.

Goal:

- Make `ssh` the owner of gameplay frontier policy: requested, active, retained, unloaded, and persisted regions.

Why it matters:

- Roads, shops, settlements, richer terrain, and remote production all need a stable answer to "does this
  gameplay tile exist, and what happens when it leaves view?"
- Pixi should express visibility and presentation, not lifecycle policy.
- NPC cities and world trade become much easier once off-screen gameplay has explicit rules.

Likely work:

- Finish the contract around `engines/ssh/src/lib/game/gameplay-frontier.ts`.
- Coalesce generation requests behind a stable `Game` API.
- Define retention rules for mutated tiles, loose goods, projects, roads, freight stops, and settlements.
- Add focused save/load tests for streamed-but-mutated gameplay state.

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

### 6. Freight-line authoring depth

Vehicle management exists, but the route editor can still grow into a real tool.

Potential scope:

- Full stop-list editing: add, remove, reorder, bay versus zone.
- Per-segment radius and goods filters.
- Multi-segment line inspection.
- Better line diagnostics: blocked pickup, missing unload, no eligible goods, no vehicle.
- Route previews on the map.

Good follow-up to:

- The current freight v1 bridge.
- Roads, if road-aware routing becomes visible in the line editor.

Risks:

- Mostly improves an existing subsystem rather than opening a new gameplay loop.
- UI polish can outrun engine semantics if route rules keep changing.

## Suggested Ordering

1. Gameplay streaming ownership.
2. Roads and path infrastructure.
3. One small content tranche that proves roads matter.
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

- **Roads v1:** build road projects, make pathfinding prefer them, and show route benefit in vehicle travel.
- **Market v1:** one shop consumes one good type and creates a visible demand/satisfaction signal.
- **Content v1:** add one new raw resource, one transformer, one produced good, and one construction recipe that uses it.
- **Village v1:** generate one persisted external village with one import need and one export good.
- **Terrain v1:** add biome-weighted deposit distribution and a seed debug panel.
- **Freight editor v2:** edit full stop lists and per-segment filters for existing lines.
