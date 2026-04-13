import type { Alveolus } from 'ssh/board/content/alveolus'
import type { SaveState } from 'ssh/game'
import type { Hive, MovingGood } from 'ssh/hive/hive'
import { afterEach, describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine'

async function flushDeferred(turns: number = 3) {
	for (let i = 0; i < turns; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0))
	}
}

function getWoodMovements(hive: Hive): MovingGood[] {
	return Array.from(hive.movingGoods.values()).flatMap((goods) =>
		goods.filter((movement) => movement.goodType === 'wood')
	)
}

describe('advert/convey regression', () => {
	let engine: TestEngine | undefined

	afterEach(async () => {
		await engine?.destroy()
		engine = undefined
	})

	it('does not keep scheduling 2-use wood once that need is already covered in flight', {
		timeout: 30000,
	}, async () => {
		engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		const scenario: Partial<SaveState> = {
			hives: [
				{
					name: 'RegressionHive',
					alveoli: [
						{ coord: [0, 0], alveolus: 'tree_chopper', goods: { wood: 2 } },
						{ coord: [1, 0], alveolus: 'sawmill', goods: { wood: 1 } },
						{
							coord: [1, -1],
							alveolus: 'woodpile',
							goods: {},
							configuration: {
								ref: { scope: 'individual' },
								individual: {
									working: true,
									buffers: { wood: 1 },
								},
							},
						},
					],
				},
			],
		}

		engine.loadScenario(scenario)
		await flushDeferred()

		const provider = engine.game.hex.getTile({ q: 0, r: 0 })?.content as Alveolus | undefined
		const sawmill = engine.game.hex.getTile({ q: 1, r: 0 })?.content as Alveolus | undefined
		const woodpile = engine.game.hex.getTile({ q: 1, r: -1 })?.content as Alveolus | undefined
		const hive = provider?.hive as Hive | undefined
		expect(provider).toBeDefined()
		expect(sawmill).toBeDefined()
		expect(woodpile).toBeDefined()
		expect(hive).toBeDefined()
		if (!provider || !sawmill || !woodpile || !hive) {
			throw new Error('Expected regression hive to be created')
		}

		const firstMovement = getWoodMovements(hive).find((movement) => movement.demander === sawmill)
		expect(firstMovement).toBeDefined()
		if (!firstMovement) {
			throw new Error('Expected an initial wood movement to the sawmill')
		}

		expect(hive.needs.wood).toBe('1-buffer')

		firstMovement.claimed = true
		firstMovement.claimedBy = 'advert-convey-regression'
		firstMovement.claimedAtMs = Date.now()
		firstMovement.allocations.source.fulfill()
		firstMovement.hop()
		await flushDeferred()

		const nextMovements = getWoodMovements(hive)
		const movementsToSawmill = nextMovements.filter((movement) => movement.demander === sawmill)
		const movementsToWoodpile = nextMovements.filter((movement) => movement.demander === woodpile)

		expect(movementsToSawmill).toHaveLength(0)
		expect(movementsToWoodpile.length).toBeGreaterThan(0)

		const woodpileMovement = movementsToWoodpile[0]
		woodpileMovement.allocations.source.fulfill()
		const releaseClaim = (movement: {
			claimed?: boolean
			claimedBy?: string
			claimedAtMs?: number
		}) => {
			movement.claimed = false
			delete movement.claimedBy
			delete movement.claimedAtMs
		}
		releaseClaim(firstMovement)
		firstMovement.finish()
		releaseClaim(woodpileMovement)
		woodpileMovement.finish()
		await flushDeferred()

		expect(getWoodMovements(hive)).toHaveLength(0)
		expect(sawmill.storage.stock.wood).toBe(2)
		expect(woodpile.storage.stock.wood).toBe(1)
	})
})
