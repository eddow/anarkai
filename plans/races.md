# Philosophies ("races") — working notes

> Conclusions belong in [`../docs/races.md`](../docs/races.md). This file tracks the open questions and
> live design. The one-sentence pitch: **races are philosophies — a preferred region in a space of axes
> (economy, hive-structure, wealth-definition, military) and a distinct definition of "success."**

## Confirmed framing

- **Invariant: tuning, not lock-out.** Every mechanic is open to every race; races only set a preferred
  sweet-spot tuning (costs, availability, happiness sources, score definition). Nothing is forbidden to
  a race. Lock-outs, if ever, are v2.
- Races are **soft leanings**, not hard walls; flavors via unique structures, not lock-outs.
- The **same race data** serves single-player (chosen philosophy / campaign lens) and multiplayer
  (rival factions with asymmetric leanings → natural trade).
- The starting three = **soviet** (production/goods-export), **pirates** (commerce/motion), **hippies**
  (tourism/inbound desirability).
- Hippies are **assimilated into the general theory**. Original brief was "happy with fewer." Now: they
  are SimCity-leaning and **export tourism inward** — nice cities, well-being + cultural zones, and
  transport links out to NPC / other settlements. Clearly an active, distinct philosophy, not a
  difficulty slider. "Happy with fewer" is re-read as **rich in desirability, not quantity.**
- Price/dial reconciliation with `commerce-architecture.md`:
  - soviet = dials down (near-autarky, bootstrap-substitute internalization);
  - pirates = dials up (volume/arbitrage, settlement stock/exhaustion);
  - hippies = dial nearly empty; their slider is **attractiveness vs infrastructure cost** + inbound
    tourism.

## Axes (current draft)

| Axis | 0 pole | 10 pole |
|---|---|---|
| Economy | production | commerce |
| Hive structure | many simple (settlers) | few complex (factorio) |
| Wealth definition | self-sufficiency | circulation / desirability |
| Military stance | pacifist | militarist (future) |

Question: is there a **centralization** axis (independent vs federated hives) worth adding? It would tie
into the workers/unions thread. Not yet decided.

## Roster (v1) + future fill-ins

v1: soviet, pirates, hippies/religious.

Future candidates to fill off-axis/mixed regions of the space:
- scientist/tech (factorio + self-sufficiency)
- nomad (mobility, cheap assets, few permanent hives)
- merchant-republic (commerce + hub hives + defensive military)
- warrior (military heaviest)
- religious/caretaker (hardening the hippie vein — well-being infrastructure as wealth)

## Open questions to resolve

- [ ] Individual/carry-currency spending by characters away from home (e.g. a train driver stranded at
      an NPC city buying food/lodging). **Deferred** — needs per-character wallets + location spending
      rules. *Note: this is not a niche feature — it is the "salary" lever that lets a player skip the
      internal-production/SimCity game entirely and live at the commerce extreme of the autarky dial
      (see `./commerce.md`).*
- ~~Do races expose UI identity or only mechanical leanings?~~ **Answered: UI identity is cosmetic +
  unimportant (decide last-minute before deploy); the mechanical leanings are the real substance.**
- [ ] How much does race affect **happiness sources**? (soviet happy from production throughput, hippie
      from well-being infra). Would tie directly into the happiness→trust→freedom loop. — likely yes,
      but scope? v1 vs later?
- [ ] How much does race affect **happiness sources**? (soviet happy from production throughput, hippie
      from well-being infra). Would tie directly into the happiness→trust→freedom loop. — likely yes,
      but scope? v1 vs later?
- [ ] Military stance: existence + weight. Deferred until the defense/occupation concept in `commerce.md`
      matures.
- [ ] Whether "religious" is a distinct race or a lexical variant of **hippies** leaning hard into
      well-being-instead-of-goods.
- [ ] Exact mechanical expression of "soft leaning" — concrete cost/availability nudge numbers to be
      tested. **Tune *after* the mechanics are implemented**: first find an *average* (race-agnostic)
      tuning, then diverge per race. Do not specify per-race numbers in `docs/races.md` yet.
- [ ] How budget for luxury/consumption spending (`commerce.md` inverted-tax) might differ per race.
