import { defer, effect, inert, reactive, type ScopedCallback, unreactive, unwrap } from 'mutts'
import { type HexBoard, isTileCoord } from 'ssh/board/board'
import { AlveolusGate } from 'ssh/board/border/alveolus-gate'
import { Alveolus } from 'ssh/board/content/alveolus'
import type { Tile } from 'ssh/board/tile'
import { traces } from 'ssh/debug'
import { options } from 'ssh/globals'
import type { AllocationBase, Storage } from 'ssh/storage/storage'
import type { GoodType } from 'ssh/types'
import { type AxialCoord, findPath, type Positioned, setPop } from 'ssh/utils'
import {
	type Advertisement,
	AdvertisementManager,
	type ExchangePriority,
	type GoodsRelations,
} from 'ssh/utils/advertisement'
import { AxialKeyMap } from 'ssh/utils/mem'
import { toAxialCoord } from 'ssh/utils/position'
import type { StorageAlveolus } from './storage'

export interface MovingGood {
	_mgId?: string
	goodType: GoodType
	path: AxialCoord[]
	provider: Alveolus
	demander: Alveolus
	from: AxialCoord
	allocations: {
		source: AllocationBase
		target: AllocationBase
	}
	hop(): AxialCoord
	place(): void
	finish(): void
}

@unreactive
export class Hive extends AdvertisementManager<Alveolus> {
	private constructor(public readonly board: HexBoard) {
		super()
		this.advertising.push(
			effect`hive.exchange-watchdog`(() => {
				this.configureExchangeWatchdog(options.stalledMovementScanIntervalMs)
			})
		)
	}
	private destroyed = false
	private wakeWanderingWorkersScheduled = false
	private advertisementFlushScheduled = false
	private pendingAdvertisements = new Map<
		Alveolus,
		import('ssh/utils/advertisement').GoodsRelations
	>()
	// Path cache for complete paths between alveoli
	private pathCache = new Map<string, AxialCoord[]>()
	private exchangeWatchdogTimer: ReturnType<typeof setInterval> | undefined
	private stalledExchangeSeenAt = new Map<string, number>()

	//#region Hives management on tile add/remove
	static for(tile: Tile) {
		const hives = new Set<Hive>()
		for (const neighbor of tile.neighborTiles) {
			// Check for hive property to support proxies
			if (neighbor?.content && 'hive' in neighbor.content) {
				const h = (neighbor.content as Alveolus).hive
				hives.add(h)
			}
		}
		if (hives.size === 0) return new Hive(tile.board)
		if (hives.size === 1) return setPop(hives)!

		const hivesArray = Array.from(hives)
		const targetHive = hivesArray.shift()!
		for (const hive of hivesArray) {
			for (const alveolus of hive.alveoli) targetHive.attach(alveolus)
			hive.destroy()
		}
		return targetHive
	}
	public name?: string
	public readonly alveoli = reactive(new Set<Alveolus>())
	/** Hive-level configurations by alveolus type */
	public readonly configurations = reactive(new Map<string, Ssh.AlveolusConfiguration>())

	// Structure and content
	// REHABILITATED MEMOIZE
	get byActionType() {
		const rv: Partial<Record<Ssh.Action['type'], Alveolus[]>> = {}
		for (const alveolus of this.alveoli) {
			const type = alveolus.action?.type
			if (!rv[type]) rv[type] = []
			rv[type].push(alveolus)
		}
		return rv
	}
	private readonly advertising: ScopedCallback[] = []
	private readonly gates = new Set<AlveolusGate>()

