import { reset } from 'mutts'
import { Container, RenderLayer, Texture } from 'pixi.js'
import { afterEach, describe, expect, it } from 'vitest'
import type { PixiGameRenderer } from './renderer'
import { VisualFactory } from './visual-factory'
import { TestEngine } from '../../ssh/tests/test-engine/engine'

function createRendererStub(game: TestEngine['game']): PixiGameRenderer {
	return {
		game,
		app: {} as any,
		worldScene: new Container(),
		layers: {
			ground: new RenderLayer(),
			alveoli: new RenderLayer(),
			resources: new RenderLayer(),
			storedGoods: new RenderLayer(),
			looseGoods: new RenderLayer(),
			characters: new RenderLayer(),
			ui: new Container(),
		},
		visuals: new Map(),
		attachToLayer(layer: RenderLayer, child: Container) {
			layer.attach(child)
			layer.sortRenderLayerChildren()
		},
		detachFromLayer(layer: RenderLayer, child: Container) {
			layer.detach(child)
			layer.sortRenderLayerChildren()
		},
		getTexture: () => Texture.WHITE,
	} as unknown as PixiGameRenderer
}

describe('VisualFactory batched lifecycle sync', () => {
	afterEach(() => {
		reset()
	})

	it('skips plain streamed terrain tiles and records the skip in diagnostics', async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		try {
			engine.loadScenario({
				tiles: [{ coord: [0, 0], terrain: 'grass' }],
				population: [],
			})

			const renderer = createRendererStub(engine.game)
			const factory = new VisualFactory(renderer)
			factory.bind()

			const initialTileVisuals = factory.getDiagnostics().current.tileVisuals
			expect(renderer.visuals.has('tile:0,0')).toBe(false)
			const diagnostics = factory.getDiagnostics()
			expect(diagnostics.recentBatches[0]?.reason).toBe('bootstrap')
			expect(diagnostics.recentBatches[0]?.tileCount).toBeGreaterThanOrEqual(1)
			expect(diagnostics.recentBatches[0]?.skippedPlainTileCount).toBeGreaterThanOrEqual(1)
			expect(diagnostics.current.tileVisuals).toBe(initialTileVisuals)

			factory.destroy()
		} finally {
			await engine.destroy()
		}
	})

	it('creates a tile visual when a plain tile later gains visible overlay state', async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		try {
			engine.loadScenario({
				tiles: [{ coord: [0, 0], terrain: 'grass' }],
				population: [],
			})

			const renderer = createRendererStub(engine.game)
			const factory = new VisualFactory(renderer)
			factory.bind()

			const initialTileVisuals = factory.getDiagnostics().current.tileVisuals
			expect(renderer.visuals.has('tile:0,0')).toBe(false)

			const tile = engine.game.hex.getTile({ q: 0, r: 0 })
			if (!tile) throw new Error('Expected tile to exist')
			tile.zone = 'harvest'
			await new Promise((resolve) => setTimeout(resolve, 0))

			expect(renderer.visuals.has('tile:0,0')).toBe(true)
			const diagnostics = factory.getDiagnostics()
			expect(diagnostics.recentBatches[0]?.reason).toBe('objectsChanged')
			expect(diagnostics.recentBatches[0]?.tileVisualCreatedCount).toBe(1)
			expect(diagnostics.current.tileVisuals).toBe(initialTileVisuals + 1)

			factory.destroy()
		} finally {
			await engine.destroy()
		}
	})

	it('removes visuals when the corresponding batched objectsRemoved event fires', async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		try {
			engine.loadScenario({
				tiles: [{ coord: [0, 0], terrain: 'grass' }],
				population: [],
			})

			const renderer = createRendererStub(engine.game)
			const factory = new VisualFactory(renderer)
			factory.bind()

			const tile = engine.game.hex.getTile({ q: 0, r: 0 })
			if (!tile) throw new Error('Expected tile to exist')
			tile.zone = 'harvest'
			await new Promise((resolve) => setTimeout(resolve, 0))
			expect(renderer.visuals.has('tile:0,0')).toBe(true)
			engine.game.hex.reset()
			expect(renderer.visuals.has('tile:0,0')).toBe(false)

			factory.destroy()
		} finally {
			await engine.destroy()
		}
	})
})
