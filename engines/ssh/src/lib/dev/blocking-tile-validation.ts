import type { AxialCoord } from 'ssh/utils'
import { axial } from 'ssh/utils'
import { toAxialCoord } from 'ssh/utils/position'
import type { Tile } from '../board/tile'
import type { GetNeighbors } from '../utils/pathfinding'

/**
 * Represents a border position between two adjacent tiles
 * This is where vehicles can service blocking tiles
 */
export interface BorderServicePosition {
	/** The blocking tile being serviced */
	blockingTile: AxialCoord
	/** The adjacent non-blocking (passable) tile */
	passableTile: AxialCoord
	/** The border position (midpoint between the two tiles) */
	borderPosition: AxialCoord
	/** Direction from blocking tile to passable tile (0-5), or undefined if direction cannot be determined */
	direction?: number
}

/**
 * Represents a blocking tile validation issue
 */
export interface BlockingTileIssue {
	/** The tile coordinate where the issue was detected */
	coord: AxialCoord
	/** Type of issue detected */
	issueType: 'landlocked' | 'would-become-landlocked'
	/** Additional details about the issue */
	details: string
	/** Related tiles involved in this issue */
	relatedTiles: AxialCoord[]
}

/**
 * Validation result for blocking tile analysis
 */
export interface BlockingTileValidationResult {
	/** All blocking tiles found on the board */
	allBlockingTiles: AxialCoord[]
	/** Landlocked blocking tiles (surrounded by other blocking tiles) */
	landlockedTiles: BlockingTileIssue[]
	/** Border service positions (valid vehicle service locations) */
	borderServicePositions: BorderServicePosition[]
	/** Total count of issues found */
	totalIssues: number
}

/**
 * Check if a tile is blocking space
 * A tile is blocking if it has content other than UnBuiltLand
 */
function _isBlockingTile(tile: Tile | undefined): boolean {
	return tile?.isBlockingSpace ?? false
}

/**
 * Check if a blocking tile is landlocked
 * A tile is landlocked if all its neighbors are also blocking tiles
 */
function isLandlockedTile(tile: Tile): boolean {
	if (!tile.isBlockingSpace) {
		return false
	}

	const neighbors = tile.neighborTiles
	// If a tile has no neighbors (edge of board), it's not landlocked
	if (neighbors.length === 0) {
		return false
	}

	// Check if all neighbors are blocking tiles
	return neighbors.every((neighbor) => neighbor.isBlockingSpace)
}

/**
 * Count the number of non-blocking neighbors a tile has
 */
function countNonBlockingNeighbors(tile: Tile): number {
	return tile.neighborTiles.filter((neighbor) => !neighbor.isBlockingSpace).length
}

/**
 * Find all blocking tiles on the board
 */
function findAllBlockingTiles(tiles: Tile[]): AxialCoord[] {
	const blockingTiles: AxialCoord[] = []
	for (const tile of tiles) {
		if (tile.isBlockingSpace) {
			const coord = toAxialCoord(tile.position)
			if (coord) {
				blockingTiles.push(coord)
			}
		}
	}
	return blockingTiles
}

/**
 * Find all landlocked blocking tiles
 */
function findLandlockedTiles(tiles: Tile[]): BlockingTileIssue[] {
	const issues: BlockingTileIssue[] = []

	for (const tile of tiles) {
		if (isLandlockedTile(tile)) {
			const coord = toAxialCoord(tile.position)
			if (!coord) continue

			const neighbors = tile.neighborTiles
			const relatedTiles = neighbors
				.map((n) => toAxialCoord(n.position))
				.filter((c): c is AxialCoord => c !== undefined)

			issues.push({
				coord,
				issueType: 'landlocked',
				details: `Landlocked blocking tile surrounded by ${neighbors.length} blocking tiles`,
				relatedTiles,
			})
		}
	}

	return issues
}

/**
 * Find all border service positions
 * A border service position is a border between a blocking tile and a non-blocking neighbor
 * These are valid vehicle service locations
 */
function findBorderServicePositions(tiles: Tile[]): BorderServicePosition[] {
	const servicePositions: BorderServicePosition[] = []
	const tileMap = new Map<string, Tile>()

	// Build a map for quick lookup
	for (const tile of tiles) {
		const coord = toAxialCoord(tile.position)
		if (coord) {
			tileMap.set(axial.key(coord), tile)
		}
	}

	for (const tile of tiles) {
		if (!tile.isBlockingSpace) continue

		const blockingCoord = toAxialCoord(tile.position)
		if (!blockingCoord) continue

		// Check each neighbor
		for (const neighbor of tile.neighborTiles) {
			if (neighbor.isBlockingSpace) continue

			// Found a non-blocking neighbor - this is a valid service border
			const passableCoord = toAxialCoord(neighbor.position)
			if (!passableCoord) continue

			// Calculate the border position (midpoint between the two tiles)
			const borderPosition = axial.linear([0.5, blockingCoord], [0.5, passableCoord])

			// Determine direction from blocking to passable by checking which neighbor index matches
			const blockingNeighbors = axial.neighbors(blockingCoord)
			let direction: number | undefined
			for (let i = 0; i < blockingNeighbors.length; i++) {
				if (axial.key(blockingNeighbors[i]) === axial.key(passableCoord)) {
					direction = i
					break
				}
			}

			servicePositions.push({
				blockingTile: blockingCoord,
				passableTile: passableCoord,
				borderPosition,
				direction,
			})
		}
	}

	return servicePositions
}

