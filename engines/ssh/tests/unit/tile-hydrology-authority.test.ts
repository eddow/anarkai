import { Game } from 'ssh/game/game'
import type { TerrainHydrologySample } from 'ssh/game/terrain-provider'
import { afterEach, describe, expect, it } from 'vitest'

const staleHydrology: TerrainHydrologySample = {
	isChannel: true,
	edges: {},
}

const freshHydrology: TerrainHydrologySample = {
	isChannel: true,
	edges: {
		n: { flux: 1, width: 1, depth: 1 },
	},
	riverFlow: {
		upstreamDirections: [],
		downstreamDirections: ['e'],
		rankFromSource: 0,
		rankToSea: 1,
		tileRole: 'through',
		pathTerminalKind: 'inland',
	},
}

describe('Tile hydrology authority', () => {
	let game: Game

	afterEach(() => {
		game.destroy()
	})

	it('prefers terrainHydrology over stale terrainState.hydrology on the tile', async () => {
		game = new Game(
			{ terrainSeed: 21, characterCount: 0 },
			{ tiles: [{ coord: [0, 0], terrain: 'forest' }] }
		)
		await game.loaded
		game.ticker.stop()
		const tile = game.hex.getTile({ q: 0, r: 0 })!
		tile.terrainState = { ...(tile.terrainState ?? {}), hydrology: staleHydrology }
		tile.terrainHydrology = freshHydrology
		expect(tile.hydrology?.riverFlow).toBeDefined()
		expect(tile.hydrology?.riverFlow?.pathTerminalKind).toBe('inland')
	})

	it('exposes the same hydrology through getRenderableTerrainAt for materialized tiles', async () => {
		game = new Game(
			{ terrainSeed: 21, characterCount: 0 },
			{ tiles: [{ coord: [0, 0], terrain: 'forest' }] }
		)
		await game.loaded
		game.ticker.stop()
		const tile = game.hex.getTile({ q: 0, r: 0 })!
		tile.terrainState = { ...(tile.terrainState ?? {}), hydrology: staleHydrology }
		tile.terrainHydrology = freshHydrology
		const sample = game.getRenderableTerrainAt({ q: 0, r: 0 })
		expect(sample?.hydrology?.riverFlow?.pathTerminalKind).toBe('inland')
	})
})
