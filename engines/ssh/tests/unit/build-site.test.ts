import { type BuildSite, installBuildSitePrototype } from 'ssh/build-site'
import { createConstructionSiteState } from 'ssh/construction-state'
import { SpecificStorage } from 'ssh/storage/specific-storage'
import type { GoodType } from 'ssh/types/base'
import { describe, expect, it } from 'vitest'

class MockStandaloneBuildSite implements BuildSite {
	public readonly tile = {} as never
	public readonly constructionSite = createConstructionSiteState({
		kind: 'dwelling',
		tier: 'basic_dwelling',
	})
	public readonly storage = new SpecificStorage(
		this.constructionSite.recipe.goods as Record<GoodType, number>
	)
	public constructionWorkSecondsApplied = 0
	public working = true
	public destroyed = false
	public declare canTake: BuildSite['canTake']
	public declare canGive: BuildSite['canGive']
	public declare readonly requiredGoods: BuildSite['requiredGoods']
	public declare readonly remainingNeeds: BuildSite['remainingNeeds']
	public declare readonly advertisedNeeds: BuildSite['advertisedNeeds']
	public declare readonly isReady: BuildSite['isReady']
	public declare readonly workingGoodsRelations: BuildSite['workingGoodsRelations']
	public declare readonly goodsRelations: BuildSite['workingGoodsRelations']
}

installBuildSitePrototype(MockStandaloneBuildSite.prototype, { aliasGoodsRelations: true })

describe('installBuildSitePrototype', () => {
	it('installs shared methods and accessors on the target prototype', () => {
		for (const key of [
			'canTake',
			'canGive',
			'requiredGoods',
			'remainingNeeds',
			'advertisedNeeds',
			'isReady',
			'workingGoodsRelations',
			'goodsRelations',
		] as const) {
			expect(Object.getOwnPropertyDescriptor(MockStandaloneBuildSite.prototype, key)).toBeTruthy()
		}
	})

	it('provides dynamic material-facing behavior for a standalone construction site', () => {
		const site = new MockStandaloneBuildSite()

		expect(site.requiredGoods).toEqual(site.constructionSite.requiredGoods)
		expect(site.remainingNeeds).toEqual(site.requiredGoods)
		expect(site.advertisedNeeds).toEqual(site.requiredGoods)
		expect(site.canTake('wood', '2-use')).toBe(true)
		expect(site.canGive('wood', '2-use')).toBe(false)
		expect(site.workingGoodsRelations).toEqual({
			wood: { advertisement: 'demand', priority: '2-use' },
			planks: { advertisement: 'demand', priority: '2-use' },
		})
		expect(site.goodsRelations).toEqual(site.workingGoodsRelations)

		site.storage.addGood('wood', 2)
		site.storage.addGood('planks', 1)

		expect(site.remainingNeeds).toEqual({})
		expect(site.advertisedNeeds).toEqual({})
		expect(site.isReady).toBe(true)
		expect(site.canTake('wood', '2-use')).toBe(false)
		expect(site.workingGoodsRelations).toEqual({})
		expect(site.goodsRelations).toEqual({})

		site.storage.removeGood('wood', 1)
		site.working = false

		expect(site.remainingNeeds).toEqual({ wood: 1 })
		expect(site.canTake('wood', '2-use')).toBe(false)
	})
})
