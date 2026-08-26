# Next Directions

This is the central place for deciding what Anarkai should manage next. It has been reorganised to
reflect the commerce architecture we have been designing together; the earlier "freight-diagnostics then
roads" framing is kept as a *re-ranked* list of candidate directions further down, not dropped.

Decisions live in `docs/`, open questions and the plan in `plans/`. The documents that matter now:

- [`docs/commerce.md`](docs/commerce.md) + [`plans/commerce.md`](plans/commerce.md) — distribution,
  external commerce, the net-deficit ledger, happiness→trust→freedom.
- [`plans/commerce-architecture.md`](plans/commerce-architecture.md) — open questions & plan: the
  price field, sourcing policy, reserve, and the implementation order.
- [`plans/spontaneous-lines.md`](plans/spontaneous-lines.md) — transport automation (one-shot orders,
  temporary corridors, the internality slider; recurring lines stay player-authored).
- [`plans/spontaneous-zones.md`](plans/spontaneous-zones.md) — spontaneous residential/commercial,
  growth/shrinkage (triangular capacity), the delivery-tile rule, and shop types.
- [`plans/emergent-planning-architecture.md`](plans/emergent-planning-architecture.md) — **current
  frontier**: replace global planner optimization with local, emergent decisions (the "ants" model).
- [`plans/rust-migration-continuation.md`](plans/rust-migration-continuation.md) — the "move only proved
  algorithms" gate for the Rust port (the pathfinding flood is the next candidate).
- [`plans/details-punchlist.md`](plans/details-punchlist.md) — leftover UI polish (config memorization,
  docked-vehicle cargo, line-editor fixes).
- [`docs/energy.md`](docs/energy.md) — energy sources, topology, and distribution (decided).
- [`docs/projects.md`](docs/projects.md) + [`plans/projects.md`](plans/projects.md) — construction
  projects as forward declarations of demand and special operations.
- [`docs/races.md`](docs/races.md) + [`plans/races.md`](plans/races.md) — philosophies ("races") and
  the tuning-not-lock-out rule.

The commerce **code** lives in `engines/ssh/src/lib/commerce/` (model, ledger, sourcing, price field,
board adapter) and its content in `engines/rules/src/content/{commerce,shops}.ts`.

## Where we are

See [`./current-status.md`](./current-status.md) for what is landed. The short version: terrain, hive
simulation, freight lines / exchange routes, bay queues, alveoli variants, and the *first* form of
external commerce (settlement city-hall trade with static prices) are all in.

The **commerce spine** (the structural layer) has now been drafted and bound to live state — the pure
core is implemented, tested, and type-clean; the *gameplay* wiring is the frontier:

- **Interfaces** (`commerce-model.ts`): `GoodFlow` / `EstateCommerceProfile`, the `Estate` interface
  (`footprint`/`profile`/`feedsPriceField`/`distanceTo`), `effectiveFlow`, `PriceNode`/`PriceFieldTuning`,
  `NeededGood`/`NeedSource`, `NetDeficit`/`NetDeficitLedger`, `Reserve`, `Source`, `SourcingEntry`,
  `Wallet`/`Transfer`. `Hive` now `implements Estate`.
- **Ledger** (`deficit-ledger.ts`): `computeNetDeficitLedger` over construction demand (player plans +
  spontaneous foundations); exposed as `Game.netDeficitLedger`. **Demand half only** — `surplus` is 0.
- **Sourcing** (`sourcing.ts`): pure `resolveSourcing` (internal-first, then external by price→distance),
  `SourcingPolicy`, `SourceOffer`, `internalSourceAvailability`. `Source` = `Estate |
  NpcSettlementTradeProfile`; `Reserve` ≡ the `1-buffer` keep-target (one knob, two names).
- **Price field** (`price-field.ts`): `priceAt` / `rateFieldAt` / `influenceWeight`, tuning in
  `commerce.priceField`. Base price is a caller parameter; the **frontier fade** is a board-aware caller
  concern (needs the generation frontier).
- **Board adapter** (`board-sources.ts`): `listHives`, `measureInternalSourceOffers`,
  `measureExternalSourceOffers` — turns live `Game` state into the `SourceOffer`s `resolveSourcing` eats.
- **Content** (`rules`): `commerce.priceField` tuning; `shops.ts` shop definitions (`ShopDefinition`,
  `shops`, `shopNeedTags`) — defined, **not yet consumed by a spawner**.
- **Bill** (`hive-plan.ts`): `HivePlanValidationProgress.requiredGoods` is now the real recipe-sum bill
  (foundation + variant chain), replacing the `charcoal` survey stub.
- **Transport automation** (`freight/one-shot-lines.ts` + `Game.transportAutomation`): the `repeat: false`
  one-shot line model (self-delete on fulfillment/abortion), the internal-first **spawner**
  (`trySpawnConstructionLines` — nearest producer/holder bay → construction zone, using only *free*
  vehicles), the external **delivery** branch (`trySpawnConstructionDeliveries` — buy from the
  nearest/cheapest NPC settlement and credit the site; instant credit for now), the "don't
  double-cover" guard (any line covering the good), and a **reactive, tunable config** (`autoSpawn` /
  `autoBuy` / `internality` / `reserve` / `spawnCooldownSeconds`) seeded from
  `commerce.transportAutomation`. See [`plans/spontaneous-lines.md`](plans/spontaneous-lines.md).

