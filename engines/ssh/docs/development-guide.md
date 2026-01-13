# Development Guide

This guide helps developers get started contributing to the SSH engine.

## Setup

### Prerequisites

- Node.js 18+ 
- npm or pnpm
- Basic TypeScript knowledge
- Familiarity with hex grids (helpful but not required)

### Installation

```bash
cd engines/ssh
npm install
```

### Development Server

```bash
npm run dev
# Opens http://localhost:5173
```

### Testing

```bash
# Run all tests
npm run test

# Run specific test file
npm run test path/to/test.ts

# Run tests in watch mode
npm run test -- --watch
```

### Code Quality

```bash
# Type checking
npm run check

# Lint and format
npm run biome

# Fix auto-fixable issues
npm run biome -- --write
```

---

## Project Structure

```
engines/ssh/
├── src/
│   ├── lib/              # Core game engine
│   │   ├── game/         # Main game systems
│   │   ├── utils/        # Utility functions
│   │   └── types/        # TypeScript definitions
│   ├── test-engine/      # Headless test environment
│   └── App.svelte        # Main UI component
├── tests/
│   ├── integration/      # Integration tests
│   └── unit/             # Unit tests
├── assets/
│   ├── game-content/     # Game data (JSON/TS)
│   ├── scripts/          # NPC scripts (.npcs)
│   └── sprites/          # Images and textures
└── docs/                 # Documentation
```

---

## Adding a New Alveolus Type

### 1. Define the Alveolus Class

Create a new file in `src/lib/game/hive/`:

```typescript
// src/lib/game/hive/quarry.ts
import { HarvestAlveolus } from './harvest'
import type { Tile } from '../board/tile'

export class QuarryAlveolus extends HarvestAlveolus {
  static readonly key = 'quarry'
  
  constructor(tile: Tile) {
    super(tile)
  }
  
  // What deposit type to harvest
  get targetDeposit() {
    return 'rock'
  }
  
  // What good to produce
  get outputGood() {
    return 'stone'
  }
  
  // How long harvesting takes (seconds)
  get workTime() {
    return 2.5
  }
}
```

### 2. Register the Alveolus

Add to `src/lib/game/hive/index.ts`:

```typescript
import { QuarryAlveolus } from './quarry'

export const alveolusClass = {
  // ... existing types
  quarry: QuarryAlveolus,
}
```

### 3. Add Game Content Data

Update `assets/game-content/alveoli.ts`:

```typescript
export const alveoli = {
  // ... existing
  quarry: {
    name: 'Quarry',
    description: 'Extracts stone from rock deposits',
    construction: {
      time: 5.0,
      materials: {
        logs: 10,
        planks: 5
      }
    },
    storage: {
      capacity: 50,
      allowed: ['stone']
    }
  }
}
```

### 4. Add Visual Assets (Optional)

Add sprite to `assets/sprites/buildings/quarry.png`

Update texture mappings in `assets/game-content/textures.ts`

### 5. Add Tests

Create `tests/unit/quarry.test.ts`:

```typescript
import { describe, test, expect } from 'vitest'
import { TestEngine } from '@/test-engine'

describe('QuarryAlveolus', () => {
  test('should harvest stone from rocks', async () => {
    const engine = new TestEngine()
    await engine.init()
    
    engine.loadScenario({
      tiles: [{ coord: [2, 2], deposit: { type: 'rock', amount: 10 } }],
      hives: [{
        alveoli: [{ coord: [0, 0], alveolus: 'quarry' }]
      }]
    })
    
    engine.tick(30.0) // Let it work
    
    const quarry = engine.game.hex.getTile({ q: 0, r: 0 }).content
    expect(quarry.storage.stock.stone).toBeGreaterThan(0)
  })
})
```

---

## Adding a New NPC Behavior

### 1. Define Context Functions

Add helper functions to appropriate context file (e.g., `src/lib/game/npcs/utils.ts`):