/**
 * Validate blocking tiles on the board
 * This function performs a comprehensive analysis of blocking tiles and identifies:
 * - All blocking tiles
 * - Landlocked tiles (problematic layout issues)
 * - Border service positions (valid vehicle service locations)
 */
export function validateBlockingTiles(tiles: Tile[]): BlockingTileValidationResult {
	const allBlockingTiles = findAllBlockingTiles(tiles)
	const landlockedTiles = findLandlockedTiles(tiles)
	const borderServicePositions = findBorderServicePositions(tiles)

	return {
		allBlockingTiles,
		landlockedTiles,
		borderServicePositions,
		totalIssues: landlockedTiles.length,
	}
}

/**
 * Get a human-readable summary of blocking tile validation results
 */
export function formatBlockingTileValidationSummary(result: BlockingTileValidationResult): string {
	const lines: string[] = []

	lines.push('=== Blocking Tile Validation Summary ===')
	lines.push(`Total blocking tiles: ${result.allBlockingTiles.length}`)
	lines.push(`Landlocked tiles (issues): ${result.landlockedTiles.length}`)
	lines.push(`Border service positions: ${result.borderServicePositions.length}`)

	if (result.landlockedTiles.length > 0) {
		lines.push('\n=== Landlocked Tiles (Layout Issues) ===')
		for (const issue of result.landlockedTiles) {
			lines.push(`  Tile (${issue.coord.q}, ${issue.coord.r}): ${issue.details}`)
		}
	}

	if (result.borderServicePositions.length > 0) {
		lines.push('\n=== Border Service Positions (Valid Vehicle Service Locations) ===')
		for (const pos of result.borderServicePositions.slice(0, 10)) {
			// Show first 10 to avoid overwhelming output
			lines.push(
				`  Blocking (${pos.blockingTile.q}, ${pos.blockingTile.r}) <-> Passable (${pos.passableTile.q}, ${pos.passableTile.r}) [dir: ${pos.direction}]`
			)
		}
		if (result.borderServicePositions.length > 10) {
			lines.push(`  ... and ${result.borderServicePositions.length - 10} more`)
		}
	}

	return lines.join('\n')
}

/**
 * Check if building on a specific tile would create landlocked tiles
 * This checks BOTH:
 * 1. If the target tile itself would become landlocked
 * 2. If any adjacent blocking tiles would become landlocked (by closing their only passable opening)
 *
 * This is critical for build plan validation per entity-space.md:
 * "the player should be informed when a build plan would create one"
 */
export function wouldBecomeLandlocked(
	tiles: Tile[],
	targetCoord: AxialCoord
): { wouldBeLandlocked: boolean; affectedTiles: AxialCoord[]; details: string } {
	// Find the target tile
	const targetTile = tiles.find((tile) => {
		const coord = toAxialCoord(tile.position)
		return coord && axial.key(coord) === axial.key(targetCoord)
	})

	if (!targetTile) {
		return { wouldBeLandlocked: false, affectedTiles: [], details: 'Tile not found on board' }
	}

	const affectedTiles: AxialCoord[] = []
	const details: string[] = []

	// If the tile is already blocking, check if it's landlocked
	if (targetTile.isBlockingSpace) {
		if (isLandlockedTile(targetTile)) {
			return {
				wouldBeLandlocked: true,
				affectedTiles: [],
				details: 'Tile is already landlocked',
			}
		}
		return {
			wouldBeLandlocked: false,
			affectedTiles: [],
			details: 'Tile is already blocking and not landlocked',
		}
	}

	// Simulate the tile becoming blocking by checking its current neighbors
	const neighbors = targetTile.neighborTiles

	// Check 1: Would the target tile itself become landlocked?
	const allNeighborsBlocking = neighbors.every((neighbor) => neighbor.isBlockingSpace)
	if (allNeighborsBlocking && neighbors.length > 0) {
		affectedTiles.push(targetCoord)
		details.push(`Target tile (${targetCoord.q}, ${targetCoord.r}) would become landlocked`)
	}

	// Check 2: Would any adjacent blocking tiles become landlocked?
	// This is the critical fix - we must check if building here would seal off
	// any adjacent blocking tiles that currently have this tile as their ONLY passable neighbor
	for (const neighbor of neighbors) {
		if (!neighbor.isBlockingSpace) continue

		// Count how many non-blocking neighbors this blocking tile currently has
		const currentNonBlockingCount = countNonBlockingNeighbors(neighbor)

		// If this blocking tile currently has exactly 1 non-blocking neighbor (the target),
		// then building on the target would make it landlocked
		if (currentNonBlockingCount === 1) {
			const neighborCoord = toAxialCoord(neighbor.position)
			if (neighborCoord) {
				affectedTiles.push(neighborCoord)
				details.push(
					`Adjacent blocking tile (${neighborCoord.q}, ${neighborCoord.r}) would become landlocked (loses its only passable neighbor)`
				)
			}
		}
	}

	return {
		wouldBeLandlocked: affectedTiles.length > 0,
		affectedTiles,
		details: details.length > 0 ? details.join('; ') : 'No landlocked tiles would be created',
	}
}

