# Commerce architecture — open questions & plan

> **Decided things live in [`docs/commerce.md`](../docs/commerce.md).** This file holds only what is
> still open and the plan. If a point below turns out to be settled, move it to `docs/commerce.md` and
> delete it here.

## Open questions

### Multi-tile buildings (estates) — a missing prerequisite

- **An estate is one building, 1-to-several tiles.** A 1-tile house is an estate; a rural house (house
  + garden stretching 3–6 tiles back from the road) is an estate; a 2–3 tile-wide/deep city tower is an
  estate; a shop, a mall, and an industrial hive are each an estate. The `Estate` interface (`footprint`,
  `profile`, `feedsPriceField`, `distanceTo`) is the per-building economic unit.
- **A settlement is a container of estates, not an estate itself.** It holds many residential,
  commercial, and industrial estates. Its "trade profile" is the aggregate NPC-side *interface*, not a
  price-field actor; the price field reads each constituent estate individually.
- **Today: 1 tile = 1 building** (1 tile = 1 house, 1 tile = 1 shop). The multi-tile-building and the
  "add an alveolus to the complex" growth model both assume a **conglomerate** — several tiles gathered
  into **one building** (a rural house + garden, a city tower, a mall, an industrial footprint) — and
  that representation **does not exist yet**.
- This is the hidden prerequisite for: (a) pricing *buildings* of any kind (a mall is one consumer
  estate, not N shop tiles), and (b) growth/shrinkage as "add/remove a tile-unit inside a complex".
- Open (not decided): the conglomerate representation — one owner entity spanning a tile footprint, how
  its internal units aggregate into a single `EstateCommerceProfile`, and how construction/dismounting
  addresses a *sub-unit* rather than a whole tile.
- **NPC settlement trade endpoint (decided direction):** the current transfer point is the settlement's
  **city hall** (`NpcSettlementTradeTarget.kind: 'city_hall'`) — a temporary short-circuit. The
  **commercial lines to the city hall are to be removed** once shops exist: all load/unload/commercial
  transactions happen on the **corresponding estate** (the specific shop/hive), never on the settlement
  container or its city hall. **Sequencing guardrail:** do *not* rip out the city-hall trade before the
  shop runtime + spawner land — the city hall is currently the only money-facing endpoint, so removing
  it first leaves commerce with no boundary.
- **Every estate has a delivery tile (freight bay).** Player hives fix it explicitly (`FreightBayAlveolus`);
  automated residential/commercial use a road-adjacent tile (every estate must touch a road). Vehicles
  park at the border and convey into the bay tile; once in the tile the good is in the estate, and r/c
  have no internal conveyance. Growth/merging, spontaneous commercial spawning, and the triangular
  capacity curve live in [`spontaneous-zones.md`](./spontaneous-zones.md).

### Remaining tuning (decided mechanism, open numbers)

- **Price-field radius `R`** and **fade radius** — the d² shape and the ≥-generation-radius constraint
  are decided; only the actual distance numbers are free.
- **NPC input trickle** — the τ_in and target per site.
- **Consumption allowance rate** — the hourly/daily drip that caps **how luxuriously characters may
  live** when paying for consumption (bread, electronics, EDC — not just "luxury"). Not about
  multi-wallet: the source is the single generic wallet at first.

### Demand origins — projects and spontaneous construction

- The ledger is **origin-agnostic**: it aggregates `NeededGood`s, never a single "project = one bill".
  Demand origins are: (1) player-authored plans (pushed → `ConstructionSiteShell`), (2) spontaneous
  residential constructions (`trySpawnResidentialProject` → `UnBuiltLand` foundation → `BuildDwelling`),
  (3) spontaneous commercial constructions (not yet implemented — will follow the same `Build*` shell
  pattern), and (4) operating demand (transform inputs / storage buffers — a later slice).
- `freightConstructionDemandTarget` already unifies (1) and (2) and tags them with ad-source `'project'`;
  the ledger should reuse the same unification rather than re-enumerating contributor types.

### Terminal goods — where building material's *continuous* demand comes from

Terminal goods fall into two demand channels; the distinction is **one-shot vs continuous**, not "which
character consumes it":

- **Consumption goods** (food, wearables/EDC) → continuous demand from **housing** (pantry targets) and
  **character presence** (personal goods, on-the-go meals).
