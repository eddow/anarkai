# Commerce, distribution, and NPC groups

## Premise

Anarkai simulates an anarcho-communist group. There is no money inside the group: people do not buy
food, clothing, coffee, tools, or entertainment from each other. Internal "commerce" should therefore
mostly be understood as **distribution**: where durable goods are made available, where consumables are
picked up, and how the settlement decides what to keep, move, store, repair, consume, import, or export.

Money-like prices enter the game only at the boundary with other groups: villages, towns, cities, and
NPC production sites. The player's group can export goods it has chosen to make available and import
goods it does not produce, cannot yet produce, or deliberately prefers to acquire from outside.

## Internal distribution zones

Commercial zoning can exist as a map/UI concept, but internally it should behave like distribution
zoning rather than private retail.

Possible uses:

- **Durable carry goods:** clothing, bags, small tools, protective gear, books, and other items a person
  keeps on them and that may wear out over time.
- **Short-lived consumables:** food, coffee, medicines, snacks, water, fuel, or similar items people
  grab before going to work, leisure, or dwellings.
- **Dwelling supplementation:** goods acquired while going home, based on what the destination dwelling
  already has, lacks, or is configured to stock.
- **Amusement and culture:** games, music, theater, libraries, cafes, sports, baths, meeting places, and
  other public attractions can live in commercial-looking zones without becoming monetary commerce.

Design directions:

- Treat shops, markets, cafes, canteens, and amusement venues as **access points** for a shared commons.
- A "shop" might be a display/storage/distribution building with shelves, staff, opening hours, and
  local stock targets, but no checkout.
- People choose distribution points using distance, availability, social habits, building capacity,
  queue length, freshness, and preference, not price.
- Goods taken from a distribution point become personal inventory, dwelling inventory, or immediate
  consumption.
- Wear and depletion should turn some goods into recurring logistical pressure. Clothing does not need
  daily pickup, but it should eventually need repair, replacement, or washing.

Open question: should common goods be fetched through distribution buildings, delivered directly to
dwellings by line logistics, or both?

One possible split:

- Distribution buildings are good for visible public life, personal choice, amusement, and goods people
  can plausibly carry.
- Direct delivery is good for staple household stock, bulky goods, emergency supply, and predictable
  recurring needs.
- A dwelling may declare "pantry targets" while a district market declares "public shelf targets"; freight
  lines satisfy both with the same exchange-route machinery.

## External commerce

Commerce with money-like units happens between the player's group and outside actors.

The umbrella concept is an **NPC group**: an outside actor that occupies map space, has needs and offers,
and can participate in import/export. NPC groups should not all use the same representation. A factory,
mine, or port behaves differently from a village or city.

Useful naming split:

- **NPC production hive:** a factory-like site that produces and/or demands goods. It is a bounded
  production organism: not generally crossed by roads, though it can contain internal road/service tiles
  and trade access points.
- **NPC inhabitation area:** a residential/commercial settlement area: village, town, city district, or
  neighborhood. Roads can cross it and structure it. The simulation does not need to care whether a tile
  is "residential" or "commercial" unless that detail becomes useful later.
- **NPC settlement:** a user-facing name for an inhabited village/town/city group. Internally this can be
  an `NpcInhabitationArea`.
- **NPC trade point:** a bay, depot, market, shopfront, border stop, or roadside interface where goods
  cross between the player's group and an NPC group.

This keeps "hive" available for strongly bounded production sites, while villages and cities remain
inhabited areas threaded by roads.

Examples of NPC production hives:

- A cement works produces concrete bags and demands coal, limestone, tools, food, or labor-equivalent
  supplies.
- A port imports electronics and exports fish, fuel, or machine parts.

Examples of NPC inhabitation areas:

- A nearby village produces grain and demands clothing, medicine, or construction materials.
- A regional town demands coffee and textiles while producing books, bicycles, or specialist tools.

The important generation distinction is spatial:

- Production hives are placed like facilities. Roads reach them, enter service areas, or connect to trade
  points, but normal through-roads should not slice them into city blocks.
- Inhabitation areas are placed like settlements. Roads may cross them, branch inside them, and define
  their shape. Their residential/commercial split can remain abstract until gameplay needs it.

## NPC group generation model

