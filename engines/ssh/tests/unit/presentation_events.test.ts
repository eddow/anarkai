import type { GameConveyEvent, GamePresentationEvent } from 'ssh/game'
import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine/engine'

const flushDeferredEvents = () => new Promise((resolve) => setTimeout(resolve, 0))

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

			engine.game.enqueueStoragePresentationChange({ uid: 'tile:1,1' })
			engine.game.enqueueStoragePresentationChange({ uid: 'tile:1,1' })
			engine.game.enqueueStoragePresentationChange({ uid: 'tile:2,2' })

			await flushDeferredEvents()

			expect(batches).toHaveLength(1)
			expect(batches[0]).toEqual([
				{ type: 'storage.changed', ownerUid: 'tile:1,1' },
				{ type: 'storage.changed', ownerUid: 'tile:2,2' },
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

			engine.game.enqueueVehicleDockPresentationChange({ uid: 'tile:1,1' }, { uid: 'vehicle:1' })
			engine.game.enqueueVehicleDockPresentationChange({ uid: 'tile:1,1' }, { uid: 'vehicle:1' })
			engine.game.enqueueVehicleDockPresentationChange({ uid: 'tile:1,1' }, { uid: 'vehicle:2' })

			await flushDeferredEvents()

			expect(batches).toHaveLength(1)
			expect(batches[0]).toEqual([
				{ type: 'vehicle.dock.changed', ownerUid: 'tile:1,1', vehicleUid: 'vehicle:1' },
				{ type: 'vehicle.dock.changed', ownerUid: 'tile:1,1', vehicleUid: 'vehicle:2' },
			])
		} finally {
			await engine.destroy()
		}
	})

	it('batches conveyed hop events without deduping endpoints', async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		try {
			const batches: readonly GameConveyEvent[][] = []
			engine.game.on({
				conveyEvents(events) {
					batches.push(events)
				},
			})

			engine.game.enqueueConveyEvent({
				ownerUid: 'tile:1,1',
				endpoint: 'source',
				goodType: 'wood',
				movementRef: 7,
				from: { q: 1, r: 1 },
				to: { q: 1.5, r: 1 },
			})
			engine.game.enqueueConveyEvent({
				ownerUid: 'tile:2,1',
				endpoint: 'target',
				goodType: 'wood',
				movementRef: 7,
				from: { q: 1, r: 1 },
				to: { q: 2, r: 1 },
			})

			await flushDeferredEvents()

			expect(batches).toHaveLength(1)
			expect(batches[0]).toEqual([
				{
					type: 'conveyed',
					ownerUid: 'tile:1,1',
					endpoint: 'source',
					goodType: 'wood',
					movementRef: 7,
					from: { q: 1, r: 1 },
					to: { q: 1.5, r: 1 },
				},
				{
					type: 'conveyed',
					ownerUid: 'tile:2,1',
					endpoint: 'target',
					goodType: 'wood',
					movementRef: 7,
					from: { q: 1, r: 1 },
					to: { q: 2, r: 1 },
				},
			])
		} finally {
			await engine.destroy()
		}
	})
})
