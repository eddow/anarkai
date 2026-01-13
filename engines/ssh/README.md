## SSH — Hex Colony Sandbox (work-in-progress)

A small sandbox colony/automation game experiment on a hex grid. NPCs perform jobs (harvest, transform, convey), move goods across borders, and keep inventories balanced while you place buildings and shape the flow of resources.

### Highlights
- **Hex grid world** with terrain generation and objects (trees, rocks, bushes).
- **Jobs and NPC scripting** for harvesting, transforming, self‑care, walking, inventory and conveying goods.
- **Goods flow** across tile borders with reservations/allocations to avoid conflicts.
- **PIXl/Canvas rendering** via `pixi.js` with Svelte UI.
- **Type‑safe gameplay code** in TypeScript.

### Getting started
1. Install Node 18+.
2. Install dependencies:
   - `npm install`
3. Start the dev server:
   - `npm run dev`
4. Open the app (if not auto‑opened):
   - `http://localhost:5173`

### Scripts
- `npm run dev` — start Vite dev server
- `npm run build` — production build
- `npm run preview` — preview the production build
- `npm run check` — typecheck (Svelte + TS)
- `npm run biome` — lint and format
- `npm run test` — run unit tests (Vitest)

### Tech stack
- TypeScript
- Vitest for tests

### Status
Active WIP. Systems and naming may change (e.g., convey/collect flows). Expect breaking changes.

## Documentation

Comprehensive documentation is available in the [`docs/`](docs/) directory:

- **[Architecture Overview](docs/architecture.md)** — System design and core components
- **[Core Systems](docs/core-systems.md)** — Detailed documentation of game systems
- **[NPC Behaviors](docs/npc-behaviors.md)** — Character behavioral specifications
- **[Test Engine](docs/test-engine.md)** — Headless testing environment
- **[Development Guide](docs/development-guide.md)** — Contributing and development patterns