```typescript
export function myCustomAction(char: Character, params: any) {
  // Implement the atomic game state change
  // Return time consumed or throw error
  return 1.0 // seconds
}
```

### 2. Create NPC Script

Create `assets/scripts/myBehavior.npcs`:

```npcs
# My custom behavior
behavior myBehavior:
  # Find target
  target = find.something()
  
  # Walk there
  walk.to(target)
  
  # Perform action
  custom.myAction(target)
  
  # Loop
  goto myBehavior
```

### 3. Register in Scripts Context

Update `src/lib/game/npcs/scripts.ts`:

```typescript
export function loadNpcScripts(scripts: Record<string, string>, context: any) {
  // ... existing
  
  const customContext = {
    myAction: (target: any) => myCustomAction(context.character, target)
  }
  
  context.custom = customContext
}
```

### 4. Test the Behavior

```typescript
test('should execute custom behavior', async () => {
  const engine = new TestEngine()
  await engine.init()
  
  const char = engine.spawnCharacter('Worker', { q: 0, r: 0 })
  
  // Load and inject script
  const script = engine.loadScript('myBehavior.npcs')
  loadNpcScripts({ '/scripts/myBehavior.npcs': script }, char.scriptsContext)
  
  // Run behavior
  await char.scriptsContext.run('myBehavior')
  
  // Assert expected state changes
})
```

---

## Common Development Patterns

### Accessing Game Instance

From within game systems:

```typescript
// Most classes have reference to game or can access via tile
class MySystem {
  constructor(private game: Game) {}
  
  doSomething() {
    const tile = this.game.hex.getTile({ q: 0, r: 0 })
  }
}
```

From browser console (dev mode):

```typescript
// Game instance is exposed globally during development
const game = window.__game__
```

### Debugging Pathfinding

```typescript
const path = game.hex.findPath(from, to, {
  debug: true // Logs pathfinding steps
})
```

### Inspecting Storage State

```typescript
const storage = alveolus.storage

console.log('Stock:', storage.stock)
console.log('Reserved:', storage.reserved)
console.log('Allocated:', storage.allocated)
console.log('Available:', storage.available)
```

### Simulating Time (Tests)

```typescript
// In tests, control time precisely
engine.tick(1.0)   // Advance 1 second
engine.tick(0.1)   // Advance 0.1 seconds

// In browser dev, use time controls in UI
configuration.timeControl = 'fast-forward' // 2x speed
configuration.timeControl = 'pause'        // Pause
```

### Reactive State Updates

The engine uses `mutts` for reactivity:

```typescript
import { reactive } from 'mutts'

const state = reactive({ count: 0 })

// Mutations trigger UI updates automatically
state.count++
```

---

## Testing Strategies

### Unit Tests

Test individual functions or classes in isolation:

```typescript
// tests/unit/storage.test.ts
import { SlottedStorage } from '@/lib/game/storage'

test('storage should enforce capacity', () => {
  const storage = new SlottedStorage(5)
  storage.addGood('logs', 5)
  
  expect(() => storage.addGood('logs', 1)).toThrow()
})
```

### Integration Tests

Test interactions between systems using TestEngine:

```typescript
// tests/integration/production.test.ts
test('sawmill should convert logs to planks', async () => {
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
  
  engine.tick(60.0)
  
  const sawmill = engine.game.hex.getTile({ q: 1, r: 0 }).content
  expect(sawmill.storage.stock.planks).toBeGreaterThan(0)
})
```

### Browser Tests (Playwright)

Test full stack including rendering and user interaction:

```typescript
// tests/e2e/gameplay.test.ts
import { test, expect } from '@playwright/test'

test('should place building', async ({ page }) => {
  await page.goto('http://localhost:5173')
  
  // Click build menu
  await page.click('[data-testid="build-menu"]')
  
  // Select sawmill
  await page.click('[data-testid="sawmill-option"]')
  
  // Click on map
  await page.click('canvas', { position: { x: 400, y: 300 } })
  
  // Verify building placed
  const buildingCount = await page.locator('[data-building]').count()
  expect(buildingCount).toBeGreaterThan(0)
})
```

