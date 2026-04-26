import { reset } from 'mutts'
import { Container, RenderLayer } from 'pixi.js'
import type { Game } from 'ssh/game/game'
import { afterEach, describe, expect, it } from 'vitest'
import { TestEngine } from '../../../ssh/tests/test-engine/engine'
import type { PixiGameRenderer } from '../renderer'
import { CharacterVisual } from './character-visual'
import { VehicleVisual } from './vehicle-visual'

function createRendererStub(game: Game): PixiGameRenderer {
	const fakeTexture = {
		frame: { width: 16, height: 16 },
		width: 16,
		height: 16,
	} as never
	const vehicles = new RenderLayer()
	const characters = new RenderLayer()
	vehicles.zIndex = 45
	characters.zIndex = 50
	return {
		game,
		layers: {
			ground: new RenderLayer(),
			alveoli: new RenderLayer(),
			resources: new RenderLayer(),
			storedGoods: new RenderLayer(),
			looseGoods: new RenderLayer(),
			vehicles,
			characters,
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

function collectLabelsIncluding(node: Container, substr: string): string[] {
	const out: string[] = []
	const label = typeof node.label === 'string' ? node.label : ''
	if (label.includes(substr)) out.push(label)
	for (const child of node.children) {
		if (child instanceof Container) out.push(...collectLabelsIncluding(child, substr))
	}
	return out
}

describe('VehicleVisual cargo', () => {
	afterEach(() => {
		reset()
	})

	it('renders storage goods from vehicle storage when there is no operator or service', async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		try {
			engine.loadScenario({
				tiles: [{ coord: [0, 0], terrain: 'grass' }],
				population: [],
				vehicles: [
					{
						uid: 'wb-idle',
						vehicleType: 'wheelbarrow',
						position: { q: 0, r: 0 },
						servedLineIds: [],
						goods: { wood: 1 },
					},
				],
			})

			const vehicle = engine.game.vehicles.vehicle('wb-idle')
			if (!vehicle) throw new Error('expected vehicle')

			const renderer = createRendererStub(engine.game)
			const visual = new VehicleVisual(vehicle, renderer)
			visual.bind()

			expect(vehicle.service).toBeUndefined()
			expect(vehicle.operator).toBeUndefined()
			expect(collectLabelsIncluding(visual.view, 'goods').length).toBeGreaterThan(0)
			expect(visual.view.visible).toBe(true)
			expect(renderer.layers.vehicles.renderLayerChildren).toContain(visual.view)
			expect(renderer.layers.characters.renderLayerChildren).not.toContain(visual.view)
			expect(renderer.layers.vehicles.zIndex).toBeLessThan(renderer.layers.characters.zIndex)

			visual.dispose()
		} finally {
			await engine.destroy()
		}
	})

	it('keeps cargo on the vehicle visual while driving; character visual has no goods layer', async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		try {
			engine.loadScenario({
				tiles: [{ coord: [0, 0], terrain: 'grass' }],
				population: [],
				vehicles: [
					{
						uid: 'wb-drive',
						vehicleType: 'wheelbarrow',
						position: { q: 0, r: 0 },
						servedLineIds: [],
						goods: { wood: 1 },
					},
				],
			})

			const vehicle = engine.game.vehicles.vehicle('wb-drive')
			if (!vehicle) throw new Error('expected vehicle')
			vehicle.beginOffloadService()

			const character = engine.spawnCharacter('driver', { q: 0, r: 0 })
			character.operates = vehicle
			character.onboard()
			expect(character.driving).toBe(true)

			const renderer = createRendererStub(engine.game)
			const vehicleVisual = new VehicleVisual(vehicle, renderer)
			const characterVisual = new CharacterVisual(character, renderer)
			vehicleVisual.bind()
			characterVisual.bind()

			expect(collectLabelsIncluding(vehicleVisual.view, 'goods').length).toBeGreaterThan(0)
			expect(collectLabelsIncluding(characterVisual.view, 'goods').length).toBe(0)
			expect(characterVisual.view.children).toHaveLength(1)
			expect(vehicleVisual.view.visible).toBe(true)
			expect(characterVisual.view.visible).toBe(false)

			characterVisual.dispose()
			vehicleVisual.dispose()
		} finally {
			await engine.destroy()
		}
	})

	it('draws the operator sprite on the vehicle under the body while driving', async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		try {
			engine.loadScenario({
				tiles: [{ coord: [0, 0], terrain: 'grass' }],
				population: [],
				vehicles: [
					{
						uid: 'wb-off',
						vehicleType: 'wheelbarrow',
						position: { q: 0, r: 0 },
						servedLineIds: [],
					},
				],
			})

			const vehicle = engine.game.vehicles.vehicle('wb-off')
			if (!vehicle) throw new Error('expected vehicle')
			vehicle.beginOffloadService()

			const character = engine.spawnCharacter('rider', { q: 0, r: 0 })
			character.operates = vehicle
			character.onboard()

			const renderer = createRendererStub(engine.game)
			const vehicleVisual = new VehicleVisual(vehicle, renderer)
			const characterVisual = new CharacterVisual(character, renderer)
			vehicleVisual.bind()
			characterVisual.bind()

			expect(characterVisual.view.visible).toBe(false)
			expect(collectLabelsIncluding(vehicleVisual.view, 'operator').length).toBeGreaterThan(0)
			expect(vehicleVisual.view.children.length).toBeGreaterThanOrEqual(2)
			const operatorIdx = vehicleVisual.view.children.findIndex(
				(c) => typeof c.label === 'string' && c.label.includes('operator')
			)
			const bodyIdx = vehicleVisual.view.children.findIndex(
				(c) => typeof c.label === 'string' && c.label.includes('body')
			)
			expect(operatorIdx).toBeGreaterThanOrEqual(0)
			expect(bodyIdx).toBeGreaterThanOrEqual(0)
			expect(operatorIdx).toBeLessThan(bodyIdx)

			characterVisual.dispose()
			vehicleVisual.dispose()
		} finally {
			await engine.destroy()
		}
	})
})
