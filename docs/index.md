# Anarkai Documentation

## Start Here

- [`./current-status.md`](./current-status.md): what is implemented, what drifted, and what to tackle next
- [`./project-inventory.md`](./project-inventory.md): current repo layout
- [`./architecture-overview.md`](./architecture-overview.md): high-level system boundaries
- [`./browser-adapter.md`](./browser-adapter.md): browser-local Anarkai UI adapter plan
- [`./engine-render-events-analysis.md`](./engine-render-events-analysis.md): why explicit SSH-to-Pixi presentation events should replace hidden reactive coupling
- [`./freight-lines.md`](./freight-lines.md): freight routes (`FreightStop` bay vs zone, normalization, UI status)
- [`./commerce.md`](./commerce.md): internal distribution zones and external trade with NPC groups
- [`./terrain-generation-roadmap.md`](./terrain-generation-roadmap.md): terrain affordances, roads, NPC placement, and NPC traffic generation
- [`./rust-core.md`](./rust-core.md): Rust/WASM core engine architecture and terrain generation algorithm refactoring
- [`./world-representation.md`](./world-representation.md): physical scale, symbolic map representation, and terrain/display scale knobs
- [`./roads.md`](./roads.md): road movement models and generated road texture notes
- [`./next-directions.md`](./next-directions.md): central decision map for the next gameplay/management tranche

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
