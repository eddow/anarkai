import { type Positioned, toAxialCoord } from '.'
import type { AxialCoord, AxialKey } from './axial'
import { axial } from './axial'
import { AxialKeyMap, HeapMin } from './mem'

export type GetNeighbors = (coord: AxialCoord) => (NeighborInfo | AxialCoord)[]
export type Scoring<T> = (coord: AxialCoord) => T | false
export interface NeighborInfo {
	coord: AxialCoord
	walkTime: number
}

interface PathfindingNode {
	coord: AxialCoord
	gCost: number // Time cost from start
	parent?: AxialCoord
}

interface HeuristicPathfindingNode extends PathfindingNode {
	fCost: number // Total cost (g + h)
}

/**
 * Reconstruct path from goal back to start using parent map
 */
function reconstructPath(
	goal: AxialCoord,
	start: AxialCoord,
	parentMap: AxialKeyMap<AxialCoord>,
	goalPoint?: AxialCoord,
): AxialCoord[] {
	const path: AxialCoord[] = goalPoint ? [goalPoint] : []
	let current: AxialCoord = goal

	// Build path from goal to start
	while (current) {
		path.unshift(current)
		const parent = parentMap.get(current)
		if (!parent || axial.distance(parent, current) === 0) break
		current = parent
	}

	// Ensure start is included
	if (path.length === 0 || axial.distance(path[0], start) !== 0) {
		path.unshift(start)
	}

	return path
}

/**
 * A* pathfinding algorithm with time-based costs and maxTime limit
 * @param getNeighbors Function to get neighbors with walk times
 * @param start Starting coordinate
 * @param goal Target coordinate
 * @param maxTime Maximum walking time allowed for the path
 * @param punctual Whether to aim for the goal or a direct neighbor
 * @returns Path if found within maxTime, undefined otherwise
 */
export function findPath(
	getNeighbors: GetNeighbors,
	start: Positioned,
	goal: Positioned,
	maxTime: number,
	punctual: boolean = true,
): AxialCoord[] | undefined {
	// use bidirectional if the function becomes used
	const startCoord = toAxialCoord(start)
	const goalCoord = toAxialCoord(goal)
	const goalDistance = punctual ? 0 : 1

	// Initialize data structures
	const openSet = new HeapMin<AxialKey, number>()
	const openSetMap = new AxialKeyMap<HeuristicPathfindingNode>()
	const closedSet = new AxialKeyMap<PathfindingNode>()
	const gCosts = new AxialKeyMap<number>()
	const parentMap = new AxialKeyMap<AxialCoord>()

	const hCost = heuristic(startCoord, goalCoord)
	// Initialize start node
	const startNode: HeuristicPathfindingNode = {
		coord: startCoord,
		gCost: 0,
		fCost: hCost,
	}

	openSet.set(axial.key(startCoord), startNode.fCost)
	openSetMap.set(startCoord, startNode)
	gCosts.set(startCoord, 0)

	while (!openSet.isEmpty) {
		// Get node with lowest fCost
		const currentCoord = axial.keyAccess(openSet.pop()![0])
		const currentNode = openSetMap.get(currentCoord)!

		// Move to closed set
		closedSet.set(currentCoord, currentNode)
		openSetMap.delete(currentCoord)

		// Check if we reached the goal
		if (axial.distance(currentCoord, goalCoord) <= goalDistance) {
			return reconstructPath(currentCoord, startCoord, parentMap, punctual ? undefined : goalCoord)
		}

		// Explore neighbors
		const neighbors = getNeighbors(currentCoord)
		for (const neighbor of neighbors) {
			const { coord: neighborCoord, walkTime } =
				'coord' in neighbor ? neighbor : { coord: neighbor, walkTime: 1 }

			// Skip if already in closed set
			if (closedSet.has(neighborCoord)) continue

			// Skip if tile is unwalkable
			if (walkTime === Number.POSITIVE_INFINITY) continue

			// Calculate tentative gCost
			const tentativeGCost = currentNode.gCost + walkTime

			// Skip if this path exceeds maxTime
			if (tentativeGCost > maxTime) continue

			// Check if this path to neighbor is better
			const existingGCost = gCosts.get(neighborCoord)
			if (existingGCost !== undefined && tentativeGCost >= existingGCost) continue

			const hCost = heuristic(neighborCoord, goalCoord)
			// Create neighbor node
			const neighborNode: HeuristicPathfindingNode = {
				coord: neighborCoord,
				gCost: tentativeGCost,
				fCost: tentativeGCost + hCost,
				parent: currentCoord,
			}

			// Update costs and add to open set
			gCosts.set(neighborCoord, tentativeGCost)
			parentMap.set(neighborCoord, currentCoord)
			openSet.set(axial.key(neighborCoord), neighborNode.fCost)
			openSetMap.set(neighborCoord, neighborNode)
		}
	}

	// No path found
	return undefined
}