/**
 * Find the nearest border service position from a given starting position
 * Uses proper pathfinding reachability instead of raw neighbor iteration
 *
 * @param tiles - All tiles on the board
 * @param getNeighbors - Function to get walkable neighbors for pathfinding
 * @param startCoord - Starting position
 * @param maxDistance - Maximum search distance (default: 10)
 * @returns Border service position if found, null otherwise
 */
export function findNearestServicePoint(
	tiles: Tile[],
	getNeighbors: GetNeighbors,
	startCoord: AxialCoord,
	maxDistance: number = 10
): BorderServicePosition | null {
	// Build a map of tiles for quick lookup
	const tileMap = new Map<string, Tile>()
	for (const tile of tiles) {
		const coord = toAxialCoord(tile.position)
		if (coord) {
			tileMap.set(axial.key(coord), tile)
		}
	}

	// Build a map of border service positions for quick lookup
	const borderPositions = findBorderServicePositions(tiles)
	const borderMap = new Map<string, BorderServicePosition>()
	for (const pos of borderPositions) {
		// Use the passable tile coordinate as the key (that's where vehicles can reach)
		borderMap.set(axial.key(pos.passableTile), pos)
	}

	// BFS over reachable tiles using proper pathfinding
	const visited = new Set<string>()
	const queue: { coord: AxialCoord; distance: number }[] = [{ coord: startCoord, distance: 0 }]

	visited.add(axial.key(startCoord))

	while (queue.length > 0) {
		const { coord, distance } = queue.shift()!

		if (distance > maxDistance) {
			continue
		}

		// Check if this tile is a passable neighbor of a blocking tile (service point)
		const borderPos = borderMap.get(axial.key(coord))
		if (borderPos) {
			return borderPos
		}

		// Get walkable neighbors using pathfinding function
		const neighbors = getNeighbors(coord)
		for (const neighbor of neighbors) {
			const neighborCoord = 'coord' in neighbor ? neighbor.coord : neighbor
			const walkTime = 'walkTime' in neighbor ? neighbor.walkTime : 1

			// Skip unwalkable tiles
			if (walkTime === Number.POSITIVE_INFINITY) continue

			const key = axial.key(neighborCoord)
			if (!visited.has(key)) {
				visited.add(key)
				queue.push({ coord: neighborCoord, distance: distance + 1 })
			}
		}
	}

	return null
}

/**
 * Check if a specific border service position is reachable from a starting position
 * Uses proper pathfinding to verify actual vehicle accessibility
 *
 * @param tiles - All tiles on the board
 * @param getNeighbors - Function to get walkable neighbors for pathfinding
 * @param startCoord - Starting position
 * @param servicePosition - Border service position to check
 * @param maxDistance - Maximum search distance (default: 10)
 * @returns true if reachable, false otherwise
 */
export function isServicePositionReachable(
	_tiles: Tile[],
	getNeighbors: GetNeighbors,
	startCoord: AxialCoord,
	servicePosition: BorderServicePosition,
	maxDistance: number = 10
): boolean {
	// Vehicles can reach the passable tile side of the border
	const targetCoord = servicePosition.passableTile

	// BFS over reachable tiles using proper pathfinding
	const visited = new Set<string>()
	const queue: { coord: AxialCoord; distance: number }[] = [{ coord: startCoord, distance: 0 }]

	visited.add(axial.key(startCoord))

	while (queue.length > 0) {
		const { coord, distance } = queue.shift()!

		if (distance > maxDistance) {
			continue
		}

		// Check if we reached the target
		if (axial.key(coord) === axial.key(targetCoord)) {
			return true
		}

		// Get walkable neighbors using pathfinding function
		const neighbors = getNeighbors(coord)
		for (const neighbor of neighbors) {
			const neighborCoord = 'coord' in neighbor ? neighbor.coord : neighbor
			const walkTime = 'walkTime' in neighbor ? neighbor.walkTime : 1

			// Skip unwalkable tiles
			if (walkTime === Number.POSITIVE_INFINITY) continue

			const key = axial.key(neighborCoord)
			if (!visited.has(key)) {
				visited.add(key)
				queue.push({ coord: neighborCoord, distance: distance + 1 })
			}
		}
	}

	return false
}
