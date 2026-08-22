# Commerce — working notes

> TODO, unresolved questions, and reflections. Conclusions go to [`docs/commerce.md`](../docs/commerce.md).

Current focus: **how to organise commerce** — the produce/transport/trade decision, the net-deficit
ledger, and how projects feed demand into it.

## Open questions

### Maintenance & energy (new — exposed, not decided)

- Maintenance is a **fifth demand origin** (recurring parts/tools consumption: a sawmill's saw blade →
  metal → mine → tools — the bootstrap circularity). Energy is a **transmitted** resource whose sources
  may be goods (petrol), networks (axle/air/wire), or both. Buildings consume energy + upkeep on top of
  transform inputs. Full framing + M1–M5 questions in
  [`commerce-architecture.md`](./commerce-architecture.md).

### Buffer layer vs commerce

- The storage-**buffer** layer (keep-targets, `minSlots`/`maxSlots`, general slots, specific-storage
  buffers) already moves goods internally (money-less). The new **sourcing/commerce** layer also moves
  goods (with money, across the group boundary). These overlap — determine the boundary clearly or the
  buffer+commerce combo swallows the commercial game. See the think-tank brief
  [`commerce-architecture.md`](./commerce-architecture.md), especially **price determination**
  (single-player has no stock exchange) and the buffer-vs-commerce seam.

## Decided direction, details to finalize later

### Net-deficit ledger

- Direction decided: need/excess is computed as a **continuous field** out of NPC + player structures —
  both sustained (production, consumption) and exceptional (projects). No per-region cell bookkeeping.
- Direction decided: **reserve is the single knob** — it protects against over-export *and* caps
  over-import. Price caps and per-good opt-ins are later refinements.
- Direction decided: **internal movement before trade** — meet a need internally (transport) when
  possible; only fall back to trade when internal supply/transport can't cover it.
- Direction decided: **stop modes** = `deficit` (auto-load the shortfall, default), `surplus` (sell
  above reserve), `explicit` (hand-authored).
- Direction decided: **arbitrage** never feeds the ledger (it is profit, not need). It has a
  "not-that-bad" default, but the Simutrans-like buy-here/sell-there commerce game is the **player's
  decision**.
- Direction decided: **source choice UX** = a "not-that-bad" automatic default + optional optimisation
  (same guardrail as everything else).

### Commercial zones & outside visitors

- Direction decided: **NPCs can attend our commerce zones** and spend money when acquiring what is sold;
  clan characters acquire the same goods **without** any money transfer. Commercial zones are therefore
  slightly configurable — whether they accept **outside commerce** and which **types of goods** they
  expose.
- Direction decided: commercial zones **rest at a field-derived equilibrium**, not a fixed 50 %:
  `equilibrium_g = supplyField_g / (supplyField_g + demandField_g)` sampled at the shop (self excluded) —
  near producers it rests full, near consumers empty; the further from production the lower the
  spontaneous delivery. The player can buy from a shop *and* provide to it (a commercial production
  line); the deviation from the equilibrium is the buy/sell signal. The trickle rate is uniform; distance
  is carried by the target.
- Direction decided: commercial-zone **capacity is elastic** — it grows with cumulative delivered volume
  (mid/long-term), while the equilibrium stays anchored, so the headroom above equilibrium is the shop's
  **spontaneous demand**. Sustained provision grows the market: a bigger shop is a stronger demand source
  → larger price gap, higher prices. *(Open tuning: gradual drift vs step-upgrades.)*
- Direction decided: commercial zones **spontaneously open** shops/courses/venues by long-term local
  need (like residential zones), but demand is not assumed satisfied — randomly generated NPC characters
  still need goods their city lacks; tourism and **personal transport** (player bus lines) close the gap
  (the hippie inbound-desirability economy).

### Money budgeting

- Direction decided: start with **one big wallet**; a later pass lets users sub-divide into custom
  purses (defaulting projects to one, recurrent transfers between purses, …). Fine-tuning is opt-in.
- Direction decided: **luxury consumption is budgeted through a wallet** (or a level) fed by a periodic
  **hourly/daily transfer**. That transfer regulates daily consumption spending — an *inverted tax*:
  instead of taxing income, you drip an allowance into the consumption purse.

### Price UI exposure

- Direction decided: price is a **field** (like terrain height or temperature) derived from sources and
  sinks. The Simutrans-like commerce game will need a **tainted colour-map** overlay to plan transport
  for profit. Exact UI is to finalize later.

### Produce / transport / trade

