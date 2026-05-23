# Blocking Tile Validation Tools

This module provides validation and debugging tools for blocking tiles as specified in [`entity-space.md`](../../docs/entity-space.md).

## Overview

Blocking tiles are tiles that have crossed from plain/project land into a foundation, shell, or finished built object. These tiles are treated as unpassable for pedestrian transit and completely inaccessible for vehicles.

### Key Concepts

- **Blocking Space**: Any tile with content other than `UnBuiltLand`
- **Landlocked Tile**: A blocking tile whose all neighboring tiles are also blocking tiles (a layout issue)
- **Border Service Position**: A border between a blocking tile and a non-blocking neighbor (valid vehicle service location)

## Files

- [`blocking-tile-validation.ts`](./blocking-tile-validation.ts) - Core validation logic
- [`blocking-tile-debug-commands.ts`](./blocking-tile-debug-commands.ts) - Debug commands and test utilities
- [`blocking-tile-validation.spec.ts`](./blocking-tile-validation.spec.ts) - Test specifications

## Core Validation Functions

### `validateBlockingTiles(tiles: Tile[]): BlockingTileValidationResult`

Performs comprehensive validation of all blocking tiles on the board.

**Returns:**
```typescript
{
  allBlockingTiles: AxialCoord[]      // All blocking tiles found
  landlockedTiles: BlockingTileIssue[] // Landlocked tiles (layout issues)
  borderServicePositions: BorderServicePosition[] // Valid vehicle service locations
  totalIssues: number                  // Count of landlocked tiles
}
```

### `wouldBecomeLandlocked(tiles: Tile[], targetCoord: AxialCoord)`

Checks if building on a specific tile would create landlocked tiles. **This is critical for build plan validation.**

**Important:** This function checks BOTH:
1. If the target tile itself would become landlocked
2. If any adjacent blocking tiles would become landlocked (by closing their only passable opening)

This satisfies the entity-space.md requirement: "the player should be informed when a build plan would create one"

**Returns:**
```typescript
{
  wouldBeLandlocked: boolean
  affectedTiles: AxialCoord[]  // Tiles that would become landlocked
  details: string              // Human-readable explanation
}
```

### `findNearestServicePoint(tiles: Tile[], getNeighbors: GetNeighbors, startCoord: AxialCoord, maxDistance?: number)`

Finds the nearest border service position from a starting position using BFS with proper pathfinding reachability.

**Important:** This function respects actual walkability - it will NOT search through blocking tiles or off-board coordinates.

**Returns:** `BorderServicePosition | null`

### `isServicePositionReachable(tiles: Tile[], getNeighbors: GetNeighbors, startCoord: AxialCoord, servicePosition: BorderServicePosition, maxDistance?: number)`

Checks if a specific border service position is reachable from a starting position using proper pathfinding.

**Returns:** `boolean`

### `formatBlockingTileValidationSummary(result: BlockingTileValidationResult): string`

Formats validation results into a human-readable summary.

## Border Service Positions

Per entity-space.md, vehicles must service blocking tiles from border positions, NOT from the blocking tile center. This module correctly models service positions as:

```typescript
interface BorderServicePosition {
  blockingTile: AxialCoord      // The blocking tile being serviced
  passableTile: AxialCoord      // The adjacent non-blocking tile
  borderPosition: AxialCoord    // The border (midpoint between tiles)
  direction?: number            // Direction from blocking to passable (0-5)
}
```

This ensures that:
- Vehicles can reach the passable tile side of the border
- The vehicle stays outside the blocking tile while servicing
- Loading/unloading is a center-to-border transfer as specified

## Debug Commands

### Browser Console Access

After attaching debug commands with `attachBlockingTileDebugCommands(game)`, use these commands in the browser console:

```javascript
// Run full validation
window.blockingTileDebug.validate()

// Find landlocked tiles
window.blockingTileDebug.findLandlocked()

// Find border service positions (not tile centers!)
window.blockingTileDebug.findBorderServicePositions()

// Check if building would create landlocked tiles (checks adjacent tiles too!)
window.blockingTileDebug.checkWouldBecomeLandlocked(q, r)

// Find nearest service position (uses pathfinding reachability)
window.blockingTileDebug.findNearestServicePoint(q, r, maxDistance?)

// Check if a specific service position is reachable
window.blockingTileDebug.checkServicePositionReachable(startQ, startR, blockingQ, blockingR, passableQ, passableR, maxDistance?)

// Get detailed tile information
window.blockingTileDebug.getTileInfo(q, r)

// Visualize blocking tiles around a position
window.blockingTileDebug.visualize(q, r, radius?)
```

### Programmatic Usage

```typescript
import { BlockingTileDebugCommands } from 'ssh/dev/blocking-tile-debug-commands'

const commands = new BlockingTileDebugCommands(game)

// Run validation
const { result, summary } = commands.validateBlockingTiles()
console.log(summary)

// Find landlocked tiles
const landlocked = commands.findLandlockedTiles()

// Check build plan (checks adjacent blocking tiles too!)
const check = commands.checkWouldBecomeLandlocked(5, 3)
if (check.wouldBeLandlocked) {
  console.warn('This build would create landlocked tiles!')
  console.warn('Affected tiles:', check.affectedTiles)
  console.warn('Details:', check.details)
}

// Find nearest service position with pathfinding
const servicePos = commands.findNearestServicePoint(0, 0, 10)
if (servicePos) {
  console.log('Service position found:', servicePos)
  console.log('Vehicle can reach passable tile:', servicePos.passableTile)
  console.log('Vehicle services blocking tile from border:', servicePos.borderPosition)
}
```

