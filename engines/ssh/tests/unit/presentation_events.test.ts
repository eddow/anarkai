// @ts-nocheck
import { atomic } from 'mutts'
import type { GamePresentationEvent } from 'ssh/game'
import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine/engine'

describe('Game presentation events', () => {
	it('batches and dedupes storage presentation changes by owner', async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		try {
			const batches: readonly GamePresentationEvent[][] = []
			engine.game.on({
				presentationEvents(events) {
					batches.push(events)
				},
			})

			const ownerA = { uid: 'tile:1,1' }
			const ownerB = { uid: 'tile:2,2' }
			atomic(() => {
				engine.game.enqueueStoragePresentationChange(ownerA)
				engine.game.enqueueStoragePresentationChange(ownerA)
				engine.game.enqueueStoragePresentationChange(ownerB)
			})()

			expect(batches).toHaveLength(1)
			expect(batches[0]).toEqual([
				{ type: 'storage.changed', owner: ownerA },
				{ type: 'storage.changed', owner: ownerB },
			])
		} finally {
			await engine.destroy()
		}
	})

	it('batches and dedupes vehicle dock presentation changes by bay and vehicle', async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		try {
			const batches: readonly GamePresentationEvent[][] = []
			engine.game.on({
				presentationEvents(events) {
					batches.push(events)
				},
			})

			const bay = { uid: 'tile:1,1' }
			const vehicleA = { uid: 'vehicle:1' }
			const vehicleB = { uid: 'vehicle:2' }
			atomic(() => {
				engine.game.enqueueVehicleDockPresentationChange(bay, vehicleA)
				engine.game.enqueueVehicleDockPresentationChange(bay, vehicleA)
				engine.game.enqueueVehicleDockPresentationChange(bay, vehicleB)
			})()

			expect(batches).toHaveLength(1)
			expect(batches[0]).toEqual([
				{ type: 'vehicle.dock.changed', owner: bay, vehicle: vehicleA },
				{ type: 'vehicle.dock.changed', owner: bay, vehicle: vehicleB },
			])
		} finally {
			await engine.destroy()
		}
	})
})
