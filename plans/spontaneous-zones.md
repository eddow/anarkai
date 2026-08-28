# Spontaneous zone management — residential & commercial

> Open questions and proposal. Decided parts migrate to `docs/` when settled. This is the **SimCity
> half** of the game — zones that deploy and grow *without* the player authoring each building — as
> opposed to player-authored hives (see [`projects.md`](./projects.md)) and hand-built transport
> (see [`spontaneous-lines.md`](./spontaneous-lines.md)).

## Scope

Three automatic, zone-driven behaviours live here:

1. **Spontaneous residential** — housing spawns when population pressure rises (already seeded:
   `trySpawnResidentialProject` in `residential/demand.ts`).
2. **Spontaneous commercial** — shops spawn near production/consumption (**v1 landed**: population-driven
   `grocery` in `commerce/commercial-demand.ts`; production-seeding is the open follow-up).
3. **Growth & shrinkage** — a building grows (merges with identical neighbours) or shrinks, changing its
   tile footprint and capacity.

All three declare **demand** into the same net-deficit ledger as player projects; none of them carries a
player-authored sourcing override — they ride the global default (see
[`commerce-architecture.md`](./commerce-architecture.md#sourcing-policy-for-spontaneous-construction--growthshrinkage-proposal)).

## Estate delivery tile (freight bay)

**Every estate has at least one delivery tile** — the point where internal freight drops goods and the
estate's own buffering begins.

- **Player hives** — the player fixes the freight-bay tile explicitly (the existing `FreightBayAlveolus`
  / road-fret action).
- **Automated residential/commercial** — a tile **adjacent to a road** is the delivery tile for now;
  every estate **must touch a road at least once**.
- **Delivery protocol for r/c (same as projects/constructions today):**
  - the vehicle **parks at the border**;
  - goods are **conveyed** from the border into the **center of the bay tile**;
  - once the good is **in the tile, it is in the estate**;
  - **r/c have no internal conveyance** — there is no sub-estate convey network beyond the single
    delivery tile. (Player hives keep their full internal convey/alveoli machinery.)

Consequence for the estate model: an estate's `footprint` includes its delivery tile, and its `profile`
reads the delivery tile's buffer as the estate's own stock (§5c "own buffer"). The delivery tile is the
**one** point where the estate's own buffer meets the transport network.

## Spontaneous commercial generation

Commerce (import/export with outside carriers / NPC groups) goes **through shops**, never through
industrial hives directly (see [`commerce-architecture.md`](./commerce-architecture.md#commerce-happens-at-shops-not-inside-industrial-hives-proposal)).

- **Production seeds the commercial zone around it.** A sawmill complex populates a *nearby commercial
  zone* with **wood and plank shops** — the shop is the money-facing endpoint for goods the nearby
  production makes (and the inputs it needs).
- **Shops stock both industrial and consumption goods** — wood, stone, planks sit alongside final
  consumption goods on the same shelves.
- Shops are estates with `feedsPriceField = false` (they consume but do not feed the price field), yet
  they are the *only* boundary where outside carriers transact.

This is the decided direction; the **spawn rule** itself is open (see below).

**Shops are multi-tile estates.** A shop is an `Estate` (not an alveolus, not a hive) that can expand
over several tiles via growth/merging — a 1-tile wood shop merging with an identical neighbour into a
2-tile shop is the same footprint-change growth as any estate. `feedsPriceField = false`; it is the
money-facing boundary, never the industrial producer.

### Sales channels (how a hive's production gets sold)

Spontaneous selling of a hive's production happens through **two** channels:

1. **Retail / walk-in** — we stock our **shops**; NPCs (or our own characters, for personal/wearable
   goods) come and **buy at the shop**, gated by *connections* (roads, bus lines, surrounding
   cities/villages, …). This is the passive, demand-driven side.
2. **One-off delivery line** — one of our **vehicles** delivers the goods to an **NPC shop or a
   concurrent (other-group) shop** as a one-shot order (`repeat = false`, a temporary corridor). This is
   the active, sell-into-their-market side.

Both are commerce; retail is local and pull-based, the one-off line is push-based and freight-driven.
The same net-deficit/sourcing resolution decides which channel is worth it (retail when local demand
justifies a shelf; one-off line when the surplus must travel to reach a buyer).

## Geographic demand expression

Need (and excess) is expressed **geographically** — the shop-spawn decision reads the *local* need/excess
around a candidate tile, not a board-wide aggregate. Three demand origins feed it:

1. **Industries** — input/output goods (a sawmill demands wood, supplies planks).
2. **Houses** — needs + luxury (food, soap, … → garbage).
3. **Present characters** (clan + NPC) — clothes, on-the-go meals, sunglasses → garbage.

Garbage is **deferred** (not part of the spawn signal for now).

**Shops diversify over all surrounding needs/production** (besides garbage) and are **created/removed
when a recurring need/surplus is spotted** at a location.

### Cumulative observation (avoid building all shops at once)

The spawn decision is **not** instantaneous on first sight of a need. Needs have different urgency
(bread > sunglasses), so a single emergency must not trigger a shop. The engine **accumulates evidence
over time** — it observes the need persists for some duration / above some threshold — before committing
a construction. This ensures:

- a transient one-off shortage does **not** spawn a shop;
- **not all shops are built together** — they emerge one by one as each need proves itself recurring;
- urgency (bread vs sunglasses) modulates the *observation window* (urgent goods clear faster), but the
  cumulative gating still applies.

## Custom shop types

**Yes — we can already define custom shop types** as game content, and it is worth doing before the
spawn logic: the spawner selects among *named* shop types rather than an abstract "a shop". Proposed
first pass of content:

| shop type | stocked goods (sell side) | buys/needs | notes |
|---|---|---|---|
| **Construction materials** | wood, stone, planks, concrete, steel | tools, hardware inputs | the industrial-input shop seeded near production hives |
| **Clothing** | clothes, sunglasses, bags, shoes | textiles, leather | EDC + wear/replacement loop |
| **Food / groceries** | bread, berries, mushrooms, flour, meals | ingredients | highest-urgency need; likely the first to spawn |
| **Household / hardware** | soap, house-cloth, appliances, fuel | soap ingredients, parts | the dwelling-pantry complement |
| **General / mixed** | misc consumables | — | fallback catch-all when no specialised shop fits |

Each shop type is a **named content definition** with: a `stockGoods` list (what it sells), a
`needGoods` list (what it buys to refill), a `capacityBase` (the `base` in the triangular curve), and
optional `tags` reused by `GoodSelectionPolicy` for category-level rules. This mirrors how alveoli are
content-defined (`alveoli.ts`), so shops belong in `engines/rules` alongside them.

### Open: granularity of shop content

- Should shop types be **per-good** (a "wood shop" vs a "plank shop") or **per-category** (a "timber
  shop" stocking wood + planks + …)? The custom types above are per-category; per-good is a refinement.
- Do shops **merge across** the same category (wood shop + plank shop → timber shop), or only
  **identical** shops merge (wood + wood)? (Also asked under merge eligibility.)
- Is there a **general/mixed** shop, or must every shop have a specialised type?

### Customer reach (catchment) — TODO, specify later

A shop's customer base is the set of people who can **physically reach** it, and the reach mode differs
by what the shop sells:

- **Personal / wearable goods** (clothes, sunglasses, EDC) — reachable by **bus (lines)** *and* **car
  (roads)** — a character can travel to the shop either way.
- **Materials / parts** (wood, stone, planks, components) — reachable **only by road (car/truck)**;
  these are freight pickups, not personal errands, so no passenger-line reach.

This is an explicit **open TODO** — the customer/catchment model (how reach is measured, how line vs
road capacity caps a shop's throughput) is **not yet specified**. It is deliberately left un-decided so
it can be designed against the transport model (bus lines + roads) once both exist.

### Staffing & walkability — later (explicit TODO)

Two shop behaviours are **deferred to later**, recorded now so the estate model keeps room for them:

- **Staffing** — a shop is staffed by **one character per tile**. An unstaffed shop does not transact
  (or transacts at a reduced rate). This ties shop throughput to the workforce, matching the general
  "building needs labour" model.
- **Walkability** — shop tiles are **enterable but not traversable**, exactly like alveoli: a character
  can walk *into* a shop tile to buy, but cannot pass *through* it to another tile. (This is the same
  occupancy rule alveoli already impose, so a shop's tile footprint blocks through-traffic like a hive
  tile does.)

Both are noted here as forward constraints on the `Shop` runtime representation, not built now.

## Growth & shrinkage

A building grows by **merging with an identical neighbour** — two 1-tile wood shops merging into one
2-tile wood shop is a valid growth transformation. Growth is therefore a *footprint* change on an
estate, not a fresh construction (though its *materials* are still a one-shot order into the ledger).

### Benefit is triangular

> Indeed, benefit will be hard-coded as store will have capacity per tile-size, adding small capacity of diverse other items barely related

Capacity grows as the **triangular number** of the tile count `n`:

```text
capacity(n) = base × n(n+1)/2     →  multiplier: 1, 3, 6, 10, 15, 21, …
```

So a 1-tile wood shop storing `base = 5`:

| tiles n | multiplier n(n+1)/2 | capacity |
|---|---|---|
| 1 | 1 | 5 |
| 2 | 3 | 15 |
| 3 | 6 | **30** |
| 4 | 10 | 50 |
| 5 | 15 | 75 |

(Confirmed: 5, 15, 30 — the earlier "60" was a typo.)

### Trigger grows faster than benefit

The **growth trigger** (what it takes to grow: demand pressure, delivered volume, elapsed time) grows
**faster** than the benefit, so each further merge is harder to justify — growth is a genuinely
increasing-cost lever, not a linear climb. (Exact trigger curve is open — it must outpace `n(n+1)/2`.)

### Shrinkage (implied)

Symmetric: a building can shed a tile-unit when its trigger falls below a floor. Open whether shrinkage
is automatic (mirror of growth) or player-confirmed.

## Open questions

- **Spontaneous commercial spawn rule**: what triggers a shop (nearby production demand, local population,
  both), and how does it pick a tile (road-adjacent in a zoned commercial area)?
- **Cumulative observation parameters**: the observation window / threshold, and how urgency (bread vs
  sunglasses) shortens it.
- **Growth trigger curve** — must outpace triangular benefit; what is it (delivered volume threshold,
  sustained demand, time)?
- **Merge eligibility** — only *identical* shops (same good)? Or same-good category (wood shop + plank
  shop merging into a "timber" shop)?
- **Shop type granularity** — per-good vs per-category (see custom shop types above).
- **Shrinkage** — automatic mirror, or player-confirmed?
- **Delivery-tile selection for r/c** — "nearest road tile" is decided for now; what happens when an
  estate spans tiles touching multiple roads?
- **r/c conveyance depth** — "no internal conveyance" is decided for now; when (if ever) does a larger
  commercial estate (mall) get a second internal stop?
- **Staffing** — "one character per shop tile" is deferred (see staffing TODO); the exact throughput
  penalty for an unstaffed shop is open.
- **Walkability** — shops are enterable-not-traversable (like alveoli); the exact occupancy/pathing rule
  for multi-tile shops is deferred (see walkability TODO).

---

## Task summary — current status (2026-08-27)

Of the three zone-driven behaviours in §Scope, **residential is done**, **commercial has a v1 spawner
(population-driven grocery) plus its runtime + content**, and **growth/shrinkage is not started**.

### Landed

- **Spontaneous residential** (`residential/demand.ts`): `trySpawnResidentialProject` (starts at most one
  dwelling project on a clear, zoned `UnBuiltLand` tile when `people − freeSlots > 0`) +
  `ResidentialDemandTicker` (periodic, cooldown-gated). This is the pre-existing seed the plan points at.
- **Shop runtime** (`commerce/shop.ts`): `Shop extends TileContent implements Estate` — a non-alveolus,
  non-hive commercial estate. `feedsPriceField = false`; a `SpecificStorage` shelf seeded from the shop
  type's `capacityBase`; `profile` mirrors the shelf (`normalizedDelta = 0`); `footprint` is a single
  tile (multi-tile growth to come); `distanceTo` over the footprint. `shopStockGoods` resolves a type's
  sell-side goods by tag (empty `stockTags` = `general` stocks everything).
- **Shop content** (`rules/content/shops.ts`): `ShopDefinition` (`label`, `stockTags`, `needTags`,
  `capacityBase`, `spawnWeight`) + five named types — `construction_materials`, `grocery`, `clothing`,
  `research`, `general` — plus `shopNeedTags` (buy side defaults to sell side). Shops are placeable via
  the `shops` game patch (`shop.test.ts`; the `commons` example starts with `shops: []`).
- **Commercial spawner v1** (`commerce/commercial-demand.ts`): `trySpawnCommercialShop` +
  `CommercialDemandTicker` (registered on `Game` alongside residential/one-shot tickers). It places **at
  most one** `grocery` shop per pass on a clear, zoned, **road-adjacent** `UnBuiltLand` tile, gated by
  **cumulative observation**: `+1` evidence per pass with shoppers, `−1` per empty pass, commit when
  evidence reaches `commercialObservationThreshold` (3). Deterministic tie-break (highest shopper count,
  then lowest coord). Type diversification + production-seeding are the open follow-ups.
- **Tests** (`tests/unit/shop.test.ts`, `tests/unit/commercial-demand.test.ts`): shop estate/shelf +
  tag resolution; spawn-on-sustained-pressure, transient-no-spawn, and no-road-no-spawn.
- **Zone study (UI)** (`commerce/zone-tendencies.ts` + `ZoneProperties`): `measureZoneTendencies(game,
  zone)` surfaces the per-zone tendencies the spawners accumulate — per-good demand (construction needs
  inside the zone, computed **locally** over the zone's own tiles, not the board ledger), **commerce
  need** (shop restock shortfall = capacity − stock for commercial zones), offer (stock inside the zone),
  structural counts (dwellings / under-construction / shops), and the two spawn-pressure signals
  (`housingPressure`, `shoppers`). Rendered in the zone inspector. The tile widget now links to the zone
  widget for **every** content kind (alveolus, dwelling, unbuilt, and shop) — a shop tile gets its own
  estate header (name + shelf) with a zone link, and the unbuilt zone chip is clickable. The zone
  inspector gained an **erase-tiles** tool (`zone:none` paint) and a **delete confirmation** (bin →
  confirm/cancel row), fixing the accidental whole-zone-delete. See `tests/unit/zone-tendencies.test.ts`.
- **Local, no board scan** — the spawners read indexed coords, not `hex.tiles`: `ZoneManager`
  `residentialCoords` + `commercialCoords` (maintained by `setZone`/`removeZone`), and
  `measureZoneTendencies` walks only the zone's own coords.

### Not landed (the actual remaining work)

- **Commercial type diversification / production seeding** — the v1 spawner is population-driven
  `grocery` only. Open items: the full spawn rule (§Open questions #1) and seeding
  `construction_materials` (etc.) from nearby production.
- **Growth / merge** — `capacityBase` + the triangular formula (`n(n+1)/2`) are documented and
  `capacityBase` is content, but `footprint` is still single-tile: no identical-neighbour merge.
- **Shrinkage** — not implemented (automatic-mirror vs player-confirmed is still open).

### Deferred (unchanged)

- **Customer reach / catchment** — explicit TODO, unspecified until bus-lines + roads exist.
- **Staffing** (one character per tile) and **walkability** (enterable-not-traversable) — forward
  constraints noted, not built.
