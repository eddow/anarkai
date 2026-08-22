# Next Directions

This is the central place for deciding what Anarkai should manage next. It has been reorganised to
reflect the commerce architecture we have been designing together; the earlier "freight-diagnostics then
roads" framing is kept as a *re-ranked* list of candidate directions further down, not dropped.

Decisions live in `docs/`, open questions and the plan in `plans/`. The documents that matter now:

- [`docs/commerce.md`](docs/commerce.md) + [`plans/commerce.md`](plans/commerce.md) — distribution,
  external commerce, the net-deficit ledger, happiness→trust→freedom.
- [`docs/energy.md`](docs/energy.md) — energy sources, topology, and distribution (decided).
- [`plans/commerce-architecture.md`](plans/commerce-architecture.md) — open questions & plan: the
  remaining maintenance/energy details and the implementation order.
- [`docs/projects.md`](docs/projects.md) + [`plans/projects.md`](plans/projects.md) — construction
  projects as forward declarations of demand and special operations.
- [`docs/races.md`](docs/races.md) + [`plans/races.md`](plans/races.md) — philosophies ("races") and
  the tuning-not-lock-out rule.

## Where we are

See [`./current-status.md`](./current-status.md) for what is landed. The short version: terrain, hive
simulation, freight lines / exchange routes, bay queues, alveoli variants, and the *first* form of
external commerce (settlement city-hall trade with static prices) are all in. What is **not** landed is
the unified commerce model we have spent this pass designing — that is the frontier.

## The decided architecture

These are concluded (recorded in the `docs/` files); they are the shape we build toward, not open
questions.

- **Net-deficit ledger** is the organising mechanism. Demand comes from buffers, transforms, projects,
  consumption, and (once decided) maintenance/energy; internal supply cancels internal demand; the
  residual is a **continuous field** of need/excess per good. `Hive.needs` is its seed.
- **Reserve is the single knob** — it caps over-export and over-import; price caps and per-good opt-ins
  are later refinements.
- **Internal movement before trade**; stop modes `deficit` / `surplus` / `explicit`; arbitrage never
  feeds the ledger (profit ≠ need).
- **Sourcing resolves the ledger** internal-first, with per-good quotas editable while a project runs;
  `quota: 'rest'` is the automatic default.
- **The autarky dial** (`dependency(g) = external_sourced / total_consumed`) replaces "two playstyles" —
  it is per-good, per-hive, drifting, and "sticky in the middle". Price *reflects* the dial, never
  creates it.
- **Price is a field** over real finite stock (static base + the full-output/empty-input rest state, with
  the only automated change being a slow input trickle); our trade moves it; profit exists but never
  feeds the ledger; NPC visitors pay from our own stock.
- **Projects = forward declarations of demand** and the primary construction surface; a project ≈ a
  special operation (a resource commitment costing trust).
- **Races are philosophies** (soviet / pirates / hippies) in a 4-axis space; tuning, not lock-out.
- **Happiness → trust → freedom**: happiness is one aggregate number → trust delta → special operations;
  drives population; too-low is a progressive loss (fewer projects), never a cliff.
- **Money**: one immaterial currency, one wallet first; luxury consumption is budgeted by a wallet/level
  fed by an hourly/daily transfer (an inverted tax).
- **Maintenance & energy are decided** (see [`docs/energy.md`](docs/energy.md)): sources are ordinary
  alveoli; hauled energy is a good, continuous energy is a cable/grid; cables are road-like tile-border
  entities, one edge-layer per border, a centre is a 3-level stack (ground/air/underground); distribution
  is a path-walk over a near-tree (priority + distance-decay on shortage); buildings use usePoints
  (linear decay, engineer repair), vehicles hold a reserve.

## Open questions to answer together

The remaining open items are small: the architecture is largely pinned; what is left is one wallet
question, a few races questions, and two deferred seams.

### A. Energy leftover details (content, not architecture)

From `plans/commerce-architecture.md` (M7): the per-energy crossing/elevation table, and the shortage
presentation (brown-out / throttle / reserve-drain). Both are details; the model is decided.

### B. Salary = individual spending = the skip-SimCity lever

What a character is allowed to spend in NPC/other-player settlements is effectively their **salary**. At
the commerce extreme of the autarky dial the player skips internal production entirely and lets characters
buy their needs directly. The salary is the *same* hourly/daily drip as the luxury wallet — one mechanism
with a scope knob (subsistence vs discretionary), not two. **Decided: one wallet for now** (multi-wallet
later, bound to projects/rules/allowance). The allowance is always used — even a train driver stranded
in a city buys food with it, so it is a permanent mechanic.

### C. Races open questions

From `plans/races.md`: how much do races shift **happiness sources**? Is "religious" a distinct race or a
hippie variant? How does the luxury/consumption budget (the inverted tax) differ per race? Military
stance — deferred until defense/occupation matures. **UI identity is cosmetic + unimportant** (decide
last-minute); **per-race tuning is deferred until after the mechanics are implemented** (find the
average tuning first, then diverge).

