# Commerce, distribution, and NPC groups

Open questions and the plan live in
[`../plans/commerce.md`](../plans/commerce.md); this document records the conclusions and what is
decided.

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

Decided split — both channels exist, using the same exchange-route machinery:

- **Commercial zones** carry the *personal* goods: heating panties, watches, in-city meals and coffees —
  anything acquired on the spot, in person.
- **Homes** receive the *household* goods by direct delivery: appliances, food ingredients, and other
  dwelling stock.
- A dwelling declares "pantry targets" while a market declares "public shelf targets"; freight lines
  satisfy both.
- People choose which home to go to for sleep/homish/free time by what is available — the building's
  quality (level, …) and its content (is there food, games, …).

**Outside visitors (decided):** NPCs can attend our commercial zones and spend money when acquiring what
is sold; clan characters acquire the same goods **without** any money transfer. Commercial zones are
therefore slightly configurable — whether they accept outside commerce and which types of goods they
expose.

### Commercial zones (SimCity "blue" zones)

Commercial zones are shops, restaurants, arenas, courses, and the like — the *visible* commerce surface.

- **The equilibrium is a field, not a constant.** The rest level is *calculated like the price*: it is
  the local **supply/demand ratio** sampled at the shop's tile,
  ```text
  equilibrium_g(shop) = supplyField_g / (supplyField_g + demandField_g)
  ```
  near producers → naturally full, near consumers → naturally drained, balanced → 50 %. The further a
  shop is from a production site, the lower the spontaneous delivery, so it rests emptier. The 0–10
  stock is only a **rendering** of the deviation from this equilibrium (the −5…+5 view); the equilibrium
  itself is the field. The shop's own stock is excluded from its own target to avoid self-reference.
- **Both directions are open to the player.** Characters (or vehicles via lines, or project sources) can
  **buy from** a shop *and* **provide to** it as part of a commercial production line. A shop is a
  sink *and* a source.
- **Spontaneous openings.** Like residential zones, commercial zones spontaneously open shops/courses/
  venues according to long-term local needs — but demand is not assumed satisfied: NPC characters are
  randomly generated and *still need sunglasses if none are sold in their city*. Tourism and **personal
  transport** close that gap (the player opens bus lines), which is exactly the inbound-desirability
  economy of the hippie philosophy.
- **Net-stock signal.** The deviation from the field equilibrium is the readable signal: negative =
  under-stocked (provide to it), positive = over-stocked (buy from it). The spontaneous trickle only
  maintains the *natural* level; the player profits by moving goods against the natural gradient or into
  a gap the trickle can't fill.
- **Capacity is elastic.** A shop's *capacity* (its stock ceiling) is **not fixed** — it grows with
  **cumulative delivered volume** of a good, in **steps** (see "Growth & shrinkage"). The **equilibrium
  stays anchored** (field-derived); the **capacity expands**, so the **headroom above equilibrium grows**
  — and that headroom is the shop's **spontaneous demand** (a shop resting at 5 with a capacity grown to
  15 still fills toward 5 but now *demands* up to 15). Consequence: the player *supplying* a shop
  literally **creates demand** — a bigger shop is a stronger demand source in the price field, opening a
  larger price gap and higher achievable prices. This is the "zone upgrades" loop: sustained provision
  grows the market it feeds.

## Consumption and happiness

Distribution is not decorative: the point of the two channels is **consumption**, and consumption is
what drives **happiness**.

Two acquisition channels, both feeding happiness:

- **Personal (EDC) goods** — everyday-carry items acquired individually at distribution points:
  sunglasses, clothes, watches, electric scooters, plus food-to-go and canteen meals. These are carried
  on the person and wear out over time.
- **Household provisioning** — delivered to dwellings: food ingredients, house-cloth, household
  appliances. These are dwelling stock, consumed where people live.

Both end up as recurring maintenance, not one-time purchases: EDC goods wear and are replaced, food and
appliances are consumed. Happiness is therefore a **sustained logistical target** (keep the shelves and
pantries above target) rather than a one-off unlock.

The model starts **simple** and grows: begin with a single aggregate happiness number; later it can
decompose into per-character preferences (coffee vs tea, mayonnaise vs ketchup) and average those into
one score.