## Test Utilities

### `runBlockingTileValidationTest(game: Game)`

Runs blocking tile validation as a test utility.

**Returns:**
```typescript
{
  passed: boolean      // true if no landlocked tiles found
  result: BlockingTileValidationResult
  summary: string
}
```

## Integration

### Attaching Debug Commands

```typescript
import { attachBlockingTileDebugCommands } from 'ssh/dev/blocking-tile-debug-commands'

// In development setup or game initialization
if (import.meta.env.DEV) {
  attachBlockingTileDebugCommands(game)
}
```

### Using in Build Plan Validation

```typescript
import { wouldBecomeLandlocked } from 'ssh/dev/blocking-tile-validation'

// Before placing a building
const check = wouldBecomeLandlocked(game.hex.tiles, { q, r })
if (check.wouldBeLandlocked) {
  // Warn player or prevent the build
  showWarning(`This building would create inaccessible landlocked tiles: ${check.details}`)
  return false // Prevent the build
}
```

### Using for Vehicle Service Planning

```typescript
import { findNearestServicePoint, isServicePositionReachable } from 'ssh/dev/blocking-tile-validation'

// Find nearest service position for a vehicle
const getNeighbors = (coord: AxialCoord) => tile.walkNeighbors
const servicePos = findNearestServicePoint(game.hex.tiles, getNeighbors, vehiclePos, 20)

if (servicePos) {
  // Verify it's actually reachable
  const reachable = isServicePositionReachable(
    game.hex.tiles,
    getNeighbors,
    vehiclePos,
    servicePos,
    20
  )

  if (reachable) {
    // Plan route to service position
    planVehicleRoute(vehiclePos, servicePos.passableTile)
  }
}
```

## Visualization Legend

When using the `visualize()` command:

- `[B]` - Blocking tile (accessible from border)
- `[L]` - Landlocked tile (inaccessible, layout issue)
- `[.]` - Passable tile (unbuilt land)
- `[?]` - Unknown/missing tile

## Entity Space Rules Reference

From [`entity-space.md`](../../docs/entity-space.md):

### Blocking Tiles
A tile is blocking space once it has at least a foundation:
- Construction site after foundation work has begun
- Alveolus (building or complete)
- Residential tile (building or complete)
- Any other built or building tile content

### Landlocked Tiles
A landlocked tile is a blocking tile whose neighboring tiles are all also blocking tiles. These are layout issues because:
- Pedestrians cannot reach them from passable space
- Vehicles cannot service them
- Once created, no character can walk to their center

**Critical Build Plan Validation:** The engine must detect when a build plan would create landlocked tiles, including cases where building on a passable tile would seal off an adjacent blocking tile's only passable opening.

### Vehicle Service Pattern
When a vehicle needs to service a blocking tile:
1. Drive to a reachable border adjacent to the blocking tile
2. Vehicle stays at border-side position (NOT the blocking tile center)
3. Character steps into the center of the blocking tile
4. Loading/unloading performed as center-to-border transfer
5. Character returns to border and resumes vehicle operation

**Key Point:** Vehicles service from border positions between blocking and passable tiles, NOT from the blocking tile center.

## Implementation Notes

### Critical Fixes Applied

1. **wouldBecomeLandlocked now checks adjacent blocking tiles**
   - Previously only checked if the target tile would become landlocked
   - Now also checks if adjacent blocking tiles would lose their only passable neighbor
   - This prevents creating landlocked tiles by "sealing off" existing blocking tiles

2. **Border service points are border positions, not tile centers**
   - Previously modeled service points as blocking tile centers
   - Now correctly models them as border positions between blocking and passable tiles
   - Vehicles can reach the passable tile side and service from the border

3. **BFS uses pathfinding reachability, not raw neighbors**
   - Previously used raw `axial.neighbors()` which could search through blocking tiles
   - Now uses proper `GetNeighbors` function that respects walkability
   - Ensures "nearest service point" is actually reachable by vehicles

4. **Actual tests instead of placeholders**
   - Comprehensive test suite covering all validation functions
   - Tests for blocking tile detection, landlocked detection, border service positions
   - Tests for wouldBecomeLandlocked with adjacent tile checking
   - Tests for pathfinding-based service point search

### Performance Considerations

- Validation runs in O(n) time where n is the number of tiles
- Landlocked detection checks all 6 neighbors per blocking tile
- Service point search uses BFS with configurable max distance
- Pathfinding-based search ensures actual reachability
- Consider caching results if running frequently

## Future Enhancements

Potential improvements:
- Visual overlay in the game editor highlighting landlocked tiles
- Real-time validation during build placement with visual feedback
- Pathfinding integration to verify actual accessibility
- Performance metrics and optimization for large boards
- Export validation results to file for analysis
- Integration with build planning UI to show would-be-landlocked tiles