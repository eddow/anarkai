import { reset } from 'mutts'
import { Container, RenderLayer, Sprite } from 'pixi.js'
import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import { createAlveolus } from 'ssh/hive'
import { BuildAlveolus } from 'ssh/hive/build'
import { afterEach, describe, expect, it } from 'vitest'
import { gatherFreightLine } from '../../../ssh/tests/freight-fixtures'
import { TestEngine } from '../../../ssh/tests/test-engine/engine'
import type { PixiGameRenderer } from '../renderer'
import { BorderVisual } from './border-visual'
import { TileVisual } from './tile-visual'

function createRendererStub(game?: TestEngine['game']): PixiGameRenderer {
	const fakeTexture = {
		frame: { width: 16, height: 16 },
		source: { width: 16, height: 16 },
		width: 16,
		height: 16,
	} as never
	return {
		game,
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

function collectLabelsIncluding(node: Container, needle: string): string[] {
	const labels: string[] = []
	for (const child of node.children) {
		if (child.label?.includes(needle)) labels.push(child.label)
		if ('children' in child) labels.push(...collectLabelsIncluding(child as Container, needle))
	}
	return labels
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
		renderer.layers.vehicles,
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
			expect(renderer.layers.storedGoods.renderLayerChildren[0]?.parent).not.toBeNull()
			expect(storageLayerSpriteCount(renderer)).toBe(1)
			expect(nonStorageGoodsAttachmentCount(renderer)).toBe(0)

			visual.dispose()
		} finally {
			await engine.destroy()
		}
	})

	it('renders the city hall icon from tile visual state', async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		try {
			engine.loadScenario({
				tiles: [{ coord: [0, 0], terrain: 'grass' }],
				population: [],
			})

			const tile = engine.game.hex.getTile({ q: 0, r: 0 })
			if (!tile) throw new Error('Expected city hall tile to exist')
			;(
				engine.game as unknown as {
					getSettlementTradeProfileAtCityHall(coord: { q: number; r: number }): unknown
				}
			).getSettlementTradeProfileAtCityHall = (coord) =>
				coord.q === 0 && coord.r === 0
					? { id: 'settlement-1', cityHall: { position: { q: 0, r: 0 } } }
					: undefined

			const renderer = createRendererStub(engine.game)
			const visual = new TileVisual(tile, renderer)
			visual.bind()

			expect(collectLabelsIncluding(visual.view, 'cityHall')).toHaveLength(1)

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

			const finishedStorage = createAlveolus('storage', tile)
			if (!finishedStorage) throw new Error('Expected storage alveolus')
			tile.content = finishedStorage
			finishedStorage.storage.addGood('wood', 1)
			visual.refreshStoredGoods()

			expect(renderer.layers.storedGoods.renderLayerChildren).toHaveLength(1)
			expect(storageLayerSpriteCount(renderer)).toBe(1)
			expect(nonStorageGoodsAttachmentCount(renderer)).toBe(0)

			visual.dispose()
		} finally {
			await engine.destroy()
		}
	})

	it('renders foundation storage goods for unbuilt construction projects', async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		try {
			engine.loadScenario({
				tiles: [{ coord: [0, 0], terrain: 'grass' }],
				population: [],
			})

			const tile = engine.game.hex.getTile({ q: 0, r: 0 })
			if (!tile) throw new Error('Expected project tile to exist')
			if (!(tile.content instanceof UnBuiltLand)) throw new Error('Expected unbuilt land')

			const renderer = createRendererStub()
			const visual = new TileVisual(tile, renderer)
			visual.bind()

			tile.content.setProject('build:storage')
			tile.content.foundationStorage?.addGood('concrete', 1)
			visual.refreshStoredGoods()

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

	it('clears the bay docked-vehicle sprite after a wheelbarrow undocks', async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		try {
			const line = gatherFreightLine({
				id: 'dock-visual',
				name: 'Dock visual',
				hiveName: 'dock-visual-hive',
				coord: [0, 0],
				filters: [],
				radius: 1,
			})
			engine.loadScenario({
				hives: [
					{
						name: 'dock-visual-hive',
						alveoli: [{ coord: [0, 0], alveolus: 'freight_bay', goods: {} }],
					},
				],
				freightLines: [line],
				population: [],
			})

			const tile = engine.game.hex.getTile({ q: 0, r: 0 })
			if (!tile) throw new Error('Expected freight bay tile to exist')
			const stop = line.stops.find((candidate) => 'anchor' in candidate)
			if (!stop) throw new Error('Expected anchor stop')
			const vehicle = engine.game.vehicles.createVehicle('dock-visual-wb', 'wheelbarrow', {
				q: 0,
				r: 0,
			})
			vehicle.beginLineService(line, stop)
			vehicle.dock()

			const renderer = createRendererStub(engine.game)
			const visual = new TileVisual(tile, renderer)
			visual.bind()

			expect(collectLabelsIncluding(visual.view, 'docked-vehicle:dock-visual-wb')).toHaveLength(1)

			vehicle.undock()
			visual.refreshDockedVehicles()

			expect(collectLabelsIncluding(visual.view, 'docked-vehicle:dock-visual-wb')).toHaveLength(0)

			visual.dispose()
		} finally {
			await engine.destroy()
		}
	})
})
