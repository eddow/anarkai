# Core Systems

This document provides detailed documentation of the core game systems in the SSH engine.

## Hex Board System

### Coordinate System

The engine uses **axial coordinates** (q, r) for hexagonal tiles:

```typescript
interface AxialCoord {
  q: number  // Column
  r: number  // Row
}
```

**Key Operations:**
- `axial.add(a, b)` — Add two coordinates
- `axial.distance(a, b)` — Manhattan distance
- `axial.round(coord)` — Round floating point to nearest hex
- `axial.neighbors(coord)` — Get 6 adjacent tiles

### Tiles

Each tile can contain different types of content:

**UnBuiltLand:**
- Terrain type (grassland, mountain, water)
- Optional deposit (trees, rocks, bushes)
- Optional project (construction plan)

**Alveolus:**
- Functional building (harvester, sawmill, storage, etc.)
- Connected to a Hive network
- May have storage capacity

**Pathfinding:**

Uses A* algorithm with customizable heuristics:

```typescript
const path = game.hex.findPath(from, to, {
  heuristic: (tile) => {
    // Custom scoring logic
    return tile.content instanceof UnBuiltLand ? 1 : 10
  }
})
```

### Zones

Tiles can be assigned to zones for organization and prioritization:

- **Harvest Zone**: Prioritized for resource extraction
- **Residential Zone**: Designated for living quarters
- **Custom Zones**: Extensible system for future zone types

```typescript
game.hex.zoneManager.setZone({ q: 2, r: 3 }, 'harvest')
const zone = game.hex.zoneManager.getZone({ q: 2, r: 3 })
```

---

## Storage System

### Storage Types

#### SlottedStorage

Fixed-capacity storage with individual slots:

```typescript
const inventory = new SlottedStorage(10) // 10 slots
inventory.addGood('logs', 5)
```

**Use Cases:**
- Character inventory
- Limited-capacity containers

#### SpecificStorage

Unlimited storage for specific good types:

```typescript
const warehouse = new SpecificStorage(['logs', 'planks'])
warehouse.addGood('logs', 100) // No limit
warehouse.addGood('stone', 1)  // Error: not allowed
```

**Use Cases:**
- Specialized storage buildings
- Type-restricted warehouses

#### NoStorage

Placeholder for buildings without storage:

```typescript
const noStorage = NoStorage.instance
// All operations are no-ops
```

### Reservations & Allocations

The storage system uses a **two-phase commit** pattern to prevent race conditions:

**Reservation** (lock existing goods for use):
```typescript
const guard = storage.reserve({ logs: 2 })
// Logs are locked, can't be used by others
// Later...
guard.commit() // Remove from storage
// or
guard.cancel() // Release lock
```

**Allocation** (reserve space for incoming goods):
```typescript
const guard = storage.allocate({ planks: 3 })
// Space reserved for 3 planks
// Later...
guard.commit() // Add to storage
// or
guard.cancel() // Release reservation
```

**Example Transaction:**
```typescript
// Transform: 2 logs -> 1 plank
const inputGuard = storage.reserve({ logs: 2 })
const outputGuard = storage.allocate({ planks: 1 })

// Do work...
await wait(workTime)

// Commit both atomically
inputGuard.commit()  // Remove logs
outputGuard.commit() // Add plank
```

This ensures:
- No double-booking of resources
- No storage overflow
- Atomic multi-step transactions

---

## Hive System

### Hive Structure

A **Hive** is a connected network of Alveoli that share:
- Workforce (characters can work at any Alveolus)
- Resource priorities (manual needs system)
- Production chains (automatic good flow)

### Alveolus Types

#### Harvest Alveolus

Extracts resources from terrain deposits:

```typescript
class TreeChopperAlveolus extends HarvestAlveolus {
  targetDeposit = 'tree'
  outputGood = 'logs'
  workTime = 2.0
}
```

**Behavior:**
- Workers find nearest matching deposit
- Harvest resources into carrying inventory
- Deliver to Alveolus storage

#### Transform Alveolus

Converts goods via recipes:

```typescript
class SawmillAlveolus extends TransformAlveolus {
  recipe = {
    inputs: { logs: 2 },
    outputs: { planks: 1 }
  }
  workTime = 3.0
}
```

**Behavior:**
- Workers check for available inputs
- Reserve inputs, allocate output space
- Perform transformation
- Commit transaction

#### Gatherer Alveolus

Collects free goods from the ground:

```typescript
class LumberjackAlveolus extends GathererAlveolus {
  gatherableGoods = ['logs']
  gatherRadius = 10
}
```

**Behavior:**
- Scouts for matching free goods in radius
- Plans efficient collection path
- Returns goods to storage

#### Storage Alveolus

Pure storage building:

```typescript
class WarehouseAlveolus extends StorageAlveolus {
  storageCapacity = 100
  allowedGoods = ['logs', 'planks', 'stone']
}
```

#### Transit Alveolus

Internal conveyor system:

```typescript
class ConveyorAlveolus extends TransitAlveolus {
  transferSpeed = 1.0 // goods per second
}
```

**Behavior:**
- Monitors for pending good movements
- Animates visual transport
- Updates logical storage

### Hive Connection

Alveoli auto-connect when built adjacent to existing Hive buildings:

```typescript
// Building next to existing hive auto-connects
const tile1 = getTile({ q: 0, r: 0 })
const tile2 = getTile({ q: 1, r: 0 }) // Adjacent

const alv1 = new SawmillAlveolus(tile1)
const alv2 = new WarehouseAlveolus(tile2)

// alv1.hive === alv2.hive (automatically merged)
```

**Manual Management:**
```typescript
const hive = Hive.for(tile)
hive.attach(alveolus)  // Add to hive
hive.detach(alveolus)  // Remove from hive
```

