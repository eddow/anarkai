import { describe, expect, it } from 'vitest'
import type { AxialCoord } from './axial'
import { findBest, findNearest, findPath, type GetNeighbors, heuristic } from './pathfinding'

// Helper function to create a simple grid for testing
function createGridNeighbors(size: number, obstacles: Set<string> = new Set()): GetNeighbors {
	return (coord: AxialCoord) => {
		const neighbors: Array<{ coord: AxialCoord; walkTime: number }> = []

		// Get all 6 hex neighbors
		const directions = [
			{ q: 1, r: 0 },
			{ q: 1, r: -1 },
			{ q: 0, r: -1 },
			{ q: -1, r: 0 },
			{ q: -1, r: 1 },
			{ q: 0, r: 1 },
		]

		for (const dir of directions) {
			const neighbor = { q: coord.q + dir.q, r: coord.r + dir.r }

			// Check bounds
			if (Math.abs(neighbor.q) > size || Math.abs(neighbor.r) > size) continue

			// Check obstacles
			const key = `${neighbor.q},${neighbor.r}`
			const walkTime = obstacles.has(key) ? Number.POSITIVE_INFINITY : 1

			neighbors.push({ coord: neighbor, walkTime })
		}

		return neighbors
	}
}

describe('Pathfinding', () => {
	describe('findPath', () => {
		it('should find a direct path between adjacent coordinates', () => {
			const getNeighbors = createGridNeighbors(5)
			const start = { q: 0, r: 0 }
			const goal = { q: 1, r: 0 }

			const path = findPath(getNeighbors, start, goal, 10, true)

			expect(path).toBeDefined()
			expect(path!.length).toBe(2)
			expect(path![0]).toEqual(start)
			expect(path![1]).toEqual(goal)
		})

		it('should find optimal path around obstacles', () => {
			const obstacles = new Set(['1,0', '0,1']) // Block direct paths
			const getNeighbors = createGridNeighbors(5, obstacles)
			const start = { q: 0, r: 0 }
			const goal = { q: 2, r: 0 }

			const path = findPath(getNeighbors, start, goal, 10, true)

			expect(path).toBeDefined()
			expect(path!.length).toBeGreaterThan(2)
			expect(path![0]).toEqual(start)
			expect(path![path!.length - 1]).toEqual(goal)
		})

		it('should return undefined when no path exists within maxTime', () => {
			const obstacles = new Set(['1,0', '-1,0', '0,1', '0,-1', '1,-1', '-1,1']) // Block all adjacent tiles
			const getNeighbors = createGridNeighbors(5, obstacles)
			const start = { q: 0, r: 0 }
			const goal = { q: 2, r: 0 }

			const path = findPath(getNeighbors, start, goal, 2, true) // Very short maxTime

			expect(path).toBeUndefined()
		})

		it('should handle punctual vs non-punctual modes', () => {
			const getNeighbors = createGridNeighbors(5)
			const start = { q: 0, r: 0 }
			const goal = { q: 2, r: 0 }

			const punctualPath = findPath(getNeighbors, start, goal, 10, true)
			const nonPunctualPath = findPath(getNeighbors, start, goal, 10, false)

			expect(punctualPath).toBeDefined()
			expect(nonPunctualPath).toBeDefined()

			// Non-punctual should end at goal coordinate
			expect(punctualPath![punctualPath!.length - 1]).toEqual(goal)
			expect(nonPunctualPath![nonPunctualPath!.length - 1]).toEqual(goal)
		})

		it('should respect walkTime costs', () => {
			// Create a grid where some paths are slower
			const getNeighbors = (coord: AxialCoord) => {
				const neighbors: Array<{ coord: AxialCoord; walkTime: number }> = []
				const directions = [
					{ q: 1, r: 0 },
					{ q: 0, r: 1 },
					{ q: -1, r: 0 },
					{ q: 0, r: -1 },
				]

				for (const dir of directions) {
					const neighbor = { q: coord.q + dir.q, r: coord.r + dir.r }
					// Make vertical movement slower
					const walkTime = dir.r !== 0 ? 3 : 1
					neighbors.push({ coord: neighbor, walkTime })
				}

				return neighbors
			}

			const start = { q: 0, r: 0 }
			const goal = { q: 2, r: 0 }

			const path = findPath(getNeighbors, start, goal, 10, true)

			expect(path).toBeDefined()
			// Should prefer horizontal movement (walkTime 1) over vertical (walkTime 3)
			expect(path!.length).toBe(3) // 0,0 -> 1,0 -> 2,0
		})

		it('should return start coordinate when start equals goal', () => {
			const getNeighbors = createGridNeighbors(5)
			const coord = { q: 0, r: 0 }

			const path = findPath(getNeighbors, coord, coord, 10, true)

			expect(path).toBeDefined()
			expect(path!.length).toBe(1)
			expect(path![0]).toEqual(coord)
		})
	})

	describe('findNearest', () => {
		it('should find nearest coordinate satisfying condition', () => {
			const getNeighbors = createGridNeighbors(5)
			const start = { q: 0, r: 0 }

			// Find nearest coordinate where q + r >= 3
			const isGoal = (coord: AxialCoord) => coord.q + coord.r >= 3

			const path = findNearest(getNeighbors, start, isGoal, 10, true)

			expect(path).toBeDefined()
			expect(path!.length).toBeGreaterThan(1)

			// Final coordinate should satisfy the condition
			const finalCoord = path![path!.length - 1]
			expect(isGoal(finalCoord)).toBe(true)
		})

		it('should return start coordinate if it satisfies condition', () => {
			const getNeighbors = createGridNeighbors(5)
			const start = { q: 3, r: 0 }

			// Start coordinate already satisfies condition
			const isGoal = (coord: AxialCoord) => coord.q + coord.r >= 3

			const path = findNearest(getNeighbors, start, isGoal, 10, true)

			expect(path).toBeDefined()
			expect(path!.length).toBe(1)
			expect(path![0]).toEqual(start)
		})

		it('should respect maxTime limit', () => {
			const getNeighbors = createGridNeighbors(5)
			const start = { q: 0, r: 0 }

			// Goal is far away
			const isGoal = (coord: AxialCoord) => coord.q + coord.r >= 10

			const path = findNearest(getNeighbors, start, isGoal, 3, true) // Very short time limit

			expect(path).toBeUndefined()
		})

		it('should handle non-punctual mode', () => {
			const getNeighbors = createGridNeighbors(5)
			const start = { q: 0, r: 0 }

			// Find coordinate where q + r >= 2
			const isGoal = (coord: AxialCoord) => coord.q + coord.r >= 2

			const path = findNearest(getNeighbors, start, isGoal, 10, false)

			expect(path).toBeDefined()
			// In non-punctual mode, should end at a neighbor of the goal
			const finalCoord = path![path!.length - 1]
			expect(finalCoord.q + finalCoord.r).toBeGreaterThanOrEqual(2)
		})
	})

	describe('findBest', () => {
		it('should find coordinate with highest score', () => {
			const getNeighbors = createGridNeighbors(5)
			const start = { q: 0, r: 0 }

			// Score function that returns higher values for coordinates farther from start
			const scoring = (coord: AxialCoord) => coord.q + coord.r

			const path = findBest(getNeighbors, start, scoring, 10, 10, true)

			expect(path).toBeDefined()

			// Final coordinate should have a good score
			const finalCoord = path![path!.length - 1]
			expect(scoring(finalCoord)).toBeGreaterThan(0)
		})

		it('should consider walkTime in relative scoring', () => {
			const getNeighbors = createGridNeighbors(5)
			const start = { q: 0, r: 0 }

			// Score function that gives high score to distant coordinates
			const scoring = (coord: AxialCoord) => (coord.q + coord.r) * 2

			const path = findBest(getNeighbors, start, scoring, 10, 20, true)

			expect(path).toBeDefined()

			// Should find a balance between high score and short distance
			const finalCoord = path![path!.length - 1]
			expect(finalCoord.q + finalCoord.r).toBeGreaterThan(0)
		})

		it('should handle scoring function that returns false', () => {
			const getNeighbors = createGridNeighbors(5)
			const start = { q: 0, r: 0 }

			// Score function that only returns positive values for specific coordinates
			const scoring = (coord: AxialCoord) => {
				if (coord.q === 2 && coord.r === 0) return 10
				return false
			}

			const path = findBest(getNeighbors, start, scoring, 10, 10, true)

			expect(path).toBeDefined()
			expect(path![path!.length - 1]).toEqual({ q: 2, r: 0, key: '2,0' })
		})

		it('should return undefined when no valid coordinates found', () => {
			const getNeighbors = createGridNeighbors(5)
			const start = { q: 0, r: 0 }

			// Score function that always returns false
			const scoring = (_coord: AxialCoord) => false as const

			const path = findBest(getNeighbors, start, scoring, 10, 0, true)

			expect(path).toBeUndefined()
		})

		it('should respect bestPossibleScore optimization', () => {
			const getNeighbors = createGridNeighbors(5)
			const start = { q: 0, r: 0 }

			// Score function with known maximum
			const scoring = (coord: AxialCoord) => 10 - (coord.q + coord.r)

			const path = findBest(getNeighbors, start, scoring, 10, 10, true)

			expect(path).toBeDefined()
			// Should find the highest scoring coordinate within reach
			const finalCoord = path![path!.length - 1]
			expect(scoring(finalCoord)).toBeGreaterThan(0)
		})
	})

	describe('heuristic', () => {
		it('should calculate correct hexagonal distance', () => {
			expect(heuristic({ q: 0, r: 0 }, { q: 1, r: 0 })).toBe(1)
			expect(heuristic({ q: 0, r: 0 }, { q: 2, r: 0 })).toBe(2)
			expect(heuristic({ q: 0, r: 0 }, { q: 1, r: 1 })).toBe(2)
			expect(heuristic({ q: 0, r: 0 }, { q: 2, r: 1 })).toBe(3)
		})

		it('should be symmetric', () => {
			const a = { q: 1, r: 2 }
			const b = { q: 3, r: 1 }

			expect(heuristic(a, b)).toBe(heuristic(b, a))
		})

		it('should be admissible (never overestimate)', () => {
			// Test a few cases where we know the actual shortest path
			const start = { q: 0, r: 0 }
			const goal = { q: 3, r: 2 }

			const heuristicDistance = heuristic(start, goal)
			const actualDistance = 5 // Manually calculated shortest path

			expect(heuristicDistance).toBeLessThanOrEqual(actualDistance)
		})
	})

	describe('Edge Cases', () => {
		it('should handle empty neighbor lists', () => {
			const getNeighbors = (_coord: AxialCoord) => []
			const start = { q: 0, r: 0 }
			const goal = { q: 1, r: 0 }

			const path = findPath(getNeighbors, start, goal, 10, true)
			expect(path).toBeUndefined()
		})

		it('should handle infinite walkTime', () => {
			const getNeighbors = (coord: AxialCoord) => {
				if (coord.q === 0 && coord.r === 0) {
					return [{ coord: { q: 1, r: 0 }, walkTime: Number.POSITIVE_INFINITY }]
				}
				return []
			}
			const start = { q: 0, r: 0 }
			const goal = { q: 1, r: 0 }

			const path = findPath(getNeighbors, start, goal, 10, true)
			expect(path).toBeUndefined()
		})

		it('should handle very large grids efficiently', () => {
			const getNeighbors = createGridNeighbors(100) // Large grid
			const start = { q: 0, r: 0 }
			const goal = { q: 5, r: 5 }

			const path = findPath(getNeighbors, start, goal, 20, true)

			expect(path).toBeDefined()
			expect(path!.length).toBeLessThanOrEqual(11) // Should be efficient
		})

		it('should handle complex obstacle patterns', () => {
			// Create a maze-like obstacle pattern
			const obstacles = new Set([
				'1,0',
				'2,0',
				'3,0', // Horizontal wall
				'0,1',
				'1,1',
				'2,1', // Another horizontal wall
				'3,1',
				'3,2',
				'3,3', // Vertical wall
			])

			const getNeighbors = createGridNeighbors(5, obstacles)
			const start = { q: 0, r: 0 }
			const goal = { q: 4, r: 4 }

			const path = findPath(getNeighbors, start, goal, 20, true)

			expect(path).toBeDefined()
			expect(path![0]).toEqual(start)
			expect(path![path!.length - 1]).toEqual(goal)

			// Verify path doesn't go through obstacles
			for (const coord of path!) {
				const key = `${coord.q},${coord.r}`
				expect(obstacles.has(key)).toBe(false)
			}
		})
	})
})
