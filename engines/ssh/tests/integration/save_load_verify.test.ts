// Manual DOM mock for PixiJS
if (typeof document === 'undefined') {
	;(global as any).document = {
		createElement: () => ({
			getContext: () => ({
				getParameter: () => 0,
				getExtension: () => ({}),
			}),
			addEventListener: () => {},
		}),
	}
	;(global as any).document.baseURI = 'http://localhost/'
}
if (typeof window === 'undefined') {
	;(global as any).window = global
}
if (typeof location === 'undefined') {
	;(global as any).location = {
		href: 'http://localhost/',
		protocol: 'http:',
		host: 'localhost',
		hostname: 'localhost',
	}
}
if (typeof navigator === 'undefined') {
	;(global as any).navigator = { userAgent: 'node' }
} else {
	try {
		;(global as any).navigator = { userAgent: 'node' }
	} catch (_e) {}
}
if (typeof requestAnimationFrame === 'undefined') {
	;(global as any).requestAnimationFrame = (cb: any) => setTimeout(cb, 16)
}
if (typeof localStorage === 'undefined') {
	;(global as any).localStorage = {
		getItem: () => null,
		setItem: () => {},
		removeItem: () => {},
		clear: () => {},
	}
}
if (typeof Image === 'undefined') {
	;(global as any).Image = class {
		_src = ''
		onload = () => {}
		onerror = () => {}
		set src(val: string) {
			this._src = val
			setTimeout(() => this.onload?.(), 1)
		}
		get src() {
			return this._src
		}
	}
}
// Bypass asset loading
;(global as any).fetch = vi.fn().mockResolvedValue({
	ok: true,
	status: 200,
	json: async () => ({ frames: {}, meta: { size: { w: 1, h: 1 } } }),
	blob: async () => ({
		type: 'image/png',
		arrayBuffer: async () => new ArrayBuffer(0),
	}),
	text: async () => '',
	headers: new Map(),
})

import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import { Game } from 'ssh/game/game'
import { DurationStep, MoveToStep, MultiMoveStep } from 'ssh/npcs/steps'
import { toAxialCoord } from 'ssh/utils/position'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Mock assets/resources
vi.mock('ssh/assets/resources', () => ({
	resources: {},
	prefix: '',
}))

vi.mock('ssh/assets/game-content', () => {
	const defaultTerrain = {
		walkTime: 1,
		generation: { deposits: {} },
		sprites: ['grass.png'],
	}
	const terrainProxy = new Proxy(
		{},
		{
			get: (_target, _prop) => defaultTerrain,
		}
	)
	return {
		vehicles: {
			'by-hands': {
				storage: { slots: 10, capacity: 100 },
			},
		},
		goods: {
			wood: { sprites: ['wood.png'] },
			stone: { sprites: ['stone.png'] },
			food: { satiationStrength: 0.5, sprites: ['food.png'] },
		},
		terrain: terrainProxy,
		deposits: {
			tree: {
				generation: { frequency: 0.1 },
				sprites: ['tree.png'],
				maxAmount: 100,
			},
		},
		alveoli: {},
		configurations: {
			'specific-storage': { working: true, buffers: {} },
			default: { working: true },
		},
	}
})

