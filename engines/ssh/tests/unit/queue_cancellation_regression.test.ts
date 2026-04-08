import { QueueStep } from 'ssh/npcs/steps'
import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine'

describe('Queue cancellation regression', () => {
	it('keeps source occupancy valid when a queued move is canceled', async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		try {
			const walker = engine.spawnCharacter('Walker', { q: 0, r: 0 })
			engine.spawnCharacter('Blocker', { q: 1, r: 0 })

			const blockedTile = engine.game.hex.getTile({ q: 1, r: 0 })
			const alternateTile = engine.game.hex.getTile({ q: 0, r: -1 })

			expect(blockedTile).toBeDefined()
			expect(alternateTile).toBeDefined()
			if (!blockedTile || !alternateTile) throw new Error('Expected test tiles to exist')

			const queued = walker.stepOn(blockedTile)
			expect(queued).toBeInstanceOf(QueueStep)

			queued?.cancel()

			expect(() => walker.stepOn(alternateTile)).not.toThrow()
			expect(walker.tile).toBe(alternateTile)
		} finally {
			await engine.destroy()
		}
	})
})
