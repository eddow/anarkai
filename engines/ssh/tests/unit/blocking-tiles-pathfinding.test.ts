import { BasicDwelling } from 'ssh/board/content/basic-dwelling'
import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import { Game } from 'ssh/game/game'
import { axial, type AxialCoord } from 'ssh/utils'
import { describe, expect, it } from 'vitest'

const grass = (coord: readonly [number, number]) => ({ coord, terrain: 'grass' as const })

async function withGame<T>(
	tiles: ReadonlyArray<readonly [number, number]>,
	run: (game: Game) => T | Promise<T>
): Promise<T> {
	const game = new Game(
		{ terrainSeed: 1234, characterCount: 0, settlementGeneration: false },
		{ tiles: tiles.map(grass) }
	)
	await game.loaded
	game.ticker.stop()
	try {
		return await run(game)
	} finally {
		game.destroy()
	}
}

function keys(path: readonly AxialCoord[] | undefined): string[] | undefined {
	return path?.map((coord) => axial.key(coord))
}

describe('blocking tile pedestrian pathfinding', () => {
	it('allows a blocking tile as the exact path destination', async () => {
		await withGame(
			[
				[0, 0],
				[1, 0],
			],
			(game) => {
				const target = game.hex.getTile({ q: 1, r: 0 })!
				target.content = new BasicDwelling(target)

				const path = game.hex.findPath({ q: 0, r: 0 }, target.position, 10, true)

				expect(keys(path)).toEqual(['0,0', '1,0'])
				expect(target.isBlockingSpace).toBe(true)
			}
		)
	})

	it('allows a pedestrian to leave from inside a blocking tile', async () => {
		await withGame(
			[
				[0, 0],
				[1, 0],
			],
			(game) => {
				const start = game.hex.getTile({ q: 0, r: 0 })!
				start.content = new BasicDwelling(start)

				const path = game.hex.findPath(start.position, { q: 1, r: 0 }, 10, true)

				expect(keys(path)).toEqual(['0,0', '1,0'])
				expect(start.isBlockingSpace).toBe(true)
			}
		)
	})

	it('routes around blocking tiles instead of using them as through-space', async () => {
		await withGame(
			[
				[0, 0],
				[1, 0],
				[2, 0],
				[0, 1],
				[1, 1],
			],
			(game) => {
				const blocked = game.hex.getTile({ q: 1, r: 0 })!
				blocked.content = new BasicDwelling(blocked)

				const path = game.hex.findPath({ q: 0, r: 0 }, { q: 2, r: 0 }, 10, true)

				expect(path).toBeDefined()
				expect(keys(path)).toEqual(['0,0', '0,1', '1,1', '2,0'])
				expect(keys(path)).not.toContain('1,0')
			}
		)
	})

	it('does not cross a blocking tile within the direct-route travel budget', async () => {
		await withGame(
			[
				[0, 0],
				[1, 0],
				[2, 0],
			],
			(game) => {
				const blocked = game.hex.getTile({ q: 1, r: 0 })!
				blocked.content = new BasicDwelling(blocked)

				const path = game.hex.findPath({ q: 0, r: 0 }, { q: 2, r: 0 }, 2, true)

				expect(path).toBeUndefined()
			}
		)
	})

	it('keeps roaded passable tiles valid and preferred around blocking space', async () => {
		await withGame(
			[
				[0, 0],
				[1, 0],
				[2, 0],
				[1, -1],
				[2, -1],
				[0, 1],
				[1, 1],
			],
			(game) => {
				const blocked = game.hex.getTile({ q: 1, r: 0 })!
				blocked.content = new BasicDwelling(blocked)
				const roadTrace = [
					game.hex.getTile({ q: 0, r: 0 })!,
					game.hex.getTile({ q: 0, r: 1 })!,
					game.hex.getTile({ q: 1, r: 1 })!,
					game.hex.getTile({ q: 2, r: 0 })!,
				]
				for (let i = 1; i < roadTrace.length; i++) {
					game.hex.setRoadType(roadTrace[i - 1]!.borderWith(roadTrace[i]!)!.position, 'asphalt')
				}

				const path = game.hex.findPath({ q: 0, r: 0 }, { q: 2, r: 0 }, 10, true)

				expect(keys(path)).toEqual(['0,0', '0,1', '1,1', '2,0'])
				expect(keys(path)).not.toContain('1,0')
			}
		)
	})

	it('keeps pre-foundation project land passable as transit', async () => {
		await withGame(
			[
				[0, 0],
				[1, 0],
				[2, 0],
			],
			(game) => {
				const project = game.hex.getTile({ q: 1, r: 0 })!
				const content = project.content
				expect(content).toBeInstanceOf(UnBuiltLand)
				if (!(content instanceof UnBuiltLand)) throw new Error('expected unbuilt land')
				content.setProject('build:storage')

				const path = game.hex.findPath({ q: 0, r: 0 }, { q: 2, r: 0 }, 10, true)

				expect(keys(path)).toEqual(['0,0', '1,0', '2,0'])
				expect(project.isBlockingSpace).toBe(false)
			}
		)
	})

	it('keeps raw nearest searches from using blocking tiles as transit', async () => {
		await withGame(
			[
				[0, 0],
				[1, 0],
				[2, 0],
			],
			(game) => {
				const blocked = game.hex.getTile({ q: 1, r: 0 })!
				blocked.content = new BasicDwelling(blocked)

				const path = game.hex.findNearest(
					{ q: 0, r: 0 },
					(coord) => axial.key(coord) === '2,0',
					2,
					true
				)

				expect(path).toBeUndefined()
			}
		)
	})

	it('allows nearest character searches to choose a blocking endpoint', async () => {
		await withGame(
			[
				[0, 0],
				[1, 0],
			],
			(game) => {
				const target = game.hex.getTile({ q: 1, r: 0 })!
				target.content = new BasicDwelling(target)

				const path = game.hex.findNearestForCharacter(
					{ q: 0, r: 0 },
					{} as never,
					(coord) => axial.key(coord) === '1,0',
					10,
					true
				)

				expect(keys(path)).toEqual(['0,0', '1,0'])
			}
		)
	})

	it('allows best character searches to choose a blocking endpoint', async () => {
		await withGame(
			[
				[0, 0],
				[1, 0],
			],
			(game) => {
				const target = game.hex.getTile({ q: 1, r: 0 })!
				target.content = new BasicDwelling(target)

				const path = game.hex.findBestForCharacter(
					{ q: 0, r: 0 },
					{} as never,
					(coord) => (axial.key(coord) === '1,0' ? 1 : false),
					10,
					1,
					true
				)

				expect(keys(path)).toEqual(['0,0', '1,0'])
			}
		)
	})
})