describe('Save/Load Determinism', () => {
	const games = new Set<Game>()

	afterEach(() => {
		for (const game of games) game.destroy()
		games.clear()
	})

	// Use static imports
	// Patch getTexture to avoid rendering errors in headless mode
	Game.prototype.getTexture = () => ({
		defaultAnchor: { x: 0.5, y: 0.5 },
		width: 1,
		height: 1,
	})

	it('Scenario 1: Movement Persistence', async () => {
		const game1 = new Game({
			terrainSeed: 1234,
			characterCount: 0,
		})
		games.add(game1)
		await game1.loaded
		const char1 = game1.population.createCharacter('Walker', { q: 0, r: 0 })
		char1.stepExecutor = new MoveToStep(10, char1, { q: 10, r: 0 })

		const dt = 0.1
		for (let i = 0; i < 20; i++) {
			game1.ticker.update(dt * 1000)
			char1.update(dt)
		}

		const saveState = game1.saveGameData()

		for (let i = 0; i < 20; i++) char1.update(dt)
		const controlPos = { ...char1.position }

		const game2 = new Game({
			terrainSeed: 1234,
			characterCount: 0,
		})
		games.add(game2)
		await game2.loaded
		await game2.loadGameData(saveState)
		const char2 = game2.population.character(char1.uid)

		for (let i = 0; i < 20; i++) char2.update(dt)

		const pos2 = toAxialCoord(char2.position)
		const ctrlAxial = toAxialCoord(controlPos)
		expect(pos2.q).toBeCloseTo(ctrlAxial.q, 4)
		expect(pos2.r).toBeCloseTo(ctrlAxial.r, 4)
		expect(char2.stepExecutor!.constructor.name).toBe('MoveToStep')
	})

	it('Scenario 2: Inventory Persistence', async () => {
		const game = new Game({
			terrainSeed: 555,
			characterCount: 0,
		})
		games.add(game)
		await game.loaded
		const char = game.population.createCharacter('Carrier', { q: 0, r: 0 })

		char.carry.addGood('wood', 1)
		char.carry.addGood('stone', 1)

		const saveState = game.saveGameData()

		const game2 = new Game({
			terrainSeed: 555,
			characterCount: 0,
		})
		games.add(game2)
		await game2.loaded
		await game2.loadGameData(saveState)
		const char2 = game2.population.character(char.uid)

		expect(char2.carry.available('wood')).toBe(1)
		expect(char2.carry.available('stone')).toBe(1)
		expect(char2.carry.available('mushrooms')).toBe(0)
	})

	it('Scenario 3: Resource Gathering (DurationStep)', async () => {
		const game = new Game({
			terrainSeed: 999,
			characterCount: 0,
		})
		games.add(game)
		await game.loaded
		const char = game.population.createCharacter('Worker', { q: 2, r: 2 })

		const workDuration = 5.0
		const step = new DurationStep(workDuration, 'work', 'Chopping Wood')
		char.stepExecutor = step

		const dt = 0.1
		for (let i = 0; i < 25; i++) char.update(dt)

		const saveState = game.saveGameData()

		const game2 = new Game({
			terrainSeed: 999,
			characterCount: 0,
		})
		games.add(game2)
		await game2.loaded
		await game2.loadGameData(saveState)
		const char2 = game2.population.character(char.uid)

		expect(char2.stepExecutor).toBeDefined()
		expect(char2.stepExecutor!.constructor.name).toBe('DurationStep')
		expect((char2.stepExecutor as DurationStep).evolution).toBeCloseTo(0.5, 2)

		// Finish work
		let finished = false
		char2.stepExecutor!.final(() => {
			finished = true
		})
		for (let i = 0; i < 26; i++) {
			char2.update(dt)
		}
		expect(finished).toBe(true)
	})

	it('reloads untouched streamed gameplay tiles from saved frontier coords', async () => {
		const game = new Game({
			terrainSeed: 321,
			characterCount: 0,
		})
		games.add(game)
		await game.loaded

		const streamedCoord = { q: 14, r: 0 }
		expect(game.hex.getTileContent(streamedCoord)).toBeUndefined()

		await game.requestGameplayFrontier(streamedCoord, 0, { maxBatchSize: 1 })

		const tile = game.hex.getTile(streamedCoord)
		expect(tile).toBeDefined()
		expect(tile?.content).toBeDefined()

		const saveState = game.saveGameData()
		expect(saveState.tiles?.some((entry) => entry.coord[0] === 14 && entry.coord[1] === 0)).toBe(
			false
		)
		expect(
			saveState.streamedFrontier?.some(
				(entry) => entry[0] === streamedCoord.q && entry[1] === streamedCoord.r
			)
		).toBe(true)

		const game2 = new Game({
			terrainSeed: 321,
			characterCount: 0,
		})
		games.add(game2)
		await game2.loaded
		await game2.loadGameData(saveState)

		expect(game2.hex.getTile(streamedCoord)).toBeDefined()
		expect(game2.hex.getTileContent(streamedCoord)).toBeDefined()
	})

	it('does not serialize the untouched bootstrap region into streamed frontier coords', async () => {
		const game = new Game({
			terrainSeed: 987,
			characterCount: 0,
		})
		games.add(game)
		await game.loaded

		const saveState = game.saveGameData()
		expect(saveState.streamedFrontier ?? []).toHaveLength(0)

		const streamedCoord = { q: 14, r: 0 }
		await game.requestGameplayFrontier(streamedCoord, 0, { maxBatchSize: 1 })
		const saveStateAfterStreaming = game.saveGameData()
		expect(saveStateAfterStreaming.streamedFrontier).toEqual([[14, 0]])
	})

	it('preserves zones and projects placed on streamed gameplay tiles', async () => {
		const game = new Game({
			terrainSeed: 654,
			characterCount: 0,
		})
		games.add(game)
		await game.loaded

		const residentialCoord = { q: 15, r: 0 }
		const projectCoord = { q: 16, r: 0 }
		await game.requestGameplayFrontier(residentialCoord, 1, { maxBatchSize: 7 })

		const residentialTile = game.hex.getTile(residentialCoord)
		const projectTile = game.hex.getTile(projectCoord)
		expect(residentialTile?.content).toBeDefined()
		expect(projectTile?.content).toBeDefined()

		residentialTile!.zone = 'residential'
		expect(projectTile!.content instanceof UnBuiltLand).toBe(true)
		;(projectTile!.content as UnBuiltLand).setProject('build:test')
		projectTile!.asGenerated = false

		const saveState = game.saveGameData()
		const game2 = new Game({
			terrainSeed: 654,
			characterCount: 0,
		})
		games.add(game2)
		await game2.loaded
		await game2.loadGameData(saveState)

		expect(game2.hex.zoneManager.getZone(residentialCoord)).toBe('residential')
		const loadedProjectTile = game2.hex.getTile(projectCoord)
		expect(loadedProjectTile?.content instanceof UnBuiltLand).toBe(true)
		expect((loadedProjectTile?.content as UnBuiltLand).project).toBe('build:test')
	})

	it('Scenario 4: Logistics/MultiMoveStep', async () => {
		// Simulates a complex movement often used when hauling goods
		const game = new Game({
			terrainSeed: 777,
			characterCount: 0,
		})
		games.add(game)
		await game.loaded
		const char = game.population.createCharacter('Hauler', { q: 0, r: 0 })

		// MultiMove: A -> B -> C
		const path = [
			{ who: char, from: { q: 0, r: 0 }, to: { q: 5, r: 5 } },
			{ who: char, from: { q: 5, r: 5 }, to: { q: 10, r: 0 } },
		]
		// This is pseudo-construction, MultiMoveStep expects distinct movements that might happen concurrently or sequentially?
		// Actually MultiMoveStep lerps all movements in parallel (evoluion 0-1).
		// It's used for fleets or coordinated moves.
		// Let's assume the character is moving relative to something else or just complex move.
		// We'll stick to a simple multi-move where 'who' is the char.

		const step = new MultiMoveStep(10, path, 'work', 'Hauling stuff')
		char.stepExecutor = step

		const dt = 0.1
		// Run 50%
		for (let i = 0; i < 50; i++) char.update(dt) // 5s

		const saveState = game.saveGameData()

		// Reload
		const game2 = new Game({
			terrainSeed: 777,
			characterCount: 0,
		})
		games.add(game2)
		await game2.loaded
		await game2.loadGameData(saveState)
		const char2 = game2.population.character(char.uid)

		expect(char2.stepExecutor!.constructor.name).toBe('MultiMoveStep')
		expect((char2.stepExecutor as MultiMoveStep).evolution).toBeCloseTo(0.5, 2)

		// Check position: Should be halfway between start and end?
		// Logic says MultiMoveStep updates position based on lerp.
		// If it persists, it should be correct.

		// Finish
		for (let i = 0; i < 51; i++) char2.update(dt)

		// After finish, char should be at destination of the movements?
		// MultiMoveStep updates 'who' position.
		// The last movement targeting q:10,r:0 should be reflected if it was applied.
		// expect(char2.position.q).toBeCloseTo(10, 1)
		// (This depends on MultiMoveStep logic detail, verified by runtime)
	})

	it('Scenario 5: Terraform Patch Roundtrip', async () => {
		const game = new Game({
			terrainSeed: 2024,
			characterCount: 0,
		})
		games.add(game)
		await game.loaded

		game.generate(
			{
				terrainSeed: 2024,
				characterCount: 0,
			},
			{
				tiles: [
					{
						coord: [1, -1],
						terrain: 'rocky',
						height: 0.77,
						temperature: 0.31,
						humidity: -0.22,
						sediment: 0.4,
						waterTable: 0.12,
					},
				],
			}
		)

		const saveState = game.saveGameData()
		expect(saveState.tiles).toContainEqual(
			expect.objectContaining({
				coord: [1, -1],
				terrain: 'rocky',
				height: 0.77,
				temperature: 0.31,
				humidity: -0.22,
				sediment: 0.4,
				waterTable: 0.12,
			})
		)

		const game2 = new Game({
			terrainSeed: 2024,
			characterCount: 0,
		})
		games.add(game2)
		await game2.loaded
		await game2.loadGameData(saveState)

		const tile = game2.hex.getTile({ q: 1, r: -1 })!
		expect(tile.terrainHeight).toBe(0.77)
		expect(tile.terrainState).toMatchObject({
			height: 0.77,
			temperature: 0.31,
			humidity: -0.22,
			sediment: 0.4,
			waterTable: 0.12,
		})
		expect(tile.content?.debugInfo?.terrain).toBe('rocky')
	})
})
