import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import type { NpcSettlementTradeProfile } from 'ssh/commerce/settlement-trade'
import { queryConstructionSiteView } from 'ssh/construction'
import { createConstructionSiteState, foundationGoodsComplete } from 'ssh/construction-state'
import { DEFAULT_DISTRICT_ID, districtUid } from 'ssh/district/district'
import { Game } from 'ssh/game/game'
import { afterEach, describe, expect, it } from 'vitest'

describe('district and concrete construction', () => {
	const games = new Set<Game>()

	afterEach(() => {
		for (const game of games) game.destroy()
		games.clear()
	})

	async function gameAtOrigin() {
		const game = new Game({
			terrainSeed: 12,
			characterCount: 0,
			settlementGeneration: false,
		})
		games.add(game)
		await game.loaded
		await game.ensureGameplaySectors(['0,0'])
		const tile = game.hex.getTile({ q: 0, r: 0 })
		expect(tile).toBeDefined()
		if (!tile) throw new Error('Expected origin tile')
		return { game, tile }
	}

	async function gameWithStorageBuffer() {
		const game = new Game(
			{
				terrainSeed: 12,
				characterCount: 0,
				settlementGeneration: false,
			},
			{
				terrains: { concrete: [[0, 0]] },
				hives: [
					{
						name: 'BufferHive',
						alveoli: [
							{
								alveolus: 'storage',
								coord: [0, 0],
								configuration: {
									ref: { scope: 'individual' },
									individual: {
										working: true,
										generalSlots: 5,
										goods: {
											concrete: { minSlots: 1, maxSlots: 0 },
										},
									},
								},
							},
						],
					},
				],
				districts: [
					{
						id: DEFAULT_DISTRICT_ID,
						name: 'Default district',
						kind: 'mixed',
						members: [[0, 0]],
					},
				],
			}
		)
		games.add(game)
		await game.loaded
		return game
	}

	function addSeller(
		game: Game,
		id: string,
		priceVp: number,
		center = { q: 4, r: 0 }
	): NpcSettlementTradeProfile {
		const profile: NpcSettlementTradeProfile = {
			id,
			regionSetKey: 'test',
			name: id,
			kind: 'town',
			center,
			radius: 3,
			offers: [{ good: 'concrete', direction: 'sell', priceVp }],
		}
		;(game as any).settlementTradeProfiles.set(id, profile)
		return profile
	}

	it('creates a default district and resolves it as a game object', async () => {
		const { game } = await gameAtOrigin()

		expect(game.listDistricts().map((district) => district.id)).toContain(DEFAULT_DISTRICT_ID)
		expect(game.getObject(districtUid(DEFAULT_DISTRICT_ID))?.title).toBe('Default district')
		expect(game.getDistrict()?.procurementPolicy).toMatchObject({
			autoBuyNeededGoods: true,
			usePurchaseReserveVp: 20,
			bufferPurchaseReserveVp: 80,
			goods: {},
		})
	})

	it('records district members for district-scoped build and zone actions', async () => {
		const { game, tile } = await gameAtOrigin()

		expect(game.applyDistrictZoneAction(tile, 'residential')).toBe(true)
		expect(game.getDistrict()?.memberCount).toBe(1)
	})

	it('creates and saves the shared player account', async () => {
		const { game } = await gameAtOrigin()

		expect(game.playerAccount.balanceVp).toBeGreaterThan(0)
		expect(game.spendVp(5)).toBe(true)
		expect(game.saveGameData().playerAccount?.balanceVp).toBe(game.playerAccount.balanceVp)
		game.creditVp(3)
		expect(game.playerAccount.balanceVp).toBe(game.saveGameData().playerAccount!.balanceVp)
	})

	it('saves and loads district procurement policy', async () => {
		const { game } = await gameAtOrigin()
		game.updateDistrictProcurementPolicy(DEFAULT_DISTRICT_ID, {
			usePurchaseReserveVp: 55,
			bufferPurchaseReserveVp: 130,
			goods: { concrete: { maxUnitPriceVp: 12 } },
		})

		const state = game.saveGameData()
		expect(state.districts?.[0]?.procurementPolicy).toMatchObject({
			usePurchaseReserveVp: 55,
			bufferPurchaseReserveVp: 130,
			goods: { concrete: { maxUnitPriceVp: 12 } },
		})

		const game2 = new Game({ terrainSeed: 12, characterCount: 0, settlementGeneration: false })
		games.add(game2)
		await game2.loadGameData(state)

		expect(game2.getDistrict()?.procurementPolicy).toMatchObject({
			usePurchaseReserveVp: 55,
			bufferPurchaseReserveVp: 130,
			goods: { concrete: { maxUnitPriceVp: 12 } },
		})
	})

	it('requires concrete before foundation goods are complete', () => {
		const state = createConstructionSiteState({ kind: 'dwelling', tier: 'basic_dwelling' })

		expect(state.foundationRequiredGoods).toEqual({ concrete: 1 })
		expect(foundationGoodsComplete(state)).toBe(false)
		state.foundationDeliveredGoods = { concrete: 1 }
		expect(foundationGoodsComplete(state)).toBe(true)
	})

	it('shows missing concrete on a new project site', async () => {
		const { game, tile } = await gameAtOrigin()
		const content = tile.content
		expect(content).toBeInstanceOf(UnBuiltLand)
		if (!(content instanceof UnBuiltLand)) throw new Error('Expected unbuilt land')

		content.setProject('build:storage')
		const view = queryConstructionSiteView(game, tile)

		expect(view?.phase).toBe('waiting_materials')
		expect(view?.requiredGoods).toEqual({ concrete: 1 })
		expect(view?.blockingReasons).toContain('missing_goods')
	})

	it('plans a use purchase request for missing foundation concrete without debiting account', async () => {
		const { game, tile } = await gameAtOrigin()
		const content = tile.content
		expect(content).toBeInstanceOf(UnBuiltLand)
		if (!(content instanceof UnBuiltLand)) throw new Error('Expected unbuilt land')
		addSeller(game, 'cheap-town', 9)
		content.setProject('build:storage')
		game.recordDistrictMember({ q: 0, r: 0 })
		const beforeBalance = game.playerAccount.balanceVp

		const requests = game.listDistrictPurchaseRequests()

		expect(requests).toContainEqual(
			expect.objectContaining({
				good: 'concrete',
				quantity: 1,
				purpose: 'use',
				providerSettlementId: 'cheap-town',
				unitPriceVp: 9,
				totalPriceVp: 9,
				status: 'planned',
			})
		)
		expect(game.playerAccount.balanceVp).toBe(beforeBalance)
	})

	it('plans concrete buffer purchases from storage buffers and respects reserve limits', async () => {
		const game = await gameWithStorageBuffer()
		addSeller(game, 'cheap-town', 10)

		expect(game.listDistrictPurchaseRequests()).toContainEqual(
			expect.objectContaining({
				good: 'concrete',
				quantity: 3,
				purpose: 'buffer',
				totalPriceVp: 30,
				status: 'planned',
			})
		)

		game.setPlayerAccountBalance(100)
		game.updateDistrictProcurementPolicy(DEFAULT_DISTRICT_ID, { bufferPurchaseReserveVp: 90 })
		expect(game.listDistrictPurchaseRequests()).toContainEqual(
			expect.objectContaining({
				good: 'concrete',
				purpose: 'buffer',
				status: 'blocked',
				blockReason: 'reserve_limit',
			})
		)
	})

	it('chooses the cheapest concrete seller with nearest and id tie-breaks', async () => {
		const game = await gameWithStorageBuffer()
		addSeller(game, 'far-expensive', 14, { q: 1, r: 0 })
		addSeller(game, 'far-cheap', 8, { q: 8, r: 0 })
		addSeller(game, 'near-cheap', 8, { q: 2, r: 0 })

		expect(game.listDistrictPurchaseRequests()).toContainEqual(
			expect.objectContaining({
				good: 'concrete',
				providerSettlementId: 'near-cheap',
				unitPriceVp: 8,
				status: 'planned',
			})
		)

		addSeller(game, 'aaa-cheap', 8, { q: 2, r: 0 })
		expect(game.listDistrictPurchaseRequests()).toContainEqual(
			expect.objectContaining({
				good: 'concrete',
				providerSettlementId: 'aaa-cheap',
				unitPriceVp: 8,
				status: 'planned',
			})
		)
	})
})
