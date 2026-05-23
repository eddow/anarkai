import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Game } from 'ssh/game/game'
import { HexBoard } from 'ssh/board/board'
import { Tile } from 'ssh/board/tile'
import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import { Alveolus } from 'ssh/board/content/alveolus'
import { Hive } from 'ssh/hive/hive'
import { validateBlockingTiles, wouldBecomeLandlocked, findNearestServicePoint, isServicePositionReachable } from 'ssh/dev/blocking-tile-validation'
import type { AxialCoord } from 'ssh/utils'
import { axial, toAxialCoord } from 'ssh/utils'

// Mock tile creation helper
function createMockTile(
	board: HexBoard,
	q: number,
	r: number,
	isBlocking: boolean
): Tile {
	const tile = new Tile(board, { q, r })
	if (isBlocking) {
		// Create a mock blocking content
		const mockContent = {
			tile,
			name: 'MockBlocking',
			debugInfo: { type: 'mock' },
			walkTime: Number.POSITIVE_INFINITY,
			background: '#ff0000',
		} as any
		tile.content = mockContent
	} else {
		// Create a mock UnBuiltLand content
		const mockContent = {
			tile,
			name: 'UnBuiltLand',
			debugInfo: { type: 'unbuilt' },
			walkTime: 1,
			background: '#ffffff',
		} as any
		tile.content = mockContent
	}
	return tile
}

// Mock neighbor setup helper
function setupNeighbors(tiles: Tile[], neighborMap: Map<string, string[]>): void {
	for (const [key, neighborKeys] of neighborMap.entries()) {
		const tile = tiles.find((t) => {
			const coord = toAxialCoord(t.position)
			return coord && axial.key(coord) === key
		})

		if (!tile) continue

		// Mock neighborTiles getter
		Object.defineProperty(tile, 'neighborTiles', {
			get: () => {
				return neighborKeys
					.map((nk) => {
						const [nq, nr] = nk.split(',').map(Number)
						return tiles.find((t) => {
							const coord = toAxialCoord(t.position)
							return coord && coord.q === nq && coord.r === nr
						})
					})
					.filter((t): t is Tile => t !== undefined)
			},
			configurable: true,
		})
	}
}