- **Building material** (wood, stone, planks, concrete, steel) → **two** channels:
  1. **Construction** — one-shot, episodic: the ledger's construction bill (projects + spontaneous
     buildings). Already wired.
  2. **Maintenance** — continuous, rate: the **engineer alveolus is a consumer alveolus** (a
     transform-like production site) whose *inputs are the building materials* it consumes to top up a
     building's `usePoint` (see `docs/commerce.md` §"Maintenance & energy"). This is **not** "engineers
     as characters eating planks" — it is a *building's degradation rate* surfacing as material demand,
     with the engineer as the applying agent. Its inputs enter the ledger as ordinary production demand
     (origin `'production'`), **no separate maintenance origin**.

So "should engineers be consumers of building material?" → **yes, but as the engineer *alveolus*'s
inputs (maintenance), not as character consumption.** The symmetric base load under the construction
spikes is maintenance; both feed the same ledger/price field.

### Sourcing policy for spontaneous construction & growth/shrinkage (proposal)

**Principle: spawn declares demand, sourcing resolves it.** Demand declaration (a `NeededGood` from any
construction) and sourcing resolution (mapping needs → concrete `Source`s) are two separate layers; the
resolution engine is **origin-blind** — it never asks who authored the construction.

- **`resolveSourcing(needs, policy) → SourcingEntry[]`** is a pure, shared function: internal-first (own
  estates after their demand + reserve), then external (NPC settlements by price × stock × distance).
- **`SourcingPolicy`** = `Reserve` + those ranking rules — the **global default**. It already matches the
  3-tier override cascade (global → zone/station → specific good).
- **Where the policy comes from is the only per-kind difference:**
  - *Player-authored project* → optional per-good `SourcingEntry[]` override (else global default).
  - *Spontaneous residential/commercial* → global default; **no per-construction override**.
- Open: where a contributor's *optional* sourcing override lives. For projects it is reachable via
  `shell.hivePlan`; the resolution engine takes a nullable `sourcing` param and falls back to the global
  default when absent — so spontaneous construction needs no per-construction hook.

### Commerce happens at shops, not inside industrial hives (proposal)

- **Industrial hives do not transact with outside carriers directly.** Commerce (buy/sell against NPC
  groups / outside carriers) is the **shop's** job, not the hive's. An industrial hive sources its
  inputs *through* a shop: the shop imports the good (outside carrier), then internal freight moves it
  shop → hive.
- **Shops stock both industrial and consumption goods.** Wood, stone, planks (industrial inputs) sit on
  shelves alongside final consumption goods — a shop is the universal external-commerce interface for
  *both* input materials and finished goods.
- Consequence for `Estate.feedsPriceField`: commercial estates still **do not feed** the price field
  (unchanged), but they are now the *only* boundary through which outside carriers transact — the
  industrial estate's `profile` stays purely its own produce/consume rate + buffer, while the shop is the
  money-facing endpoint.

### Growth = a new construction, not inherited sourcing (corrected)

- **Growth is adding an alveolus to an existing hive — a *new construction*.** Its materials are a fresh
  demand that joins the ledger like any other construction; it does **not** "inherit the parent estate's
  sourcing policy" (earlier framing, superseded). Sourcing policy is always resolved origin-blind.
- **What growth *does* inherit is transport, not sourcing.** A growth alveolus sits inside a hive that
  already has a freight bay + corridors, so its one-shot order rides the *existing* bay/line — no new
  corridor. A remote spontaneous building does **not**, and needs either a temporary corridor or
  outside-carrier delivery (see below).

### Temporary corridors & one-shot transport (player vs automatic)

Construction imports are **one-shot orders** — the decided model already unifies them with recurring
lines: *"one order type, a repeat flag"* (recurring trade lines and one-shot project orders are the same
type, `repeat = false`). Transport for a one-shot order is a **temporary corridor**: vehicles allocated
for the duration, "a resource commitment (like special operations), not a permanent corridor".

So the question is not "line vs no line" but **who authorizes the one-shot order**, and it is answered by
the already-decided acquisition ladder — both ends exist, defaulting to automatic:

1. **Manual purchase order** — player sets good/amount/source/destination/max-price (full control).
2. **Stock-target import** — the construction declares a target; internal supply is tried first, then an
   import up to a cap. This is the `deficit` stop mode ("auto-load the shortfall").
3. **Trade route** — recurring (sustained volume), not one-shot.