	private scheduleAdvertisement(
		alveolus: Alveolus,
		goodsRelations: GoodsRelations = alveolus.goodsRelations
	) {
		if (this.destroyed || !alveolus || !alveolus.tile) {
			traces.advertising?.log(`[SCHEDULE] SKIP: invalid alveolus`, {
				alveolus: alveolus?.name,
				hasTile: !!alveolus?.tile,
			})
			return
		}
		this.pendingAdvertisements.set(alveolus, goodsRelations)
		if (this.advertisementFlushScheduled) return
		this.advertisementFlushScheduled = true
		defer(() => {
			if (this.destroyed) return
			this.advertisementFlushScheduled = false
			const pending = [...this.pendingAdvertisements.entries()]
			this.pendingAdvertisements.clear()
			for (const [alveolus, relations] of pending) {
				if (!alveolus || !alveolus.tile) {
					traces.advertising?.log(`[SCHEDULE] SKIP PENDING: invalid alveolus`, {
						alveolus: alveolus?.name,
					})
					continue
				}
				this.advertise(alveolus, unwrap(relations))
			}
		})
	}

	public attach(alveolus: Alveolus) {
		this.alveoli.add(alveolus)
		// Ensure gates exist between neighboring alveoli in the hive
		for (const surrounding of alveolus.tile.surroundings) {
			if (surrounding.tile instanceof Alveolus) {
				if (!(surrounding.border.content instanceof AlveolusGate)) {
					surrounding.border.content = new AlveolusGate(surrounding.border)
				}
			}
		}
		for (const gate of alveolus.gates) this.gates.add(gate)
		alveolus.hive = this
		this.invalidatePathCache()
		this.advertising.push(
			effect`alveolus.advertise`(() => {
				const goodsRelations = alveolus.goodsRelations
				if (traces.advertising) {
					traces.advertising.log(
						`advertise effect source: ${alveolus.name} action=${alveolus.action?.type ?? 'unknown'} relations=${JSON.stringify(goodsRelations)}`
					)
				}
				traces.advertising?.log(
					`advertise effect: ${alveolus.name} ${JSON.stringify(goodsRelations)}`
				)
				this.scheduleAdvertisement(alveolus, goodsRelations)
			})
		)
	}
	/**
	 * This hive is defined as a copy of another hive after an alveolus removal didn't divide it
	 * @param hive
	 */
	private copyFrom(hive: Hive) {
		if (hive.name) this.name = hive.name
		this.movingGoods = hive.movingGoods
	}
	/**
	 * This hive is defined as a part of another hive who had just been divided by an alveolus removal
	 * @param hive
	 */
	private partOf(hive: Hive) {
		if (hive.name)
			this.name = `${hive.name} - ${Math.floor(this.board.game.random(36 ** 3))
				.toString(36)
				.padStart(3, '0')}`
		// TODO: destroying an alveolus (and its borders) should "loose" the goods and cancel all the movements going through
	}
	/**
	 * Has to be called *after* tile.content is not a alveolus anymore
	 * @param alveolus
	 */
	removeAlveolus(alveolus: Alveolus) {
		this.alveoli.delete(alveolus)
		this.invalidatePathCache()
		const toPlaceAlveoli = new Set(this.alveoli)
		const hives: Hive[] = []

		while (toPlaceAlveoli.size > 0) {
			const hive = new Hive(this.board)
			hives.push(hive)
			const toAddSet = new Set<Alveolus>()
			toAddSet.add(setPop(toPlaceAlveoli)!)
			while (toAddSet.size > 0) {
				const alveolus = setPop(toAddSet)!
				hive.attach(alveolus)
				for (const neighbor of alveolus.neighborAlveoli)
					if (!hive.alveoli.has(neighbor)) toAddSet.add(neighbor)
			}
		}
		if (hives.length === 1) {
			const newHive = hives[0].copyFrom(this)
			// Destroy the old hive since it's being replaced
			this.destroy()
			return newHive
		}
		for (let i = 0; i < hives.length - 1; i++) hives[i].partOf(this)
		// Destroy the old hive since it's being replaced
		this.destroy()
	}
	//#endregion

	//#region Path caching
	private invalidatePathCache() {
		this.pathCache.clear()
	}

