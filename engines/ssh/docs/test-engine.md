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

## Testing Patterns

### Integration Test Structure

A typical integration test follows this pattern:

```typescript
import { describe, test, expect } from 'vitest'
import { TestEngine } from '@/test-engine'

describe('Feature Name', () => {
  test('should do something', async () => {
    // 1. Setup
    const engine = new TestEngine()
    await engine.init()
    
    // 2. Arrange
    engine.loadScenario({
      hives: [/* ... */],
      freeGoods: [/* ... */]
    })
    
    // 3. Act
    engine.tick(10.0) // Simulate 10 seconds
    
    // 4. Assert
    const tile = engine.game.hex.getTile({ q: 2, r: 2 })
    expect(tile.content).toBeDefined()
  })
})
```

### Accessing Game State

The test engine exposes the full game instance:

```typescript
// Access hex board
const tile = engine.game.hex.getTile({ q: 0, r: 0 })

// Access population
const characters = Array.from(engine.game.population.characters.values())

// Access hives
const hive = Array.from(engine.game.hex.getTile(coord).content.hive)

// Query free goods
const goods = engine.game.hex.freeGoods.getAt(coord)
```

### Deterministic Testing

The test engine provides deterministic execution:

- **Fixed time steps**: `tick()` advances by exact time deltas
- **Seeded RNG**: Game uses seeded random number generation
- **No async rendering**: All operations are synchronous
- **Controlled environment**: No browser timing variability

### Testing Async Behaviors

For testing behaviors that span multiple game ticks:

```typescript
test('character should complete job', async () => {
  const engine = new TestEngine()
  await engine.init()
  
  // Setup scenario
  engine.loadScenario({ /* ... */ })
  
  // Tick until condition met (with timeout)
  let ticks = 0
  const maxTicks = 100
  
  while (ticks < maxTicks) {
    engine.tick(0.1)
    
    const character = engine.getCharacter('Worker')
    if (character.currentJob === null) {
      break // Job completed
    }
    
    ticks++
  }
  
  expect(ticks).toBeLessThan(maxTicks) // Ensure it didn't timeout
})
```

## Common Patterns

### Testing Resource Flow

```typescript
test('goods should flow from source to destination', async () => {
  const engine = new TestEngine()
  await engine.init()
  
  engine.loadScenario({
    hives: [{
      alveoli: [
        { coord: [0, 0], alveolus: 'storage', goods: { logs: 10 } },
        { coord: [1, 0], alveolus: 'sawmill' }
      ]
    }]
  })
  
  engine.tick(30.0) // Allow time for conveyance
  
  const sawmill = engine.game.hex.getTile({ q: 1, r: 0 }).content
  expect(sawmill.storage.stock.logs).toBeGreaterThan(0)
})
```

### Testing NPC Behaviors

```typescript
test('character should harvest resources', async () => {
  const engine = new TestEngine()
  await engine.init()
  
  engine.loadScenario({
    tiles: [{ coord: [2, 2], deposit: { type: 'tree', amount: 5 } }],
    hives: [{
      alveoli: [{ coord: [0, 0], alveolus: 'tree_chopper' }]
    }]
  })
  
  const char = engine.spawnCharacter('Harvester', { q: 0, r: 0 })
  
  engine.tick(60.0) // Allow time to harvest
  
  const storage = engine.game.hex.getTile({ q: 0, r: 0 }).content.storage
  expect(storage.stock.logs).toBeGreaterThan(0)
})
```

### Testing Error Conditions

```typescript
test('should handle missing resources gracefully', async () => {
  const engine = new TestEngine()
  await engine.init()
  
  engine.loadScenario({
    hives: [{
      alveoli: [{ coord: [0, 0], alveolus: 'sawmill' }] // No logs
    }]
  })
  
  // Should not throw even without resources
  expect(() => engine.tick(10.0)).not.toThrow()
})
```

## Debugging Tests

### Console Logging

The test engine preserves console output:

```typescript
test('debug test', async () => {
  const engine = new TestEngine()
  await engine.init()
  
  console.log('Game state:', engine.game.saveGameData())
  
  engine.tick(1.0)
  
  console.log('After 1 second:', engine.game.saveGameData())
})
```

### Inspecting State

Use the game's save data for detailed inspection:

```typescript
const saveData = engine.game.saveGameData()
console.log('Hives:', saveData.hives)
console.log('Free goods:', saveData.freeGoods)
console.log('Population:', saveData.population)
```

## Limitations

- **No Visual Testing**: Cannot test rendering or UI interactions
- **No Real-time Input**: Cannot simulate user input events
- **Simplified Environment**: Some browser APIs may not be fully polyfilled
- **Manual Time Control**: Must explicitly advance time via `tick()`

For visual or interactive testing, use Playwright browser tests instead.