**Recommendation (open for endorsement):** the default is **automatic one-shot** (2): resolution is
internal-first ("internal movement before trade"), then a one-shot buy, with outside carriers absorbing
the long leg ("outside carriers come last" is the *fallback order*, not a hard block). The **temporary
corridor is a vehicle commitment**, so it must surface as a cost — it is not silently spawned. Manual
mode (1) is the player override for when they want to pin sources or lay a corridor themselves.

The player-facing dial for how much of this is automatic (settlers vs simutrans) is its own concern —
see [`spontaneous-lines.md`](./spontaneous-lines.md).

### Deferred (keep the seam, do not block)

- **Outside carriers** (end): how they plug into the same trade interface (pseudo-vehicles vs an abstract
  import/export edge).
- **Defense & honesty** (multiplayer): faction "feeling" over buildings/goods; stealing; war-as-decree.

## Price decision

This gathers everything decided and still-open about price. The **automatic field** shape is decided
(flow-rate anchor × stock elasticity — the hybrid below); the **mapping** is exponential; the
**price-setting override** layer is open. In multiplayer, price-fixing also seeds local **stock markets**.

### 1. The automatic price (hybrid: throughput + pressure — decided)

Neither pure flow nor pure stock alone is playable. The **hybrid** is: **flow rate anchors the price,
stock modulates it**. For each good `g`, each actor `s`:

```text
# producer (supply)
base_supply_s(g)      = production rate (units/time)          # structural capacity
stock_factor_s        = stock_s(g) / capacity_s(g)            # ∈ [0,1]  (producer's OWN buffer)
effective_supply_s    = base_supply_s · (0.5 + 0.5·stock_factor_s)

# consumer (demand)
base_demand_d(g)      = consumption rate (units/time)
empty_factor_d        = 1 − stock_d(g) / target_d(g)          # ∈ [0,1]
effective_demand_d    = base_demand_d · (0.5 + 0.5·empty_factor_d)

rateField_g(p)        = Σ_s w(dist(p,s)) · effective_supply_s − Σ_d w(dist(p,d)) · effective_demand_d

price_g(p)            = base_g · exp( −k · rateField_g(p) )
```

- **Flow anchors, stock modulates.** A mega-factory at balance still exerts more spatial pressure than a
  tiny workshop (its `base_supply` is bigger), but a disrupted line (consumer stock → 0) still spikes
  price (`empty_factor → 1`). Both failure modes fixed.
- **Rate and content are structural, not advertised (decided).** The price field reads a hive's
  `{ rate, stock, capacity }` **directly** — *not* from the advertisement board. Advertising
  (`demand`/`provide` + priority) is convey/movement matching only. Stored units count; conveying units
  do not (simplicity).
- **The `0.5` floor.** The `(0.5 + 0.5·x)` form means a fully-empty consumer still *only* demands at
  `base_demand`, and a full producer still *offers* at `base_supply` — stock is an elasticity valve,
  never a hard on/off. This is the tuning knob (`0.5` → `α`); `k` is elasticity.
- **Fill is unclamped (decided).** `stock_factor = stock/capacity` is not re-normalized to `[0,1]`: a
  hive over-producing into a buffer (stock > capacity) drives `fill > 1`, so a producer's effective
  supply can exceed `base_supply`. The `0.5` floor is the only lower bound.
- **Directional for free**: a sawmill is a plank supplier and a wood demander.
- **Frontier fade** scales the deviation → `price → base` at the generated edge.
- `w(d) = max(0, 1 − (d/R)²)`, `R` ≥ generation radius; `dist` = Manhattan/Euclidean at commerce nodes.

### 2. Player price setting (open)

The automatic price is the **base**, but the player may **override** it. Two axes of override:

**A. Generic offset — "±X% from base".** A project (or a global rule) states "sell at +1 % over the
calculated price", with the field still doing all the spatial work underneath. This is the "not-that-bad
default with a twist" knob: one number, no per-good bookkeeping.

**B. Fine-grained per-good, per-place.** Pin an exact price (or offset) for a specific good at a specific
place — full control, only where it matters.

Both layer on top of the field; neither replaces it. The field stays the base; the override is a
multiplier/offset.

### 3. Price setting = demand/offer rate (the insight)

