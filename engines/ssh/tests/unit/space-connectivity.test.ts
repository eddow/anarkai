import {
	type BoardTopology,
	boardTopologyFromHex,
	checkPlacementConnectivity,
	collectAdjacentBuildingFootprints,
	coordKey,
	findBlockedFootprintTiles,
	placementConnectsFreeSpace,
	placementKeepsEntrancesReachable,
	placementKeepsFootprintReachable,
	validateFootprintConnectivity,
} from 'ssh/board/space-connectivity'
import { Game } from 'ssh/game/game'
import { type AxialCoord, axial } from 'ssh/utils/axial'
import { afterEach, describe, expect, it } from 'vitest'

/** A synthetic board: a set of walkable tiles, everything else blocking. */
const makeBoard = (free: readonly AxialCoord[]): BoardTopology => {
	const freeKeys = new Set(free.map(coordKey))
	return {
		neighbors: (c) => axial.neighbors(c),
		isTraversable: (c) => freeKeys.has(coordKey(c)),
	}
}

const c = (q: number, r: number): AxialCoord => ({ q, r })

describe('placementConnectsFreeSpace', () => {
	it('rejects a placement that partitions a corridor', () => {
		// 1-wide corridor along q at r=0.
		const board = makeBoard([c(0, 0), c(1, 0), c(2, 0), c(3, 0), c(4, 0)])
		// Occupying the middle tile severs left from right.
		const result = placementConnectsFreeSpace(board, [c(2, 0)])
		expect(result.ok).toBe(false)
		expect(result.ok === false && result.reason).toBe('partitions-free-space')
		// Finite board: locked = minority side (1 ring tile either way here).
		if (!result.ok && result.reason === 'partitions-free-space') {
			expect(result.locked).toHaveLength(1)
			expect(result.locked[0]).toMatchObject(
				expect.objectContaining({ q: expect.any(Number), r: 0 })
			)
		} else {
			throw new Error('expected partitions-free-space')
		}
	})

	it('locks the minority side, not the open board', () => {
		// Corridor q=0..9 at r=0. Occupying (1,0) splits a 1-tile pocket (0,0)
		// from the 8-tile open side — locked must be the pocket, not the board.
		// (Which ring tile that is depends on neighbour order: the ring is
		// {(0,0),(2,0)} and the minority side has exactly 1 tile.)
		const board = makeBoard(Array.from({ length: 10 }, (_, q) => c(q, 0)))
		const result = placementConnectsFreeSpace(board, [c(1, 0)])
		expect(result.ok).toBe(false)
		if (!result.ok && result.reason === 'partitions-free-space') {
			expect(result.locked).toHaveLength(1)
			expect([c(0, 0), c(2, 0)]).toContainEqual(result.locked[0])
		} else {
			throw new Error('expected partitions-free-space')
		}
	})

	it('early-exits on open boards: ring joins within footprint neighbourhood', () => {
		// Open 21×21 blob; occupying the center must NOT walk the whole board.
		// Count isTraversable calls: ring-size neighbourhood, not board-size.
		const free = new Set<string>()
		for (let q = -10; q <= 10; q++) for (let r = -10; r <= 10; r++) free.add(`${q},${r}`)
		let calls = 0
		const board: BoardTopology = {
			neighbors: (coord) => axial.neighbors(coord),
			isTraversable: (coord) => {
				calls++
				return free.has(coordKey(coord))
			},
		}
		expect(placementConnectsFreeSpace(board, [c(0, 0)]).ok).toBe(true)
		// Ring (6) + their neighbours until the ring joins (~a few dozen), not ~440.
		expect(calls).toBeLessThan(100)
	})

	it('allows a non-separating placement at the corridor end', () => {
		const board = makeBoard([c(0, 0), c(1, 0), c(2, 0), c(3, 0), c(4, 0)])
		expect(placementConnectsFreeSpace(board, [c(0, 0)]).ok).toBe(true)
	})

	it('allows a placement off to the side of a 2-wide region', () => {
		// A 2-wide blob: both r=0 and r=1 along q.
		const board = makeBoard([c(0, 0), c(1, 0), c(2, 0), c(0, 1), c(1, 1), c(2, 1)])
		// Removing a corner tile leaves the rest connected.
		expect(placementConnectsFreeSpace(board, [c(2, 0)]).ok).toBe(true)
	})

	it('does not run to infinity: an open ring cell escapes, a pocket ring cell is locked', () => {
		// 1-wide corridor q=0..10 at r=0, with the "outside" beyond q>=10. Occupying
		// (5,0) severs left (pocket) from right (open → infinity).
		const free = Array.from({ length: 11 }, (_, q) => c(q, 0))
		const board: BoardTopology = {
			neighbors: (coord) => axial.neighbors(coord),
			isTraversable: (coord) => free.some((f) => f.q === coord.q && f.r === coord.r),
			leadsToInfinity: (coord) => coord.q >= 10,
		}
		const result = placementConnectsFreeSpace(board, [c(5, 0)])
		expect(result.ok).toBe(false)
		if (!result.ok && result.reason === 'partitions-free-space') {
			// The left side never reaches infinity → locked; the right side is open.
			expect(result.locked).toEqual([c(4, 0)])
		} else {
			throw new Error('expected partitions-free-space')
		}
	})

	it('allows a placement when every ring cell reaches infinity', () => {
		// 2-wide corridor (r=0 and r=1), q=0..10, outside beyond q>=10. Occupying
		// (5,0) does not disconnect — you go around via r=1, and both sides stay open.
		const free = [
			...Array.from({ length: 11 }, (_, q) => c(q, 0)),
			...Array.from({ length: 11 }, (_, q) => c(q, 1)),
		]
		const board: BoardTopology = {
			neighbors: (coord) => axial.neighbors(coord),
			isTraversable: (coord) => free.some((f) => f.q === coord.q && f.r === coord.r),
			leadsToInfinity: (coord) => coord.q >= 10,
		}
		expect(placementConnectsFreeSpace(board, [c(5, 0)]).ok).toBe(true)
	})
})

