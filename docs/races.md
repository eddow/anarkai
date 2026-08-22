# Philosophies ("races") — shared concept notes

> Working notes and open questions belong in
> [`../plans/races.md`](../plans/races.md); this document records what is decided. The concept was
> originally a late "icing-on-the-cake" idea but has proven more fundamental: a way to make the
> commerce/autarky dial (see [`./commerce.md`](./commerce.md) and
> [`../plans/commerce-architecture.md`](../plans/commerce-architecture.md)) a *characterful*
> decision instead of a blank slider.

## The core reframe

**Races are not factions with bonus/penalty tables, and not "three difficulty settings with hats."**
They are **philosophies**: each a preferred region in a *space of axes*, plus a distinct definition of
**what counts as winning** (wealth). Both the economy and the sense of identity fall out of that.

### The one hard rule: tuning, not lock-out

> A race is a **preferred sweet-spot tuning** — never a gate. **Every game mechanic is available to
> every race.** A soviet may run freight lines and trade, a pirate may build farms, a hippie may build
> a factory. Races only make one region of the space *easier / more natural / more rewarding*, and make
> a different definition of wealth the *score*; they never forbid the rest.

This is the organising principle everything below obeys. A race should *invite* a way of playing by
adjusting costs, availability, happiness sources, and what it counts as a win — never by closing doors.
Lock-outs, if ever considered, are explicitly a **v2 spike**, not now.

### Races sit in a space, not on one line

The earlier "autarky dial" is only one dimension. The full space (so far) is:

| Axis | 0 pole | 10 pole |
|---|---|---|
| **Economy** | production (self-made) | commerce (bought/moved) |
| **Hive structure** | many simple hives (settlers) | few complex hives (factorio) |
| **Wealth definition** | self-sufficiency | circulation / desirability |
| **Military stance** | pacifist | militarist *(future)* |

A race is a **weight vector** over these axes — a *lean*, not a lock. The "sweet spot" you asked about
is therefore a **vector of leanings**, and it feeds whatever its wealth/score definition is.

### The starting three

| | **Soviet** | **Pirates** | **Hippies** |
|---|---|---|---|
| **Economy axis** | production | commerce | *outward-living* (tourism) |
| **Hive structure** | many simple hives | few mobile/cheap assets | medium, quality-focused |
| **Wealth definition** | self-sufficiency index | circulation / throughput | **desirability / contentment** |
| **The "export"** | **material goods** | **motion** (throughput) | **a destination** (visitors) |
| **Autarky dial lean** | dials down hard (near-autarky) | lives by the dial (import-leaning) | dial barely matters |

Why these three: they cover three genuinely different answers to **"how does wealth enter the group?"**

- **Soviet** pulls wealth in by *producing* more than it needs and exporting the surplus as goods.
- **Pirates** pull wealth in by *moving* value — buying where it is cheap, selling where it is dear,
  living on the spread and on throughput.
- **Hippies** pull wealth in by *attracting people* — they do not ship goods outward; they make an
  inbound flow of visitors / tourism the core of their economy.

This keeps the three from being "the same economy with different numbers": the *flow* itself differs.

## Hippies: tourism as the inbound export

The hippie philosophy is *not* "happy with fewer," and it is not a passive easy-mode. It is an active,
**SimCity-flavoured** build toward **desirability**.

- Their "industry" is **place quality**: nice settlements, well-being and cultural zones, and the
  infrastructure that makes a place worth *visiting*.
- Their commercial engine is **inbound**: NPC and other-settlement visitors arrive, stay, and pay for
  the experience. Their freight and road matters are about **connecting to visitors**, not moving cargo.
- Their wealth is measured by **desirability / contentment**, which converts to money through
  visitor/tourism revenue rather than goods export or arbitrage.

This makes the thin "NPC visitors buy from our commerce zone" edge from `commerce.md` into a
**first-class flow** for this philosophy: a tourist economy built on well-being infrastructure and
transport links out to the world.

The religious/caretaker variant sits on the same vein: **well-being infrastructure that produces
happiness instead of goods** is a real, distinct wealth-definition, and can be much more than "a content
society" — it is an economy whose *output* is experience and care.

## Design principles

1. **Tuning, not lock-out (the invariant).** Every mechanic is open to every race; a race only adjusts
   the *sweet-spot tuning* (costs, availability, happiness sources, and what counts as victory). Doors
   stay open for all; nothing is forbidden by choice of race.
2. **One source of truth.** The same race data serves **single-player** (the philosophy the player adopts,
   a campaign lens) and **multiplayer** (rival philosophies whose preferences make them each other's
   natural market — a surplus you export on one axis is a deficit another philosophy imports).
3. **Different definitions of wealth.** The three races should not be compared on the same scoreboard;
   each is asked to do meaningfully different things.
4. **Prices reflect the dial, not create it** (from `commerce.md`): race *influences* the dial but never
   mandates it.
5. **In multiplayer, races are friction generators.** Different leanings make real, asymmetric trade —
   the organic cure for the "no fake stock exchange" problem.

## Future races to fill the space

The three starting races occupy interesting but not every region. Future candidates, each an
*off-axis or mixed* position rather than a corner:

- **Scientist / tech** — leans factorio + self-sufficiency, indifferent to commerce (the soviet–factorio
  seam).
- **Nomad** — leans mobility, cheap assets, trade, few permanent hives.
- **Merchant-republic** — commerce + few hub hives + defensive military (a city-state in space).
- **Warrior** — military heaviest, economy secondary.
- **Religious / caretaker** — contentment + pacifist (hardens the hippie vein into a distinct identity).

## Open questions (tracked in `../plans/races.md`)

- **Individual spending** (e.g. a character stranded at an NPC city buying local food/lodging) — the
  salary/allowance drip (decided in `commerce.md`); per-character wallets later.
- **Races influence a lot (decided):** bonus/malus on **production / commerce / happiness**, plus
  **equilibriums and rates** — not a flat numeric table but real tuning of the dial and the
  happiness/trust loop, per philosophy.
- **UI identity is purely cosmetic (decided, unimportant):** colors/banners/titles — decide at the last
  minute before deploy; it does not drive design.
- How much does a race affect **happiness sources** — soviets get more happiness from production
  throughput, hippies from well-being infra? (This ties directly into the happiness/trust loop in
  `commerce.md`.)
- Military stance existence and weight — deferred until the military/occupation concept matures.

## Relation to the commerce architecture

This document gives the autarky dial a face. The reconciliation with `commerce-architecture.md`:

- **Soviet** = lives low on the dial, leans on bootstrap-substitute internalization (dials down per good).
- **Pirates** = lives high on the dial, leans on volume/arbitrage and settlement stock/exhaustion.
- **Hippies** = their dial is nearly empty; their slider is **attractiveness vs. infrastructure cost**
  and the inbound tourism flow — reinforcing that races are vectors, not points on one line.