Setting a price is not just a cosmetic number — it **changes the effective demand/offer rate**. Example:
I produce very few machines and have no stock pressure to liquidate, so I price them high; that *slows
my sell rate* (few buyers at that price) but keeps the margin. Conversely, pricing below the field dumps
stock fast.

So the override is really a **rate valve**, not just a number:

- **Above-base price** → sell slowly, keep stock (for scarce goods you don't need to move).
- **Below-base price** → sell fast, clear stock (for surplus you must liquidate).

**Resolved (colleague, endorsed): price is primary, rate is derived.** The player *sets a price* (the
margin is the game: `Profit = Price − TransportCost`); the **clearance rate is a derived, displayed
metric** ("at +15 % markup, ≈ 4.2 units/day"). Letting players set absolute rate caps breaks upstream
buffers when they overflow. The rate valve is an *effect*, not a separate knob.

**Clearance velocity as a function of price (decided).** A node declares a structural **max rate**
`rate_max` (its capacity: conveyor/worker/output-buffer throughput). The actual trade velocity follows:

```text
rate_trade(P) = min( capacity_limit,  rate_max · (base_price / P)^α )
```

- `P` = the offered sell/buy price; `base_price` = the spatial field value; `α ≥ 1` = price sensitivity.
- **At base price** (`P = base_price`): trades at full `rate_max` (the standard throughput).
- **Premium** (`P > base_price`): `rate_trade → 0` smoothly — goods sell slowly, protecting internal stock.
- **Discount** (`P < base_price`): `rate_trade` rises above baseline — stock liquidation.
- **Hard cap** `capacity_limit` clamps the top — a discount can't cause infinite instantaneous throughput.
- **No manual rate caps**: the player sets `P`; the clearance rate adapts automatically on this curve.

This is the concrete "rate valve" from the insight above — price is the lever, the curve is the valve.

**Resolved: overrides feed back into the field.** A +200 % price must *reduce* the `supplyPressure` that
stock radiates; otherwise NPCs still see a cheap abundant market from raw volume, and competitors get
broken signals. (This also seeds local **stock markets** in multiplayer — see below.)

**Resolved scope hierarchy (3-tier cascade):**
1. **Global default** (e.g. +0 % everywhere).
2. **Zone / station override** ("all goods departing *Harbor Hub* +5 %").
3. **Specific good override** ("pin *Machines* at *Harbor Hub* to $450/unit").

This keeps micromanagement low while allowing precision. Open remainder: the exact *shape* of the
feedback term (how an override re-scales `supplyPressure`), and whether the generic offset is project /
line / zone / global scoped.

### 4. One primitive, two metrics

Per structure, per good:

```text
{ rate: delta_s(g), stock, capacity/target, isBuffered }
```

- **Price** = the spatial field of **effective rate** (flow × stock-elasticity) — *value* ("what's it worth
  here").
- **Deficit** = Σ(target − stock) over `2-use` needs — *urgency* ("buy now").
- **Surplus** = Σ(stock − reserve) — export availability.

Price is **flow-anchored, stock-modulated**; deficit/surplus are pure **stock**. Two metrics, one
primitive — no parallel subsystems.

### 5. The ratio paradox → resolved (exponential over flow)

The ratio `(1 + D)/(1 + S)` was designed for normalized `[0,1]` stock. The hybrid switch makes it moot:
**rate** is the anchor, so the natural mapping is the **exponential** form `base · exp(−k·rateField)`.
Doubling production has the exact inverse weight of doubling consumption; price never goes negative nor
plateaus. `k` = elasticity (tuning).

### 5b. In-transit goods are invisible to the price field (decided, endorsed)

Goods in transit (or the mere existence of a transport line) must **never** depress the destination
price slope — otherwise the margin that justified the line vanishes before the first delivery, and a
"ghost line" of routed trucks could freeze out competitors without delivering. Three buckets:

- **Origin physical storage** (factory buffer) → affects **origin** price.
- **In transit / holding** (vehicles on road/rail, **station storage**) → **invisible** to the field.
- **Destination hive's own buffer** → affects **destination** price, **only upon the selling action**
  (ownership transfer into the consumer's internal buffer).

Consequence: a running line settles into a **sawtooth** margin — wide at T0 (empty consumer / full
producer), unchanged in transit, compressed on delivery, re-expanding as the consumer digests stock.
This rewards *small continuous* deliveries over batch mega-trains, and is the core profitability loop.

**The selling action (decided).** A sale is **not** a station unload. It is the exact moment ownership
transfers from the holding entity/station into the producing/consuming hive's **internal buffer** — money
moves and the price field adjusts *only* there. Station storage is "holding", invisible like in-transit.

**Instant spot pricing, no smoothing (decided).** `base·e^(−k·rateField)` is the single source of truth
for all actors; EMA-style smoothing is **rejected** — the hive's own gradual buffer consumption already
produces a smooth price-recovery curve.

### 5c. Only the *hive's own* stock feeds supply/demand pressure (decided)

Refinement to §5b: the stock that modulates supply/demand is the **same hive's own buffer** — the hive
that *produces* (supply) or *consumes* (demand) the good. It is **not** about player vs NPC; it is about
**whose hive the good is in**.

- A train station full of wood next to a sawmill does **not** make wood cheap; if the sawmill's output
  buffer is empty, wood is expensive — regardless of how much wood is parked in the adjacent station.
- Symmetrically, a consumer's **own** buffer drives its demand pressure; goods parked in a *neighbouring*
  structure do not.
- **Not "player vs NPC", but "the producing/consuming hive's own buffer".** A player-owned sawmill's
  buffer *is* a supply signal (it is the producer); a player-owned warehouse full of wood is *not* (it
  neither produces nor consumes wood — it only holds it). The distinction is *role* (producer/consumer vs
  holder), not *ownership*.
- The "station export dock" bucket in §5b is therefore **not** a supply source for the price field; it is
  where goods *wait*, invisible like in-transit. The **producing hive's buffer** is the single supply
  signal at the origin.

This is the concrete meaning of "available supply" (§6): available = **held at the hive that produces
(or consumes) it**, not merely *nearby*, regardless of ownership.

### 6. Production vs stock → superseded by the hybrid (see §1 & §5c)

The earlier "available supply ≠ physical stock" concern is **absorbed** by the hybrid: `base_supply` is
production rate (auto-offered), parked storage contributes 0 rate until *offered*, in-transit is
invisible (§5b), and — per §5c — the only stock that feeds supply/demand pressure is the
**producing/consuming hive's own buffer** (by role, not ownership). No separate rule needed.

- **Houses and commercial zones are consumers (decided).** They feed `effective_demand` exactly like a
  transform does — they are the sink end of the EDC/household flows. Their `consumption_rate` is the
  population-driven demand (food, household goods, EDC) and their `target` is the dwelling/shelf stock.

### 7. Node-scoped computation, not per-tile (decided, endorsed)

Colleague critique, **agreed**. `Σ w(dist)` over every tile × every source is O(tiles × sources) and
won't survive large maps. Restrict the field to **where commerce occurs** — node intersections, stations,
markets, trade points — and use a **Manhattan/Euclidean radius** for the pressure kernel, reserving
road-aware pathfinding for actual **route selection** only.

- **Colour-map / sweet-spot UI is moot (decided).** Neither the price colour-map nor a "sweet-spot
  spotting" overlay appears in gameplay, because **commerce selection is automatic**: the player only
  controls *whether a zone is commercial*; the actual commerces are spawned automatically, and the
  buy/sell selection (for player *and* NPC) uses a **different calculus** (the deficit ledger + sourcing).
  So the field is an internal value, not a player-planning overlay. No UI question remains here.

### 8. Local stock markets (multiplayer) — seeded by feedback

Because overrides feed back into the field, a player's ask/bid price becomes **visible to others** at a
place. Aggregated over a trade point, that is a local **stock market** — no new machinery, just the
feedback term. Note as a multiplayer consequence; no single-player action needed.

### 9. Fill fraction vs absolute quantity (stock/capacity)

`2/10` and `20/100` are the **same fill fraction** (0.2) — and that is correct *for price*, because the
stock factor is a **dimensionless eagerness/deviation-from-rest** signal. But they are **not** the same
*absolute availability* (8 vs 80 units) — and that is a **different axis**.

- **Price** reads **fill fraction** (scale-free): 2/10 == 20/100 for the `0.5 + 0.5·fill` elasticity. The
  *scale* difference between the two actors is already carried by their **flow rate** (`base_supply`/
  `base_demand`), not by stock.
- **Availability** reads **absolute quantity** (`stock − reserve`, or `capacity − stock`): how much can
  actually be bought/sold in a trip. This belongs to **sourcing / stop capacity / quotas**, not the price
  field.

Two axes, never conflated: **fill fraction → price (eagerness)**, **absolute quantity → sourcing (how
  much is actually there)**. The only ambiguous case — same rate, different capacity — is resolved by the
  fact that capacity is a *buffer size*, affecting only how quickly the actor fills/stalls, which the flow
  term already reflects.

## Plan

Agreed order: **questions → structures/interfaces → implementation**.

1. ~~Answer the M7 leftovers~~ — **all answered** (crossing/elevation + shortage presentation resolved).
2. **Draft interfaces** — unblocked *now* (energy and the wallet question are decided):
   - `NeededGood = { good, quantity, priority: '0-store'|'1-buffer'|'2-use' }`, declared by **one
     contributing object** (a project, alveolus, construction site, road, …) — no separate `origin`
     enum, no `source` field; the object *is* the origin. Only `2-use` is sourced from outside. Energy is
     **not** an origin: hauled energy (fuel) is a transform input → a `production` need declared by the
     consuming alveolus; continuous energy is a rate-balance, not a stored deficit.
   - `NetDeficit` — **board/group-scoped**, not per-hive: a road, city demolition, or standalone
     construction site is a spatial contributor with no hive. Aggregated over all contributing objects
     (player + NPC).
   - `StopMode = 'deficit'|'surplus'|'explicit'` (a per-stop behaviour); `Reserve` = the resting
     amount / keep-target (`defaultReserve` = the fallback keep-target).
   - `SourcingEntry = { good, source, quota }`; `ProjectSourcing`.
   - `Wallet { name }` — **one wallet even in development**; multi-wallet is an internal engine
     capability (future multiplayer / diplomacy), discussed/implemented later. Single-player forces one
     invisible `"general treasury"` (no UI). `Transfer` = the salary + consumption drip.
3. **Implement** the first-playable slices.

### First playable slices

- **Ledger v1** — real `requiredGoods` bill → `Hive.needs` field → one `deficit` stop imports a shortfall.
- **Sourcing v1** — one project with a two-source quota (own hive + NPC settlement), editable mid-run.
- **Reserve v1** — one buffer with a reserve knob that blocks over-export and caps over-import.
- **Price-field v1** — the d² + frontier-fade field, wired to `Hive.needs`' surplus/need.
- **Maintenance v1** — one building with a usePoints life level that engineers can top back up
  (the M1/M4 model is decided; this slice is a job + decay probe).
- **Salary v1** — one wallet drip that lets a character buy food at an NPC city.

---

## Remaining points (summary)

Open questions and open numbers only — everything architectural is decided.

**Open questions (small, none block the ledger):**

- **Price override** (§3): the generic-offset scope (project / line / zone / global). *(The feedback-term
  shape is resolved — the clearance curve `rate_max·(base/P)^α` is the valve; §3.)*
- **Deferred seams:** outside carriers (end-game); defense/honesty (multiplayer).

**Open numbers (decided mechanism, tune later):**

- Price-field radius `R` + fade radius. **`fadeRadius` and generation must be tuned *together***: the
  frontier fade has to reach the generated map edge, so `fadeRadius` tracks the generation radius/frontier
  — the two are coupled, not independent knobs. The price field is computed over the *live* generation
  frontier, so changing generation scales must re-tune `fadeRadius` in lockstep (and `R` stays ≥ the
  generation radius per the original constraint).
- NPC input-trickle `τ_in` + target.

**Reserve ≡ the `1-buffer` target (decided).** The sourcing `Reserve` keep-target ("don't export below
it, don't import above it") is **the same number as a storage's `1-buffer` target** (`StorageAlveolus.
storageBuffers`). It is one knob with two names (commerce-facing vs storage-facing), **not** a second
field. Sourcing reads the keep-target via `internalSourceAvailability(stock, ownDemand, reserve)`;
`reserve` resolves to `Reserve.perGood[good] ?? defaultReserve` — and for a buffer, that default falls
back to the buffer target, not a new global.
- Consumption **allowance rate** (the inverted-tax drip — caps how luxuriously characters live; source
  = the single generic wallet).
- Elasticity `k` and the `0.5` stock-elasticity floor.
- Price sensitivity `α` and `capacity_limit` per node type (the clearance curve).

**Next step:** draft the interfaces (step 2) → Ledger v1.
