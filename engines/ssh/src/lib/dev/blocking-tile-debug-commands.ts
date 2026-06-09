import type { AxialCoord } from 'ssh/utils'
import { axial } from 'ssh/utils'
import { toAxialCoord } from 'ssh/utils/position'
import type { Tile } from '../board/tile'
import type { Game } from '../game/game'
import type { GetNeighbors } from '../utils/pathfinding'
import {
	type BlockingTileIssue,
	type BlockingTileValidationResult,
	type BorderServicePosition,
	findNearestServicePoint,
	formatBlockingTileValidationSummary,
	isServicePositionReachable,
	validateBlockingTiles,
	wouldBecomeLandlocked,
} from './blocking-tile-validation'

/**
 * Debug command interface for blocking tile validation
 * These commands can be called from the browser console or used in tests
 */
export class BlockingTileDebugCommands {
	constructor(private readonly game: Game) {}

	/**
	 * Get a function that returns walkable neighbors for pathfinding
	 * This respects blocking tiles and walk times
	 */
	private getNeighborsFunction(): GetNeighbors {
		return (coord: AxialCoord) => {
			const tile = this.game.hex.getTile(coord)
			if (!tile) return []

			// Use the tile's walkNeighbors which respects blocking tiles
			return tile.walkNeighbors
		}
	}

	/**
	 * Run a comprehensive validation of all blocking tiles on the board
	 * @returns Validation result with formatted summary
	 */
	validateBlockingTiles(): {
		result: BlockingTileValidationResult
		summary: string
	} {
		const tiles = this.game.hex.tiles
		const result = validateBlockingTiles(tiles)
		const summary = formatBlockingTileValidationSummary(result)

		console.log(summary)

		return { result, summary }
	}

	/**
	 * Find all landlocked blocking tiles (layout issues)
	 * @returns Array of landlocked tile issues
	 */
	findLandlockedTiles(): BlockingTileIssue[] {
		const tiles = this.game.hex.tiles
		const result = validateBlockingTiles(tiles)

		if (result.landlockedTiles.length === 0) {
			console.log('✓ No landlocked tiles found')
		} else {
			console.warn(
				`⚠ Found ${result.landlockedTiles.length} landlocked tile(s):`,
				result.landlockedTiles
			)
		}

		return result.landlockedTiles
	}

	/**
	 * Find all border service positions (valid vehicle service locations)
	 * @returns Array of border service positions
	 */
	findBorderServicePositions(): BorderServicePosition[] {
		const tiles = this.game.hex.tiles
		const result = validateBlockingTiles(tiles)

		console.log(`Found ${result.borderServicePositions.length} border service position(s)`)

		return result.borderServicePositions
	}

	/**
	 * Check if a specific tile would become landlocked if built upon
	 * This checks BOTH the target tile AND any adjacent blocking tiles that would lose their only passable neighbor
	 * @param q - Q coordinate of the tile to check
	 * @param r - R coordinate of the tile to check
	 * @returns Result indicating if landlocked tiles would be created
	 */
	checkWouldBecomeLandlocked(
		q: number,
		r: number
	): {
		wouldBeLandlocked: boolean
		affectedTiles: AxialCoord[]
		details: string
	} {
		const tiles = this.game.hex.tiles
		const targetCoord: AxialCoord = { q, r }
		const result = wouldBecomeLandlocked(tiles, targetCoord)

		let message = ''
		if (result.wouldBeLandlocked) {
			message = `⚠ Building on (${q}, ${r}) would create landlocked tile(s):\n  ${result.details}`
		} else {
			message = `✓ Building on (${q}, ${r}) would NOT create landlocked tiles`
		}

		console.log(message)

		return result
	}

	/**
	 * Find the nearest border service position from a given starting position
	 * Uses proper pathfinding reachability
	 * @param q - Q coordinate of starting position
	 * @param r - R coordinate of starting position
	 * @param maxDistance - Maximum search distance (default: 10)
	 * @returns Border service position if found, null otherwise
	 */
	findNearestServicePoint(
		q: number,
		r: number,
		maxDistance: number = 10
	): {
		servicePosition: BorderServicePosition | null
		message: string
	} {
		const tiles = this.game.hex.tiles
		const startCoord: AxialCoord = { q, r }
		const getNeighbors = this.getNeighborsFunction()

		const servicePosition = findNearestServicePoint(tiles, getNeighbors, startCoord, maxDistance)

		let message = ''
		if (servicePosition) {
			message = `✓ Found border service position:\n`
			message += `  Blocking tile: (${servicePosition.blockingTile.q}, ${servicePosition.blockingTile.r})\n`
			message += `  Passable tile: (${servicePosition.passableTile.q}, ${servicePosition.passableTile.r})\n`
			message += `  Border position: (${servicePosition.borderPosition.q.toFixed(2)}, ${servicePosition.borderPosition.r.toFixed(2)})\n`
			message += `  Direction: ${servicePosition.direction ?? 'unknown'}`
		} else {
			message = `✗ No border service position found within ${maxDistance} tiles of (${q}, ${r})`
		}

		console.log(message)

		return { servicePosition, message }
	}