**What is not landed** is the *gameplay* half of that spine: the **physical carrier** behind delivery
(the buy+credit is instant — no outside-carrier travel yet), the `surplus` (producer-export) half of
the ledger, operating demand in the bill, the frontier fade, and the spontaneous commercial spawner /
growth-shrinkage representation.

## Current frontier — planner scalability (emergent planning)

As of 2026-08-26 the frontier has moved past the commerce spine to **planner scalability**. The commerce
structural layer is drafted and the spontaneous-line automation is wired on both halves (self-haul and
buy+credit); the open item is that the per-character planner (`Character.findAction` →
`rankedWorkCandidates`) is `O(N × board × pathfind)` and cannot reach hundreds of characters regardless
of language.

Two new plans capture this:

- [`plans/emergent-planning-architecture.md`](plans/emergent-planning-architecture.md) — replace the
  global-optimum planner with **local, emergent decisions** (the "ants" model): precomputed distance
  fields instead of per-candidate pathfinding, advertisements extended from goods to work, commitment +
  hysteresis to kill the re-plan cascade, a small sensing radius (last-mile only), and coarse-graph
  routing. Phased migration (fields → locality → ad-driven work → commitment → coarse-graph + Rust),
  each phase independently shippable with a fallback.
- [`plans/rust-migration-continuation.md`](plans/rust-migration-continuation.md) — the **"move only
  proved algorithms"** gate. The pathfinding optimizations (target-bounded flood, blocking-tile oracle,
  transit/candidate tokens, transit snapshot) are **proved in TS and committed** (see
  `engines/ssh/src/lib/utils/pathfinding.ts`, `engines/ssh/src/lib/board/board.ts`,
  `engines/ssh/tests/unit/pathfinding.test.ts`); the next steps are a determinism test, then porting the
  *pure flood* to `engines/core` — not the policy (roads, burden, planner logic), which stays in TS.

The "what survives / what is retired" split lives in the emergent-planning doc; the Rust sequence lives
in the migration-continuation doc.

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
2. **Structures & interfaces** — ✅ **done** (the `commerce/` module + `rules` content above). The
   shapes actually landed differ slightly from the original sketch and are worth noting:
   - `NeededGood = { good, quantity, source }` — the **object is the origin** (`source: NeedSource =
     Alveolus | ConstructionSiteShell | UnBuiltLand`), narrowed by `instanceof`/type-guard. There is **no
     `origin`/`Deficit.origin` enum** — the object identity replaces it (and `UnBuiltLand` covers the
     residential foundation phase).
   - `NetDeficit = { demand, surplus, deficit, needs }` + `NetDeficitLedger` (board-scoped).
   - `SourcingEntry = { good, source, quota: number | 'rest' }`; `ProjectSourcing`; `Reserve`; `Wallet` /
     `Transfer` — all landed.
   - **Not yet landed:** `StopMode = 'deficit'|'surplus'|'explicit'` (still a doc-only concept), and
     wiring `Hive.needs` into the ledger (the ledger currently reads construction shells directly,
     not `Hive.needs`).
3. **Implementation** — the "first playable slices" below (three are done, the rest remain).

### Architectural hygiene (kept from the old plan)

- When the core (and conveying especially) moves to Rust, the "version" hacks will have to be revisited
  and eliminated.
- Serialize dockview layout (widget panels/params) into the savegame: widget `params` are already
  serializable config (`pinned: boolean`), never live game objects, so panels restore by id + params
  without re-embedding runtime references.

## Candidate directions (re-ranked)

Ranked against the decided architecture. The old "roads next" framing is superseded: roads are
*infrastructure for commerce*, not the frontier. The **planner-scalability** direction below is now the
frontier (see "Current frontier").

### 1. Emergent planning → planner scalability (current frontier)

Replace the global-optimum planner (`rankedWorkCandidates`) with local, emergent decisions so the
simulation reaches hundreds of characters/vehicles. Phased: distance fields → candidate-set locality →
advertisement-driven work → commitment/hysteresis → coarse-graph routing + Rust. See
[`plans/emergent-planning-architecture.md`](plans/emergent-planning-architecture.md) and
[`plans/rust-migration-continuation.md`](plans/rust-migration-continuation.md).

### 2. Commerce architecture → code (primary)

The structural spine is drafted (see "Where we are"); the remaining *gameplay* work here is:
wire a live **`deficit` stop** that imports a shortfall (the consumer of the ledger + sourcing), add the
**`surplus`** (producer-export) half of the ledger, fold **operating demand** (transform inputs / storage
buffers) into the bill, make **`Hive.needs`** feed the ledger (today the ledger reads construction shells
directly), and apply the **frontier fade** board-side. This is the spine every other direction plugs
into.