NPC generation can start from a small set of group archetypes rather than detailed per-building
simulation. Roads matter before this layer is fully materialized: NPC groups should generate background
traffic between each other, including goods, people, and vehicles moving between inhabited areas, trade
points, and production hives.

See [`./terrain-generation-roadmap.md`](./terrain-generation-roadmap.md) for the terrain and road
correction pass that should precede full NPC entity generation.

### `NpcProductionHive`

A production hive is a bounded productive place: cement works, sawmill, mine, quarry, port, refinery,
farm complex, workshop, or depot.

Generation shape:

- choose a footprint and anchor tile;
- place production/demand metadata on the group, not on every building;
- attach one or more `NpcTradePoint`s at reachable edges or service yards;
- connect roads to the trade points;
- optionally draw internal roads, yards, storage, or buildings as decorative/service tiles;
- prevent public through-roads from treating the footprint like a normal settlement grid.

This is the Simutrans-factory-like model: the player cares what it produces, what it demands, where to
reach it, and what the local price influence is.

### `NpcInhabitationArea`

An inhabitation area is a lived-in outside settlement: hamlet, village, town, city, neighborhood, or
mixed residential/commercial area.

Generation shape:

- choose one or more settlement blobs along terrain, roads, rivers, or coast;
- allow roads to cross, branch, and form the settlement skeleton;
- optionally tag broad subareas as residential, commercial, civic, industrial, or mixed later;
- expose demand/production metadata on the settlement as a whole or on coarse districts;
- place `NpcTradePoint`s at markets, depots, town gates, stations, ports, or roadside plazas.

This model says "people live here" without requiring a full internal economy. For commerce, the
settlement can simply demand and offer goods through trade points.

### `NpcTradePoint`

A trade point is the contact surface between the player's logistics and an NPC group.

Possible user-facing names:

- production hive: freight bay, loading bay, depot, yard, dock;
- settlement: market, depot, town gate, roadside market, station, port, trade point;
- border/external abstraction: border stop, external depot, gateway.

Internally, `NpcTradePoint` is probably the cleanest common name. The local label can be generated from
the parent group type and terrain.

The player's group can:

- mark internal goods as available for export;
- reserve some goods from export so internal needs remain protected;
- buy unavailable goods such as concrete bags for early hive construction;
- keep importing goods forever if the group never builds the required production chain;
- use trade as a temporary bridge until local production exists.

## Price fields

Prices should depend on geography, not a global market table.

Each NPC group can advertise:

- goods it produces, with a low local price;
- goods it demands, with a high local price;
- optional capacity, stock, freshness, contract, or throughput limits.

For each good, the map can derive a price field from the nearest relevant production and demand sources.
These sources may be NPC production hives, NPC settlements, or later other player-like groups:

- Near a producer, that good is cheap.
- Near a demander, that good is expensive.
- Between them, price changes linearly by tile distance until a maximum influence distance.
- Outside the influence radius, the price falls back to a regional/default value or becomes unavailable.

This allows a simple spatial trade model:

- Exporting goods is better near places that demand them.
- Importing goods is cheaper near places that produce them.
- Logistics distance matters without needing a full economic simulation.
- Different map starts can make different goods strategically important.

Possible calculation sketch:

```text
producerInfluence = max(0, 1 - distanceToNearestProducer / maxDistance)
demandInfluence = max(0, 1 - distanceToNearestDemand / maxDistance)

buyPrice = basePrice * lerp(1, producerDiscount, producerInfluence)
sellPrice = basePrice * lerp(1, demandPremium, demandInfluence)
```

This is intentionally incomplete. The important design constraint is that price is local, readable, and
derived from nearby production/demand rather than hidden global noise.

## Import and export interfaces

There are several plausible ways to connect an NPC group to the player's logistics.

### Border trade stop

A trade stop sits at the edge of the map, a road, a rail tile, a river dock, or another external gateway.
The player assigns import/export policies there.

Good for:

- early implementation;
- clear UI;
- maps where outside commerce enters through obvious gates;
- treating the outside world as abstract.

Risk: it can make nearby towns and factories feel less physical if all trade collapses into a generic
border point.

### NPC production hive freight bay

An NPC production hive has one or more freight bays. Player freight lines can route to these bays, unload
exports, and load imports.

Good for:

- reusing freight-line concepts;
- making trade feel spatial and route-based;
- letting road quality and distance matter;
- connecting directly to "factory produces/demands goods" mental models.

