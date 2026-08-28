# Districts

A **district** is a per-tile, per-owner land-use designation. It answers *"can a house / shop spawn
**here**?"* — the SimCity half of the game — and is deliberately **not** a runtime object.

This replaces the former "residential / commercial / harvest zone" (and "zoning") terminology.

## Core model

- A district is a **value on a tile**, not an object:
  ```text
  Map<owner, DistrictKind>
  ```
- `DistrictKind = 'clean' | 'residential' | 'commercial'`.
  - `clean` (formerly `harvest`) — prioritize cutter/chopper work on these tiles.
  - `residential` — housing may spawn here.
  - `commercial` — shops may spawn here.
- A tile with no district entry for an owner is simply un-designated for that owner.
- **No runtime objects**: the spawners read indexed coordinate lists (`residentialCoords` /
  `commercialCoords`), not per-district objects. Districts have no identity, no name, no color, and no
  widget of their own.

## Ownership

- The player paints districts.
- An NPC settlement is an "owner" too: it carries its own districts over its tiles.
- Because designation is an **owner-keyed map**, a single tile can be `residential` for settlement X **and**
  `commercial` for the player simultaneously. (Single-player doesn't expose the concurrency; keep the
  per-owner map as the canonical shape so multiplayer doesn't need a later migration.)

## Relationship to plots

Districts are not typed by plots, and a district is not a plot. A [plot](./plots.md) widget may offer a
button to set the district kind of **all tiles in the plot** in one action (bulk re-designation), but the
district value itself stays per-tile and owner-keyed — the plot is only a convenient grouping for the edit.

## Spontaneous spawning (the SimCity half)

Districts drive the spontaneous spawners:

- **Residential** — housing spawns when population pressure rises (`residential/demand.ts`).
- **Commercial** — shops spawn near production/consumption (`commerce/commercial-demand.ts`).
- **Growth & shrinkage** — a building merges with identical neighbours or sheds tiles (triangular
  capacity).

See [`../plans/districts.md`](../plans/districts.md) for the plan and open questions.

## The nudge model (spontaneous spawn signal)

The signal that drives **both** residential and commercial construction is a **nudge**: a per-good,
per-tile, **decaying** accumulation of unmet demand *and* unspendable surplus. A nudge answers "is there
a recurring shortfall or glut here that a new (or bigger) distribution point would fix?". It lives **in
tiles**, not in plots — the commercial-plot property widget is removed.

### Origins

A nudge is emitted by every entity whose need or excess cannot be satisfied through what already exists:

- **Factories / transforms** — an input it cannot get, or an output it cannot move.
- **Characters** — personal needs they cannot reach (food-to-go, clothing, EDC, …).
- **Houses / dwellings** — pantry targets that go unfilled (house-cloth, food ingredients, …).
- **Housing itself** — a character without a home nudges **residential** districts (a dwelling), not a shop.

**Shops emit nothing.** A shop's own restock shortfall is *not* a nudge for a *new* shop — the existing
freight/sourcing spine handles restocking. Nudges spawn and grow distribution points; they do not cascade
from distribution points.

### Surplus is a nudge too

A **surplus** (a factory's unspendable output, a storage buffer that stays full) emits a nudge for that
good just as a shortfall does — someone must *buy* it. "Demand in wood" therefore covers **both** "we
need wood" and "we need to sell wood": both directions nudge a **wood-selling** shop. A nudge is keyed
on the **good**, never on the buy/sell direction.

### Emission (local neighborhood scan)

Each origin deposits its nudge into the tiles of a **bounded neighborhood** around itself — the same
locality pattern the character planner already uses (`tilesAround(position, sensingRadius)`, Phase 2 in
[`../plans/emergent-planning-architecture.md`](../plans/emergent-planning-architecture.md)). Emission is
**origin-outward**, `O(origins × radius²)`: no per-candidate reachability search, no board scan.
"Reachability" is the **weight**, not the query — a nudge is scaled by hex-distance from its source
(full at 0, fading to 0 at the sensing radius).

### Accumulation & decay

Each district tile keeps a **per-good running sum** of the nudges it receives; that sum **decays over
time**, so a transient shortage fades while a recurring one accumulates. Because the sum is per-good and
direction-agnostic, a deficit on one side and a surplus on the other **both** add to the same counter —
they reinforce, not cancel.

### Trigger → construct, then clear

When a tile's accumulated nudge for a good crosses a threshold, that tile **spontaneously begins a
construction** whose type matches the nudges it received (a shop stocking that good, or a dwelling for
housing nudges). Committing a construction **clears, in a radius around the new distribution point**
(larger than the demand radius), the accumulated nudges for that good **and for every good the new
building distributes** — the newly-served area no longer reports the need.

### Targeting: upgrade vs spawn (neighborhood shop scan)

A nudge is **addressed**, not broadcast. Resolution is a **local neighborhood scan** with a greedy
cascade:

1. Scan the origin's neighborhood for a **shop estate** that sells the needed good.
2. If one is found — increase **that shop's** demand nudge (a growth/upgrade signal feeding the
   triangular-capacity curve).
3. If none sells the good — nudge **all shops** (they could expand their stock to cover it).
4. If there are **no shops at all** — nudge the **commercial tiles** (a spawn candidate).

Each shop's demand nudge **decays over time**, so when two nearby shops serve the same good, the one
that keeps satisfying the need accumulates and survives while the other starves and can eventually
**close**. A new shop spawns only when nothing existing can serve the need; an existing shop grows when
it can.

### Emission cadence & tunability

- **Cadence (game-time, not per-tick).** A *continuous* unsatisfied need (e.g. hunger) re-emits every
  `X` seconds of **game time** via the `Clock` scheduler (`game.clock.begin(step, ds)`; `complete()`
  returns the next `remainingDs` to reschedule) — never per simulation tick, and never wall-clock.
  Transient needs emit once.
- **Tunability (TODO).** Auto-nudging should be tunable per philosophy ("race") — e.g. the `soviet`
  race defaults toward **autarky** (prefer internal self-hauling/spawning over nudging external
  commerce). Nudge strength, decay rate, spawn threshold, and the autarky bias are **content tuning**,
  not hardcoded.

### Player agency

Spontaneous spawning is the **fill-in**, never the primary builder. It only ever constructs on tiles the
player **designated** (painted a district on); un-designated tiles never spawn. The player's levers stay:
paint districts (choose *where* things may appear), author plots and assign alveoli, explicitly build
hives/projects, and set the internality/sourcing dials. The nudge model adds a *local, evidence-gated*
fallback for the gaps — it does not automate away the player.

## Commerce

The *commerce consequences* of districts (equilibrium field, outside visitors, growth loop) live in
[`commerce.md`](./commerce.md). Districts are the spatial answer; commerce is the economic answer.
