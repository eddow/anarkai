import { reset } from 'mutts'
import { Container, RenderLayer, Sprite } from 'pixi.js'
import { BasicDwelling } from 'ssh/board/content/basic-dwelling'
import { BuildDwelling } from 'ssh/board/content/build-dwelling'
import { afterEach, describe, expect, it } from 'vitest'
import { TestEngine } from '../../../ssh/tests/test-engine/engine'
import type { PixiGameRenderer } from '../renderer'
import { DwellingVisual } from './dwelling-visual'

function createRendererStub(): PixiGameRenderer {
	const fakeTexture = {
		frame: { width: 16, height: 16 },
		width: 16,
		height: 16,
	} as never
	return {
		layers: {
			ground: new RenderLayer(),
			alveoli: new RenderLayer(),
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
		getTexture: () => fakeTexture,
	} as unknown as PixiGameRenderer
}

function countSprites(node: Container): number {
	let total = 0
	for (const child of node.children) {
		if (child instanceof Sprite) total += 1
		if ('children' in child) {
			total += countSprites(child as Container)
		}
	}
	return total
}

function countSpritesInLayer(layer: RenderLayer): number {
	return layer.renderLayerChildren.reduce(
		(total, child) => total + countSprites(child as Container),
		0
	)
}

describe('DwellingVisual', () => {
	afterEach(() => {
		reset()
	})

	it('renders the cabin sprite only for completed dwellings', async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		try {
			engine.loadScenario({
				tiles: [{ coord: [0, 0], terrain: 'grass' }],
				population: [],
				zones: { residential: [[0, 0]] },
			})

			const tile = engine.game.hex.getTile({ q: 0, r: 0 })
			if (!tile) throw new Error('Expected residential tile')

			const renderer = createRendererStub()

			tile.content = new BuildDwelling(tile, 'basic_dwelling')
			const buildSite = tile.content
			if (!(buildSite instanceof BuildDwelling)) throw new Error('Expected BuildDwelling')
			const buildVisual = new DwellingVisual(buildSite, renderer)
			buildVisual.bind()
			expect(countSpritesInLayer(renderer.layers.alveoli)).toBe(0)
			buildVisual.dispose()

			tile.content = new BasicDwelling(tile)
			const completedDwelling = tile.content
			if (!(completedDwelling instanceof BasicDwelling)) throw new Error('Expected BasicDwelling')
			const completedVisual = new DwellingVisual(completedDwelling, renderer)
			completedVisual.bind()
			expect(countSpritesInLayer(renderer.layers.alveoli)).toBe(1)
			completedVisual.dispose()
		} finally {
			await engine.destroy()
		}
	})
})