/**
 * Heuristic function for hexagonal grid (Manhattan distance approximation)
 */
export function heuristic(a: Positioned, b: Positioned): number {
	return axial.distance(toAxialCoord(a), toAxialCoord(b))
}

/**
 * Find the nearest coordinate that satisfies a condition within maxTime
 * @param getNeighbors Function to get neighbors with walk times
 * @param start Starting coordinate
 * @param isGoal Function that returns true if the coordinate is a valid goal
 * @param maxTime Maximum walking time allowed for the path
 * @param punctual Whether to aim for the goal or a direct neighbor
 * @returns Path to the nearest valid goal if found within maxTime, undefined otherwise
 */
export function findNearest<_T>(
	getNeighbors: GetNeighbors,
	start: Positioned,
	isGoal: Scoring<true>,
	stop: number | ((coord: Positioned, walkTime: number) => boolean),
	punctual: boolean = true,
): AxialCoord[] | undefined {
	const startCoord = toAxialCoord(start)
	if (typeof stop === 'number')
		stop = (
			(stop) => (_, walkTime: number) =>
				walkTime > stop
		)(stop)
	// Check if start position already satisfies the goal condition
	if (isGoal(startCoord)) return [startCoord]
	if (stop(startCoord, 0)) return undefined

	// Initialize data structures
	const openSet = new HeapMin<AxialCoord, number>()
	const openSetMap = new AxialKeyMap<PathfindingNode>()
	const closedSet = new AxialKeyMap<PathfindingNode>()
	const gCosts = new AxialKeyMap<number>()
	const parentMap = new AxialKeyMap<AxialCoord>()

	// Initialize start node
	const startNode: PathfindingNode = {
		coord: startCoord,
		gCost: 0,
	}

	openSet.set(startCoord, startNode.gCost)
	openSetMap.set(startCoord, startNode)
	gCosts.set(startCoord, 0)

	while (!openSet.isEmpty) {
		// Get node with lowest fCost
		const currentCoord = openSet.pop()![0]
		const currentNode = openSetMap.get(currentCoord)!

		// Move to closed set
		closedSet.set(currentCoord, currentNode)
		openSetMap.delete(currentCoord)

		// Check if we reached a valid goal
		if (punctual && isGoal(currentCoord)) {
			return reconstructPath(currentCoord, startCoord, parentMap)
		}

		// Explore neighbors
		const neighbors = getNeighbors(currentCoord)
		for (const neighbor of neighbors) {
			const { coord: neighborCoord, walkTime } =
				'coord' in neighbor ? neighbor : { coord: neighbor, walkTime: 1 }

			// Skip if tile is unwalkable
			if (!Number.isFinite(walkTime)) continue

			// Skip if already in closed set
			if (closedSet.has(neighborCoord)) continue
			if (!punctual && isGoal(neighborCoord)) {
				return reconstructPath(currentCoord, startCoord, parentMap, neighborCoord)
			}

			// Calculate tentative gCost
			const tentativeGCost = currentNode.gCost + walkTime

			// Skip if this path cannot be followed
			if (stop(neighborCoord, tentativeGCost)) continue

			// Check if this path to neighbor is better
			const existingGCost = gCosts.get(neighborCoord)
			if (existingGCost !== undefined && tentativeGCost >= existingGCost) continue

			// Create neighbor node
			const neighborNode: PathfindingNode = {
				coord: neighborCoord,
				gCost: tentativeGCost,
				parent: currentCoord,
			}

			// Update costs and add to open set
			gCosts.set(neighborCoord, tentativeGCost)
			parentMap.set(neighborCoord, currentCoord)
			openSet.set(neighborCoord, neighborNode.gCost)
			openSetMap.set(neighborCoord, neighborNode)
		}
	}

	// No valid goal found within maxTime
	return undefined
}

