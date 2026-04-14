import { BuildAlveolus } from 'ssh/hive/build'
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

	function makeSite() {
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

		const site = new BuildAlveolus(mockTile, 'engineer')
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
		expect(site.canTake('wood', '2-use')).toBe(true)
		expect(site.canTake('stone', '2-use')).toBe(true)
		expect(site.isReady).toBe(false)
	})

	it('keeps advertising only goods whose room is still unallocated', () => {
		const site = makeSite()
		const inboundWood = site.storage.allocate({ wood: 1 }, 'test.inbound.wood')

		expect(site.remainingNeeds).toEqual({ wood: 1, stone: 1 })
		expect(site.advertisedNeeds).toEqual({ stone: 1 })
		expect(site.workingGoodsRelations).toEqual({
			stone: { advertisement: 'demand', priority: '2-use' },
		})
		expect(site.canTake('wood', '2-use')).toBe(false)
		expect(site.canTake('stone', '2-use')).toBe(true)
		expect(site.isReady).toBe(false)

		inboundWood.cancel()

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

		const inbound = site.storage.allocate({ wood: 1, stone: 1 }, 'test.inbound')

		expect(site.remainingNeeds).toEqual({ wood: 1, stone: 1 })
		expect(site.advertisedNeeds).toEqual({})
		expect(site.workingGoodsRelations).toEqual({})
		expect(site.isReady).toBe(false)
		expect(site.canTake('wood', '2-use')).toBe(false)

		inbound.fulfill()

		expect(site.remainingNeeds).toEqual({})
		expect(site.advertisedNeeds).toEqual({})
		expect(site.workingGoodsRelations).toEqual({})
		expect(site.isReady).toBe(true)
	})
})
