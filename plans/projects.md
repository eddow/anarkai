# Projects — working notes

> TODO, unresolved questions, and reflections. Conclusions go to
> [`../docs/projects.md`](../docs/projects.md).

## Open questions

- **Project vs `HivePlan` (a project may span several hive plans).** Today `Project` ≡ `HivePlan`: one
  plan = one contiguous cluster = one hive. But a *project* is a higher-level undertaking ("lumber
  industry", "residential block", "trade post") that may span **several** hive plans (several separate
  buildings/clusters), plus roads/track and demolition entries. Is there a `Project` wrapper type holding
  N `HivePlan`s, or is the plan itself the top-level authoring unit? How does a project-level bill
  aggregate over its plans (+ roads + demolition)?
- **Push semantics**: atomic (whole plan commits at once) vs per-entry (streamed construction)? The
  "git branch" language leans atomic, but per-entry lets early entries start building while later ones
  are still being funded.
- **Does `validating` consume goods, or is it a pure time gate?** Now the real construction bill
  (foundation + recipe) + work-seconds (replaced the old `charcoal` survey stub). Remaining question:
  is *surveying* (the novelty-scaled work-seconds) a real resource sink beyond that bill?
- **Merge semantics**: when two projects are merged, how do their bills combine/conflict (duplicate
  coords, shared configs)?
- **Operating demand in the ledger**: on push, does only construction-recipe demand enter the deficit
  ledger, or also the *operating* demand of the configured alveoli (storage buffers / transform inputs)?
- **Roads / track as project entries**: decided that projects manage roads and track laying, but not
  whether they are *entries* inside the same plan (sharing the bill + staging) or a parallel tool that
  projects reference/connect to.
- **Time unit**: work-seconds vs man-hours × worker count for validation; how do multiple engineers
  accelerate it?
- **Source choice UX**: "buy all not produced" needs a per-good source decision (which trade point,
  price cap). How much is automatic vs player-chosen?
- **Reusable / scattered plans**: the same plan (e.g. wood-chopper + sawmill + freight bay) is stamped
  several times around a forest. Is a placed copy still the *same* plan object, or an instantiated clone?
  How do N copies bill, validate, and share (or fork) configuration?
- **Demolition cost in cities**: building a stop/station in a city may remove existing buildings. How is
  that cost computed and surfaced (and does it interact with the bill)?

## Reflections

- The stage machine (`draft → validating → working`) is already the right register for
  "planned vs committed" demand — only `working` should advertise to the board.
- Projects invert demand direction: today demand is emergent (placed alveoli advertise); projects make
  it a forward declaration. The `requiredGoods` stub is the existing seam for this.
- The bill + "buy all not produced" is the same net-deficit computation as commerce; projects are a
  *demand origin*, not a separate trading mechanism.
- Position/transport (from `docs/commerce.md`) applies to projects too: a project's import need is
  satisfied by trade unless sustained volume justifies owning the corridor to it.
- **Granularity**: "one building = one hive" is the floor; the plan composes buildings, and reuse means
  the same cluster can be scattered. This makes the plan a *stamp/template*, which may pull it toward a
  blueprint model (clone per placement) rather than a single live object.

## TODO

- [ ] Replace `hivePlanValidationRequirements` `requiredGoods` stub with a real recipe-sum bill.
- [ ] Add configured operating demand to the bill.
- [ ] Feed the bill into the group deficit ledger on push.
- [ ] Decide push semantics (atomic vs per-entry).
- [ ] Decide validating-good consumption.
- [ ] Decide reusable-plan model (stamp vs clone; shared vs forked config).
- [ ] Decide roads/track representation inside a plan.
- [ ] Decide city demolition cost model.
