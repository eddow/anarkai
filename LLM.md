# Anarkai Workspace Documentation

## Overview
Anarkai is a modular monorepo driven by a custom game engine (`engines/ssh`) and UI framework (`packages/pounce-ts`). It relies heavily on `mutts` for reactivity.

## Architecture
- **State Management**: Using `mutts` reactive proxies.
- **UI Framework**: `pounce-ts` (React-like JSX but with fine-grained reactivity, NO VDOM diffing in the React sense).
- **Game Engine**: `ssh` encapsulates domain logic, using `npcs` for behaviors.

## Project Structure
- `apps/`: Consumers (e.g., `browser-pounce`).
- `engines/`: Core logic (e.g., `ssh`).
- **Libraries**: Shared libraries (`mutts`, `pounce-ts`, `npcs`, `omni18n`) are located in `~/dev/ownk` and linked via the workspace.

## Development
- **Install**: `pnpm install`
- **Dev**: `pnpm dev` (starts all). Targeted: `pnpm dev:pounce`.
- **Test**: `pnpm test` (using Vitest).
