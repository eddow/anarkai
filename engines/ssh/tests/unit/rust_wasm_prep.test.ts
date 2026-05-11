import { BasicDwelling } from 'ssh/board/content/basic-dwelling'
import { BuildDwelling } from 'ssh/board/content/build-dwelling'
import { Commitment } from 'ssh/commitment'
import { Game } from 'ssh/game/game'
import {
	proposedVehicleJobIdentityKey,
	proposedVehicleJobIdentityParts,
	proposedVehicleJobMatchParts,
} from 'ssh/jobs/offers'
import {
	slottedStorageAllocationPlan,
	slottedStorageAvailable,
	slottedStorageAvailableGoods,
	slottedStorageReservationPlan,
	slottedStorageRoom,
	specificStorageAllocationPlan,
	specificStorageAvailable,
	specificStorageAvailableGoods,
	specificStorageReservationPlan,
	specificStorageRoom,
} from 'ssh/storage/pure'
import { SlottedStorage } from 'ssh/storage/slotted-storage'
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

		it('plans specific-storage allocation and reservation from plain data', () => {
			const snapshot = {
				stock: { wood: 10, stone: 2 },
				reserved: { wood: 3 },
				allocated: { wood: 4 },
				maxAmounts: { wood: 20, stone: 5 },
			} as const

			expect(specificStorageAllocationPlan(snapshot, { wood: 8, stone: 10 })).toEqual({
				ok: true,
				goods: { wood: 6, stone: 3 },
			})
			expect(specificStorageReservationPlan(snapshot, { wood: 10, stone: 1 })).toEqual({
				ok: true,
				goods: { wood: 7, stone: 1 },
			})
			expect(specificStorageAllocationPlan(snapshot, {})).toEqual({
				ok: false,
				reason: 'Empty goods object provided for allocation',
			})
			expect(specificStorageReservationPlan(snapshot, { berries: 1 })).toEqual({
				ok: false,
				reason: 'Insufficient goods to reserve any goods',
			})
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

		it('plans slotted-storage allocation with current slot ordering', () => {
			const snapshot = {
				maxQuantityPerSlot: 5,
				slots: [
					{ goodType: 'wood', quantity: 4, reserved: 1 },
					{ goodType: 'wood', quantity: 2, allocated: 2 },
					undefined,
					undefined,
				],
			} as const

			expect(slottedStorageAllocationPlan(snapshot, { wood: 8, stone: 3 })).toEqual({
				ok: true,
				entries: [
					{ operation: 'allocate', slotIndex: 0, goodType: 'wood', quantity: 1 },
					{ operation: 'allocate', slotIndex: 1, goodType: 'wood', quantity: 1 },
					{ operation: 'allocate', slotIndex: 2, goodType: 'wood', quantity: 5 },
					{ operation: 'allocate', slotIndex: 3, goodType: 'wood', quantity: 1 },
				],
			})
			expect(slottedStorageAllocationPlan(snapshot, {})).toEqual({
				ok: false,
				reason: 'Empty goods object provided for allocation',
			})
			expect(
				slottedStorageAllocationPlan(
					{ maxQuantityPerSlot: 5, slots: [{ goodType: 'wood', quantity: 5 }] },
					{ stone: 1 }
				)
			).toEqual({
				ok: false,
				reason: 'Insufficient room to allocate any goods',
			})
		})

		it('plans slotted-storage reservation with current slot ordering', () => {
			const snapshot = {
				maxQuantityPerSlot: 5,
				slots: [
					{ goodType: 'wood', quantity: 4, reserved: 1 },
					{ goodType: 'wood', quantity: 2, allocated: 2 },
					{ goodType: 'stone', quantity: 3 },
					undefined,
				],
			} as const

			expect(slottedStorageReservationPlan(snapshot, { wood: 4, stone: 5 })).toEqual({
				ok: true,
				entries: [
					{ operation: 'reserve', slotIndex: 1, goodType: 'wood', quantity: 2 },
					{ operation: 'reserve', slotIndex: 0, goodType: 'wood', quantity: 2 },
					{ operation: 'reserve', slotIndex: 2, goodType: 'stone', quantity: 3 },
				],
			})
			expect(slottedStorageReservationPlan(snapshot, {})).toEqual({
				ok: false,
				reason: 'Empty goods object provided for reservation',
			})
			expect(slottedStorageReservationPlan(snapshot, { berries: 1 })).toEqual({
				ok: false,
				reason: 'Insufficient goods to reserve any goods',
			})
		})

		it('keeps slotted class allocation and reservation aligned with pure plans', () => {
			const storage = new SlottedStorage(4, 5)
			storage.addGood('wood', 4)
			storage.addGood('wood', 2)
			const allocationSnapshot = {
				maxQuantityPerSlot: 5,
				slots: [
					{ goodType: 'wood', quantity: 4, allocated: 0, reserved: 0 },
					{ goodType: 'wood', quantity: 2, allocated: 0, reserved: 0 },
					undefined,
					undefined,
				],
			} as const
			const allocationPlan = slottedStorageAllocationPlan(allocationSnapshot, { wood: 3 })
			if (!allocationPlan.ok) throw new Error(allocationPlan.reason)
			expect(storage.allocate({ wood: 3 }, new Commitment('test.alloc'))).toBeUndefined()
			expect(storage.allocated('wood')).toBe(
				allocationPlan.entries.reduce((sum, entry) => sum + entry.quantity, 0)
			)

			const reservationSnapshot = {
				maxQuantityPerSlot: 5,
				slots: [
					{ goodType: 'wood', quantity: 4, allocated: 1, reserved: 0 },
					{ goodType: 'wood', quantity: 2, allocated: 2, reserved: 0 },
					undefined,
					undefined,
				],
			} as const
			const reservationPlan = slottedStorageReservationPlan(reservationSnapshot, { wood: 4 })
			if (!reservationPlan.ok) throw new Error(reservationPlan.reason)
			expect(storage.reserve({ wood: 4 }, new Commitment('test.reserve'))).toBeUndefined()
			const reserved = storage
				.renderedGoods()
				.slots.reduce((sum, slot) => sum + (slot.goodType === 'wood' ? slot.reserved : 0), 0)
			expect(reserved).toBe(reservationPlan.entries.reduce((sum, entry) => sum + entry.quantity, 0))
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

		it('keeps vehicle job identity string stable while exposing pure identity parts', () => {
			const hop = {
				job: 'vehicleHop',
				vehicleUid: 'vehicle:1',
				lineId: 'line:1',
				stopId: 'stop:1',
				path: [],
				dockEnter: true,
				needsBeginService: false,
				approachPath: [{ q: 0, r: 0 }],
				targetCoord: { q: 1, r: 0 },
				urgency: 1,
				fatigue: 0,
			} satisfies Job
			const offload = {
				job: 'vehicleOffload',
				vehicleUid: 'vehicle:1',
				maintenanceKind: 'loadFromBurden',
				looseGood: { goodType: 'stone', position: { q: 1, r: 0 } },
				targetCoord: { q: 1, r: 0 },
				approachPath: [],
				urgency: 1,
				fatigue: 0,
			} satisfies Job

			expect(proposedVehicleJobIdentityParts(hop)).toEqual([
				'vehicleHop',
				'vehicle:1',
				'line:1',
				'stop:1',
				'dock',
				'continue',
				'',
				'',
				'1,0',
			])
			expect(proposedVehicleJobMatchParts(hop)).toEqual([
				'vehicleHop',
				'vehicle:1',
				'line:1',
				'stop:1',
				'dock',
				'continue',
				'',
				'',
				'1,0',
				'1',
			])
			expect(proposedVehicleJobIdentityKey(offload)).toBe(
				'vehicleOffload:vehicle:1:loadFromBurden:1,0::stone'
			)
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
