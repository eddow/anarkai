import type { Alveolus } from 'ssh/board/content/alveolus'
import type { SaveState } from 'ssh/game'
import { BuildAlveolus } from 'ssh/hive/build'
import type { Hive } from 'ssh/hive/hive'
import { axial } from 'ssh/utils/axial'
import { toAxialCoord } from 'ssh/utils/position'
import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine'

describe('Multi-Hop Convey Tests', () => {
	it('creates a movement that can be handed through an intermediate storage', {
		timeout: 15000,
	}, async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()
		try {
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'ChainHive',
						alveoli: [
							{ coord: [0, 0], alveolus: 'storage', goods: { wood: 3 } },
							{ coord: [1, 0], alveolus: 'storage', goods: {} },
							{ coord: [2, 0], alveolus: 'sawmill', goods: {} },
						],
					},
				],
			}

			engine.loadScenario(scenario)

			const provider = engine.game.hex.getTile({ q: 0, r: 0 })?.content as Alveolus | undefined
			const relay = engine.game.hex.getTile({ q: 1, r: 0 })?.content as Alveolus | undefined
			const demander = engine.game.hex.getTile({ q: 2, r: 0 })?.content as Alveolus | undefined
			const hive = (provider?.hive ?? demander?.hive) as Hive | undefined

			expect(provider).toBeDefined()
			expect(relay).toBeDefined()
			expect(demander).toBeDefined()
			expect(hive).toBeDefined()
			if (!provider || !relay || !demander || !hive) {
				throw new Error('Expected chain hive to be created')
			}

			const providerCoord = toAxialCoord(provider.tile.position)
			const created = hive.createMovement('wood', provider, demander)
			const providerMovements = hive.movingGoods.get(providerCoord)
			expect(created || (providerMovements?.length ?? 0) > 0).toBe(true)
			expect(providerMovements?.length ?? 0).toBeGreaterThan(0)

			const movement = providerMovements?.find(
				(candidate) =>
					candidate.goodType === 'wood' &&
					candidate.provider === provider &&
					candidate.demander === demander
			)
			expect(movement).toBeDefined()
			if (!movement) {
				throw new Error('Expected initial movement from provider')
			}

			expect(movement.path.length).toBeGreaterThan(2)
			expect(movement.path.map((step) => axial.key(step))).toContain('1.5,0')
			expect(movement.path.at(-1)).toMatchObject({ q: 2, r: 0 })

			movement.claimed = true
			movement.allocations.source.fulfill()
			const firstHop = movement.hop()
			expect(firstHop).toMatchObject({ q: 0.5, r: 0 })
			movement.place()
			movement.allocations.source = hive
				.storageAt(firstHop)!
				.reserve({ wood: 1 }, { type: 'convey.path', movement })
			movement.claimed = false

			const relayMovements = relay.aGoodMovement
			expect(relayMovements?.length ?? 0).toBeGreaterThan(0)
			expect(relayMovements?.[0]?.movement.goodType).toBe('wood')
			expect(relayMovements?.[0]?.movement.provider?.name).toBe(provider.name)
			expect(relayMovements?.[0]?.movement.demander?.name).toBe(demander.name)
			expect(relayMovements?.[0]?.movement.path.at(0)).toMatchObject({ q: 1, r: 0 })
		} finally {
			await engine.destroy()
		}
	})

	it('does not route stone through an intermediate alveolus that cannot buffer stone', {
		timeout: 15000,
	}, async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()
		try {
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'StoneRelayMismatch',
						alveoli: [
							{ coord: [0, 0], alveolus: 'stonecutter', goods: { stone: 1 } },
							{ coord: [1, 0], alveolus: 'woodpile', goods: {} },
						],
					},
				],
			}

			engine.loadScenario(scenario)

			const targetTile = engine.game.hex.getTile({ q: 2, r: 0 })
			expect(targetTile).toBeDefined()
			if (!targetTile) throw new Error('Expected target tile to exist')
			targetTile.content = new BuildAlveolus(targetTile, 'sawmill')

			const provider = engine.game.hex.getTile({ q: 0, r: 0 })?.content as Alveolus | undefined
			const relay = engine.game.hex.getTile({ q: 1, r: 0 })?.content as Alveolus | undefined
			const demander = engine.game.hex.getTile({ q: 2, r: 0 })?.content as Alveolus | undefined
			const hive = (provider?.hive ?? demander?.hive ?? relay?.hive) as Hive | undefined

			expect(provider).toBeDefined()
			expect(relay).toBeDefined()
			expect(demander).toBeDefined()
			expect(hive).toBeDefined()
			if (!provider || !relay || !demander || !hive) {
				throw new Error('Expected stone relay scenario to be created')
			}

			expect(relay.storage.hasRoom('stone')).toBe(0)
			expect(hive.getPath(provider, demander, 'stone')).toBeUndefined()
			expect(hive.createMovement('stone', provider, demander)).toBe(false)
			expect(provider.aGoodMovement).toBeUndefined()
			expect(relay.aGoodMovement).toBeUndefined()
		} finally {
			await engine.destroy()
		}
	})
})