	/**
	 * Check if a specific border service position is reachable from a starting position
	 * @param startQ - Q coordinate of starting position
	 * @param startR - R coordinate of starting position
	 * @param blockingQ - Q coordinate of blocking tile
	 * @param blockingR - R coordinate of blocking tile
	 * @param passableQ - Q coordinate of passable tile
	 * @param passableR - R coordinate of passable tile
	 * @param maxDistance - Maximum search distance (default: 10)
	 * @returns true if reachable, false otherwise
	 */
	checkServicePositionReachable(
		startQ: number,
		startR: number,
		blockingQ: number,
		blockingR: number,
		passableQ: number,
		passableR: number,
		maxDistance: number = 10
	): {
		reachable: boolean
		message: string
	} {
		const tiles = this.game.hex.tiles
		const startCoord: AxialCoord = { q: startQ, r: startR }
		const getNeighbors = this.getNeighborsFunction()

		const servicePosition: BorderServicePosition = {
			blockingTile: { q: blockingQ, r: blockingR },
			passableTile: { q: passableQ, r: passableR },
			borderPosition: axial.linear(
				[0.5, { q: blockingQ, r: blockingR }],
				[0.5, { q: passableQ, r: passableR }]
			),
		}

		const reachable = isServicePositionReachable(
			tiles,
			getNeighbors,
			startCoord,
			servicePosition,
			maxDistance
		)

		let message = ''
		if (reachable) {
			message = `✓ Service position at blocking (${blockingQ}, ${blockingR}) <-> passable (${passableQ}, ${passableR}) is reachable from (${startQ}, ${startR})`
		} else {
			message = `✗ Service position at blocking (${blockingQ}, ${blockingR}) <-> passable (${passableQ}, ${passableR}) is NOT reachable from (${startQ}, ${startR}) within ${maxDistance} tiles`
		}

		console.log(message)

		return { reachable, message }
	}

	/**
	 * Get detailed information about a specific tile's blocking status
	 * @param q - Q coordinate of the tile
	 * @param r - R coordinate of the tile
	 * @returns Detailed tile information
	 */
	getTileBlockingInfo(
		q: number,
		r: number
	): {
		coord: AxialCoord
		isBlocking: boolean
		isLandlocked: boolean
		hasBorderServiceAccess: boolean
		servicePositions: BorderServicePosition[]
		neighbors: Array<{ coord: AxialCoord; isBlocking: boolean }>
		message: string
	} | null {
		const tiles = this.game.hex.tiles
		const targetCoord: AxialCoord = { q, r }

		const tile = tiles.find((t) => {
			const coord = toAxialCoord(t.position)
			return coord && axial.key(coord) === axial.key(targetCoord)
		})

		if (!tile) {
			console.log(`✗ Tile (${q}, ${r}) not found on the board`)
			return null
		}

		const isBlocking = tile.isBlockingSpace
		const neighbors = tile.neighborTiles
		const allNeighborsBlocking = neighbors.every((n) => n.isBlockingSpace)
		const hasNonBlockingNeighbor = neighbors.some((n) => !n.isBlockingSpace)

		const neighborInfo = neighbors.map((n) => {
			const coord = toAxialCoord(n.position)
			return {
				coord: coord ?? { q: 0, r: 0 },
				isBlocking: n.isBlockingSpace,
			}
		})

		const isLandlocked = isBlocking && allNeighborsBlocking && neighbors.length > 0
		const hasBorderServiceAccess = isBlocking && hasNonBlockingNeighbor

		// Find service positions for this blocking tile
		let servicePositions: BorderServicePosition[] = []
		if (isBlocking && hasNonBlockingNeighbor) {
			const result = validateBlockingTiles(tiles)
			servicePositions = result.borderServicePositions.filter(
				(pos) => axial.key(pos.blockingTile) === axial.key(targetCoord)
			)
		}

		let message = `Tile (${q}, ${r}):\n`
		message += `  Blocking: ${isBlocking ? 'Yes' : 'No'}\n`
		if (isBlocking) {
			message += `  Landlocked: ${isLandlocked ? 'Yes ⚠' : 'No ✓'}\n`
			message += `  Border Service Access: ${hasBorderServiceAccess ? 'Yes ✓' : 'No ✗'}\n`
			message += `  Service Positions: ${servicePositions.length}\n`
			message += `  Neighbors: ${neighbors.length} (${neighbors.filter((n) => n.isBlockingSpace).length} blocking, ${neighbors.filter((n) => !n.isBlockingSpace).length} passable)`
		} else {
			message += `  Neighbors: ${neighbors.length} (${neighbors.filter((n) => n.isBlockingSpace).length} blocking, ${neighbors.filter((n) => !n.isBlockingSpace).length} passable)`
		}

		console.log(message)

		return {
			coord: targetCoord,
			isBlocking,
			isLandlocked,
			hasBorderServiceAccess,
			servicePositions,
			neighbors: neighborInfo,
			message,
		}
	}