- Direction decided: a clan owns vehicles and can allocate them to **recurrent traffic** or **local
  maintenance** (like the current wheelbarrow grabbing/providing). The corridor cost model is vehicle +
  labour competing with the local price spread.
- Direction decided: **internal movement before trade** — when a need can be met internally, transport
  is preferred; trade is the fallback. This is the automatic default of the produce/transport/trade
  decision.
- Direction decided: every decision carries a **"not-that-bad" generic default**, so the game works
  without tuning and optimisation is always optional.

### Project sourcing (replaces the mis-framed "sustained volume")

- Direction decided: a project's bill is not a flat `{ good: qty }` — it is a set of **sourcing
  requirements**: "buy X units of good G from source S", and a good can be split across several sources
  with **quotas** (partial self-provision: own forester 40 + NPC settlement 60).
- Direction decided: **quotas stay editable while the project is ongoing** — re-pin sources and amounts
  as the project runs (not frozen at push).
- Direction decided: **sources** = own hives, NPC settlements, NPC production hives, and (multiplayer)
  other players' settlements. Internal source = price 0 + corridor cost; external = price + distance.
- Direction decided: resolution is **internal-first**: own hives first (after their own demand + reserve),
  then external sources ranked by price × stock × distance; `quota: 'rest'` = "fill the remainder here"
  is the automatic default.
- Direction decided: sourcing is the **resolution of the net-deficit ledger**, not a parallel system — a
  manual quota is an `explicit` override of the internal-first default.
- Direction decided: **vehicles are allocated to temporary corridors** for project-bound transport — a
  resource commitment (like special operations), not a permanent corridor.

### Special operations

- Direction decided: project ≈ special operation; placeholder is currency-account delta + project
  creation. The per-op list + cost is to be written later.

### Happiness model

- Direction decided: one aggregate number (0–100% → trust delta −1…+1). Later: per-character preferences
  (coffee/tea, mayonnaise/ketchup) averaged into one score; satisfaction-curve shape (diminishing vs
  binary, substitutable vs named) deferred with it.

### External commerce

- **NPC stock/consumption numbers**: mechanism decided — rest state is **full output / empty input**;
  the only automated, memoryless process is a slow **input trickle**
  (`input += (target − input) · (1 − 2^(−dt/τ_in))`) that keeps an idle site alive but is deliberately
  poor (real throughput needs player-supplied input). The exact τ_in and target are to tune later.
- **NPC production elasticity**: decided — throughput grows with **cumulative input supplied** (mirror of
  commercial-zone capacity elasticity). Open tuning: gradual vs step; what scales (throughput vs output
  ceiling vs input demand); and the **competition tension** (a grown NPC producer is a better source *or*
  a stronger competitor).
- **Outside carriers**: deferred to the end — how they plug into the same trade interface as local
  freight (pseudo-vehicles vs an abstract import/export edge).

## Reflections

- Internal edges cancel: summing all demand and all local supply nets internal producer→consumer pairs
  to zero, leaving only the **external deficit**. "Import" is just that deficit routed to a trade stop.
- The three "import" cases — construction recipe, production input, storage buffer — are **three origins
  of one demand**, not three mechanisms.
- Projects are a **forward declaration of demand** (a `HivePlan` bill) — see `docs/projects.md`. They
  feed the ledger before anything is built.
- Produce/transport/trade is the **spatial twin** of the net-deficit: a good can be in surplus at its
  producer and in deficit at its consumer simultaneously; trade wins when the price spread is thinner
  than transport cost.
- The existing `Hive.needs` already aggregates demand ads; it is the seed of the ledger, not a new
  subsystem to invent.
- **Consumption closes the loop**: construction and production are the *means*; consumption (EDC +
  household provisioning) is the *end* that yields happiness. Happiness is the payoff that turns the
  whole logistics net into a game, not just a transport puzzle — and it is itself a demand origin
  (pantry/shelf targets) feeding the same ledger.
- **Happiness → trust → freedom** (decided): happiness is the humans' verdict on the AI's work; it
  accumulates as **trust**, which is a *mana*-like resource that buys the AI **freedom** to perform
  special operations without asking. Special operations are **extraordinary resource allocations**
  (currency, goods, manpower) — e.g. founding a settlement or emptying the account — not everyday
  logistics. Happiness also drives **population** and is a **losing condition** (too low → the AI is
  disconnected). A future layer models the humans' zeal to protect the commons (defense/forces +
  honesty), seeded by the same trust.
- **Distribution (decided)**: both channels. Commercial zones carry personal goods (heating panties,
  watches, in-city meals/coffees); homes receive household goods (appliances, food ingredients) by
  delivery. People pick a home for sleep/homish/free time by availability, building quality/level, and
  content (food, games, …).
