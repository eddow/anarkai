# SSH Testing Infrastructure

This directory contains integration and unit tests for the SSH game engine.

## Directory Structure

- `unit/`: Lower-level tests for core systems (storage, pathfinding, etc.)
- `integration/`: Higher-level tests for NPC behaviors and complex game scenarios.
- `e2e/`: (Reserved) Playwright-based tests for browser-level interactions.

## Key Mechanisms

### Default Script Loading

The SSH engine automatically loads NPC scripts (`.npcs` files) from `assets/scripts` using Vite's `import.meta.glob`. This happens during the initialization of a character's `scriptsContext`.

In tests, you don't need to manually read and load these scripts unless you want to override them. Accessing `char.scriptsContext` is enough to trigger the default loading:

```typescript
// In an integration test
const game = new Game(config, scenario)
await game.loaded

for (const char of game.population) {
    // Scripts are already loaded and bound to the context here
    void char.scriptsContext 
}
```

The loading logic is located in `src/lib/game/npcs/context/index.ts`.

### Test Engine

For integration tests, `TestEngine` (in `src/test-engine.ts`) provides a headless environment to run game scenarios without needing a browser or PixiJS rendering loop. It handles scenario loading, character spawning, and manual ticking of the game clock.

## Running Tests

Run all tests:
```bash
npm run test
```

Run core unit tests:
```bash
npm run test:core
```

Run a specific test:
```bash
npx vitest run tests/integration/source_allocation.test.ts
```
