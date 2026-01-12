# SSH Test Engine Documentation

The **SSH Test Engine** is a headless runtime environment designed for integration testing of the `ssh` game core. It replaces the browser-based `pixi` engine for tests running in Node.js (via Vitest), eliminating dependencies on the DOM and providing a deterministic simulation loop.

## Purpose

*   **Headless Execution**: run game logic without a browser.
*   **Deterministic Simulation**: Control the game loop precisely for reliable tests.
*   **Scenario Injection**: Load specific game states (`SaveState`) to test isolated behaviors.
*   **Fast Execution**: Optimized for high-performance testing in CI environments.

## Architecture

The test engine is located in `engines/ssh/src/test-engine/`.

### Core Components

*   **`TestEngine`**: Facade class that wraps the `Game` instance. It handles initialization, ticking, and helper methods for testing.
*   **`Environment`**: Polyfills for browser globals (`window`, `requestAnimationFrame`, etc.) required by the core engine.
*   **`Mocks`**: Stubs for game content and assets usually loaded via Vite/HTTP.

### Directory Structure

```text
engines/ssh/src/test-engine/
├── index.ts            # Entry point
├── engine.ts           # TestEngine class implementation
├── environment.ts      # Global environment setup and polyfills
├── assets.ts           # Asset loading utilities (fs-based for Node)
└── mocks/              # Mocks for static game content
```

## Usage

### 1. Basic Setup

To use the engine in a test, instantiate `TestEngine`, initialize it, and load a scenario.

```typescript
import { TestEngine } from '../test-engine';

const engine = new TestEngine();
await engine.init(); // Waits for async engine startup
```

### 2. Loading Scenarios

You can inject a specific board state using `loadScenario`. This is useful for setting up a board with specific resources, hives, or characters without playing through the game.

```typescript
const scenario = {
    freeGoods: [{ goodType: 'mushrooms', position: { q: 2, r: 2 } }],
    hives: [{ name: 'TestHive', alveoli: [{ coord: [2, 2], alveolus: 'tree_chopper' }] }]
};

engine.loadScenario(scenario);
```

### 3. Controlling Time

The engine does not include an automatic run loop. You must manually advance time using `tick()`.

```typescript
// Advance simulation by 5 seconds
engine.tick(5.0); 

// Advance by 1 second, with 0.1s step (default)
engine.tick(1.0);
```

### 4. Spawning Characters

Use the helper to spawn characters with specific scripts.

```typescript
const char = engine.spawnCharacter('Worker', { q: 2, r: 2 });
```

### 5. Script Injection

Since `import.meta.glob` is not available in the Node test environment (unless using `vite-node`), the engine provides a way to load and inject NPC scripts from the `assets/scripts` directory.

```typescript
// Load scripts from disk
const workScript = engine.loadScript('work.npcs');
const inventoryScript = engine.loadScript('inventory.npcs');

// Inject into character context
const { loadNpcScripts } = await import('../npcs/scripts');
loadNpcScripts({ 
    '/scripts/work.npcs': workScript,
    '/scripts/inventory.npcs': inventoryScript 
}, char.scriptsContext);
```

## Implementation Details

### Environment Polyfills
The `ssh` core engine relies on global browser objects. The `TestEngine` automatically patches these on instantiation:
- `globalThis.window`
- `globalThis.document` (minimal stub)
- `globalThis.requestAnimationFrame` (mapped to `setTimeout`)

### Asset Loading
The engine bypasses the standard Vite asset pipeline for tests, using direct file system access to read `.npcs` scripts and other assets required for determining NPC behavior.
