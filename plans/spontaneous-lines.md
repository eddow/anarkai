# Automatic spontaneous line creation — transport automation

> Open questions and proposal. Decided parts migrate to `docs/` when settled.

## Why

Two play-styles live on the same autarky dial (see [`docs/commerce.md`](../docs/commerce.md)):

- **Simutrans** end — the player hand-builds the transport network; every line, corridor, and order is
  authored.
- **Settlers** end — the group largely runs itself; construction, commerce, and the freight that
  satisfies them are mostly automatic.

Manual-only ordering is paperwork — a risk the docs already flag ("too much order management can become
paperwork if every small import requires manual setup"). Automatic line creation is the mechanic that
lets a settlers-leaning player delegate transport without becoming simutrans.

## What it is — and what it is not

"Spontaneous line creation" = the engine autonomously materializes the **one-shot orders** and
**temporary corridors** that the deficit ledger + sourcing resolution already call for, instead of
requiring the player to author each one.

It **reuses** the decided *"one order type, a repeat flag"* model, with a hard line drawn:

- a construction import is a **one-shot order** (`repeat = false`) — **automatable**;
- a **temporary corridor** is a vehicle commitment for that order's duration — **automatable**;
- a **recurring line** (`repeat = true`) is **never automated** — always player-authored.

So automation covers **ad-hoc, one-shot transport only**; the permanent network is always hand-built.

### One-shot lifecycle (decided)

A one-shot line (`repeat = false`) **self-deletes** after its own fulfillment, or on abortion (any
exception / terminal reason — the deficit it was created for vanished, no source/destination, etc.).
"Fulfillment" = the deficit this line was spawned to cover is now `0`.

**Spawn rule (decided):** when a good's need (construction, operating demand, …) has **no line and no
delivery** already covering it, the spawner either:

- **creates a one-off line** (self-haul: source bay → destination zone/shell), or
- **orders a delivery** (`buy` + an outside carrier brings it) —

chosen **along configuration** (the internality slider / cost threshold decides which). Both are
one-shot orders under the hood; a "delivery" is the external-carrier variant of the same order type.

**Provisional internality rule (implemented now, pending the full cost formula).** Until the ratio
form is wired, the slider acts as a simple preference, gated on `autoBuy`:

- `internality ≥ 0.5` → **self-haul first** (one-off line with a free vehicle), delivery only as fallback;
- `internality < 0.5` → **delivery first** (buy from the nearest/cheapest NPC settlement, spend VP,
  credit the construction site), one-off line only as fallback.

This is deliberately coarse; the log-odds cost threshold below replaces it once delivery has a real
physical carrier (outside-carrier travel) rather than an instant credit.

**One-shots always occur.** Estate growth and residential/commercial buildings are built *automatically*
(they are not authored by hand), so a new spontaneous construction always produces a one-shot order —
even for a player who hand-controls every aspect of transportation. The transport-automation controls
decide *how that order is fulfilled* (temporary corridor vs outside carrier), never *whether* the need
exists.

## The internality slider (internal transfer vs local commerce)

Automation is not a binary. It is a **slider** because vehicle allocation is itself a cost: how far a
good must travel, how many vehicle-hours are consumed, and what is gained by moving it internally versus
buying/selling it locally. The slider expresses **how eagerly the group commits vehicles to internal
transfer instead of leaning on local commerce**:

```
internalize everything ◄──────────────────────► rely on local commerce
   (self-haul, own corridor)              (buy/sell locally, outside carriers)
```

- Toward **internalize**: more internal transfer, more temporary corridors, more vehicle-hours committed.
- Toward **local commerce**: fewer corridors; the ledger's internal-first resolution gives way sooner to
  buying locally (outside carriers absorb the long leg), which is cheaper in vehicle-hours but pays the
  local price spread.

This is the same cost trade the docs already describe ("own the corridor only when sustained volume
justifies dedicated transport; otherwise trade across the boundary") — the slider is the player's lever
on *where that threshold sits*.

### Narrowing cascade (general → category → per good)

The slider follows the **3-tier cascade used everywhere else** — each tier overrides only what it needs,
falling back to the tier above:

1. **General** — the global default (one scalar + its min/max bounds).
2. **Good category** — overrides for a category (industrial, food, EDC, …), only the fields it sets.
3. **Per good** — fine-tuned overrides for a single good, only the fields it sets.

This cascade **already exists as a component** — the freight line load/unload tuning (`GoodSelectionPolicy`
in `ssh/freight/goods-selection-policy.ts`) is exactly `defaultEffect` (general) → `tagRules` (category)
→ `goodRules` (per good), resolved most-specific-first. The transport-automation slider should reuse the
same three-layer shape (and ideally the same override machinery) rather than inventing a new one.

### Unit (decided direction): cost threshold

Outside-vs-inside carrier is a **0..1 slider** whose meaning is a **cost threshold** — "how much vehicle
cost am I willing to absorb before buying locally" (0 = always local, 1 = always internal).

The open question is now the **cost calculation itself**. Proposal:

### Cost formula (proposal — the ratio form)

For a one-shot order (good `g`, quantity `Q`, at destination `D`), the engine compares two costs:

```text
vehicle_cost     = distance(origin, D) × vehicle_hours_per_unit × Q     # self-haul corridor
spread_avoided   = P_local(D, g) × Q                                     # local buy price avoided
```

`spread_avoided` is the money you *save* by self-hauling instead of buying locally — the local price of
the good at the demand site (`P_local(D, g) = base · exp(−k·rateField)`, the decided spatial price).
Internal self-provision is "price 0 + corridor cost", so the internal side of the spread is 0; the full
local price is the spread.

The raw cost ratio is `r = vehicle_cost / spread_avoided`:

- `r < 1` → self-hauling is cheaper than buying locally;
- `r > 1` → buying locally is cheaper.

The slider `s ∈ [0,1]` maps to a **tolerance multiplier** via log-odds, so the decision is:

```text
internalize (self-haul)  ⟺  r < s / (1 − s)
```

| `s` | multiplier `s/(1−s)` | effect |
|---|---|---|
| 0.00 | 0 | never internalize (always buy locally) |
| 0.50 | 1 | pure cost comparison — the neutral default |
| 0.75 | 3 | willing to spend up to 3× the spread on vehicles |
| → 1 | → ∞ | always internalize |

This gives the slider a concrete, dimensionless meaning — *"up to X× the avoided price spread in vehicle
cost"* — and `s = 0.5` is exactly the cost-neutral default. Per-category / per-good overrides just
change `s` (hence the multiplier) for that slice, reusing the `GoodSelectionPolicy`-style cascade.

**Hard bounds** still clamp the extremes regardless of the ratio:

- `max_internal_transfer` — a ceiling on total committed vehicle-hours (fleet over-commit guard);
- `min_local_provision` — a floor guaranteeing some goods still transact locally (markets stay relevant).

The ratio decides *each* order; the bounds decide *aggregate* behaviour.

**Open inside the formula:** the exact `vehicle_hours_per_unit` rate (and whether labour enters
`vehicle_cost`), and whether `P_local` is the instantaneous spot price (decided "no smoothing") or a
short average.

## Hard bounds (min/max) on top of the dial

A plain slider is too loose; it needs **hard min/max limits** so the automatic behaviour never runs
away in either direction. The full control is therefore a **slider + clamped bounds**:

- **max internal transfer** — a ceiling on committed vehicle-hours / corridor count (never over-commit
  the fleet);
- **min local provision** — a floor guaranteeing the group still *sells/buys locally* (never fully
  self-haul, so local markets stay relevant);
- the slider positions the default between these bounds.

The bounds are the "hard limits"; the slider is the "soft preference".

## Outside carriers + wallet

Outside carriers are **part of the same controls**, not a separate switch:

- the **slider + min/max** decide *when* the engine falls back to outside carriers instead of a
  temporary corridor;
- a **wallet / budget** the automatic one-shot orders may draw from caps how much the group spends on
  (external) procurement without the player's explicit sign-off — the ceiling on auto-spend.

Together: slider picks the internal-vs-local bias, bounds clamp the extremes, the wallet caps auto-spend,
and recurring lines stay manual.

## Spontaneous vs authored

- **Player-authored project** → may carry explicit sourcing + a hand-laid corridor (full control).
- **Spontaneous residential/commercial** → rides the automatic ladder, clamped by the slider/bounds and
  the wallet.
- **Growth** (add an alveolus to a hive) → rides the *existing* hive bay/line; no new corridor.

## Multi-modal & feeder/trunk (boats, trains, planes)

**The automation is mode-agnostic, but it never plans multi-modal routes — it *composes* with the
player's lines.**

The half-simutrans player already has a way to express multi-modal transport: they hand-lay a trunk
(e.g. a train "wood" line from station A to station B). The automation's job is **not** to invent that
trunk, but to **use it as the long leg** and fill only the unserved feeders with automated one-shot
trucks:

```text
source → [auto truck] → station A → [player train] → station B → [auto truck] → demand
  feeder                    trunk                      trunk               feeder
```

- The **player's permanent lines are the trunk network**; the **automatic one-shot corridors are the
  feeders** (last-mile to/from stations). No multi-modal route *planning* is automated.
- "Internal-first" resolution then reads: *is there a path through the existing line network from a
  source to the demand site?* If yes, use it (trunk + auto feeders); if no, self-haul by truck corridor
  or buy locally / outside carrier — the same cost ratio decides the latter.
- Consequence: the **cost formula** already extends naturally — `vehicle_cost` becomes the *feeder legs
  only* when a player trunk exists (the trunk is already committed), which makes internal transfer
  systematically cheaper and thus encourages the simutrans play of building a backbone and letting
  feeders auto-fill. The trunk is not free at the margin (capacity), but it is already sunk/committed.

So there **is** a point to it, but the point is *simpler* than full automation: the automation never
crosses modes on its own; it treats the player's network as a black-box trunk and does truck feeders.

**Automated one-shot corridors are road-only (decided).** The automation materializes **trucks on
roads** — it never creates a train/boat/plane service. Rail, water, and air are the player's *permanent
trunk* network (hand-built, recurring); the automatic layer is road feeders only. So the mode split is
categorical, not a dial: automated = road, trunk = player-chosen mode.

## People (passengers) — defer

**Defer passenger automation, but keep the seam.**

- People displacement (commuting, public transport, happiness travel) is a **parallel concern**, not a
  blocker for goods transport automation.
- The one thing to preserve now: the **line/order representation must stay payload-agnostic** (goods vs
  people) so passenger flows can ride the same "one order type, a repeat flag" + feeder/trunk machinery
  later without rework. The current freight line model already names only goods; note the payload
  seam but do not design passenger automation yet.
- When it returns, the same internality slider and feeder/trunk composition apply, but with different
  *cost* inputs (time, comfort, walking distance) instead of a price spread.

## Proposed lines (widget, not auto-promotion)

Recurring lines are **never auto-created**, but the engine *proposes* them: when a corridor's volume
stays above a threshold, it is surfaced in a dedicated **"Proposed lines" widget** the player can open.
The widget lists each candidate (origin → destination, good, observed volume) and the player accepts or
discards — promotion to a permanent line is always a player decision.

## Open questions

- **Cost formula** — the ratio form is proposed (see "Cost formula"); open inside it: the
  `vehicle_hours_per_unit` rate (does labour enter `vehicle_cost`?), and whether `P_local` is the
  instantaneous spot price or a short average.
- Is the **wallet/budget** a single shared pool, or a per-good / per-zone budget? (Docs already decide
  "one wallet" — this is the *auto-spend ceiling* over that wallet, distinct from the balance itself.)
- How the **internality slider** interacts with the per-good **autarky dial** (`dependency(g)`): is the
  internality slider global (with category/per-good overrides), while `dependency(g)` stays per-good?
- How a temporary corridor's **cost** (vehicle-hours) is surfaced without becoming paperwork.
- **Trunk capacity**: when a player line is used as the trunk, what marginal cost/capacity does it
  impose on the one-shot feeder (or is it treated as free committed capacity)?
- **Passenger payload seam**: the line/order representation stays goods-typed today; confirm it can stay
  payload-agnostic so people transport reuses it later without rework.
- **Threshold** at which a corridor is *proposed* to the player (it is never auto-created).
- **Outside-carrier vs self-haul split** for spontaneous constructions. Proposal: spontaneous =
  outside-carrier delivery by default (cheap in vehicle-hours), with the slider pulling toward
  self-haul only when the player biases internalize.

---

## Task summary — one-shot mechanism (done & working)

The full one-shot (`repeat: false`) mechanism is implemented, wired to the ticker, and covered by
end-to-end tests.

**Landed**

- **Lifecycle** (`one-shot-lines.ts`): `isOneShotLine` / `lineUnloadGoods` / `oneShotLineFulfilled` /
  `sweepOneShotLines` — a one-shot line self-deletes once the deficit it covers is `0`, or on abortion
  (no stops).
- **Self-haul spawner** (`trySpawnConstructionLines`): routes a `repeat: false` line from the nearest
  producer/holder hive bay (stock above reserve) to a radius zone over the construction site, using only
  *free* vehicles. **One line per need/destination** — concurrent same-good constructions are served
  independently.
- **Delivery branch** (`trySpawnConstructionDeliveries`): the external half of the internality slider —
  buys from the nearest/cheapest NPC settlement and credits the site (instant credit, `spendVp` +
  `storage.addGood`). **One delivery per need**, subject to the wallet.
- **Destination-aware dedup guard** (`hasTransportCoveringNeed`): a line for site A no longer blocks
  site B needing the same good (the old good-scoped guard deadlocked two concurrent constructions).
  Non-radius lines (bay↔bay / named-zone) still count conservatively as covering.
- **Ticker** (`OneShotLineTicker`): reads `game.transportAutomation` live each pass; `autoSpawn` /
  `autoBuy` are independent toggles, `internality` orders self-haul vs delivery, `spawnCooldownSeconds`
  is the pass cadence; sweeps every pass. Registered on `Game` after world generation.
- **Config** (`Game.transportAutomation`): reactive, seeded from `commerce.transportAutomation`.

**Tests** (`tests/unit/one-shot-lines.test.ts`, 11 passing): identification, fulfillment/sweep, spawn,
recurring-line dedup, reserve keep-back, config seeding, delivery, delivery dedup, **multi-need spawn**,
**multi-need delivery**, and an **end-to-end ticker spawn→fulfill→sweep** loop.

**Still open (unchanged, later slices)**

- The **physical outside carrier** behind delivery (buy+credit is instant — no travel/carrier entity).
- The **cost-threshold formula** (log-odds ratio form) once delivery has a real carrier.
- The **internality-slider UI** (player-facing control; the config knob exists but no UI branches it).