	private getPath(from: Alveolus, to: Alveolus, goodType: GoodType): AxialCoord[] | undefined {
		const fromCoord = toAxialCoord(from.tile.position)
		const toCoord = toAxialCoord(to.tile.position)
		const key = `${fromCoord.q},${fromCoord.r}-${toCoord.q},${toCoord.r}-${goodType}`

		if (this.pathCache.has(key)) {
			return this.pathCache.get(key)!
		}

		// Use actual pathfinding to get the complete path
		const path = findPath(
			(c) => this.getNeighborsForGood(c, goodType).map((n) => toAxialCoord(n)),
			fromCoord,
			toCoord,
			Number.POSITIVE_INFINITY,
			true
		)

		if (path && path.length > 0) {
			// path is tile - border - tile - border - ... - tile
			// We should keep only the borders and the last tile
			const maxNdx = Math.floor(path.length / 2)
			for (let i = 0; i < maxNdx; i++) path.splice(i, 1)
			this.pathCache.set(key, path)
			return path
		}

		return undefined
	}

	private getPathDistance(from: Alveolus, to: Alveolus, goodType: GoodType): number {
		const path = this.getPath(from, to, goodType)
		return path ? path.length : Number.POSITIVE_INFINITY
	}

	private findNearest<T extends Alveolus>(
		from: Alveolus,
		candidates: Set<T>,
		goodType: GoodType
	): T | undefined {
		if (candidates.size === 0) return undefined

		// TODO: Implement smarter target selection algorithm that considers:
		// - Construction urgency/priority
		// - Resource scarcity and demand levels
		// - Build order and dependencies
		// - Worker availability and path congestion
		// - Storage capacity utilization
		// Currently just uses distance as the primary factor

		traces.advertising?.log(
			`[FIND] START: ${from.name} to ${candidates.size} candidates for ${goodType}`,
			Array.from(candidates).map((c) => ({ name: c.name, type: c.constructor.name }))
		)

		let nearest: T | undefined
		let minDistance = Number.POSITIVE_INFINITY

		for (const candidate of candidates) {
			const distance = this.getPathDistance(from, candidate, goodType)
			traces.advertising?.log(`[FIND] CANDIDATE: ${candidate.name} distance=${distance}`)
			if (distance < minDistance) {
				minDistance = distance
				nearest = candidate
			}
		}

		traces.advertising?.log(
			`[FIND] RESULT: ${nearest?.name ?? 'undefined'} distance=${minDistance}`
		)
		return nearest
	}
	//#endregion

	private configureExchangeWatchdog(intervalMs: number | false) {
		if (this.exchangeWatchdogTimer) {
			clearInterval(this.exchangeWatchdogTimer)
			this.exchangeWatchdogTimer = undefined
		}
		this.stalledExchangeSeenAt.clear()
		if (!intervalMs || intervalMs <= 0) return
		this.exchangeWatchdogTimer = setInterval(() => {
			if (this.destroyed) return
			this.scanForStalledExchanges()
		}, intervalMs)
	}

	private scanForStalledExchanges() {
		const now = Date.now()
		const settleMs = Math.max(
			options.stalledMovementSettleMs,
			Number(options.stalledMovementScanIntervalMs) || 0
		)
		const activeKeys = new Set<string>()

		for (const provider of this.alveoli) {
			for (const [goodType, provideRelation] of Object.entries(provider.goodsRelations) as [
				GoodType,
				GoodsRelations[GoodType],
			][]) {
				if (provideRelation?.advertisement !== 'provide') continue
				if (provider.storage.available(goodType) <= 0) continue

				for (const demander of this.alveoli) {
					if (demander === provider) continue

					const demandRelation = demander.goodsRelations[goodType]
					if (demandRelation?.advertisement !== 'demand') continue
					if (demander.storage.hasRoom(goodType) <= 0) continue
					if (this.hasActiveMovement(provider, demander, goodType)) continue
					if (!this.getPath(provider, demander, goodType)) continue

					const key = this.stalledExchangeKey(provider, demander, goodType)
					activeKeys.add(key)

					const firstSeenAt = this.stalledExchangeSeenAt.get(key) ?? now
					this.stalledExchangeSeenAt.set(key, firstSeenAt)
					if (now - firstSeenAt < settleMs) continue

					traces.advertising?.warn(
						`[WATCHDOG] STALLED EXCHANGE: ${goodType} ${provider.name} -> ${demander.name}`,
						{
							goodType,
							provider: provider.name,
							demander: demander.name,
							providePriority: provideRelation.priority,
							demandPriority: demandRelation.priority,
							stableForMs: now - firstSeenAt,
						}
					)
					this.scheduleAdvertisement(provider)
					this.scheduleAdvertisement(demander)
					this.stalledExchangeSeenAt.set(key, now)
				}
			}
		}

		for (const key of this.stalledExchangeSeenAt.keys()) {
			if (!activeKeys.has(key)) this.stalledExchangeSeenAt.delete(key)
		}
	}