Consumption is also a **demand origin**: for any consumed good, either produce it locally, or keep it in
stock at a distribution center whose "provide" lines refurnish shops and homes — with a **buy trigger**
that sends the distribution center out to buy when its stock depletes. Pantry and shelf targets feed the
same net-deficit ledger as construction and production.

The distribution/consumption half of "commerce" is internal and money-less — its currency is happiness,
not price.

### Happiness → trust → freedom

Happiness is the humans' verdict on the AI's work. It measures how satisfied the people are with the
commune the AI runs for them.

That happiness accumulates as **trust** — the AI's standing with the humans — and trust is a **resource**
("mana") that buys the AI **freedom**: the right to take *special operations* on the group's behalf
without asking.

The loop is:

- the AI runs logistics well → people are happy → trust grows → the AI earns more freedom to act;
- the AI spends that trust on a special operation → trust falls until the people are happy again.

**Trust is a single number**: happiness is aggregated to one score (0–100%) which translates to a trust
delta (−1…+1) applied over time.

**Special operations** are bound to **projects** — in practice, a project *is* a special operation. They
involve sporadic, extraordinary resource commitments: buying in materials, laying a temporary road to
bring in wood from elsewhere, allocating vehicles to the project. Until a dedicated list exists, the
placeholder is simple: the **currency account delta** moves happiness (up when the balance grows, down
when it shrinks, weighted by perceived usefulness) and **project creation** is the spend.

Happiness drives **population**: it alone changes in/out-migration and birth rate. Content people stay
and attract newcomers; neglect makes people leave.

The failure signal is a **progressive loss of control, not a cliff**: as happiness falls, fewer projects
are available to the AI — a slow slope toward being disconnected, never a single zero-crossing.

