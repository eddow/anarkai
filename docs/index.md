# Anarkai Documentation

## Start Here

- [`./current-status.md`](./current-status.md): what is implemented, what drifted, and what to tackle next
- [`./project-inventory.md`](./project-inventory.md): current repo layout
- [`./architecture-overview.md`](./architecture-overview.md): high-level system boundaries
- [`./freight-lines.md`](./freight-lines.md): freight routes (`FreightStop` bay vs zone, normalization, UI status)

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