	private stalledExchangeKey(provider: Alveolus, demander: Alveolus, goodType: GoodType) {
		const from = toAxialCoord(provider.tile.position)
		const to = toAxialCoord(demander.tile.position)
		return `${goodType}:${from.q},${from.r}->${to.q},${to.r}`
	}

	private hasActiveMovement(provider: Alveolus, demander: Alveolus, goodType: GoodType) {
		for (const goods of this.movingGoods.values()) {
			if (
				goods.some(
					(mg) => mg.goodType === goodType && mg.provider === provider && mg.demander === demander
				)
			) {
				return true
			}
		}
		return false
	}

	getNeighborsForGood(ref: Positioned, _goodType: GoodType) {
		const coord = toAxialCoord(ref)
		if (isTileCoord(coord)) {
			const content = this.board.getTileContent(ref) as Alveolus
			if (!content?.tile) return []
			return content.gates.map((g) => g.border.position)
		}
		// Get a border's neighbors - find tileA's and tileB's borders who are gates but not me
		const border = this.board.getBorder(ref)!
		return [border.tile.a.position, border.tile.b.position]
	}
	//#region Needy / events

	// TODO: @memoize
	get needs() {
		const calculatedNeeds: Partial<Record<GoodType, ExchangePriority>> = {}

		// Add advertisement needs
		for (const [gt, { advertisement }] of Object.entries(this.advertisements)) {
			if (advertisement === 'demand') {
				const advertisers = this.advertisements[gt as GoodType]?.advertisers
				if (!advertisers) continue

				// highest non-empty priority index represents the current priority
				let highest = 0
				for (let i = advertisers.length - 1; i >= 0; i--) {
					if (advertisers[i] && advertisers[i].length > 0) {
						highest = i
						break
					}
				}
				const asPriority: ExchangePriority = (['0-store', '1-buffer', '2-use'] as const)[
					highest as 0 | 1 | 2
				]
				// Filter out 0-store priority - these are only for internal conveying, not hive needs
				if (asPriority !== '0-store' && !calculatedNeeds[gt as GoodType]) {
					calculatedNeeds[gt as GoodType] = asPriority
				}
			}
		}

		return calculatedNeeds
	}

	movingGoods = reactive(new AxialKeyMap<MovingGood[]>())
	storageAt(coord: Positioned): Storage | undefined {
		if (isTileCoord(toAxialCoord(coord))) {
			const content = this.board.getTileContent(coord) as Alveolus
			return content.storage
		}
		const border = this.board.getBorder(coord)!
		return border.content?.storage
	}

	wakeWanderingWorkersNear(_provider: Alveolus, _demander: Alveolus) {
		if (this.destroyed) return
		if (this.wakeWanderingWorkersScheduled) return
		this.wakeWanderingWorkersScheduled = true
		defer(() => {
			if (this.destroyed) return
			this.wakeWanderingWorkersScheduled = false
			for (const worker of this.board.game.population) {
				if (worker.assignedAlveolus) continue
				if (worker.stepExecutor) continue
				if (!worker.actionDescription.includes('selfCare.wander')) continue
				const nextAction = worker.findAction()
				if (!nextAction || nextAction.name === worker.runningScript?.name) continue
				worker.abandonAnd(nextAction)
			}
		})
	}