**Defense and honesty are future** (they imply multiplayer). Buildings and goods do not *belong* to
anyone; each faction merely holds a **feeling** toward them ("it's ours" / "it's not"). Stealing is a
character taking something from "us" for "him". War is a faction appropriating a hive by decree ("let's
consider this hive as ours") without commerce — workers of both clans then contest occupation, and armed
forces must get involved before work is allowed.

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

### Money, stocks, and carriers

- **One immaterial currency** — bitcoin-like — as already implemented. No barter, no per-faction tokens.
- **NPC groups hold real stocks** with min/max bounds, not infinite sources/sinks. Their rest state is
  **full output / empty input**: a sawmill accumulates planks to capacity and consumes wood down to
  nothing — output tends to full, input tends to empty. Surplus planks then "disappear" from spontaneous
  local NPC sales (price falls as the output shelf fills).
- **The only automated, memoryless process is the *input provision*** — a slow "half-life-like" trickle
  that feeds the input so the site can keep producing:
  ```text
  input(t+dt) = input(t) + (target − input(t)) · (1 − 2^(−dt/τ_in))
  ```
  This trickle lets a player *buy from a sawmill without bringing wood* — but it is deliberately **poor**:
  the wood arrives slowly enough that, to make the sawmill commercially relevant, the player must supply
  wood themselves. The trickle keeps an idle NPC site alive; real throughput comes from real inputs.
- **Production is elastic** (the mirror of commercial-zone elasticity): an NPC production hive's
  *production capacity* grows with **cumulative input supplied**, in **steps** (see "Growth & shrinkage").
  Its rest state stays full-output/empty-input; what grows is the **throughput** (and the output ceiling
  that scales with it). So supplying a factory grows the supplier, just as supplying a shop grows the
  demand — the player can *invest* in an NPC hive, not merely tap it.
- **The competition tension:** growing an NPC producer is a double-edged lever — it is a better
  **arbitrage source** if you *buy* its output, but a stronger **competitor** if you also *produce* that
  good yourself. The elasticity loop is neutral about which you are; the player decides whether a
  well-fed NPC sawmill is a supplier or a rival.
- **Outside carriers come last.** Everything can be done locally — goods, carrying, even engineering and
  construction — *or* bought. The two are interchangeable at the boundary.
- **Money is integrated on both sides**: continuous commerce (transport lines between an NPC
  logging/sawmill and transformation hives; the "price of planks vs price of wood" spread) and one-shot
  windows (projects). The group also allocates money to household appliances and EDC luxuries — those
  purchases are consumption spending, not project spending.
- **Luxury consumption is budgeted** through a wallet (or a level) fed by a periodic hourly/daily
  transfer — the way to regulate daily consumption spending. It works like an *inverted tax*: instead of
  taxing income, you drip a fixed allowance into the consumption purse.
- **Money budgeting (decided):** **one wallet** for now; multi-wallet later, when projects / rules /
  personal-allowance-outside-the-settlement can each be bound to a specific custom wallet. Fine-tuning is
  opt-in.
- **Character allowance (salary) is always used.** Even at the commerce extreme of the dial (where a
  player skips the internal SimCity game), a train driver stranded in a city still buys food/lodging with
  it, so the allowance drip is a permanent mechanic, not an extreme-only one.

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
- expose demand/production metadata on the settlement as a whole or on coarse subareas;
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

**Price field (decided model):**

```text
price_g(p) = base_g × (1 + fade(p) × (demandField_g(p) − supplyField_g(p)))

supplyField_g(p) = Σ_surplus_s × w(dist(p, s))    storers s (NPC + players)
demandField_g(p) = Σ_need_d × w(dist(p, d))        demanders d (transform/housing/commerce)

w(d)      = squared-distance falloff, finite support: max(0, 1 − (d/R)²)
fade(p)   = min(1, distanceToFrontier(p) / FadeRadius)
surplus_s = surplus weight (directional, below)          ∈ [0,1]
need_d    = demand weight  (directional, below)          ∈ [0,1]
dist      = road-aware travel cost
```

Implementation approach — the **geometry/weight split**, which is what keeps wide-area map coloring
cheap and the field dynamic:

- **Distance (geometry)** changes only when roads/buildings change. Compute it once per good with a
  **multi-source Dijkstra** over the movement-cost graph (roads = cheap edges), so proximity is travel
  cost and the price field follows roads.
- **Weights (`surplus`/`need`)** change with stock constantly. Apply them as a cheap multiply-add over
  the cached distance field, invalidated by a `revision[good]` bump.
- **Finite support** (the R cutoff) keeps each source local, so coloring is a sparse accumulation on a
  coarse grid, memoized and lazily recomputed — never `O(tiles × goods × sources)` per frame.
- **Squared-distance decay** (`w(d) = max(0, 1 − (d/R)²)`) is local and *smooth* at the R cutoff; a
  newly-generated source only moves prices inside its R-radius.
- **Frontier fade** (`fade(p)`) ramps the deviation to 0 at the generated-world boundary, so
  `price → base` at the frontier. When a neighbour sector generates, the boundary moves out and visible
  tiles relax continuously toward the true field — no price jump (reads the existing
  `Game.requestGameplayFrontier` / `streamedFrontier` machinery for the frontier distance).
- **Directional surplus/need (decided).** A producer of good g contributes **surplus only** (never
  demand); a consumer contributes **demand only** (never surplus) — a sawmill never has a wood surplus
  or a plank demand. For a plain storage holding X of a capacity M: surplus = X, demand = M − X.
- **Buffered goods are invisible to the price field (decided).** Storage marked as **buffering** does
  not add to demand, and buffered goods do not add to availability, in the price calculation (and in the
  shops' balance level, which reuses the same fields). "Buffered" = protected/reserved — economically
  out of circulation.
- **Radius ≥ generation radius (decided).** `R` (and the fade radius) is at least the terrain-generation
  radius, so every source that influences a tile's price is generated before that price is read.

The important design constraint is that price is local, readable, and derived from nearby
production/demand rather than hidden global noise.

**Price UI exposure (decided):** price is a **field** (like terrain height or temperature) derived from
sources and sinks. The Simutrans-like commerce game will need a **tainted colour-map overlay** to plan
transport for profit. The exact UI is to finalize later.

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

## Produce, transport, or trade?

The produce-vs-import decision is **not** settled by production capability alone — it depends on
**relative positions** and **transport capacity**.

- A plank line may be technically self-sufficient, but if it sits far from the construction site, owning
  the corridor is worse than trading: **sell planks where they are produced** (cheap near the producer)
  and **buy planks where they are needed** (pay near the demander), letting outside carriers absorb the
  long, bulky leg.
- Internal transport is volumetric and bounded. One truck does not move hundreds of cubic metres over a
  long route — below a sustained-volume threshold, buy/sell is the correct play, not a dedicated trunk.
- Rule of thumb: **own the corridor only when sustained volume justifies dedicated transport**; otherwise
  treat each region as its own deficit cell and trade across the boundary.
- Preference: **internal movement before trade** — when a need can be met internally, transport is
  preferred; trade is the fallback.

This is the spatial twin of the net-deficit idea: a good can be in surplus near its producer and in
deficit near its consumer at the same time. Internal transport is a cost you weigh against the local
buy/sell price spread — trade wins when the spread is thinner than the transport cost.

## The autarky dial

Commerce and the internal economy are **not two modes — they are a dial**. Each hive sits somewhere on
it, drifts over time, and the position is **per-good**: a hive can be autarkic in stone and import-reliant
in tools.

```
0 ───────────────────────────────────────────────── 10
Simutrans-only               mixed taper             settlers-only
(buy everything)        (the interesting zone)       (near-autarky)
```

Define, per good `g`:

```
dependency(g) = external_sourced(g) / total_consumed(g)   →   0 (self-made) to 1 (all bought)
```

The player's ongoing job is to **turn the dial down per good where it is worth it** and leave it up where
it is not. Three consequences:

- **Internalization is a rate, not a switch.** `dependency(tools)` *decays* as production ramps up; the
  game rewards *incremental* internalization.
- **The dial is sticky in the middle.** Neither full autarky nor full import is strictly optimal; the
  mixed middle is genuinely attractive (where the "not-that-bad" default lands).
- **Price reflects the dial, it does not create it.** Buying a good you could make yourself is
  expensive-but-available; making it is cheaper long-run but costs up-front infrastructure + labour.

## Net-deficit ledger and sourcing

The produce/transport/trade decision is resolved by a single **net-deficit ledger** — the decided
direction for how need and excess are computed and satisfied.

- **Continuous field, not per-region cells.** Need/excess is computed as a continuous field out of NPC +
  player structures — both sustained (production, consumption) and exceptional (projects). No per-region
  cell bookkeeping.
- **Reserve is the single knob.** It protects against over-export *and* caps over-import. Price caps and
  per-good opt-ins are later refinements.
- **Internal movement before trade.** Meet a need internally (transport) when possible; only fall back to
  trade when internal supply/transport can't cover it.
- **Stop modes** = `deficit` (auto-load the shortfall, default), `surplus` (sell above reserve),
  `explicit` (hand-authored).
- **Deficit = priority `2-use` demand.** The ledger's "deficit" is specifically the *urgent* need — not
  the full demand, which also spans `1-buffer` (replenish toward target) and `0-store` (surplus). Lower
  priorities are wants; only `2-use` is the deficit the ledger tracks and sources.
- **Arbitrage never feeds the ledger** — it is profit, not need. It has a "not-that-bad" default, but the
  Simutrans-like buy-here/sell-there commerce game is the **player's decision**.
- **Source choice UX** = a "not-that-bad" automatic default + optional optimisation (the same guardrail as
  everything else).
- **One mechanism, two faces.** Buffers declare needs (money-less) and commerce satisfies deficits with
  money at the boundary — both feed/satisfy the same ledger, not two parallel systems.
- **One order type, a repeat flag.** Recurring trade lines and one-shot project purchase orders are the
  same order type with a repeat flag, not two types.

### Project sourcing

A project's bill is not a flat `{ good: qty }` — it is a set of **sourcing requirements**: "buy X units of
good G from source S", and a good can be split across several sources with **quotas** (partial
self-provision: own forester 40 + NPC settlement 60).

- **Quotas stay editable while the project is ongoing** — re-pin sources and amounts as the project runs
  (not frozen at push).
- **Sources** = own hives, NPC settlements, NPC production hives, and (multiplayer) other players'
  settlements. Internal source = price 0 + corridor cost; external = price + distance.
- **Resolution is internal-first**: own hives first (after their own demand + reserve), then external
  sources ranked by price × stock × distance; `quota: 'rest'` = "fill the remainder here" is the automatic
  default.
- Sourcing is the **resolution of the net-deficit ledger**, not a parallel system — a manual quota is an
  `explicit` override of the internal-first default.
- **Vehicles are allocated to temporary corridors** for project-bound transport — a resource commitment
  (like special operations), not a permanent corridor.

## Maintenance & energy

- **Energy sources are ordinary alveoli.** A water wheel (built beside water) produces rotational energy;
  a stationary engine transforms fuel → kinetic; a generator transforms kinetic → electricity. Energy
  production is a regular transform-like alveolus, not a special subsystem.
- **Two kinds of energy.** **Hauled** (fuel = an ordinary good, consumed as a transform input with a
  per-input usage rate — "1 can → X planks") and **continuous providers** (electricity, compressed air,
  kinetic rotation) carried by a **cable/grid** — a **road-like tile-border entity** (not a road, not a
  building) where **instantaneous production must match instantaneous consumption**.
- **Cables are road-like (on tile borders).** A cable is a **tile addition** carried on the same borders
  roads use, not a tile content. **A border holds at most one edge-layer** — a road *or* a cable, never
  two. **A tile centre is a stack of up to 3 levels** — ground / air / underground — one network per
  level, each a proper **junction** (a road or cable can meet the centre from several borders, e.g. a
  3-way). Different networks (road + cable, axle + pipe) co-locate at one centre on different levels
  rather than sharing a border. A cable can be **bridged**, **elevated (mats)**, or **buried** by
  tech/science; some kinds block, others let roads/rails pass through. The distribution/shortage model
  is in [`energy.md`](./energy.md).
- **Vehicles hold an energy reserve** (battery, fly-wheel); **buildings do not** — they draw live from
  the grid.
- **Maintenance is a usePoints life level.** A building has a `usePoint` scalar that decays **linearly
  and randomly per dt** (not exponential half-life) and **only while used** (like vehicles). Engineers
  top it back toward 100 %; job urgency ≈ `100 − usePoint%`. **Engineers may specialise in vehicles
  (garages)**, so vehicles undergo the same maintenance.
- **Maintenance is done by engineers, as a consumer alveolus.** The engineer alveolus has its **own
  inputs** (goods) and "produces" maintenance — it is a *consumer alveolus* like any transform, whose
  output is upkeep work. Its inputs enter the ledger as ordinary production demand (origin
  `'production'`), not a separate `'maintenance'` origin; maintenance is not a goods-ledger origin of its
  own.
- **The tool ladder is emergent** — the player chooses *paths* (kinetic vs electric), not a numeric
  level+1 progression.
- **Vehicle power source is a per-vehicle recipe property.** Hand/foot-powered vehicles (wheelbarrow,
  bicycle) are recipes. Science is far later.

## Growth & shrinkage (elasticity)

- **Steps, not a continuum.** An entity (commercial-zone capacity, NPC-hive throughput) accumulates
  **growth points** when its input is held **above** balance; the inverse drains them (shrinkage) when
  held **below**; growth points may go negative.
- At a threshold, an **upgrade** is planned and — after works — the entity becomes a bigger
  (more-demanding) one; a negative threshold → shrinkage.
- **Transform hives are directional.** Output **below** balance is positive for growth; input **above**
  equilibrium is positive too; the inverse of each reduces growth points. A transform grows only when
  well-fed *and* under-delivered — the two signals net against each other.

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
- `NetDeficitLedger`: the continuous need/excess field computed from NPC + player structures; reserve is
  its single knob; stop modes = `deficit` / `surplus` / `explicit`.
- `SourcingRequirement` / `Quota`: a project bill entry "buy X units of good G from source S", splittable
  across sources with quotas; resolved internal-first.

Open questions (currency, finite vs infinite NPC sources, physical-visit vs outside carriers,
amusement-as-export) are tracked in [`../plans/commerce.md`](../plans/commerce.md).