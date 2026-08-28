# Anarkai Documentation

## Start Here

- [`./current-status.md`](./current-status.md): what is implemented, what drifted, and what to tackle next
- [`./project-inventory.md`](./project-inventory.md): current repo layout
- [`./architecture-overview.md`](./architecture-overview.md): high-level system boundaries
- [`./video-plan.md`](./video-plan.md): outline for a 10-20 minute presentation of Anark-AI
- [`./browser-adapter.md`](./browser-adapter.md): browser-local Anarkai UI adapter plan
- [`./engine-render-events-analysis.md`](./engine-render-events-analysis.md): why explicit SSH-to-Pixi presentation events should replace hidden reactive coupling
- [`./freight-lines.md`](./freight-lines.md): freight routes (`FreightStop` bay vs zone, normalization, UI status)
- [`./plots.md`](./plots.md): authored, optionally-named areas (work authority, terraforming, hive plot variables)
- [`./districts.md`](./districts.md): per-tile, per-owner land-use designations (residential / commercial / clean)
- [`./commerce.md`](./commerce.md): internal distribution districts and external trade with NPC groups
- [`./terrain-generation-roadmap.md`](./terrain-generation-roadmap.md): terrain affordances, roads, NPC placement, and NPC traffic generation
- [`./rust-core.md`](./rust-core.md): Rust/WASM core engine architecture and terrain generation algorithm refactoring
- [`./world-representation.md`](./world-representation.md): physical scale, symbolic map representation, and terrain/display scale knobs
- [`./roads.md`](./roads.md): road movement models and generated road texture notes
- [`./next-directions.md`](./next-directions.md): central decision map for the next gameplay/management tranche

## Plans (proposals & open questions)

Decisions live in `docs/`, proposals in `plans/`. The active plans:

- [`../plans/emergent-planning-architecture.md`](../plans/emergent-planning-architecture.md): replace
  global planner optimization with local, emergent decisions (the "ants" model).
- [`../plans/rust-migration-continuation.md`](../plans/rust-migration-continuation.md): the "move only
  proved algorithms" gate for the Rust port.
- [`../plans/spontaneous-lines.md`](../plans/spontaneous-lines.md): transport automation (one-shot orders,
  the internality slider).
- [`../plans/districts.md`](../plans/districts.md): spontaneous residential/commercial (growth/shrinkage).
- [`../plans/plots.md`](../plans/plots.md): authored areas — terraforming, hive plot variables, division/merge.
- [`../plans/commerce-architecture.md`](../plans/commerce-architecture.md): price field, sourcing, reserve.
- [`../plans/details-punchlist.md`](../plans/details-punchlist.md): leftover UI polish.

## Workspace Commands

```bash
pnpm dev:browser
pnpm test
pnpm typecheck
```

Useful focused commands:

```bash
pnpm --filter ssh-browser dev
pnpm --filter ssh exec vitest run tests/unit
pnpm --filter engine-terrain test
```