	public createMovement(goodType: GoodType, provider: Alveolus, demander: Alveolus) {
		// Check if either alveolus is destroyed
		if (!provider.tile || !demander.tile || provider.destroyed || demander.destroyed) {
			traces.advertising?.log(`[CREATE] SKIP: destroyed alveolus`, {
				goodType,
				provider: provider.name,
				demander: demander.name,
				providerDestroyed: !provider.tile || provider.destroyed,
				demanderDestroyed: !demander.tile || demander.destroyed,
			})
			return false
		}

		// Check if demander has capacity for more of this good
		const currentStock = demander.storage.stock[goodType] || 0
		const capacity = demander.storage.capacity
		if (currentStock >= capacity) {
			traces.advertising?.log(
				`[CREATE] SKIP CAPACITY: ${goodType} ${provider.name} -> ${demander.name} (stock: ${currentStock}/${capacity})`
			)
			return false
		}

		const positions = {
			provider: toAxialCoord(provider.tile.position),
			demander: toAxialCoord(demander.tile.position),
		}

		traces.advertising?.log(`[CREATE] START: ${goodType} ${provider.name} -> ${demander.name}`)

		// Use cached path if available, otherwise calculate it
		const path = [...this.getPath(provider, demander, goodType)!]

		if (!path || path.length < 1) {
			traces.advertising?.log(`[CREATE] NO PATH: ${goodType} ${provider.name} -> ${demander.name}`)
			return false
		}

		traces.advertising?.log(
			`[CREATE] PATH FOUND: ${goodType} ${provider.name} -> ${demander.name} length=${path.length}`
		)

		const reason = {
			type: 'hive-transfer',
			goodType,
			...positions,
			providerName: provider.name,
			demanderName: demander.name,
			movementId: `movement-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
			createdAt: Date.now(),
		}

		return inert(() => {
			traces.advertising?.log(
				`[CREATE] INERT START: ${goodType} ${provider.name} -> ${demander.name}`,
				reason
			)

			// TWIN ALLOCATION PATTERN:
			// Both provider and target allocations must succeed together or fail together.
			// This prevents orphaned allocations that cause memory leaks.
			// If either allocation fails, we clean up any partial allocation atomically.
			let providerToken: AllocationBase | null = null
			let targetToken: AllocationBase | null = null

			try {
				// Step 1: Create provider allocation
				const providerAvailable = provider.storage.available(goodType)
				const providerStock = provider.storage.stock[goodType] ?? 0

				providerToken = provider.storage.reserve({ [goodType]: 1 }, reason)
				traces.allocations?.log(`[MOVEMENT] Provider allocation created:`, {
					movementId: reason.movementId,
					type: 'source',
					goodType,
					provider: provider.name,
					demander: demander.name,
					token: !!providerToken,
					debugInfo: {
						providerAvailable,
						providerStock,
						providerWorking: (provider as any).working,
					},
				})

				if (!providerToken) {
					throw new Error(
						`Provider allocation failed for ${goodType} from ${provider.name}. Available: ${providerAvailable}, Stock: ${providerStock}`
					)
				}

				// Step 2: Create target allocation
				targetToken = demander.storage.allocate({ [goodType]: 1 }, reason)
				traces.allocations?.log(`[MOVEMENT] Demander allocation created:`, {
					movementId: reason.movementId,
					type: 'target',
					goodType,
					provider: provider.name,
					demander: demander.name,
					token: !!targetToken,
				})

				if (!targetToken) {
					// Debug storage capacity if allocation failed
					const storageDebug = {
						stock: demander.storage.stock,
						availables: demander.storage.availables,
						capacity: demander.storage.capacity,
						hasRoom: demander.storage.hasRoom(goodType),
						available: demander.storage.available(goodType),
						rendered: demander.storage.renderedGoods(),
						demanderName: demander.name,
						demanderType: (demander as any).action?.type || 'unknown',
					}

					throw new Error(
						`Target allocation failed for ${goodType} to ${demander.name}. Storage: ${JSON.stringify(storageDebug)}`
					)
				}

				// Step 3: Both allocations succeeded - proceed with movement
				traces.allocations?.log(`[MOVEMENT] TWIN ALLOCATION SUCCESS: ${goodType}`, {
					movementId: reason.movementId,
					provider: provider.name,
					demander: demander.name,
				})
			} catch (error) {
				// TWIN ALLOCATION FAILED: Clean up any partial allocation
				traces.allocations?.error(`[MOVEMENT] TWIN ALLOCATION FAILED: ${goodType}`, {
					movementId: reason.movementId,
					goodType,
					provider: provider.name,
					demander: demander.name,
					error: error instanceof Error ? error.message : String(error),
					hadProvider: !!providerToken,
					hadTarget: !!targetToken,
				})

				// Clean up provider if it was created
				if (providerToken) {
					try {
						providerToken.cancel()
						traces.allocations?.log(
							`[MOVEMENT] Cleaned up provider allocation after twin failure:`,
							{
								movementId: reason.movementId,
								goodType,
								provider: provider.name,
							}
						)
					} catch (cancelError) {
						traces.allocations?.error(`[MOVEMENT] Failed to cleanup provider allocation:`, {
							movementId: reason.movementId,
							error: cancelError instanceof Error ? cancelError.message : String(cancelError),
						})
					}
				}

				// Target allocation doesn't need cleanup since allocate() throws on failure
				return false
			}

			const self = this
			const removeMovingGood = (mgRef: MovingGood) => {
				for (const [coord, goods] of self.movingGoods.entries()) {
					const kept = goods.filter((mg) => mg !== mgRef && mg !== movingGood)
					if (kept.length !== goods.length) {
						if (kept.length === 0) self.movingGoods.delete(coord)
						else self.movingGoods.set(coord, kept)
					}
				}
			}
			const movingGood: MovingGood = {
				goodType,
				path,
				provider,
				demander,
				from: positions.provider,
				allocations: {
					source: providerToken!,
					target: targetToken!,
				},
				hop() {
					const nextCoord = this.path.shift()!
					traces.advertising?.log(
						`[MOVEMENT] HOP: ${this.goodType} ${this.provider.name} -> ${this.demander.name} to ${nextCoord.q},${nextCoord.r} (path left: ${this.path.length})`
					)
					removeMovingGood(this)
					this.from = nextCoord
					movingGood.from = nextCoord
					self.scheduleAdvertisement(this.provider)
					self.scheduleAdvertisement(this.demander)
					return nextCoord
				},
				place() {
					const here = movingGood.from
					removeMovingGood(this)
					const current = self.movingGoods.get(here) ?? []
					self.movingGoods.set(here, [...current, movingGood])
					traces.advertising?.log(
						`[MOVEMENT] PLACE: ${this.goodType} placed at ${here.q},${here.r}`
					)
				},
				finish() {
					traces.allocations?.log(
						`[MOVEMENT] FINISH: ${this.goodType} ${this.provider.name} -> ${this.demander.name}`,
						{
							movementId: reason.movementId,
							goodType,
							provider: this.provider.name,
							demander: this.demander.name,
						}
					)
					removeMovingGood(this)

					// CRITICAL: Both allocations must be properly handled
					try {
						this.allocations.target.fulfill()
						traces.allocations?.log(`[MOVEMENT] TARGET FULFILLED: ${this.goodType}`, {
							movementId: reason.movementId,
							goodType,
							provider: this.provider.name,
							demander: this.demander.name,
						})
					} catch (error) {
						traces.allocations?.error(`[MOVEMENT] TARGET FULFILL FAILED: ${this.goodType}`, {
							movementId: reason.movementId,
							goodType,
							provider: this.provider.name,
							demander: this.demander.name,
							error: error instanceof Error ? error.message : String(error),
						})
					}

					// Source allocation should be automatically fulfilled when goods are removed from storage
					// but let's ensure it's tracked properly
					traces.allocations?.log(`[MOVEMENT] SOURCE SHOULD AUTO-FULFILL: ${this.goodType}`, {
						movementId: reason.movementId,
						goodType,
						provider: this.provider.name,
						demander: this.demander.name,
					})

					self.scheduleAdvertisement(this.provider)
					self.scheduleAdvertisement(this.demander)
				},
			}

			movingGood.place()
			this.wakeWanderingWorkersNear(provider, demander)
			traces.advertising?.log(
				`[CREATE] SUCCESS: ${goodType} ${provider.name} -> ${demander.name} movement active`
			)

			// Add tracking for incomplete movements
			setTimeout(() => {
				const isStillActive =
					this.movingGoods.has(positions.provider) ||
					Array.from(this.movingGoods.values()).some((goods) =>
						goods.some((mg) => mg === movingGood)
					)

				if (isStillActive) {
					traces.allocations?.warn(
						`[MOVEMENT] LONG-RUNNING: ${goodType} ${provider.name} -> ${demander.name}`,
						{
							movementId: reason.movementId,
							goodType,
							provider: provider.name,
							demander: demander.name,
							age: '5+ seconds',
						}
					)
				}
			}, 5000)

			return true
		})
	}

	get generalStorages() {
		return [
			...((this.byActionType['slotted-storage'] || []) as StorageAlveolus[]),
			...((this.byActionType['specific-storage'] || []) as StorageAlveolus[]),
		]
	}
	selectMovement(
		advertisement: Advertisement,
		alveolus: Alveolus,
		storages: Alveolus[],
		goodType: GoodType,
		sourcePriority: ExchangePriority,
		targetPriority: ExchangePriority,
		onCreated?: (storage: Alveolus) => void
	): Alveolus {
		traces.advertising?.log(
			`[SELECT] START: ${goodType} ${advertisement} from ${alveolus.name} to ${storages.length} candidates`
		)

		// We consider A->B === B->A
		const storage = inert(() => this.findNearest(alveolus, new Set(storages), goodType))
		if (storage === undefined) {
			traces.advertising?.log(
				`[SELECT] NO REACHABLE: ${goodType} from ${alveolus.name} to any of: ${storages.map((s) => (s as any).name || 'unnamed').join(', ')}`
			)
			throw new Error(`No reachable storage for ${goodType} from ${alveolus.name}`)
		}
		traces.advertising?.log(
			`[SELECT] FOUND: ${goodType} ${advertisement} ${alveolus.name} -> ${storage.name}`
		)
		// Defer movement creation to avoid reactive cycle:
		// The advertise effect reads storage state, and createMovement modifies it.
		defer(() => {
			if (this.destroyed) return
			try {
				traces.advertising?.log(
					`[SELECT] DEFERRED CREATE: ${goodType} ${alveolus.name} -> ${storage.name}`
				)

				// CRITICAL: Validate target can actually take the goods before creating movement
				const isDemand = advertisement === 'demand'
				// For 'provide' ads, the target is 'storage'. For 'demand' ads, the target is 'alveolus'.
				const targetStorage = isDemand ? alveolus : storage
				const providerStorage = isDemand ? storage : alveolus

				console.log(
					`[SELECT] DEBUG: advertisement=${advertisement}, alveolus=${alveolus.name}, storage=${storage.name}`
				)
				console.log(`[SELECT] DEBUG: isDemand=${isDemand}, targetStorage=${targetStorage.name}`)

				// Check provider can give the goods
				if ('canGive' in providerStorage && typeof providerStorage.canGive === 'function') {
					const providerCanGive = providerStorage.canGive(goodType, sourcePriority)
					console.log(
						`[SELECT] PROVIDER CHECK: ${providerStorage.name} can give ${goodType}: ${providerCanGive}`
					)

					if (!providerCanGive) {
						traces.advertising?.log(
							`[SELECT] SKIP: ${goodType} - ${providerStorage.name} has no goods to give`
						)
						console.log(`[SELECT] SKIP: ${goodType} - ${providerStorage.name} has no goods to give`)

						// Debug why provider can't give
						console.log(`[SELECT] PROVIDER DEBUG: ${providerStorage.name}`, {
							available: providerStorage.storage.available(goodType),
							stock: providerStorage.storage.stock[goodType] || 0,
							working: (providerStorage as any).working,
						})
						return storage
					}
				}

				// Check target can take the goods
				if ('canTake' in targetStorage && typeof targetStorage.canTake === 'function') {
					const targetCanTake = targetStorage.canTake(goodType, targetPriority)
					console.log(
						`[SELECT] TARGET CHECK: ${targetStorage.name} can take ${goodType}: ${targetCanTake}`
					)

					if (!targetCanTake) {
						traces.advertising?.log(
							`[SELECT] SKIP: ${goodType} - ${targetStorage.name} cannot accept goods`
						)
						console.log(`[SELECT] SKIP: ${goodType} - ${targetStorage.name} cannot accept goods`)

						// Debug why target can't take
						console.log(`[SELECT] TARGET DEBUG: ${targetStorage.name}`, {
							hasRoom: targetStorage.storage.hasRoom(goodType),
							stock: targetStorage.storage.stock[goodType] || 0,
							available: targetStorage.storage.available(goodType),
							working: (targetStorage as any).working,
						})
						return storage
					}
				}

				console.log(`[SELECT] PROCEEDING: ${goodType} - validation passed, creating movement`)

				const created = this.createMovement(
					goodType,
					...((advertisement === 'provide' ? [alveolus, storage] : [storage, alveolus]) as [
						Alveolus,
						Alveolus,
					])
				)
				if (!created) {
					traces.advertising?.log(
						`[SELECT] DEFERRED NOOP: ${goodType} ${alveolus.name} -> ${storage.name}`
					)
					return storage
				}
				onCreated?.(storage)
				traces.advertising?.log(`[SELECT] DEFERRED SUCCESS: ${goodType} movement created`)
			} catch (e) {
				// Ignore allocation errors that occur if resources are no longer available
				// The system will retry naturally on next advertisement if needed
				const error = e as Error
				if (error.name === 'AllocationError') {
					traces.advertising?.log(`[SELECT] ALLOCATION ERROR: ${goodType} - ${error.message}`)
				} else {
					traces.advertising?.log(`[SELECT] ERROR: ${goodType} - ${error.message}`)
					console.error(e)
				}
			}
		})
		return storage
	}

	destroy() {
		this.destroyed = true
		this.wakeWanderingWorkersScheduled = false
		if (this.exchangeWatchdogTimer) {
			clearInterval(this.exchangeWatchdogTimer)
			this.exchangeWatchdogTimer = undefined
		}
		this.stalledExchangeSeenAt.clear()

		// Clean up all moving goods and their allocations
		for (const [coord, goods] of this.movingGoods.entries()) {
			for (const movingGood of goods) {
				const movementId =
					movingGood.allocations?.source &&
					(movingGood.allocations.source as any).reason?.movementId
				traces.allocations?.log(
					`[MOVEMENT] CANCELLED DURING DESTROY: ${movingGood.goodType} ${movingGood.provider.name} -> ${movingGood.demander.name}`,
					{
						movementId,
						goodType: movingGood.goodType,
						provider: movingGood.provider.name,
						demander: movingGood.demander.name,
						coord,
					}
				)
				// Cancel all allocations to prevent leaks
				movingGood.allocations?.source?.cancel()
				movingGood.allocations?.target?.cancel()
			}
		}
		this.movingGoods.clear()

		// Clean up all advertising effects
		for (const cleanup of this.advertising) {
			cleanup()
		}
		this.advertising.length = 0
	}
	//#endregion
}
