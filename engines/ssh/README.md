# ssh

`engines/ssh` is the gameplay engine for Anarkai.

It owns:

- the board and tile-content model
- alveolus and hive behavior
- NPC work logic
- storage reservations and allocations
- save/load
- streamed gameplay materialization on top of deterministic terrain

## Run Checks

```bash
pnpm --filter ssh check
pnpm --filter ssh test
```

## Key Docs

- [`./docs/architecture.md`](./docs/architecture.md)
- [`./docs/core-systems.md`](./docs/core-systems.md)
- [`./docs/hive-refresh-and-good-movements.md`](./docs/hive-refresh-and-good-movements.md)
- [`./docs/npc-behaviors.md`](./docs/npc-behaviors.md)
- [`./docs/test-engine.md`](./docs/test-engine.md)

## Current Focus

The main remaining architectural job is making gameplay streaming a first-class concern, not extending basic hive mechanics.
