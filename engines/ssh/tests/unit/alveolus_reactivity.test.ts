import { effect, reactive } from 'mutts'
import { Alveolus } from 'ssh/board/content/alveolus'
import type { Tile } from 'ssh/board/tile'
import type { Game } from 'ssh/game'
import { Hive } from 'ssh/hive/hive'
import { SlottedStorage } from 'ssh/storage/slotted-storage'
import { describe, expect, it, vi } from 'vitest'

// Mock dependencies
vi.mock('ssh/assets/game-content', () => ({
	alveoli: { test: { action: { type: 'storage' } } },
	deposits: {},
	goods: { wood: { sprites: [] } },
	terrain: {},
	jobBalance: {
		offload: { projectTile: 15, alveolusBlocked: 4, residentialTile: 1.25 },
		convey: 3,
		gather: 2.5,
		harvest: { clearing: 2.5, fallbackBase: 0.25, needsBonus: 0.5 },
		transform: 1,
		engineer: { foundation: 3, construct: 2 },
		defragment: 0.9,
	},
	configurations: {
		'specific-storage': { working: true, buffers: {} },
		default: { working: true },
	},
}))

// We need to allow real namedEffect for reactivity to work
vi.mock('ssh/src/lib/debug', async () => {
	return {
		assert: () => {},
		namedEffect: (_name: string, fn: () => void) => {
			return effect`test:named-effect`(fn)
		},
		traces: {},
	}
})

// Concrete implementation of abstract Alveolus
@reactive
class TestAlveolus extends Alveolus {
	get workingGoodsRelations() {
		return {
			wood: { advertisement: 'demand', priority: '2-use' },
		} as any
	}
}

describe('Alveolus Reactivity', () => {
	it('should trigger advertise when working status changes', async () => {
		// 1. Setup minimal Game/Board/Tile structure
		const game = {
			random: () => 0.5,
			hex: {
				getTile: () => null,
			},
			configurationManager: {
				getNamedConfiguration: () => undefined,
			},
		} as unknown as Game

		const board = {
			game,
			getTileContent: () => null,
		} as any

		const tile = {
			position: { q: 0, r: 0 },
			board,
			surroundings: [],
			neighborTiles: [],
			log: () => {},
		} as unknown as Tile

		const storage = new SlottedStorage(10, 100)
		storage.addGood('wood', 10) // Have some stock

		const alveolus = new TestAlveolus(tile, storage)

		// 2. Create Hive and spy on advertise
		// Hive constructor requires board.
		const hive = (Hive as any).for({ ...tile, neighborTiles: [] })

		// Spy on the advertise method
		const advertiseSpy = vi.spyOn(hive, 'advertise')

		// 3. Attach alveolus - this should trigger the first advertise
		hive.attach(alveolus)

		expect(advertiseSpy).toHaveBeenCalledTimes(1)
		const initialArgs = advertiseSpy.mock.calls[0]
		// Initial state: working=true, so it uses workingGoodsRelations (demand wood)
		expect(initialArgs[1]).toMatchObject({
			wood: { advertisement: 'demand' },
		})

		// 4. Toggle working to FALSE
		console.log('Toggling working to false...')
		const callsBeforeToggle = advertiseSpy.mock.calls.length
		alveolus.working = false

		// Effect should run - verify we got at least one more call
		expect(advertiseSpy.mock.calls.length).toBeGreaterThan(callsBeforeToggle)
		const secondArgs = advertiseSpy.mock.calls[advertiseSpy.mock.calls.length - 1]

		// Working=false: should advertise 'provide' for stock (wood)
		expect(secondArgs[1]).toMatchObject({
			wood: { advertisement: 'provide', priority: '0-store' },
		})

		// 5. Toggle working back to TRUE
		console.log('Toggling working to true...')
		const callsBeforeSecondToggle = advertiseSpy.mock.calls.length
		alveolus.working = true

		expect(advertiseSpy.mock.calls.length).toBeGreaterThan(callsBeforeSecondToggle)
		const thirdArgs = advertiseSpy.mock.calls[advertiseSpy.mock.calls.length - 1]
		expect(thirdArgs[1]).toMatchObject({
			wood: { advertisement: 'demand' },
		})
	})
})