- **Consumption as demand origin (decided)**: produce the good locally, or keep it in stock at a
  distribution center whose "provide" lines refurnish shops + homes, with a buy trigger on depletion.
  Recurrence is settled — happiness is maintenance.
- **Trust economy (decided)**: single pooled number — happiness 0–100% → trust delta −1…+1.
- **Population (decided)**: happiness alone drives in/out-migration and birth rate.
- **Losing condition (decided)**: progressive — fewer projects available (slow slope), not a cliff.
- **Defense & honesty (decided as future)**: multiplayer-only. No ownership — factions hold a "feeling"
  toward buildings/goods ("ours"/"not"). Stealing = taking "ours" for "him". War = appropriating a hive
  by decree; armed forces contest occupation before work is allowed.
- **External commerce (decided)**: one immaterial currency (bitcoin-like). NPC groups hold real stocks
  with min/max + natural consumption (rest = full output / empty input; the only automated change is the
  slow input trickle, like unstored goods' memoryless inflow) — well-stocked sites drop in price and
  surplus "disappears" from spontaneous local sales. Outside carriers come last; everything
  can be done locally *or* bought. Money is integrated on both continuous commerce (transport lines,
  transform-hive price spreads) and one-shot project windows, plus consumption spending (household
  appliances, EDC luxuries).
- **Money budgeting (decided)**: one big wallet first; sub-purses (project-default, recurrent transfers)
  in a later pass.
- **Price UI (decided)**: price is a field (like terrain height/temperature) from sources/sinks; a
  tainted colour-map overlay for transport-for-profit planning.
- **Vehicle allocation (decided)**: a clan's vehicles serve recurrent traffic or local maintenance
  (wheelbarrow grab/provide); corridor cost = vehicle + labour vs local price spread.
- **Defaults (decided)**: every decision has a "not-that-bad" generic default; optimisation is always
  optional.
- **Net-deficit ledger (decided)**: need/excess is a continuous field computed from NPC + player
  structures (sustained + exceptional like projects), not per-region cells. Reserve is the single knob;
  internal movement before trade; stop modes = deficit/surplus/explicit; arbitrage never feeds the
  ledger (Simutrans-like commerce is the player's decision). Source choice UX is an automatic default +
  optional optimisation.
- **Outside visitors (decided)**: NPCs attend our commerce zones and spend money on what they acquire;
  clan characters take the same goods without money. Commerce zones are configurable (outside-commerce
  on/off, exposed good types).
- **Money budgeting (decided)**: one big wallet first; sub-purses (project-default, recurrent transfers)
  in a later pass. Luxury consumption is budgeted by a wallet/level fed by an hourly/daily transfer — an
  inverted tax that regulates daily consumption spending.
- **Per-character spending = "salary" = the skip-SimCity lever** (new insight): what a character is
  allowed to spend in NPC/other-player settlements is effectively their **salary**. At the commerce
  extreme of the autarky dial, the player does not build production/distribution at all — they hand
  characters an allowance and let them satisfy needs by buying directly from NPCs. The salary (the same
  hourly/daily drip as the luxury wallet) becomes the single knob that *replaces* the whole
  internal-production game. This elevates "individual spending" (currently deferred in `races.md`) from
  a stranded-driver niche to a first-class, extreme-dial playstyle.

## TODO

- [ ] Unify the ledger: replace `HivePlan.requiredGoods` stub with a real recipe-sum bill + configured
      operating demand.
- [ ] Make `Hive.needs` the single net-deficit computation as a continuous field over NPC + player
      structures (`{ good, quantity, origin }`).
- [ ] Add `deficit` stop mode (default load selection = import the shortfall).
- [ ] Surface reserve as the first-class knob ("don't sell below this").
- [ ] Decide buffer-vs-commerce boundary (see multiple-choice below).
- [ ] Answer maintenance/energy M1–M5 (fifth demand origin + power question — see
      `commerce-architecture.md`).
- [ ] (Later) commerce-zone config: outside-commerce on/off + exposed good types.
- [ ] (Later) write the special-operations list + per-op cost (bound to projects).
- [ ] (Later) tune the luxury-wallet hourly/daily transfer rate.
- [ ] (Later) tune NPC input trickle (τ_in + target per site).
- [ ] (Later) happiness refinement: per-character preferences, satisfaction curve.
- [ ] (End) outside carriers.
- [ ] (Far future) defense/honesty layer (multiplayer).
