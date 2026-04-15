import { goods as goodsCatalog } from 'engine-rules'
import { inert, isReactive, reactive } from 'mutts'
import { traces } from 'ssh/debug'
import type { GoodType } from 'ssh/types'

export type ExchangePriority = '0-store' | '1-buffer' | '2-use'
export type Advertisement = 'demand' | 'provide'
export type PerGood<T> = Partial<Record<GoodType, T>>
export type GoodsRelations = PerGood<{
	advertisement: Advertisement
	priority: ExchangePriority
}>

const assertGoodType = (goodType: string): goodType is GoodType => {
	return goodType in goodsCatalog
}

export interface StorageBase {
	readonly name: string
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

function isAllBucketsEmpty<T>(buckets: T[][]): boolean {
	return buckets.every((b) => b.length === 0)
}

let movementIds = 0

export abstract class AdvertisementManager<TAdvertiser extends StorageBase> {
	// New version: advertisers are grouped by numeric priority index
	readonly advertisements: PerGood<{
		advertisement: Advertisement
		advertisers: TAdvertiser[][]
	}> = reactive({})
	private lastAds = new Map<TAdvertiser, GoodsRelations>()
	abstract readonly generalStorages: (StorageBase & TAdvertiser)[]
	abstract createMovement(goodType: GoodType, giver: TAdvertiser, taker: TAdvertiser): void
	abstract selectMovement(
		advertisement: Advertisement,
		giver: TAdvertiser,
		storages: TAdvertiser[],
		goodType: GoodType,
		sourcePriority: ExchangePriority,
		targetPriority: ExchangePriority,
		onCreated?: (storage: TAdvertiser) => void
	): TAdvertiser | undefined

