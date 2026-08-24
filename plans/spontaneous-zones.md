# Spontaneous zone management — residential & commercial

> Open questions and proposal. Decided parts migrate to `docs/` when settled. This is the **SimCity
> half** of the game — zones that deploy and grow *without* the player authoring each building — as
> opposed to player-authored hives (see [`projects.md`](./projects.md)) and hand-built transport
> (see [`spontaneous-lines.md`](./spontaneous-lines.md)).

## Scope

Three automatic, zone-driven behaviours live here:

1. **Spontaneous residential** — housing spawns when population pressure rises (already seeded:
   `trySpawnResidentialProject` in `residential/demand.ts`).
2. **Spontaneous commercial** — shops spawn near production/consumption (not yet implemented).
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

## Growth & shrinkage

A building grows by **merging with an identical neighbour** — two 1-tile wood shops merging into one
2-tile wood shop is a valid growth transformation. Growth is therefore a *footprint* change on an
estate, not a fresh construction (though its *materials* are still a one-shot order into the ledger).

### Benefit is triangular

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
