import { goods as goodsCatalog } from '../../../assets/game-content'
import { assert } from 'ssh/src/lib/debug'
import type { GoodType } from 'ssh/src/lib/types'

export type ExchangePriority = '0-store' | '1-buffer' | '2-use'
export type Advertisement = 'demand' | 'provide'
export type PerGood<T> = Partial<Record<GoodType, T>>
export type GoodsRelations = PerGood<{ advertisement: Advertisement; priority: ExchangePriority }>

const assertGoodType = (goodType: string): goodType is GoodType => {
	return goodType in goodsCatalog
}

interface StorageBase {
	canTake(goodType: GoodType, priority: ExchangePriority): boolean
	canGive(goodType: GoodType, priority: ExchangePriority): boolean
}

export function maxPriority(priorities: ExchangePriority[]): ExchangePriority {
	return priorities.reduce<ExchangePriority>((max, priority) => {
		return priority[0] > max[0] ? priority : max
	}, '0-store')
}

function ensureBucket<T>(buckets: T[][], index: number) {
	while (buckets.length <= index) buckets.push([] as T[])
}

function getMaxPriorityBucket<T>(buckets: T[][]): { index: number; list: T[] } | undefined {
	for (let i = buckets.length - 1; i >= 0; i--) {
		const list = buckets[i]
		if (list && list.length > 0) return { index: i, list }
	}
	return undefined
}

function isAllBucketsEmpty<T>(buckets: T[][]): boolean {
	return buckets.every((b) => b.length === 0)
}

export abstract class AdvertisementManager<Advertiser> {
	// New version: advertisers are grouped by numeric priority index
	advertisements: PerGood<{
		advertisement: Advertisement
		advertisers: Advertiser[][]
	}> = {}
	private lastAds = new Map<Advertiser, GoodsRelations>()
	abstract readonly generalStorages: (StorageBase & Advertiser)[]
	abstract createMovement(goodType: GoodType, giver: Advertiser, taker: Advertiser): void
	abstract selectMovement(
		advertisement: Advertisement,
		giver: Advertiser,
		storages: Advertiser[],
		goodType: GoodType,
	): Advertiser
	advertise(advertiser: Advertiser, ads: GoodsRelations) {
		if (this.lastAds.has(advertiser)) {
			const lastAds = this.lastAds.get(advertiser)!
			for (const goodType in lastAds) {
				if (!assertGoodType(goodType)) continue
				const last = lastAds[goodType]!
				const current = this.advertisements[goodType]
				if (current && current.advertisement === last.advertisement) {
					const lastIndex = Number(last.priority[0])
					ensureBucket(current.advertisers, lastIndex)
					const bucket = current.advertisers[lastIndex]
					const idx = bucket.indexOf(advertiser as any)
					if (idx !== -1) bucket.splice(idx, 1)
					if (isAllBucketsEmpty(current.advertisers)) delete this.advertisements[goodType]
				}
			}
		}
		this.lastAds.set(advertiser, ads)
		for (const [goodType, ad] of Object.entries(ads)) {
			if (!assertGoodType(goodType)) continue
			const existing = this.advertisements[goodType]

			if (existing && existing.advertisement !== ad.advertisement) {
				const maxBucket = getMaxPriorityBucket(existing.advertisers)
				if (maxBucket && maxBucket.list.length > 0) {
					const selected = this.selectMovement(
						ad.advertisement,
						advertiser,
						maxBucket.list as Advertiser[],
						goodType,
					)
					const list = maxBucket.list as Advertiser[]
					const removeIdx = list.indexOf(selected)
					if (removeIdx !== -1) list.splice(removeIdx, 1)
					if (isAllBucketsEmpty(existing.advertisers)) delete this.advertisements[goodType]
				}
			} else {
				// Try general storages first if applicable
				const availableGeneralStorages = this.generalStorages.filter(
					ad.advertisement === 'provide'
						? (s) => s.canTake(goodType as GoodType, ad.priority)
						: (s) => s.canGive(goodType as GoodType, ad.priority),
				)
				if (availableGeneralStorages.length > 0) {
					this.selectMovement(
						ad.advertisement,
						advertiser,
						availableGeneralStorages as unknown as Advertiser[],
						goodType,
					)
				} else if (existing) {
					assert(existing.advertisement === ad.advertisement, 'Advertisement type mismatch')
					const index = Number(ad.priority[0])
					ensureBucket(existing.advertisers, index)
					existing.advertisers[index].push(advertiser)
					/* TODO: try to balance the buckets by creating movements
					1- check this.canGive/canTake
					2- check the others (from extreme priority to this.priority+-1) with their respective canGive/canTake
					*/
				} else {
					const advertisers: Advertiser[][] = []
					const index = Number(ad.priority[0])
					ensureBucket(advertisers, index)
					advertisers[index].push(advertiser)
					this.advertisements[goodType] = {
						advertisement: ad.advertisement,
						advertisers,
					}
				}
			}
		}
	}
}
