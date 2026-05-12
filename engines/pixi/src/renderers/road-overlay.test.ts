import { reset } from 'mutts'
import { Container, RenderLayer } from 'pixi.js'
import type { Game } from 'ssh/game/game'
import { afterEach, describe, expect, it } from 'vitest'
import { TestEngine } from '../../../ssh/tests/test-engine/engine'
import type { PixiGameRenderer } from '../renderer'
import { RoadOverlay } from './road-overlay'

function createRendererStub(game: Game): PixiGameRenderer {
	const ground = new RenderLayer()
	const roads = new RenderLayer()
	const alveoli = new RenderLayer()
	ground.zIndex = 0
	roads.zIndex = 5
	alveoli.zIndex = 10
	return {
		game,
		worldScene: new Container(),
		layers: {
			ground,
			roads,
			alveoli,
			resources: new RenderLayer(),
			storedGoods: new RenderLayer(),
			looseGoods: new RenderLayer(),
			vehicles: new RenderLayer(),
			characters: new RenderLayer(),
			ui: new Container(),
		},
		attachToLayer(layer: RenderLayer, child: Container) {
			layer.attach(child)
			layer.sortRenderLayerChildren()
		},
		detachFromLayer(layer: RenderLayer, child: Container) {
			layer.detach(child)
			layer.sortRenderLayerChildren()
		},
	} as unknown as PixiGameRenderer
}

describe('RoadOverlay', () => {
	afterEach(() => reset())

	it('renders stored roads on a layer between terrain and structures', async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		try {
			engine.loadScenario({
				tiles: [
					{ coord: [0, 0], terrain: 'grass' },
					{ coord: [1, 0], terrain: 'grass' },
				],
				population: [],
			})
			engine.game.hex.setRoadType({ q: 0.5, r: 0 }, 'path')

			const renderer = createRendererStub(engine.game)
			const overlay = new RoadOverlay(renderer)
			overlay.bind()

			expect(renderer.layers.ground.zIndex).toBeLessThan(renderer.layers.roads.zIndex)
			expect(renderer.layers.roads.zIndex).toBeLessThan(renderer.layers.alveoli.zIndex)
			expect(renderer.layers.roads.renderLayerChildren).toHaveLength(1)

			overlay.dispose()
		} finally {
			await engine.destroy()
		}
	})
})
