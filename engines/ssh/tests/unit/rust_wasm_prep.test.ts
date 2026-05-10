import { BasicDwelling } from 'ssh/board/content/basic-dwelling'
import { BuildDwelling } from 'ssh/board/content/build-dwelling'
import { Game } from 'ssh/game/game'
import {
	slottedStorageAvailable,
	slottedStorageAvailableGoods,
	slottedStorageRoom,
	specificStorageAvailable,
	specificStorageAvailableGoods,
	specificStorageRoom,
} from 'ssh/storage/pure'
import { isVehicleBoundJob, type Job } from 'ssh/types/base'
import { afterEach, describe, expect, it } from 'vitest'

describe('Rust/WASM preparation seams', () => {
	describe('pure storage snapshots', () => {
		it('computes specific-storage available goods and room from plain data', () => {
			const snapshot = {
				stock: { wood: 10, stone: 2 },
				reserved: { wood: 3 },
				allocated: { wood: 4 },
				maxAmounts: { wood: 20, stone: 5 },
			} as const

			expect(specificStorageAvailableGoods(snapshot)).toEqual({ wood: 7, stone: 2 })
			expect(specificStorageAvailable(snapshot, 'wood')).toBe(7)
			expect(specificStorageRoom(snapshot, 'wood')).toBe(6)
		})

		it('computes slotted-storage available goods and room from plain data', () => {
			const snapshot = {
				maxQuantityPerSlot: 5,
				slots: [
					{ goodType: 'wood', quantity: 4, reserved: 1 },
					{ goodType: 'wood', quantity: 2, allocated: 2 },
					{ goodType: 'stone', quantity: 5 },
					undefined,
				],
			} as const

			expect(slottedStorageAvailableGoods(snapshot)).toEqual({ wood: 5, stone: 5 })
			expect(slottedStorageAvailable(snapshot, 'wood')).toBe(5)
			expect(slottedStorageRoom(snapshot, 'wood')).toBe(7)
			expect(slottedStorageRoom(snapshot, 'berries')).toBe(5)
		})
	})

	describe('vehicle job predicate', () => {
		it('uses the shared vehicleUid seam instead of enumerating vehicle job names', () => {
			const vehicleJob = {
				job: 'vehicleHop',
				vehicleUid: 'vehicle:1',
				lineId: 'line:1',
				stopId: 'stop:1',
				path: [],
				dockEnter: false,
				urgency: 1,
				fatigue: 0,
			} satisfies Job
			const normalJob = { job: 'harvest', urgency: 1, fatigue: 0 } satisfies Job

			expect(isVehicleBoundJob(vehicleJob)).toBe(true)
			expect(isVehicleBoundJob(normalJob)).toBe(false)
		})
	})

	describe('localizable content labels', () => {
		let game: Game | undefined

		afterEach(() => {
			game?.destroy()
			game = undefined
		})

		it('keeps name as an engine id and exposes optional translation keys', async () => {
			game = new Game(
				{ terrainSeed: 9801, characterCount: 0 },
				{ tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }] }
			)
			await game.loaded
			game.ticker.stop()

			const tile = game.hex.getTile({ q: 0, r: 0 })!
			const dwelling = new BasicDwelling(tile)
			const buildDwelling = new BuildDwelling(tile, 'basic_dwelling')

			expect(dwelling.name).toBe('basic_dwelling')
			expect(dwelling.title).toBe('Basic dwelling')
			expect(dwelling.titleKey).toBe('residential.dwelling.tierBasic')
			expect(buildDwelling.name).toBe('build.dwelling.basic_dwelling')
			expect(buildDwelling.titleKey).toBe('residential.projectBasicDwelling')
		})
	})
})
