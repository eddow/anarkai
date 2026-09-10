import { FreightBayAlveolus } from 'ssh/hive/freight-bay'
import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import { demolishStructure } from 'ssh/construction-demolition'
import { Game } from 'ssh/game/game'
import {
	pickVehicleRelocationTarget,
	relocateVehicleFromAlveolus,
} from 'ssh/freight/vehicle-relocation'
import type { GamePatches } from 'ssh/game/game'
import { afterEach, describe, expect, it } from 'vitest'
import { gatherFreightLine } from '../freight-fixtures'

describe('vehicle relocation', () => {
	let game: Game | undefined

	afterEach(() => {
		game?.destroy()
		game = undefined
	})

	async function setupBayHive(): Promise<Game> {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'concrete' as const },
				{ coord: [1, 0] as const, terrain: 'concrete' as const },
				{ coord: [2, 0] as const, terrain: 'concrete' as const },
			],
			hives: [
				{
					name: 'RelocateHive',
					alveoli: [
						{ coord: [0, 0], alveolus: 'freight_bay', goods: {} },
						{ coord: [1, 0], alveolus: 'freight_bay', goods: {} },
					],
				},
			],
			freightLines: [
				gatherFreightLine({
					name: 'Relocate line',
					hiveName: 'RelocateHive',
					coord: [0, 0],
					filters: ['wood'],
					radius: 2,
				}),
			],
		} satisfies GamePatches
		const next = new Game(
			{ terrainSeed: 4242, characterCount: 0, settlementGeneration: false },
			patches
		)
		await next.loaded
		next.ticker.stop()
		game = next
		return next
	}

	it('prefers a free same-hive bay over a burdened neighbor', async () => {
		const g = await setupBayHive()
		const fromTile = g.hex.getTile({ q: 0, r: 0 })!
		const freeBayTile = g.hex.getTile({ q: 1, r: 0 })!
		const burdenedTile = g.hex.getTile({ q: 2, r: 0 })!
		expect(freeBayTile.content).toBeInstanceOf(FreightBayAlveolus)
		g.hex.looseGoods.add(burdenedTile, 'wood', { position: burdenedTile.position })

		const line = [...g.freightLines][0]!
		const vehicle = g.vehicles.createVehicle('wheelbarrow', { q: 0, r: 0 }, [line])
		const character = g.population.createCharacter('Evicted', { q: 0, r: 0 })
		vehicle.beginService(line, line.stops[1]!, character)
		vehicle.dock()

		const target = pickVehicleRelocationTarget(g, vehicle, fromTile)
		expect(target).toBe(freeBayTile)

		// Real eviction flow undocks first, so the vehicle is idle and burdens its new tile.
		vehicle.undock()
		expect(relocateVehicleFromAlveolus(g, vehicle, fromTile)).toBe(true)
		expect(vehicle.position).toMatchObject({ q: 1, r: 0 })
		expect(freeBayTile.isBurdened).toBe(true)
	})

	it('skips burdened bays and falls through to the next unburdened tile', async () => {
		const g = await setupBayHive()
		const fromTile = g.hex.getTile({ q: 0, r: 0 })!
		const burdenedBayTile = g.hex.getTile({ q: 1, r: 0 })!
		g.hex.looseGoods.add(burdenedBayTile, 'stone', { position: burdenedBayTile.position })

		const line = [...g.freightLines][0]!
		const vehicle = g.vehicles.createVehicle('wheelbarrow', { q: 0, r: 0 }, [line])

		const picked = pickVehicleRelocationTarget(g, vehicle, fromTile)
		expect(picked).toBeDefined()
		expect(picked).not.toBe(burdenedBayTile)
		expect(picked).not.toBe(fromTile)
		expect(picked!.isClear).toBe(true)
		expect(picked!.isBurdened).toBe(false)
	})

	it('falls back to a nearby clear tile when no bay is free', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'concrete' as const },
				{ coord: [1, 0] as const, terrain: 'concrete' as const },
			],
			hives: [
				{
					name: 'SoloHive',
					alveoli: [{ coord: [0, 0], alveolus: 'storage', goods: {} }],
				},
			],
		} satisfies GamePatches
		const solo = new Game(
			{ terrainSeed: 4243, characterCount: 0, settlementGeneration: false },
			patches
		)
		await solo.loaded
		solo.ticker.stop()
		game = solo
		const fromTile = solo.hex.getTile({ q: 0, r: 0 })!
		const freeTile = solo.hex.getTile({ q: 1, r: 0 })!
		if (freeTile.content instanceof (await import('ssh/board/content/unbuilt-land')).UnBuiltLand) {
			freeTile.content.deposit = undefined
		}
		for (const good of [...solo.hex.looseGoods.getGoodsAt(freeTile.position)]) good.remove()

		const vehicle = solo.vehicles.createVehicle('wheelbarrow', { q: 0, r: 0 })
		const target = pickVehicleRelocationTarget(solo, vehicle, fromTile)
		expect(target).toBeDefined()
		expect(target!.isClear).toBe(true)
		expect(target!.isBurdened).toBe(false)
		solo.destroy()
		game = undefined
	})

	it('never picks a burdened tile', async () => {
		const g = await setupBayHive()
		const fromTile = g.hex.getTile({ q: 0, r: 0 })!
		const freeBayTile = g.hex.getTile({ q: 1, r: 0 })!
		const line = [...g.freightLines][0]!
		const vehicle = g.vehicles.createVehicle('wheelbarrow', { q: 0, r: 0 }, [line])

		// Burden the preferred bay: the picker must skip it.
		g.hex.looseGoods.add(freeBayTile, 'wood', { position: freeBayTile.position })
		expect(freeBayTile.isBurdened).toBe(true)
		const picked = pickVehicleRelocationTarget(g, vehicle, fromTile)
		// The burdened bay is skipped; the picker falls through to a nearby clear tile.
		if (picked) {
			expect(picked.isClear).toBe(true)
			expect(picked.isBurdened).toBe(false)
		}
		expect(picked).not.toBe(freeBayTile)
	})

	it('demolishing an occupied bay leaves no ghost vehicles', async () => {
		const g = await setupBayHive()
		const bayTile = g.hex.getTile({ q: 0, r: 0 })!
		const line = [...g.freightLines][0]!
		const vehicle = g.vehicles.createVehicle('wheelbarrow', { q: 0, r: 0 }, [line])
		const character = g.population.createCharacter('Occupant', { q: 0, r: 0 })
		vehicle.beginService(line, line.stops[1]!, character)
		vehicle.dock()
		expect(vehicle.position).toBeUndefined()

		demolishStructure(bayTile)

		expect(bayTile.content).toBeInstanceOf(UnBuiltLand)
		// No ghost: every vehicle has a world position after demolition.
		for (const v of g.vehicles) {
			expect(v.position).toBeDefined()
		}
		// Demolition never fails: the vehicle sits on (or docked at) a tile.
		expect(vehicle.tile).toBeDefined()
		// Relocated into the other (free) bay, not left on the demolished tile.
		const freeBayTile = g.hex.getTile({ q: 1, r: 0 })!
		expect(vehicle.position).toMatchObject({ q: 1, r: 0 })
		expect(vehicle.tile).toBe(freeBayTile)
	})

	it('demolition still succeeds with no unburdened candidate (fallback to anchor)', async () => {
		const patches = {
			tiles: [{ coord: [0, 0] as const, terrain: 'concrete' as const }],
			hives: [
				{
					name: 'LoneHive',
					alveoli: [{ coord: [0, 0], alveolus: 'freight_bay', goods: {} }],
				},
			],
			freightLines: [
				gatherFreightLine({
					name: 'Lone line',
					hiveName: 'LoneHive',
					coord: [0, 0],
					filters: ['wood'],
					radius: 2,
				}),
			],
		} satisfies GamePatches
		const lone = new Game(
			{ terrainSeed: 4244, characterCount: 0, settlementGeneration: false },
			patches
		)
		await lone.loaded
		lone.ticker.stop()
		game = lone
		const bayTile = lone.hex.getTile({ q: 0, r: 0 })!
		const line = [...lone.freightLines][0]!
		const vehicle = lone.vehicles.createVehicle('wheelbarrow', { q: 0, r: 0 }, [line])
		const character = lone.population.createCharacter('Lone', { q: 0, r: 0 })
		vehicle.beginService(line, line.stops[1]!, character)
		vehicle.dock()

		demolishStructure(bayTile)

		expect(bayTile.content).toBeInstanceOf(UnBuiltLand)
		expect(vehicle.position).toBeDefined()
		lone.destroy()
		game = undefined
	})
})