	advertise(advertiser: TAdvertiser, ads: GoodsRelations | undefined) {
		if (ads !== undefined && isReactive(ads)) debugger
		inert(() => {
			if (!advertiser) {
				traces.advertising?.log(`[ADVERTISE] SKIP: undefined advertiser`)
				return
			}
			const adsRecord: GoodsRelations = ads ?? {}
			traces.advertising?.log(`[ADVERTISE] START: ${advertiser}`, { ads: adsRecord })

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
						const idx = bucket.indexOf(advertiser)
						if (idx !== -1) {
							bucket.splice(idx, 1)
							traces.advertising?.log(
								`[ADVERTISE] REMOVE OLD: ${goodType} ${last.advertisement} from ${advertiser}`
							)
						}
						if (isAllBucketsEmpty(current.advertisers)) {
							delete this.advertisements[goodType]
							traces.advertising?.log(`[ADVERTISE] DELETE EMPTY: ${goodType}`)
						}
					}
				}
			}
			this.lastAds.set(advertiser, adsRecord)
			for (const [goodType, ad] of Object.entries(adsRecord)) {
				if (!assertGoodType(goodType)) continue
				const existing = this.advertisements[goodType]
				let movementCreated = false
				if (existing && existing.advertisement !== ad.advertisement) {
					// Try opposite priority buckets in order: 2, then 1, then 0 (only if current side > 0)
					const newPriorityNum = Number(ad.priority[0])
					const oppositePriorities: number[] = [2, 1]
					if (newPriorityNum > 0) oppositePriorities.push(0)

					for (const oppositePriority of oppositePriorities) {
						const bucket = existing.advertisers[oppositePriority]

						if (!bucket?.length) continue

						traces.advertising?.log(`[ADVERTISE] MATCH OPPOSITE: ${goodType}`, {
							newAd: `${ad.advertisement} priority ${ad.priority} from ${advertiser}`,
							existingAd: `${existing.advertisement} priority ${oppositePriority}`,
							bucket,
						})

						// Try to create movement first, only remove from bucket if successful
						try {
							// Generate unique ID for this specific movement attempt
							const movementId = `${goodType}-${advertiser.name}-${movementIds++}`

							const movementTarget = this.selectMovement(
								ad.advertisement,
								advertiser,
								bucket,
								goodType,
								ad.priority,
								`${oppositePriority}` as ExchangePriority,
								(movedAdvertiser) => {
									const idx = bucket.indexOf(movedAdvertiser)
									if (idx !== -1) {
										bucket.splice(idx, 1)
										traces.advertising?.log(
											`[ADVERTISE] REMOVE MATCHED: ${goodType} - removed ${movedAdvertiser.name || 'unnamed'} from bucket ${oppositePriority} (movement: ${movementId})`
										)
										if (bucket.length === 0) {
											// Only remove bucket if empty
											existing.advertisers.splice(oppositePriority, 1)
											if (isAllBucketsEmpty(existing.advertisers)) {
												traces.advertising?.log(`[ADVERTISE] BUCKET EMPTY - DELETE: ${goodType}`)
												delete this.advertisements[goodType]
											}
										}
									}
								}
							)
							if (movementTarget) {
								traces.advertising?.log(
									`[ADVERTISE] MOVEMENT SELECTED: ${goodType} -> ${(movementTarget as any)?.name ?? 'undefined'} (movement: ${movementId})`
								)
								// Successfully matched, break out of priority loop
								movementCreated = true
								break
							}
							traces.advertising?.log(
								`[ADVERTISE] MOVEMENT REFUSED: ${goodType} (movement: ${movementId})`
							)
						} catch (e) {
							traces.advertising?.log(
								`[ADVERTISE] MOVEMENT FAILED: ${goodType} - ${(e as Error).message}`
							)
						}
					}
				}

				if (movementCreated) {
					continue
				}

				const advertiserIsGeneralStorage = this.generalStorages.includes(
					advertiser as unknown as TAdvertiser
				)
				const availableGeneralStorages = this.generalStorages.filter((s) => {
					if (s === advertiser) return false
					const candidateIsGeneralStorage = this.generalStorages.includes(s)

					// General storage fallback should bridge producers/consumers with storages,
					// not create storage-to-storage transfers.
					if (advertiserIsGeneralStorage && candidateIsGeneralStorage) {
						return false
					}

					// Prevent 0-store providers from using general storage fallback to other storages
					if (Number(ad.priority[0]) === 0 && candidateIsGeneralStorage) {
						return false
					}

					return ad.advertisement === 'provide'
						? s.canTake(goodType as GoodType, ad.priority)
						: s.canGive(goodType as GoodType, ad.priority)
				})
				if (availableGeneralStorages.length > 0) {
					traces.advertising?.log(
						`[ADVERTISE] GENERAL STORAGE: ${goodType} -> ${availableGeneralStorages.length} options`
					)
					try {
						this.selectMovement(
							ad.advertisement,
							advertiser,
							availableGeneralStorages,
							goodType,
							ad.priority,
							ad.priority
						)
					} catch (e) {
						traces.advertising?.log(
							`[ADVERTISE] GENERAL STORAGE FAILED: ${goodType} - ${(e as Error).message}`
						)
					}
					continue
				}

				if (existing) {
					if (existing.advertisement === ad.advertisement) {
						// Same advertisement type - add to existing bucket
						const index = Number(ad.priority[0])
						ensureBucket(existing.advertisers, index)
						existing.advertisers[index].push(advertiser)
						traces.advertising?.log(
							`[ADVERTISE] ADD TO BUCKET: ${goodType} ${ad.advertisement} priority ${ad.priority} - now ${existing.advertisers[index].length} in bucket`
						)
						continue
					} else {
						// Different advertisement type - replace existing entirely
						traces.advertising?.log(
							`[ADVERTISE] REPLACE: ${goodType} ${existing.advertisement} -> ${ad.advertisement}`
						)
						const advertisers: TAdvertiser[][] = []
						const index = Number(ad.priority[0])
						ensureBucket(advertisers, index)
						advertisers[index].push(advertiser)
						this.advertisements[goodType] = {
							advertisement: ad.advertisement,
							advertisers,
						}
						traces.advertising?.log(
							`[ADVERTISE] NEW BUCKET: ${goodType} ${ad.advertisement} priority ${ad.priority}`
						)
						continue
					}
				}

				const advertisers: TAdvertiser[][] = []
				const index = Number(ad.priority[0])
				ensureBucket(advertisers, index)
				advertisers[index].push(advertiser)
				this.advertisements[goodType] = {
					advertisement: ad.advertisement,
					advertisers,
				}
				traces.advertising?.log(
					`[ADVERTISE] NEW BUCKET: ${goodType} ${ad.advertisement} priority ${ad.priority}`
				)
			}

			traces.advertising?.log(`[ADVERTISE] END: ${advertiser}`)
		})
	}
}
