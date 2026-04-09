# ssh-browser

`apps/browser` is the active playable client for Anarkai.

It combines:

- Sursaut-based UI
- Dockview panel layout
- `engine-pixi` world rendering
- `ssh` gameplay state and selection/inspection flows

## Run

```bash
pnpm --filter ssh-browser dev
```

## Useful Commands

- `pnpm --filter ssh-browser check`
- `pnpm --filter ssh-browser test`

## Notes

This app is no longer just a sandbox stub. It is the main integration point for the current terrain, hive, and inspector work.