---

## Common Pitfalls

### 1. Forgetting to Commit Guards

```typescript
// ❌ Wrong - guard never committed
const guard = storage.reserve({ logs: 2 })
// Goods locked forever!

// ✅ Correct
const guard = storage.reserve({ logs: 2 })
try {
  doWork()
  guard.commit()
} catch (e) {
  guard.cancel()
  throw e
}
```

### 2. Mutating Reactive State Incorrectly

```typescript
// ❌ Wrong - bypasses reactivity
storage.stock.logs = 10

// ✅ Correct - use provided methods
storage.addGood('logs', 10)
```

### 3. Hardcoding Coordinates

```typescript
// ❌ Wrong - breaks with different board sizes
const tile = game.hex.getTile({ q: 0, r: 0 })

// ✅ Correct - use relative or dynamic coordinates
const tile = game.hex.getTile(character.position)
const neighbor = game.hex.getTile(axial.add(tile.coord, { q: 1, r: 0 }))
```

### 4. Not Handling Null Returns

```typescript
// ❌ Wrong - getTile can return null
const tile = game.hex.getTile(coord)
tile.content = newContent // Crash if tile is null!

// ✅ Correct
const tile = game.hex.getTile(coord)
if (tile) {
  tile.content = newContent
}
```

### 5. Ignoring TypeScript Errors

```typescript
// ❌ Wrong - defeats the purpose of TypeScript
const storage = alveolus.storage as any
storage.doSomethingWrong()

// ✅ Correct - fix the type issue
if (alveolus.storage) {
  alveolus.storage.addGood('logs', 1)
}
```

---

## Debugging Tips

### Enable Debug Logging

```typescript
// In game.ts or specific system
const DEBUG = true

if (DEBUG) {
  console.log('[System]', data)
}
```

### Inspect Game State

```typescript
// In browser console
const saveData = window.__game__.saveGameData()
console.log(JSON.stringify(saveData, null, 2))
```

### Visualize Pathfinding

```typescript
// Add visual debug markers
const path = game.hex.findPath(from, to)
path.forEach(coord => {
  const tile = game.hex.getTile(coord)
  // Add visual marker to tile
})
```

### Test Specific Scenarios

Use scenario injection for isolated debugging:

```typescript
const engine = new TestEngine()
await engine.init()

// Create exact problematic state
engine.loadScenario({
  // Minimal reproduction case
})

engine.tick(1.0)
// Inspect state
```

---

## Performance Considerations

### Pathfinding

- Cache paths when possible
- Use appropriate search limits
- Consider multi-frame pathfinding for long distances

### Reactive Updates

- Batch mutations when possible
- Use `unreactive()` for large data structures that don't need reactivity

### Rendering

- Minimize sprite count
- Use texture atlases
- Cull off-screen objects

### Memory

- Properly destroy objects when removed
- Unsubscribe from events
- Clear references to allow garbage collection

---

## Contributing

### Code Style

- Follow existing patterns
- Use TypeScript strictly (no `any`, no `@ts-ignore`)
- Write meaningful variable names
- Add JSDoc comments for public APIs

### Commit Messages

Follow conventional commits:

```
feat(hive): add quarry alveolus type
fix(storage): prevent negative stock counts
docs(readme): update installation instructions
test(convey): add multi-hop transfer test
```

### Pull Request Process

1. Create feature branch
2. Implement changes with tests
3. Run `npm run check` and `npm run biome`
4. Submit PR with clear description
5. Address review feedback

---

## Resources

- [Hex Grid Guide](https://www.redblobgames.com/grids/hexagons/) — Comprehensive hex algorithms
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html) — TypeScript reference
- [Vitest Docs](https://vitest.dev/) — Testing framework
- [PIXI.js Docs](https://pixijs.com/guides) — Rendering library

---

## Getting Help

- Check existing tests for examples
- Read related source code
- Search issues in repository
- Ask in project communication channels

Happy coding! 🎮
