# Commerce architecture — open questions & plan

> **Decided things live in [`docs/commerce.md`](../docs/commerce.md).** This file holds only what is
> still open and the plan. If a point below turns out to be settled, move it to `docs/commerce.md` and
> delete it here.

## Open questions

### Maintenance & energy (M-series)

M1–M6 are decided (see `docs/commerce.md` → "Maintenance & energy"). Energy distribution is decided in
[`docs/energy.md`](../docs/energy.md): cables are road-like tile-border entities; a border holds one
edge-layer; a centre is a stack of up to 3 levels (ground/air/underground), one network per level, each a
junction; distribution is a **path-walk** over a near-tree (loss = Πη, bottleneck = min capacity,
shortage = priority then distance-decay, redundancy = ≤ few parallel paths). The remaining open question:

- **M7 — Continuous providers: the leftover details.** Decided: topology, the path-walk distribution,
  "vehicles hold a reserve, buildings don't", cross-level links are natural (a tower is just a node),
  and **one level per cable for now** (high = electricity, ground = roads + kinetic, subterranean =
  pressured air; other energies open to proposal). Open:
  - The per-energy **crossing/elevation table** (which kinds block vs pass-through; which support
    bridge / elevated-mats / buried).
  - Shortage **presentation**: the allocation math (priority → distance-decay) is decided; the
    player-facing consequence (brown-out vs throttle vs reserve-drain) is not.

### Remaining tuning (decided mechanism, open numbers)

- **Price-field radius `R`** and **fade radius** — the d² shape and the ≥-generation-radius constraint
  are decided; only the actual distance numbers are free.
- **NPC input trickle** — the τ_in and target per site.
- **Luxury-wallet transfer rate** — the hourly/daily drip magnitude.

### Deferred (keep the seam, do not block)

- **Outside carriers** (end): how they plug into the same trade interface (pseudo-vehicles vs an abstract
  import/export edge).
- **Defense & honesty** (multiplayer): faction "feeling" over buildings/goods; stealing; war-as-decree.

## Plan

Agreed order: **questions → structures/interfaces → implementation**.

1. **Answer the M7 leftovers** (energy, content-level, do **not** block the interfaces): the per-energy
   crossing/elevation table; the shortage presentation (brown-out / throttle / reserve-drain).
2. **Draft interfaces** — unblocked *now* (energy and the one-wallet question are decided):
   - `Deficit = { good, quantity, origin: 'project'|'production'|'storage'|'consumption'|'energy', scope }`
     (maintenance is **not** an origin — engineers do it as a consumer alveolus whose inputs are
     `'production'` demand).
   - `Hive.needs` → the net-deficit field (deficit = priority `2-use` demand only)
   - `StopMode = 'deficit'|'surplus'|'explicit'`; `Reserve`
   - `SourcingEntry = { good, source, quota }`; `ProjectSourcing`
   - `Wallet` (single for now; multi-wallet later) / `Transfer` (the salary + luxury drip)
3. **Implement** the first-playable slices.

### First playable slices

- **Ledger v1** — real `requiredGoods` bill → `Hive.needs` field → one `deficit` stop imports a shortfall.
- **Sourcing v1** — one project with a two-source quota (own hive + NPC settlement), editable mid-run.
- **Reserve v1** — one buffer with a reserve knob that blocks over-export and caps over-import.
- **Price-field v1** — the d² + frontier-fade field, wired to `Hive.needs`' surplus/need.
- **Maintenance v1** — one building with a usePoints life level that engineers can top back up
  (the M1/M4 model is decided; this slice is a job + decay probe).
- **Salary v1** — one wallet drip that lets a character buy food at an NPC city.
