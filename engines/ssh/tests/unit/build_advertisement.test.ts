// @ts-nocheck
import { Commitment } from 'ssh/commitment'
import type { ConstructionSiteState } from 'ssh/construction-state'
import { BuildAlveolus } from 'ssh/hive/build'
import type { AlveolusType } from 'ssh/types/base'
import { describe, expect, it, vi } from 'vitest'

describe('BuildAlveolus advertisement', () => {
	const mockHive = {
		working: true,
		needs: {},
		configurations: new Map(),
		movingGoods: new Map(),
		removeAlveolus: vi.fn(),
		hasIncomingMovementFor: vi.fn(() => false),
	} as any

	function makeSite(target: AlveolusType = 'engineer', constructionSite?: ConstructionSiteState) {
		const mockTile = {
			position: { q: 0, r: 0 },
			board: {
				game: {
					random: () => 0.5,
					freightLines: [],
					configurationManager: {
						getNamedConfiguration: () => undefined,
					},
				},
			},
			log: () => {},
		} as any

		const site = new BuildAlveolus(mockTile, target, constructionSite)
		;(site as any).hive = mockHive
		return site
	}

	it('advertises every missing construction good before any inbound allocation', () => {
		const site = makeSite()

		expect(site.requiredGoods).toEqual({ wood: 1, stone: 1 })
		expect(site.remainingNeeds).toEqual({ wood: 1, stone: 1 })
		expect(site.advertisedNeeds).toEqual({ wood: 1, stone: 1 })
		expect(site.workingGoodsRelations).toEqual({
			wood: { advertisement: 'demand', priority: '2-use' },
			stone: { advertisement: 'demand', priority: '2-use' },
		})
		expect(site.goodsRelations).toEqual(site.workingGoodsRelations)
		expect(site.canTake('wood', '2-use')).toBe(true)
		expect(site.canTake('stone', '2-use')).toBe(true)
		expect(site.isReady).toBe(false)
	})

	it('repairs missing material demand from the target recipe', () => {
		const site = makeSite('tree_chopper', {
			target: { kind: 'alveolus', alveolusType: 'tree_chopper' },
			recipe: { goods: {}, workSeconds: 0 },
			phase: 'waiting_materials',
			requiredGoods: undefined as never,
			deliveredGoods: {},
			consumedGoods: {},
			workSecondsApplied: 0,
			blockingReasons: [],
		})

		expect(site.requiredGoods.stone).toBeGreaterThan(0)
		expect(site.remainingNeeds.stone).toBe(site.requiredGoods.stone)
		expect(site.advertisedNeeds.stone).toBe(site.requiredGoods.stone)
		expect(site.goodsRelations.stone).toMatchObject({
			advertisement: 'demand',
			priority: '2-use',
		})
		expect(site.canTake('stone', '2-use')).toBe(true)
	})

	it('keeps advertising only goods whose room is still unallocated', () => {
		const site = makeSite()
		const inboundWoodCommitment = new Commitment('test.inbound.wood')
		site.storage.allocate({ wood: 1 }, inboundWoodCommitment)

		expect(site.remainingNeeds).toEqual({ wood: 1, stone: 1 })
		expect(site.advertisedNeeds).toEqual({ stone: 1 })
		expect(site.workingGoodsRelations).toEqual({
			stone: { advertisement: 'demand', priority: '2-use' },
		})
		expect(site.canTake('wood', '2-use')).toBe(false)
		expect(site.canTake('stone', '2-use')).toBe(true)
		expect(site.isReady).toBe(false)

		inboundWoodCommitment.cancel('test.cancel')

		expect(site.advertisedNeeds).toEqual({ wood: 1, stone: 1 })
		expect(site.workingGoodsRelations).toEqual({
			wood: { advertisement: 'demand', priority: '2-use' },
			stone: { advertisement: 'demand', priority: '2-use' },
		})
		expect(site.canTake('wood', '2-use')).toBe(true)
	})

	it('stops advertising goods once inbound allocations consume all room', () => {
		const site = makeSite()

		expect(site.remainingNeeds).toEqual({ wood: 1, stone: 1 })
		expect(site.advertisedNeeds).toEqual({ wood: 1, stone: 1 })
		expect(site.workingGoodsRelations).toEqual({
			wood: { advertisement: 'demand', priority: '2-use' },
			stone: { advertisement: 'demand', priority: '2-use' },
		})
		expect(site.isReady).toBe(false)
		expect(site.canTake('wood', '2-use')).toBe(true)

		const inboundCommitment = new Commitment('test.inbound')
		site.storage.allocate({ wood: 1, stone: 1 }, inboundCommitment)

		expect(site.remainingNeeds).toEqual({ wood: 1, stone: 1 })
		expect(site.advertisedNeeds).toEqual({})
		expect(site.workingGoodsRelations).toEqual({})
		expect(site.isReady).toBe(false)
		expect(site.canTake('wood', '2-use')).toBe(false)

		inboundCommitment.fulfill()

		expect(site.remainingNeeds).toEqual({})
		expect(site.advertisedNeeds).toEqual({})
		expect(site.workingGoodsRelations).toEqual({})
		expect(site.isReady).toBe(true)
	})
})
