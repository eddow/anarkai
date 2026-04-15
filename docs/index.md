# Anarkai Documentation

## Start Here

- [`./current-status.md`](./current-status.md): what is implemented, what drifted, and what to tackle next
- [`./project-inventory.md`](./project-inventory.md): current repo layout
- [`./architecture-overview.md`](./architecture-overview.md): high-level system boundaries
- [`./freight-lines.md`](./freight-lines.md): freight routes (`FreightStop` bay vs zone, normalization, UI status)
- Handoff / remaining UI tasks: [`../sandbox/freight-handoff.md`](../sandbox/freight-handoff.md)

## Workspace Commands

```bash
pnpm dev:browser
pnpm test
pnpm typecheck
```

Useful focused commands:

```bash
pnpm --filter ssh-browser dev
pnpm --filter ssh test
pnpm --filter engine-terrain test
```