describe('placementKeepsEntrancesReachable', () => {
	it('reports the new structure boxed-in (no free neighbour)', () => {
		// The only free tile is the one being occupied.
		const board = makeBoard([c(1, 0)])
		const result = placementKeepsEntrancesReachable(board, [c(1, 0)], [c(1, 0)])
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.reason).toBe('entrance-blocked')
			expect(result.blocked).toEqual([c(1, 0)])
		}
	})

	it('walls in an existing neighbour whose last free tile is filled', () => {
		// Alveolus A at (1,0) is already blocking (not free); its only free neighbour is (2,0).
		const board = makeBoard([c(2, 0), c(3, 0)])
		// Occupying (2,0) leaves A with no free neighbour — but free space {3,0} is still connected.
		expect(placementConnectsFreeSpace(board, [c(2, 0)]).ok).toBe(true)
		const result = placementKeepsEntrancesReachable(board, [c(2, 0)], [c(1, 0)])
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.blocked).toEqual([c(1, 0)])
	})

	it('allows an entrance with a remaining free neighbour', () => {
		// 2-wide region; occupying (2,0) leaves (1,0)'s neighbours (0,0)/(1,1) free.
		const two = makeBoard([c(0, 0), c(1, 0), c(2, 0), c(0, 1), c(1, 1), c(2, 1)])
		expect(placementKeepsEntrancesReachable(two, [c(2, 0)], [c(1, 0)]).ok).toBe(true)
	})
})

describe('boardTopologyFromHex', () => {
	let game: Game

	afterEach(() => game.destroy())

	it('reports structures as non-traversable and empty land as traversable', async () => {
		game = new Game(
			{ terrainSeed: 51, characterCount: 0, settlementGeneration: false },
			{
				terrains: {
					grass: [
						[0, 0],
						[1, 0],
					],
				},
				hives: [{ name: 'H', alveoli: [{ coord: [0, 0], alveolus: 'storage' }] }],
			}
		)
		await game.loaded
		game.ticker.stop()

		const board = boardTopologyFromHex(game.hex)
		expect(board.isTraversable(c(0, 0))).toBe(false) // storage alveolus
		expect(board.isTraversable(c(1, 0))).toBe(true) // empty land
	})

	it("is live-board only — a plan does not make another plan's tile non-walkable", async () => {
		game = new Game(
			{ terrainSeed: 52, characterCount: 0, settlementGeneration: false },
			{
				terrains: {
					grass: [
						[0, 0],
						[1, 0],
					],
				},
			}
		)
		await game.loaded
		game.ticker.stop()

		// A draft project plans a pile on the still-empty tile (1,0).
		game.projects.createDraft('Plan', [{ coord: [1, 0] as const, alveolusType: 'pile' as const }])

		// The topology is live-board only: a planned entry does NOT occupy its tile.
		// The plan's own walls are passed as `used` to the placement checks, never
		// folded into boardTopologyFromHex.
		const board = boardTopologyFromHex(game.hex)
		expect(board.isTraversable(c(1, 0))).toBe(true) // empty land despite the plan
		expect(board.isTraversable(c(0, 0))).toBe(true) // untouched empty land
	})
})