describe('blocking tile vehicle pathfinding', () => {
	it('never allows a blocking tile as an exact vehicle destination', async () => {
		await withGame(
			[
				[0, 0],
				[1, 0],
			],
			(game) => {
				const target = game.hex.getTile({ q: 1, r: 0 })!
				target.content = new BasicDwelling(target)

				const path = game.hex.findPathForVehicle({ q: 0, r: 0 }, target.position, 10, true)

				expect(path).toBeUndefined()
				expect(target.isBlockingSpace).toBe(true)
			}
		)
	})

	it('routes vehicle paths around blocking tiles instead of through them', async () => {
		await withGame(
			[
				[0, 0],
				[1, 0],
				[2, 0],
				[0, 1],
				[1, 1],
			],
			(game) => {
				const blocked = game.hex.getTile({ q: 1, r: 0 })!
				blocked.content = new BasicDwelling(blocked)

				const path = game.hex.findPathForVehicle({ q: 0, r: 0 }, { q: 2, r: 0 }, 10, true)

				expect(path).toBeDefined()
				expect(keys(path)).toEqual(['0,0', '0,1', '1,1', '2,0'])
				expect(keys(path)).not.toContain('1,0')
			}
		)
	})

	it('excludes blocking tiles from vehicle reachability', async () => {
		await withGame(
			[
				[0, 0],
				[1, 0],
				[2, 0],
				[0, 1],
				[1, 1],
			],
			(game) => {
				const blocked = game.hex.getTile({ q: 1, r: 0 })!
				blocked.content = new BasicDwelling(blocked)

				const reachable = game.hex.reachableForVehicle({ q: 0, r: 0 }, 10)

				expect(reachable.has({ q: 1, r: 0 })).toBe(false)
				expect(reachable.has({ q: 2, r: 0 })).toBe(true)
			}
		)
	})

	it('drives to the reachable border side of a blocking service target', async () => {
		await withGame(
			[
				[-1, 0],
				[0, 0],
				[1, 0],
			],
			(game) => {
				const target = game.hex.getTile({ q: 1, r: 0 })!
				target.content = new BasicDwelling(target)

				const path = game.hex.findPathForVehicleServiceBorder(
					{ q: -1, r: 0 },
					target.position,
					10
				)

				expect(keys(path)).toEqual(['-1,0', '0,0'])
				expect(keys(path)).not.toContain('1,0')
			}
		)
	})

	it('does not invent a border service route through sealed blocking space', async () => {
		await withGame(
			[
				[0, 0],
				[1, 0],
				[2, 0],
			],
			(game) => {
				const target = game.hex.getTile({ q: 2, r: 0 })!
				target.content = new BasicDwelling(target)
				for (const neighbor of target.neighborTiles) {
					neighbor.content = new BasicDwelling(neighbor)
				}

				const path = game.hex.findPathForVehicleServiceBorder(
					{ q: 0, r: 0 },
					target.position,
					10
				)

				expect(path).toBeUndefined()
			}
		)
	})
})
