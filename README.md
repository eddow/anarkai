# Anarkai

Anarkai is a hex-colony sandbox split into focused workspace packages:

- `engines/terrain`: deterministic terrain and hydrology generation
- `engines/ssh`: gameplay simulation, hive logic, save/load, and streamed board materialization
- `engines/pixi`: Pixi renderer and continuous terrain surface
- `apps/browser`: the playable browser client built on Sursaut

## Current State

The repo has moved beyond early experimentation:

- terrain generation is implemented as a reusable engine
- hive behavior exists and is covered by a broad unit/integration test suite
- the browser client can inspect and interact with the simulation
- continuous terrain rendering is wired through Pixi

The biggest remaining product/architecture gap is not terrain generation anymore. It is turning streamed terrain into a fully first-class streamed gameplay world.

## Quick Start

```bash
pnpm install
pnpm dev:browser
```

Useful workspace commands:

- `pnpm test`
- `pnpm typecheck`
- `pnpm --filter ssh-browser dev`
- `pnpm --filter ssh test`
- `pnpm --filter engine-terrain test`

## Documentation

- [`docs/index.md`](./docs/index.md)
- [`docs/current-status.md`](./docs/current-status.md)
- [`docs/project-inventory.md`](./docs/project-inventory.md)
- [`docs/architecture-overview.md`](./docs/architecture-overview.md)
- [`docs/freight-lines.md`](./docs/freight-lines.md)