describe('placementKeepsFootprintReachable', () => {
	it('stays reachable when any footprint tile keeps a free neighbour', () => {
		// 3-tile shop: door tile (0,0) boxed, but (2,0) still touches free (3,0).
		const board = makeBoard([c(3, 0)])
		expect(placementKeepsFootprintReachable(board, [c(1, 0)], [c(0, 0), c(1, 0), c(2, 0)])).toBe(
			true
		)
	})

	it('reports boxed-in when no footprint tile keeps a free neighbour', () => {
		const board = makeBoard([])
		expect(placementKeepsFootprintReachable(board, [c(1, 0)], [c(0, 0), c(1, 0), c(2, 0)])).toBe(
			false
		)
	})

	it('walls in a neighbour shop whose last free tile is filled', () => {
		// Neighbour shop at (1,0)+(1,1); its only free neighbour is (2,0).
		const board = makeBoard([c(2, 0), c(3, 0)])
		expect(placementConnectsFreeSpace(board, [c(2, 0)]).ok).toBe(true)
		expect(placementKeepsFootprintReachable(board, [c(2, 0)], [c(1, 0), c(1, 1)])).toBe(false)
	})
})

describe('checkPlacementConnectivity', () => {
	it('runs partition once + reachability per neighbour + self', () => {
		// Partition: corridor split, no neighbours involved.
		const corridor = makeBoard([c(0, 0), c(1, 0), c(2, 0), c(3, 0), c(4, 0)])
		const split = checkPlacementConnectivity(corridor, [c(2, 0)], [])
		expect(split.ok).toBe(false)
		expect(split.partitionsFreeSpace).toBe(true)
		expect(split.walledNeighbours).toEqual([])

		// Walled neighbour without partition: (1,0) is an existing building whose
		// only free neighbour (2,0) is being filled; free space {3,0} stays connected.
		const board = makeBoard([c(2, 0), c(3, 0)])
		const walled = checkPlacementConnectivity(board, [c(2, 0)], [[c(1, 0)]])
		expect(walled.ok).toBe(false)
		expect(walled.partitionsFreeSpace).toBe(false)
		expect(walled.walledNeighbours).toEqual([[c(1, 0)]])
	})

	it('passes a non-separating placement with open neighbours', () => {
		const board = makeBoard([c(0, 0), c(1, 0), c(2, 0), c(3, 0), c(4, 0)])
		const check = checkPlacementConnectivity(board, [c(0, 0)], [[c(1, 0)]])
		expect(check.ok).toBe(true)
	})
})

describe('validateFootprintConnectivity', () => {
	let game: Game

	afterEach(() => game.destroy())

	it('collects adjacent building footprints and reports walled victims', async () => {
		game = new Game(
			{ terrainSeed: 51, characterCount: 0, settlementGeneration: false },
			{
				terrains: {
					grass: [
						[0, 0],
						[1, 0],
						[2, 0],
						[3, 0],
					],
				},
				hives: [{ name: 'H', alveoli: [{ coord: [1, 0], alveolus: 'storage' }] }],
			}
		)
		await game.loaded
		game.ticker.stop()

		// Storage at (1,0); filling (2,0) leaves it only (0,0) — still reachable.
		expect(collectAdjacentBuildingFootprints(game.hex, [c(2, 0)])).toEqual([[c(1, 0)]])
		const open = validateFootprintConnectivity(game.hex, [c(2, 0)])
		expect(open.ok).toBe(true)
		expect(open.victims).toEqual([])
	})
})

describe('findBlockedFootprintTiles', () => {
	it('reports empty when every footprint tile keeps an opening', () => {
		// 2-wide region; occupying (2,0) leaves both (1,0) and (2,0) with openings.
		const board = makeBoard([c(0, 0), c(1, 0), c(2, 0), c(0, 1), c(1, 1), c(2, 1)])
		expect(findBlockedFootprintTiles(board, [c(2, 0)], [c(1, 0), c(2, 0)])).toEqual([])
	})

	it('catches a ghost walling in an earlier draft tile (existential passes, universal fails)', () => {
		// Draft tile (1,0) + ghost (2,0): (2,0) still touches free (3,0), so the
		// footprint as a whole is reachable — but (1,0) lost its only opening (2,0).
		const board = makeBoard([c(3, 0)])
		expect(placementKeepsFootprintReachable(board, [c(1, 0), c(2, 0)], [c(1, 0), c(2, 0)])).toBe(
			true
		)
		expect(findBlockedFootprintTiles(board, [c(1, 0), c(2, 0)])).toEqual([c(1, 0)])
	})

	it('catches two adjacent ghost tiles walling each other', () => {
		// Ghosts (1,0)+(2,0) with no free neighbour left: both blocked.
		const board = makeBoard([])
		expect(findBlockedFootprintTiles(board, [c(1, 0), c(2, 0)])).toEqual([c(1, 0), c(2, 0)])
	})

	it('refuses the placement via checkPlacementConnectivity', () => {
		const board = makeBoard([c(3, 0)])
		const check = checkPlacementConnectivity(board, [c(1, 0), c(2, 0)], [])
		expect(check.ok).toBe(false)
		expect(check.blockedFootprintTiles).toEqual([c(1, 0)])
	})
})
