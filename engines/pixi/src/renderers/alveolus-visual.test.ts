import { reset } from 'mutts'
import { Container, RenderLayer, Sprite } from 'pixi.js'
import { alveolusClass } from 'ssh/hive'
import { BuildAlveolus } from 'ssh/hive/build'
import { afterEach, describe, expect, it } from 'vitest'
import { TestEngine } from '../../../ssh/tests/test-engine/engine'
import type { PixiGameRenderer } from '../renderer'
import { BorderVisual } from './border-visual'
import { TileVisual } from './tile-visual'

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

function storageLayerSpriteCount(renderer: PixiGameRenderer): number {
	return countSpritesInLayer(renderer.layers.storedGoods)
}

function nonStorageGoodsAttachmentCount(renderer: PixiGameRenderer): number {
	return [
		renderer.layers.ground,
		renderer.layers.alveoli,
		renderer.layers.resources,
		renderer.layers.looseGoods,
		renderer.layers.characters,
	].reduce(
		(total, layer) =>
			total + layer.renderLayerChildren.filter((child) => child.label.includes('/goods')).length,
		0
	)
}

describe('TileVisual storage goods layering', () => {
	afterEach(() => {
		reset()
	})

	it('renders one stored-good sprite in the storedGoods layer for loaded storage', async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		try {
			engine.loadScenario({
				hives: [
					{
						name: 'loaded',
						alveoli: [{ coord: [0, 0], alveolus: 'storage', goods: { wood: 1 } }],
					},
				],
				population: [],
			})

			const tile = engine.game.hex.getTile({ q: 0, r: 0 })
			if (!tile) throw new Error('Expected storage tile to exist')

			const renderer = createRendererStub()
			const visual = new TileVisual(tile, renderer)
			visual.bind()

			expect(renderer.layers.storedGoods.renderLayerChildren).toHaveLength(1)
			expect(storageLayerSpriteCount(renderer)).toBe(1)
			expect(nonStorageGoodsAttachmentCount(renderer)).toBe(0)

			visual.dispose()
		} finally {
			await engine.destroy()
		}
	})

	it('keeps exactly one stored-good sprite in storedGoods after build-site replacement', async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		try {
			engine.loadScenario({
				tiles: [{ coord: [0, 0], terrain: 'grass' }],
				population: [],
			})

			const tile = engine.game.hex.getTile({ q: 0, r: 0 })
			if (!tile) throw new Error('Expected construction tile to exist')

			const renderer = createRendererStub()
			const visual = new TileVisual(tile, renderer)
			visual.bind()

			tile.content = new BuildAlveolus(tile, 'storage')
			expect(countSpritesInLayer(renderer.layers.alveoli)).toBe(1)

			const StorageCtor = alveolusClass.storage
			if (!StorageCtor) throw new Error('Expected storage alveolus constructor')
			const finishedStorage = new StorageCtor(tile)
			tile.content = finishedStorage
			finishedStorage.storage.addGood('wood', 1)

			expect(renderer.layers.storedGoods.renderLayerChildren).toHaveLength(1)
			expect(storageLayerSpriteCount(renderer)).toBe(1)
			expect(nonStorageGoodsAttachmentCount(renderer)).toBe(0)

			visual.dispose()
		} finally {
			await engine.destroy()
		}
	})

	it('sorts attached render-layer children by zIndex regardless of attach order', () => {
		const layer = new RenderLayer()
		layer.sortableChildren = true

		const parent = new Container()
		const back = new Container()
		const front = new Container()
		back.zIndex = 10
		front.zIndex = 20
		parent.addChild(front, back)

		layer.attach(front)
		layer.attach(back)
		layer.sortRenderLayerChildren()

		expect(layer.renderLayerChildren).toEqual([back, front])
	})

	it('renders gate goods once from the restored border visual parent', async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		try {
			engine.loadScenario({
				hives: [
					{
						name: 'paired',
						alveoli: [
							{ coord: [0, 0], alveolus: 'storage' },
							{ coord: [1, 0], alveolus: 'storage' },
						],
					},
				],
				population: [],
			})

			const left = engine.game.hex.getTile({ q: 0, r: 0 })
			const right = engine.game.hex.getTile({ q: 1, r: 0 })
			if (!left?.content || !right?.content) throw new Error('Expected adjacent alveoli to exist')

			const leftContent = left.content
			if (!('gates' in leftContent) || !leftContent.gates[0]) {
				throw new Error('Expected adjacent alveoli to expose a gate')
			}
			leftContent.gates[0].storage.addGood('wood', 1)

			const renderer = createRendererStub()
			const leftVisual = new TileVisual(left, renderer)
			const rightVisual = new TileVisual(right, renderer)
			const gateVisual = new BorderVisual(leftContent.gates[0].border, renderer)
			leftVisual.bind()
			rightVisual.bind()
			gateVisual.bind()

			expect(storageLayerSpriteCount(renderer)).toBe(1)
			expect(nonStorageGoodsAttachmentCount(renderer)).toBe(0)

			leftVisual.dispose()
			rightVisual.dispose()
			gateVisual.dispose()
		} finally {
			await engine.destroy()
		}
	})
})