	/**
	 * Visualize blocking tiles on the console with ASCII art
	 * Shows a simple representation of the board with blocking tiles marked
	 * @param centerQ - Q coordinate of center tile to visualize around
	 * @param centerR - R coordinate of center tile to visualize around
	 * @param radius - Radius of area to visualize (default: 5)
	 */
	visualizeBlockingTiles(centerQ: number, centerR: number, radius: number = 5): void {
		const tiles = this.game.hex.tiles
		const tileMap = new Map<string, Tile>()

		for (const tile of tiles) {
			const coord = toAxialCoord(tile.position)
			if (coord) {
				tileMap.set(axial.key(coord), tile)
			}
		}

		console.log(`\nBlocking Tile Visualization (center: ${centerQ}, ${centerR}, radius: ${radius})`)
		console.log('Legend: [B] = Blocking, [L] = Landlocked, [.] = Passable, [?] = Unknown\n')

		const centerCoord: AxialCoord = { q: centerQ, r: centerR }
		const allCoords = axial.allTiles(centerCoord, radius)
		const rows: string[][] = []

		for (const coord of allCoords) {
			const tile = tileMap.get(axial.key(coord))
			let symbol = '[?]'

			if (tile) {
				if (tile.isBlockingSpace) {
					const neighbors = tile.neighborTiles
					const isLandlocked = neighbors.every((n) => n.isBlockingSpace) && neighbors.length > 0
					symbol = isLandlocked ? '[L]' : '[B]'
				} else {
					symbol = '[.]'
				}
			}

			// Group by row for proper hex grid visualization
			const axialCoord = coord
			const row = axialCoord.r + radius
			if (!rows[row]) {
				rows[row] = []
			}
			rows[row].push(symbol)
		}

		// Output rows with proper indentation for hex grid
		for (let i = 0; i < rows.length; i++) {
			const row = rows[i]
			if (!row) continue

			// Add indentation for hex grid shape
			const indent = Math.abs(i - radius)
			const padding = '  '.repeat(indent)
			console.log(padding + row.join(' '))
		}

		console.log('')
	}
}

/**
 * Attach blocking tile debug commands to the global window object for browser console access
 * This should be called during development/debugging setup
 */
export function attachBlockingTileDebugCommands(game: Game): void {
	if (typeof window === 'undefined') return

	const commands = new BlockingTileDebugCommands(game)

	// @ts-expect-error - Adding debug commands to window
	window.blockingTileDebug = {
		validate: () => commands.validateBlockingTiles(),
		findLandlocked: () => commands.findLandlockedTiles(),
		findBorderServicePositions: () => commands.findBorderServicePositions(),
		checkWouldBecomeLandlocked: (q: number, r: number) => commands.checkWouldBecomeLandlocked(q, r),
		findNearestServicePoint: (q: number, r: number, maxDistance?: number) =>
			commands.findNearestServicePoint(q, r, maxDistance),
		checkServicePositionReachable: (
			startQ: number,
			startR: number,
			blockingQ: number,
			blockingR: number,
			passableQ: number,
			passableR: number,
			maxDistance?: number
		) =>
			commands.checkServicePositionReachable(
				startQ,
				startR,
				blockingQ,
				blockingR,
				passableQ,
				passableR,
				maxDistance
			),
		getTileInfo: (q: number, r: number) => commands.getTileBlockingInfo(q, r),
		visualize: (q: number, r: number, radius?: number) =>
			commands.visualizeBlockingTiles(q, r, radius),
	}

	console.log('Blocking tile debug commands available at `window.blockingTileDebug`')
	console.log('  .validate() - Run full validation')
	console.log('  .findLandlocked() - Find landlocked tiles')
	console.log('  .findBorderServicePositions() - Find vehicle service positions')
	console.log(
		'  .checkWouldBecomeLandlocked(q, r) - Check if building would create landlocked tiles'
	)
	console.log('  .findNearestServicePoint(q, r, maxDistance?) - Find nearest service position')
	console.log(
		'  .checkServicePositionReachable(startQ, startR, blockingQ, blockingR, passableQ, passableR, maxDistance?) - Check if service position is reachable'
	)
	console.log('  .getTileInfo(q, r) - Get detailed tile information')
	console.log('  .visualize(q, r, radius?) - Visualize blocking tiles around a position')
}

/**
 * Run blocking tile validation as a test utility
 * Returns true if validation passes (no landlocked tiles), false otherwise
 */
export function runBlockingTileValidationTest(game: Game): {
	passed: boolean
	result: BlockingTileValidationResult
	summary: string
} {
	const commands = new BlockingTileDebugCommands(game)
	const { result, summary } = commands.validateBlockingTiles()

	const passed = result.landlockedTiles.length === 0

	return {
		passed,
		result,
		summary,
	}
}
