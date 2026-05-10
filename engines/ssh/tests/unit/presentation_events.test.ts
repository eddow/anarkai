import type { GamePresentationEvent } from 'ssh/game'
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
})