Risk: it requires careful authority rules so player workers and vehicles can interact with an NPC
production site without owning or editing it like a normal hive.

### Settlement trade point

An NPC settlement exposes a public exchange building or area: a selling shop, market hall, depot,
warehouse, plaza, roadside market, or town gate. It can be placed inside or near the settlement and acts
like a socialized trade interface.

Good for:

- villages, towns, and cities that should feel inhabited rather than industrial;
- goods that are acquired through public markets;
- future diplomacy, reputation, or relationship mechanics.

Risk: the word "shop" may imply internal retail if the distinction is not clear in UI copy. "Trade point"
or "settlement depot" may be cleaner internal names.

### Contract pickup and delivery

The player creates a trade order: buy concrete bags from production hive A, sell surplus textiles to
settlement B, or exchange medicine for tools. Vehicles then fulfill the order through normal freight
mechanics.

Good for:

- explicit player control;
- preventing accidental export of needed goods;
- supporting one-off construction bootstrapping.

Risk: too much order management can become paperwork if every small import requires manual setup.

## Acquiring goods

Acquisition can be layered from simple to richer behavior:

1. **Manual purchase order:** the player selects a good, amount, source, destination, and max acceptable
   price. This is ideal for early construction materials like concrete bags.
2. **Stock target import:** a hive, warehouse, or construction plan declares a target amount. If internal
   production cannot satisfy it, the system may import up to a configured cap.
3. **Trade route:** a recurring route imports allowed goods and exports allowed surplus goods when price
   and stock rules permit.
4. **Autonomous steward:** later, a planning system can propose imports/exports based on shortages,
   reserves, travel distance, and expected construction plans.

Useful guardrails:

- Export only from goods explicitly marked exportable, or from stock above a protected reserve.
- Let construction sites request externally sourced materials when no internal source exists.
- Show the player why an import happened: shortage, construction requirement, reserve target, or manual
  order.
- Make external commerce optional but useful. A group can aim for self-sufficiency, dependence on trade,
  or a hybrid path.

## Early concrete example

At the beginning of a scenario, the group may need concrete bags to build its first hive. It does not
produce concrete yet, and perhaps never will.

Possible flow:

1. A construction plan requires concrete bags.
2. The internal inventory scan finds none and no local producer.
3. Nearby NPC production hives and settlement trade points are queried for concrete bag availability and
   local price.
4. The player chooses a source or accepts the best available source.
5. A purchase order reserves outside currency/credit and creates an import task.
6. A vehicle travels to the production hive bay, border stop, or settlement depot.
7. Concrete bags enter the player's logistics network at the chosen receiving bay.
8. Existing freight/construction delivery moves them to the construction site.

This keeps early bootstrapping understandable: the group does not suddenly mint concrete because the
planner needs it, and the outside economy is visible as place, distance, and dependency.

## Implementation notes

Likely engine concepts:

- `DistributionZone`: internal access area for free pickup, entertainment, and public stock targets.
- `NpcGroup`: umbrella outside actor with produced goods, demanded goods, price influence, map footprint,
  and trade interfaces.
- `NpcProductionHive`: bounded factory-like group; roads connect to it or run inside service areas but do
  not normally cross it as public through-roads.
- `NpcInhabitationArea`: village/town/city area; roads may cross and branch inside it, with residential
  and commercial detail abstracted until needed.
- `TradeInterface`: a bay, border stop, depot, or market building where goods cross ownership boundaries.
- `ExportPolicy`: rules for which goods may leave the group and how much reserve must remain.
- `ImportPolicy`: rules for which goods may be bought automatically, from where, and under what price cap.
- `TradeOrder`: one-off or recurring import/export intent.
- `LocalPriceField`: derived per good from nearest production/demand influence.

Questions to keep open:

- Does outside commerce use one abstract currency, barter-equivalent value, favors/credit, or scenario-
  specific units?
- Can NPC production hives and settlements run out of stock or demand capacity, or are they infinite
  sources/sinks with price only?
- Should imports require a person/vehicle physically visiting the NPC site, or can some goods be delivered
  by outside carriers?
- How much UI should expose price fields on the map versus hiding them behind source recommendations?
- Are amusement zones purely internal distribution/culture, or can some venues attract outside visitors
  and therefore become export-like services?