describe('Blocking Tile Validation', () => {
	describe('validateBlockingTiles', () => {
		it('should identify no blocking tiles when all tiles are unbuilt', () => {
			// Create mock board
			const mockBoard = {
				game: {},
				getTile: vi.fn(),
				getTileContent: vi.fn(),
			} as any

			// Create 3x3 grid of non-blocking tiles
			const tiles: Tile[] = []
			for (let q = -1; q <= 1; q++) {
				for (let r = -1; r <= 1; r++) {
					tiles.push(createMockTile(mockBoard, q, r, false))
				}
			}

			const result = validateBlockingTiles(tiles)

			expect(result.allBlockingTiles).toHaveLength(0)
			expect(result.landlockedTiles).toHaveLength(0)
			expect(result.borderServicePositions).toHaveLength(0)
			expect(result.totalIssues).toBe(0)
		})

		it('should identify a single blocking tile with passable neighbors', () => {
			const mockBoard = {
				game: {},
				getTile: vi.fn(),
				getTileContent: vi.fn(),
			} as any

			// Create center blocking tile surrounded by passable tiles
			const tiles: Tile[] = []
			tiles.push(createMockTile(mockBoard, 0, 0, true)) // Center blocking
			for (let q = -1; q <= 1; q++) {
				for (let r = -1; r <= 1; r++) {
					if (q === 0 && r === 0) continue
					tiles.push(createMockTile(mockBoard, q, r, false))
				}
			}

			// Setup neighbors
			const neighborMap = new Map<string, string[]>()
			neighborMap.set('0,0', ['-1,0', '0,-1', '1,-1', '1,0', '0,1', '-1,1'])
			setupNeighbors(tiles, neighborMap)

			const result = validateBlockingTiles(tiles)

			expect(result.allBlockingTiles).toHaveLength(1)
			expect(result.allBlockingTiles[0]).toEqual({ q: 0, r: 0 })
			expect(result.landlockedTiles).toHaveLength(0) // Not landlocked - has passable neighbors
			expect(result.borderServicePositions.length).toBeGreaterThan(0) // Should have service positions
		})

		it('should identify landlocked tiles correctly', () => {
			const mockBoard = {
				game: {},
				getTile: vi.fn(),
				getTileContent: vi.fn(),
			} as any

			// Create center blocking tile surrounded by blocking tiles
			const tiles: Tile[] = []
			tiles.push(createMockTile(mockBoard, 0, 0, true)) // Center blocking
			for (let q = -1; q <= 1; q++) {
				for (let r = -1; r <= 1; r++) {
					if (q === 0 && r === 0) continue
					tiles.push(createMockTile(mockBoard, q, r, true)) // All neighbors blocking
				}
			}

			// Setup neighbors
			const neighborMap = new Map<string, string[]>()
			neighborMap.set('0,0', ['-1,0', '0,-1', '1,-1', '1,0', '0,1', '-1,1'])
			setupNeighbors(tiles, neighborMap)

			const result = validateBlockingTiles(tiles)

			expect(result.allBlockingTiles.length).toBeGreaterThan(0)
			expect(result.landlockedTiles).toHaveLength(1)
			expect(result.landlockedTiles[0].coord).toEqual({ q: 0, r: 0 })
			expect(result.landlockedTiles[0].issueType).toBe('landlocked')
			expect(result.borderServicePositions).toHaveLength(0) // No service positions - all blocking
		})

		it('should identify border service positions correctly', () => {
			const mockBoard = {
				game: {},
				getTile: vi.fn(),
				getTileContent: vi.fn(),
			} as any

			// Create a blocking tile with one passable neighbor
			const tiles: Tile[] = []
			tiles.push(createMockTile(mockBoard, 0, 0, true)) // Center blocking
			tiles.push(createMockTile(mockBoard, 1, 0, false)) // One passable neighbor
			tiles.push(createMockTile(mockBoard, -1, 0, true)) // Other neighbors blocking
			tiles.push(createMockTile(mockBoard, 0, -1, true))
			tiles.push(createMockTile(mockBoard, 1, -1, true))
			tiles.push(createMockTile(mockBoard, 0, 1, true))
			tiles.push(createMockTile(mockBoard, -1, 1, true))

			// Setup neighbors
			const neighborMap = new Map<string, string[]>()
			neighborMap.set('0,0', ['-1,0', '0,-1', '1,-1', '1,0', '0,1', '-1,1'])
			setupNeighbors(tiles, neighborMap)

			const result = validateBlockingTiles(tiles)

			expect(result.borderServicePositions.length).toBeGreaterThan(0)
			const servicePos = result.borderServicePositions[0]
			expect(servicePos.blockingTile).toEqual({ q: 0, r: 0 })
			expect(servicePos.passableTile).toEqual({ q: 1, r: 0 })
			expect(servicePos.borderPosition.q).toBeCloseTo(0.5)
			expect(servicePos.borderPosition.r).toBeCloseTo(0)
		})
	})

	describe('wouldBecomeLandlocked', () => {
		it('should return false for tiles with non-blocking neighbors', () => {
			const mockBoard = {
				game: {},
				getTile: vi.fn(),
				getTileContent: vi.fn(),
			} as any

			const tiles: Tile[] = []
			tiles.push(createMockTile(mockBoard, 0, 0, false)) // Target (non-blocking)
			tiles.push(createMockTile(mockBoard, 1, 0, false)) // Passable neighbor

			// Setup neighbors
			const neighborMap = new Map<string, string[]>()
			neighborMap.set('0,0', ['1,0'])
			setupNeighbors(tiles, neighborMap)

			const result = wouldBecomeLandlocked(tiles, { q: 0, r: 0 })

			expect(result.wouldBeLandlocked).toBe(false)
			expect(result.affectedTiles).toHaveLength(0)
		})

		it('should return true for tiles surrounded by blocking tiles', () => {
			const mockBoard = {
				game: {},
				getTile: vi.fn(),
				getTileContent: vi.fn(),
			} as any

			const tiles: Tile[] = []
			tiles.push(createMockTile(mockBoard, 0, 0, false)) // Target (non-blocking)
			for (let q = -1; q <= 1; q++) {
				for (let r = -1; r <= 1; r++) {
					if (q === 0 && r === 0) continue
					tiles.push(createMockTile(mockBoard, q, r, true)) // All neighbors blocking
				}
			}

			// Setup neighbors
			const neighborMap = new Map<string, string[]>()
			neighborMap.set('0,0', ['-1,0', '0,-1', '1,-1', '1,0', '0,1', '-1,1'])
			setupNeighbors(tiles, neighborMap)

			const result = wouldBecomeLandlocked(tiles, { q: 0, r: 0 })

			expect(result.wouldBeLandlocked).toBe(true)
			expect(result.affectedTiles).toContainEqual({ q: 0, r: 0 })
		})

		it('should identify adjacent blocking tiles that would become landlocked', () => {
			const mockBoard = {
				game: {},
				getTile: vi.fn(),
				getTileContent: vi.fn(),
			} as any

			const tiles: Tile[] = []
			tiles.push(createMockTile(mockBoard, 0, 0, false)) // Target (non-blocking)
			tiles.push(createMockTile(mockBoard, 1, 0, true)) // Adjacent blocking tile with ONLY this passable neighbor
			tiles.push(createMockTile(mockBoard, 2, 0, true)) // Blocking
			tiles.push(createMockTile(mockBoard, 1, -1, true)) // Blocking
			tiles.push(createMockTile(mockBoard, 2, -1, true)) // Blocking
			tiles.push(createMockTile(mockBoard, 1, 1, true)) // Blocking
			tiles.push(createMockTile(mockBoard, 0, 1, true)) // Blocking

			// Setup neighbors for target
			const neighborMap = new Map<string, string[]>()
			neighborMap.set('0,0', ['1,0', '0,1', '-1,1', '-1,0', '0,-1', '1,-1'])
			// Setup neighbors for adjacent blocking tile (1,0) - it has only (0,0) as passable neighbor
			neighborMap.set('1,0', ['2,0', '2,-1', '1,-1', '0,0', '0,1', '1,1'])
			setupNeighbors(tiles, neighborMap)

			const result = wouldBecomeLandlocked(tiles, { q: 0, r: 0 })

			expect(result.wouldBeLandlocked).toBe(true)
			expect(result.affectedTiles).toContainEqual({ q: 1, r: 0 })
			expect(result.details).toContain('Adjacent blocking tile')
		})

		it('should not flag adjacent blocking tiles that have other passable neighbors', () => {
			const mockBoard = {
				game: {},
				getTile: vi.fn(),
				getTileContent: vi.fn(),
			} as any

			const tiles: Tile[] = []
			tiles.push(createMockTile(mockBoard, 0, 0, false)) // Target (non-blocking)
			tiles.push(createMockTile(mockBoard, 1, 0, true)) // Adjacent blocking tile with multiple passable neighbors
			tiles.push(createMockTile(mockBoard, 2, 0, false)) // Another passable neighbor

			// Setup neighbors for adjacent blocking tile (1,0) - it has TWO passable neighbors
			const neighborMap = new Map<string, string[]>()
			neighborMap.set('1,0', ['2,0', '0,0'])
			setupNeighbors(tiles, neighborMap)

			const result = wouldBecomeLandlocked(tiles, { q: 0, r: 0 })

			expect(result.wouldBeLandlocked).toBe(false)
			expect(result.affectedTiles).toHaveLength(0)
		})
	})

	describe('findNearestServicePoint', () => {
		it('should find the nearest border service position', () => {
			const mockBoard = {
				game: {},
				getTile: vi.fn(),
				getTileContent: vi.fn(),
			} as any

			const tiles: Tile[] = []
			// Create a passable start tile
			tiles.push(createMockTile(mockBoard, 0, 0, false))
			// Create a blocking tile with passable neighbor
			tiles.push(createMockTile(mockBoard, 1, 0, true))
			tiles.push(createMockTile(mockBoard, 2, 0, false))

			// Setup neighbors
			const neighborMap = new Map<string, string[]>()
			neighborMap.set('0,0', ['1,0'])
			neighborMap.set('1,0', ['0,0', '2,0'])
			neighborMap.set('2,0', ['1,0'])
			setupNeighbors(tiles, neighborMap)

			// Mock getNeighbors function that respects walkability
			const getNeighbors = vi.fn((coord: AxialCoord) => {
				const tile = tiles.find((t) => {
					const tc = toAxialCoord(t.position)
					return tc && axial.key(tc) === axial.key(coord)
				})
				if (!tile) return []

				// Return walkable neighbors (non-blocking tiles)
				const neighbors = tile.neighborTiles
				return neighbors
					.filter((n) => !n.isBlockingSpace)
					.map((n) => {
						const nc = toAxialCoord(n.position)
						return {
							coord: nc ?? { q: 0, r: 0 },
							walkTime: 1,
						}
					})
			})

			const result = findNearestServicePoint(tiles, getNeighbors, { q: 0, r: 0 }, 10)

			expect(result).not.toBeNull()
			expect(result?.blockingTile).toEqual({ q: 1, r: 0 })
			expect(result?.passableTile).toEqual({ q: 2, r: 0 })
		})

		it('should return null when no service point found within maxDistance', () => {
			const mockBoard = {
				game: {},
				getTile: vi.fn(),
				getTileContent: vi.fn(),
			} as any

			const tiles: Tile[] = []
			tiles.push(createMockTile(mockBoard, 0, 0, false))
			// No blocking tiles nearby

			const getNeighbors = vi.fn(() => [])

			const result = findNearestServicePoint(tiles, getNeighbors, { q: 0, r: 0 }, 5)

			expect(result).toBeNull()
		})

		it('should respect maxDistance parameter', () => {
			const mockBoard = {
				game: {},
				getTile: vi.fn(),
				getTileContent: vi.fn(),
			} as any

			const tiles: Tile[] = []
			tiles.push(createMockTile(mockBoard, 0, 0, false))
			// Service point is at distance 5
			tiles.push(createMockTile(mockBoard, 5, 0, true))
			tiles.push(createMockTile(mockBoard, 6, 0, false))

			// Setup neighbors
			const neighborMap = new Map<string, string[]>()
			neighborMap.set('5,0', ['6,0'])
			neighborMap.set('6,0', ['5,0'])
			setupNeighbors(tiles, neighborMap)

			const getNeighbors = vi.fn((coord: AxialCoord) => {
				const tile = tiles.find((t) => {
					const tc = toAxialCoord(t.position)
					return tc && axial.key(tc) === axial.key(coord)
				})
				if (!tile) return []

				const neighbors = tile.neighborTiles
				return neighbors
					.filter((n) => !n.isBlockingSpace)
					.map((n) => {
						const nc = toAxialCoord(n.position)
						return {
							coord: nc ?? { q: 0, r: 0 },
							walkTime: 1,
						}
					})
			})

			// With maxDistance 3, should not find it
			const result1 = findNearestServicePoint(tiles, getNeighbors, { q: 0, r: 0 }, 3)
			expect(result1).toBeNull()

			// With maxDistance 10, should find it
			const result2 = findNearestServicePoint(tiles, getNeighbors, { q: 0, r: 0 }, 10)
			expect(result2).not.toBeNull()
		})

		it('should not search through blocking tiles', () => {
			const mockBoard = {
				game: {},
				getTile: vi.fn(),
				getTileContent: vi.fn(),
			} as any

			const tiles: Tile[] = []
			tiles.push(createMockTile(mockBoard, 0, 0, false))
			tiles.push(createMockTile(mockBoard, 1, 0, true)) // Blocking - should not pass through
			tiles.push(createMockTile(mockBoard, 2, 0, true)) // Blocking with service point
			tiles.push(createMockTile(mockBoard, 3, 0, false))

			// Setup neighbors
			const neighborMap = new Map<string, string[]>()
			neighborMap.set('0,0', ['1,0'])
			neighborMap.set('1,0', ['0,0', '2,0'])
			neighborMap.set('2,0', ['1,0', '3,0'])
			neighborMap.set('3,0', ['2,0'])
			setupNeighbors(tiles, neighborMap)

			const getNeighbors = vi.fn((coord: AxialCoord) => {
				const tile = tiles.find((t) => {
					const tc = toAxialCoord(t.position)
					return tc && axial.key(tc) === axial.key(coord)
				})
				if (!tile) return []

				const neighbors = tile.neighborTiles
				return neighbors
					.filter((n) => !n.isBlockingSpace)
					.map((n) => {
						const nc = toAxialCoord(n.position)
						return {
							coord: nc ?? { q: 0, r: 0 },
							walkTime: 1,
						}
					})
			})

			const result = findNearestServicePoint(tiles, getNeighbors, { q: 0, r: 0 }, 10)

			// Should not find service point because it's behind blocking tiles
			expect(result).toBeNull()
		})
	})

	describe('isServicePositionReachable', () => {
		it('should return true when service position is reachable', () => {
			const mockBoard = {
				game: {},
				getTile: vi.fn(),
				getTileContent: vi.fn(),
			} as any

			const tiles: Tile[] = []
			tiles.push(createMockTile(mockBoard, 0, 0, false))
			tiles.push(createMockTile(mockBoard, 1, 0, true))
			tiles.push(createMockTile(mockBoard, 2, 0, false))

			// Setup neighbors
			const neighborMap = new Map<string, string[]>()
			neighborMap.set('0,0', ['1,0'])
			neighborMap.set('1,0', ['0,0', '2,0'])
			neighborMap.set('2,0', ['1,0'])
			setupNeighbors(tiles, neighborMap)

			const getNeighbors = vi.fn((coord: AxialCoord) => {
				const tile = tiles.find((t) => {
					const tc = toAxialCoord(t.position)
					return tc && axial.key(tc) === axial.key(coord)
				})
				if (!tile) return []

				const neighbors = tile.neighborTiles
				return neighbors
					.filter((n) => !n.isBlockingSpace)
					.map((n) => {
						const nc = toAxialCoord(n.position)
						return {
							coord: nc ?? { q: 0, r: 0 },
							walkTime: 1,
						}
					})
			})

			const servicePosition = {
				blockingTile: { q: 1, r: 0 },
				passableTile: { q: 2, r: 0 },
				borderPosition: axial.linear([0.5, { q: 1, r: 0 }], [0.5, { q: 2, r: 0 }]),
			}

			const result = isServicePositionReachable(tiles, getNeighbors, { q: 0, r: 0 }, servicePosition, 10)

			expect(result).toBe(true)
		})

		it('should return false when service position is not reachable', () => {
			const mockBoard = {
				game: {},
				getTile: vi.fn(),
				getTileContent: vi.fn(),
			} as any

			const tiles: Tile[] = []
			tiles.push(createMockTile(mockBoard, 0, 0, false))
			tiles.push(createMockTile(mockBoard, 1, 0, true))
			tiles.push(createMockTile(mockBoard, 2, 0, false))

			// Setup neighbors
			const neighborMap = new Map<string, string[]>()
			neighborMap.set('0,0', []) // No neighbors - isolated
			neighborMap.set('1,0', ['2,0'])
			neighborMap.set('2,0', ['1,0'])
			setupNeighbors(tiles, neighborMap)

			const getNeighbors = vi.fn((coord: AxialCoord) => {
				const tile = tiles.find((t) => {
					const tc = toAxialCoord(t.position)
					return tc && axial.key(tc) === axial.key(coord)
				})
				if (!tile) return []

				const neighbors = tile.neighborTiles
				return neighbors
					.filter((n) => !n.isBlockingSpace)
					.map((n) => {
						const nc = toAxialCoord(n.position)
						return {
							coord: nc ?? { q: 0, r: 0 },
							walkTime: 1,
						}
					})
			})

			const servicePosition = {
				blockingTile: { q: 1, r: 0 },
				passableTile: { q: 2, r: 0 },
				borderPosition: axial.linear([0.5, { q: 1, r: 0 }], [0.5, { q: 2, r: 0 }]),
			}

			const result = isServicePositionReachable(tiles, getNeighbors, { q: 0, r: 0 }, servicePosition, 10)

			expect(result).toBe(false)
		})
	})
})