import type { NpcSettlementTradeProfile } from 'ssh/commerce/settlement-trade'
import type { FreightLineDefinition } from 'ssh/freight/freight-line'
import { executeNpcTradeStopTransfer } from 'ssh/freight/npc-trade-stop'
import type { Game } from 'ssh/game'
import { migrateV1FiltersToGoodsSelection } from 'ssh/freight/goods-selection-policy'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine'

const tradeProfile: NpcSettlementTradeProfile = {
	id: 'neighbor-market',
	regionSetKey: '0,0',
	name: 'Neighbor market',
	kind: 'village',
	center: { q: 4, r: 0 },
	radius: 2,
	offers: [
		{ good: 'concrete', direction: 'sell', priceVp: 10 },
		{ good: 'wood', direction: 'buy', priceVp: 3 },
	],
}

function installTradeProfile(game: Game): void {
	;(game as unknown as { settlementTradeProfiles: Map<string, NpcSettlementTradeProfile> })
		.settlementTradeProfiles.set(tradeProfile.id, tradeProfile)
}

function marketLine(patch: Partial<FreightLineDefinition> = {}): FreightLineDefinition {
	return {
		id: 'market-loop',
		name: 'Market loop',
		cyclic: true,
		stops: [
			{
				id: 'market',
				trade: { kind: 'settlement', settlementId: tradeProfile.id },
			},
			{
				id: 'bay',
				anchor: {
					kind: 'alveolus',
					hiveName: 'Engineers',
					alveolusType: 'freight_bay',
					coord: [0, 0],
				},
			},
		],
		...patch,
	}
}

describe('NPC trade freight stops', () => {
	let engine: TestEngine

	beforeEach(async () => {
		engine = new TestEngine({ terrainSeed: 777, characterCount: 0 })
		await engine.init()
		engine.loadScenario({
			tiles: [
				{ coord: [0, 0], terrain: 'grass' },
				{ coord: [1, 0], terrain: 'grass' },
				{ coord: [4, 0], terrain: 'grass' },
			],
			hives: [
				{
					name: 'Engineers',
					alveoli: [
						{ coord: [0, 0], alveolus: 'freight_bay' },
						{
							coord: [1, 0],
							alveolus: 'storage',
							configuration: {
								ref: { scope: 'individual' },
								individual: {
									working: true,
									buffers: { concrete: 2 },
								},
							},
						},
					],
				},
			],
		})
		installTradeProfile(engine.game)
		engine.game.setPlayerAccountBalance(100)
	})

	afterEach(async () => {
		await engine.destroy()
	})

	it('imports only goods with downstream hive demand', () => {
		const line = marketLine()
		const vehicle = engine.game.vehicles.createVehicle('cart', 'wheelbarrow', { q: 4, r: 0 }, [
			line,
		])
		const result = executeNpcTradeStopTransfer({
			game: engine.game,
			vehicle,
			line,
			stop: line.stops[0]!,
		})

		expect(result.imported.concrete).toBe(2)
		expect(vehicle.storage.stock.concrete).toBe(2)
		expect(engine.game.playerAccount.balanceVp).toBe(80)
	})

	it('does not import when the downstream buffer is full', () => {
		const storage = engine.game.hex.getTile({ q: 1, r: 0 })!.content as {
			storage: {
				addGood(good: 'concrete', qty: number): number
				stock: Partial<Record<string, number>>
			}
		}
		expect(storage.storage.addGood('concrete', 12)).toBe(12)
		expect(storage.storage.stock.concrete).toBe(12)
		const line = marketLine()
		const vehicle = engine.game.vehicles.createVehicle('cart', 'wheelbarrow', { q: 4, r: 0 }, [
			line,
		])

		const result = executeNpcTradeStopTransfer({
			game: engine.game,
			vehicle,
			line,
			stop: line.stops[0]!,
		})

		expect(result.imported.concrete ?? 0).toBe(0)
		expect(vehicle.storage.stock.concrete ?? 0).toBe(0)
		expect(engine.game.playerAccount.balanceVp).toBe(100)
	})

	it('blocks imports below line reserve while still exporting allowed cargo', () => {
		const line = marketLine({
			minBalanceAfterBuyVp: 95,
			stops: [
				{
					id: 'market',
					trade: { kind: 'settlement', settlementId: tradeProfile.id },
					unloadSelection: migrateV1FiltersToGoodsSelection(['wood']),
				},
				marketLine().stops[1]!,
			],
		})
		const vehicle = engine.game.vehicles.createVehicle('cart', 'wheelbarrow', { q: 4, r: 0 }, [
			line,
		])
		vehicle.storage.addGood('wood', 1)

		const result = executeNpcTradeStopTransfer({
			game: engine.game,
			vehicle,
			line,
			stop: line.stops[0]!,
		})

		expect(result.exported.wood).toBe(1)
		expect(result.imported.concrete ?? 0).toBe(0)
		expect(vehicle.storage.stock.wood ?? 0).toBe(0)
		expect(engine.game.playerAccount.balanceVp).toBe(103)
	})
})