### D. Deferred (do not block, but keep the seam open)

- **Outside carriers** (end-game): how they plug into the same trade interface (pseudo-vehicles vs an
  abstract import/export edge).
- **Defense & honesty** (multiplayer-only): faction "feeling" over buildings/goods; stealing; war-as-decree.

## Implementation order (the actual next moves)

Agreed sequence — **questions → structures/interfaces → implementation**:

1. **Answer the last open items** (§A–§C): the energy leftover details and the races questions. None of
   these block the ledger; they are all small and mostly independent (the one-wallet question is already
   decided).
2. **Structures & interfaces** — the commerce spine is unblocked *now* (energy no longer gates it):
   - `Deficit = { good, quantity, origin: 'project'|'production'|'storage'|'consumption'|'energy', scope }`
     (maintenance is **not** an origin — engineers do it as a consumer alveolus whose inputs are
     `'production'` demand)
   - `Hive.needs` → the net-deficit field over NPC + player structures (deficit = priority `2-use` only).
   - `StopMode = 'deficit'|'surplus'|'explicit'`; `Reserve` as the single knob.
   - `SourcingEntry = { good, source, quota }`; `ProjectSourcing`.
   - `Wallet` (single for now) / `Transfer` for the salary + luxury drip.
3. **Implementation** — the "first playable slices" below.

### Architectural hygiene (kept from the old plan)

- When the core (and conveying especially) moves to Rust, the "version" hacks will have to be revisited
  and eliminated.
- Serialize dockview layout (widget panels/params) into the savegame: widget `params` are already
  serializable config (`pinned: boolean`), never live game objects, so panels restore by id + params
  without re-embedding runtime references.

## Candidate directions (re-ranked)

Ranked against the decided architecture. The old "roads next" framing is superseded: roads are
*infrastructure for commerce*, not the frontier.

### 1. Commerce architecture → code (primary)

Turn the net-deficit ledger + sourcing into working code: replace the `HivePlan.requiredGoods` stub with
a real recipe-sum bill + operating demand; make `Hive.needs` the net-deficit field; add the `deficit`
stop mode; surface reserve. This is the spine every other direction plugs into.

### 2. Projects (supporting, in parallel)

Projects are the construction surface *and* the special-operation spend. Open items live in
`plans/projects.md`: reusable-plan model (stamp vs clone), push semantics (atomic vs per-entry),
roads/track-as-entries, city demolition cost.

### 3. Maintenance & energy (energy is decided; wire it later)

Energy's model is fully specified in `docs/energy.md`. Implementation (cables as a tile-border layer, the
path-walk distribution, usePoints) is a later slice; it no longer gates anything. The two leftover M7
details (crossing/elevation table, shortage presentation) are content.

### 4. Races (once the space is stable)

Philosophies as tuning vectors; they need the commerce dial and the happiness loop to mean anything.

### 5. Roads & path infrastructure (was #1, now supporting)

Still valuable — road-aware routing, lane/band metadata, builder workflow, bay-less roads — but it is
infrastructure that *makes distance matter for commerce*. Do it when commerce needs it (outside carriers,
trade points), or as a parallel slice once the ledger is live.

### 6. More game content

New deposits / harvesters / transformers / goods. A fill-in; the chains only make sense once the ledger
and the maintenance ladder exist (otherwise more internal logistics puzzles without the commerce spine).

### 7. NPC cities & villages

External settlements deepen demand once sourcing can name them as sources. Blocked on roads + commerce
interfaces.

### 8. Terrain generation rework

Needed when settlements / roads / commerce need stronger geography. Keep as background.

## Decision prompts

- Are we answering questions (§A–§C) or writing interfaces? The commerce spine is unblocked; start
  drafting interfaces now — the remaining questions are small and orthogonal to the ledger.
- Does the next slice *reduce a deficit the ledger can express*, or does it just add assets?
- Is the smallest playable slice "one shop consuming one good" or "one deficit routed to one source"?
  The latter proves the architecture; the former proves the content.
- Which decision becomes hardest to change after this lands? The `Deficit.origin` union and the wallet
  shape (one wallet vs two) fork the most.

## First playable slices

- **Ledger v1:** real `requiredGoods` bill → `Hive.needs` field → one `deficit` stop imports a shortfall.
- **Sourcing v1:** one project with a two-source quota (own hive + NPC settlement), editable mid-run.
- **Reserve v1:** one buffer with a reserve knob that blocks over-export and caps over-import.
- **Price-field v1:** the d² + frontier-fade field, wired to `Hive.needs`' surplus/need.
- **Maintenance v1:** one building with a usePoints life level engineers can top back up (decided model).
- **Salary v1:** one wallet drip that lets a character buy food at an NPC city (the skip-SimCity probe).
- **Race v1:** one philosophy nudging one axis + one happiness source (after the dial is live).
- **Roads v2:** (re-ranked) turn instant roads into build projects, add route-benefit summaries.