### Production Priorities

Manual needs system for setting production goals:

```typescript
hive.manualNeeds = {
  planks: 50,
  stone: 20
}
```

The Hive logic uses this to prioritize work assignments.

---

## Population System

### Character Lifecycle

**Creation:**
```typescript
const char = game.population.createCharacter('Worker', { q: 2, r: 2 })
```

**Properties:**
- `name: string` — Unique identifier
- `position: AxialCoord` — Current location
- `carry: SlottedStorage` — Inventory (default 10 slots)
- `hunger: number` — 0-100, increases over time
- `currentJob: JobPlan | null` — Active work assignment

**Destruction:**
```typescript
game.population.removeCharacter(char)
```

### Job System

Characters execute jobs assigned by Hives:

```typescript
interface JobPlan {
  type: 'harvest' | 'transform' | 'convey' | 'gather' | 'construct' | 'foundation'
  target: Alveolus | Tile
  priority: number
}
```

**Job Assignment Flow:**
1. Hive generates job plans based on needs
2. Idle characters query `hive.nextJob()`
3. Character executes NPC script for job type
4. Job completes, character becomes idle again

### Needs System

**Hunger:**
- Increases at constant rate (~1 per game second)
- Critical threshold: 70 (triggers `goEat` behavior)
- Character seeks food from:
  1. Own inventory
  2. Food storage buildings
  3. Free food on ground

**Future Needs:**
- Sleep / Rest
- Social / Entertainment
- Safety / Shelter

### Script Execution

Characters have a `scriptsContext` for NPC script execution:

```typescript
// Scripts are loaded dynamically
loadNpcScripts(scriptFiles, char.scriptsContext)

// Execute script
await char.scriptsContext.run('work.harvest')
```

See [NPC Behaviors](npc-behaviors.md) for detailed script documentation.

---

## Goods System

### Good Types

Defined in game content configuration:

```typescript
type GoodType = 
  | 'logs' | 'planks' | 'stone' | 'iron_ore' 
  | 'mushrooms' | 'berries' | 'meat'
  // ... etc
```

### Free Goods

Goods lying on the ground at specific coordinates:

```typescript
// Add free good
game.hex.freeGoods.add(tile, 'mushrooms', { 
  position: { q: 2.3, r: 1.7 } // Precise sub-tile position
})

// Query free goods at tile
const goods = game.hex.freeGoods.getAt({ q: 2, r: 1 })
// Returns: [{ goodType: 'mushrooms', position: {...} }]

// Remove free good
game.hex.freeGoods.remove(tile, good)
```

**Properties:**
- Precise sub-tile positioning (fractional q, r)
- No ownership (anyone can pick up)
- Visual representation on map
- Can "burden" working tiles

### Storage Goods

Goods in building or character storage:

```typescript
const storage = alveolus.storage
storage.addGood('logs', 10)
storage.hasGood('logs', 5) // Check availability
storage.removeGood('logs', 3)
storage.stock // { logs: 7, ... }
```

### Carried Goods

Goods in character inventory:

```typescript
const char = game.population.createCharacter('Worker', coord)
char.carry.addGood('logs', 5)
char.carry.isFull // Check if at capacity
```

### Good Movement

Goods flow through the system via several mechanisms:

**1. Character Transport:**
- Pick up from storage → carry → drop to storage
- Pick up free good → carry → drop to storage

**2. Conveyance:**
- Storage A → Transit system → Storage B
- Managed by Transit Alveolus workers

**3. Transformation:**
- Input goods reserved from storage
- Output goods allocated to storage
- Atomic swap on completion

**4. Production:**
- Harvesting creates new goods
- Consumption (eating) destroys goods

---

## World Generation

### Generator System

Procedural generation uses seeded RNG for reproducibility:

```typescript
const config: GameGenerationConfig = {
  boardSize: 12,        // Hex radius
  terrainSeed: 1234,    // RNG seed
  characterCount: 3,    // Initial population
  characterRadius: 200  // Spawn radius
}

game.generate(config)
```

### Terrain Generation

Uses Perlin noise for:
- Height map (mountains, valleys)
- Moisture map (water, grassland)
- Temperature variations

**Deposit Placement:**
- Trees: grassland with low density
- Rocks: mountains with medium density
- Bushes: grassland edges

### Initial Goods

Each tile starts with equilibrium goods:
- Random count based on deposit type
- Sub-tile positioning using triangular distribution
- Immediate availability for gathering

### Patches

Override generated state with specific configurations:

```typescript
game.generate(config, {
  tiles: [
    { coord: [2, 2], deposit: { type: 'tree', amount: 10 } }
  ],
  hives: [
    { alveoli: [{ coord: [0, 0], alveolus: 'sawmill' }] }
  ],
  freeGoods: [
    { goodType: 'mushrooms', position: { q: 3, r: 3 } }
  ]
})
```

This allows precise test scenarios and saved game restoration.

---

## Event System

The game uses an event-driven architecture for loose coupling:

```typescript
// Subscribe to events
game.on('gameStart', () => {
  console.log('Game initialized!')
})

game.on('objectClick', (pointer, object) => {
  console.log('Clicked:', object)
})

// Emit events
game.emit('gameStart')
```

**Available Events:**
- `gameStart()` — Fired after world generation
- `objectOver(pointer, object)` — Mouse hover
- `objectOut(pointer, object)` — Mouse leave
- `objectDown(pointer, object)` — Mouse down
- `objectUp(pointer, object)` — Mouse up
- `objectClick(pointer, object)` — Click
- `objectDrag(tiles, event)` — Drag operation

This allows UI components to react to game state changes without tight coupling.