### 3. Projects (supporting, in parallel)

Projects are the construction surface *and* the special-operation spend. Open items live in
`plans/projects.md`: reusable-plan model (stamp vs clone), push semantics (atomic vs per-entry),
roads/track-as-entries, city demolition cost.

### 4. Maintenance & energy (energy is decided; wire it later)

Energy's model is fully specified in `docs/energy.md`. Implementation (cables as a tile-border layer, the
path-walk distribution, usePoints) is a later slice; it no longer gates anything. The two leftover M7
details (crossing/elevation table, shortage presentation) are content.

### 5. Races (once the space is stable)

Philosophies as tuning vectors; they need the commerce dial and the happiness loop to mean anything.

### 6. Roads & path infrastructure (was #1, now supporting)

Still valuable — road-aware routing, lane/band metadata, builder workflow, bay-less roads — but it is
infrastructure that *makes distance matter for commerce*. Do it when commerce needs it (outside carriers,
trade points), or as a parallel slice once the ledger is live.

### 7. More game content

New deposits / harvesters / transformers / goods. A fill-in; the chains only make sense once the ledger
and the maintenance ladder exist (otherwise more internal logistics puzzles without the commerce spine).

### 8. NPC cities & villages

External settlements deepen demand once sourcing can name them as sources. Blocked on roads + commerce
interfaces.

### 9. Terrain generation rework

Needed when settlements / roads / commerce need stronger geography. Keep as background.

## Decision prompts

- The structural spine is drafted; the next fork is **gameplay wiring** vs **content** — do we wire a
  live `deficit` stop (proves the spine end-to-end), or add the spontaneous commercial spawner (proves
  the content)?
- Does the next slice *reduce a deficit the ledger can express*, or does it just add assets?
- Is the smallest playable slice "one shop consuming one good" or "one deficit routed to one source"?
  The latter proves the architecture; the former proves the content.
- Which decision becomes hardest to change after this lands? The `NeedSource` union (object-as-origin vs
  a discriminant) and the wallet shape (one wallet vs two) fork the most.
- **Planner fork (new):** does the next slice start the emergent-planning migration (Phase 1 — distance
  fields short-circuit `tailorProposedJob`, zero behaviour change) or finish the commerce gameplay
  wiring (a live `deficit` stop)? The former unlocks scalability; the latter proves the commerce spine
  end-to-end.

## First playable slices

- **Ledger v1** — ✅ real `requiredGoods` bill → `computeNetDeficitLedger` → `Game.netDeficitLedger`
  (demand half). ⏳ Remaining: a live `deficit` stop that imports the shortfall.
- **Sourcing v1** — ✅ pure `resolveSourcing` + `board-sources.ts` adapter. ⏳ Remaining: a concrete
  caller (the deficit stop / trade-stop) that invokes it end-to-end.
- **Reserve v1** — ⏳ the data shape (`Reserve`) and `internalSourceAvailability` exist; the buffer
  wiring (a storage buffer whose `1-buffer` target *is* the reserve knob) is not yet connected.
- **Price-field v1** — ✅ pure `priceAt` / `rateFieldAt` + `commerce.priceField` tuning. ⏳ Remaining:
  the board-aware frontier fade and a consumer sampling the field.
- **Transport automation v1** — ✅ `repeat` flag + one-shot lifecycle (self-delete), internal-first
  spawner (`trySpawnConstructionLines`), external delivery branch (`trySpawnConstructionDeliveries`,
  instant buy+credit), free-vehicle allocation, dedup guard, and reactive
  `Game.transportAutomation` config. ⏳ Remaining: a physical outside carrier for delivery, and the
  internality-slider UI that actually branches line-vs-delivery. See
  [`plans/spontaneous-lines.md`](plans/spontaneous-lines.md).
- **Emergent planning v1** — ✅ pathfinding perf rounds landed (target-bounded flood, blocking-tile
  oracle, transit/candidate tokens, transit snapshot). ⏳ Remaining: the phased migration to local
  decisions (fields → locality → ad-driven work → commitment → coarse-graph + Rust). See
  [`plans/emergent-planning-architecture.md`](plans/emergent-planning-architecture.md) and
  [`plans/rust-migration-continuation.md`](plans/rust-migration-continuation.md).
- **Maintenance v1** — ⏳ one building with a usePoints life level engineers can top back up (decided
  model; not implemented).
- **Salary v1** — ⏳ one wallet drip that lets a character buy food at an NPC city (the skip-SimCity
  probe).
- **Spontaneous zones** — ⏳ `shops.ts` content is defined; the commercial spawner (cumulative
  observation → shop), residential (seeded), and growth/shrinkage (triangular capacity) are not yet
  implemented. See [`plans/spontaneous-zones.md`](plans/spontaneous-zones.md).
- **Race v1** — ⏳ one philosophy nudging one axis + one happiness source (after the dial is live).
- **Roads v2** — ⏳ (re-ranked) turn instant roads into build projects, add route-benefit summaries.