function relativeScore(score: number, walkTime: number): number {
	return score / (walkTime + 1)
}

/**
 * Find the nearest coordinate that satisfies a condition within maxTime
 * @param getNeighbors Function to get neighbors with walk times
 * @param start Starting coordinate
 * @param isGoal Function that returns true if the coordinate is a valid goal
 * @param maxTime Maximum walking time allowed for the path
 * @param punctual Whether to aim for the goal or a direct neighbor
 * @returns Path to the nearest valid goal if found within maxTime, undefined otherwise
 */
export function findBest<_T>(
	getNeighbors: GetNeighbors,
	start: Positioned,
	scoring: Scoring<number>,
	stop: number | ((coord: Positioned, walkTime: number) => boolean),
	bestPossibleScore: number,
	punctual: boolean = true,
): AxialCoord[] | undefined {
	const startCoord = toAxialCoord(start)
	if (typeof stop === 'number')
		stop = (
			(stop) => (_, walkTime: number) =>
				walkTime > stop
		)(stop)
	// Check if start position already satisfies the goal condition
	if (stop(startCoord, 0)) return undefined

	// Initialize data structures
	const openSet = new HeapMin<AxialCoord, number>()
	const openSetMap = new AxialKeyMap<PathfindingNode>()
	const closedSet = new AxialKeyMap<PathfindingNode>()
	const gCosts = new AxialKeyMap<number>()
	const parentMap = new AxialKeyMap<AxialCoord>()
	const homeScore = scoring(startCoord)
	let [bestScore, bestScoreCoord]: [number, AxialCoord | undefined] =
		homeScore !== false
			? [relativeScore(homeScore, 0), startCoord]
			: [Number.NEGATIVE_INFINITY, undefined]

	// Initialize start node
	const startNode: PathfindingNode = {
		coord: startCoord,
		gCost: 0,
	}

	function considerScore(coord: AxialCoord, score: number | false, walkTime: number): void {
		if (score === false) return
		const relative = relativeScore(score, walkTime)
		if (relative > bestScore) {
			bestScore = relative
			bestScoreCoord = coord
		}
	}

	openSet.set(startCoord, startNode.gCost)
	openSetMap.set(startCoord, startNode)
	gCosts.set(startCoord, 0)

	while (!openSet.isEmpty) {
		// Get node with lowest fCost
		const currentCoord = openSet.pop()![0]
		const currentNode = openSetMap.get(currentCoord)!
		if (relativeScore(bestPossibleScore, currentNode.gCost) < bestScore) continue
		// Move to closed set
		closedSet.set(currentCoord, currentNode)
		openSetMap.delete(currentCoord)

		// Check if we reached a valid goal
		if (punctual) considerScore(currentCoord, scoring(currentCoord), currentNode.gCost)

		// Explore neighbors
		const neighbors = getNeighbors(currentCoord)
		for (const neighbor of neighbors) {
			const { coord: neighborCoord, walkTime } =
				'coord' in neighbor ? neighbor : { coord: neighbor, walkTime: 1 }

			// Skip if tile is unwalkable
			if (!Number.isFinite(walkTime)) continue

			// Skip if already in closed set
			if (closedSet.has(neighborCoord)) continue
			if (!punctual)
				considerScore(neighborCoord, scoring(neighborCoord), currentNode.gCost + walkTime)

			// Calculate tentative gCost
			const tentativeGCost = currentNode.gCost + walkTime

			// Skip if this path cannot be followed
			if (stop(neighborCoord, tentativeGCost)) continue

			// Check if this path to neighbor is better
			const existingGCost = gCosts.get(neighborCoord)
			if (existingGCost !== undefined && tentativeGCost >= existingGCost) continue

			// Create neighbor node
			const neighborNode: PathfindingNode = {
				coord: neighborCoord,
				gCost: tentativeGCost,
				parent: currentCoord,
			}

			// Update costs and add to open set
			gCosts.set(neighborCoord, tentativeGCost)
			parentMap.set(neighborCoord, currentCoord)
			openSet.set(neighborCoord, neighborNode.gCost)
			openSetMap.set(neighborCoord, neighborNode)
		}
	}
	return bestScoreCoord && reconstructPath(bestScoreCoord, startCoord, parentMap)
}
