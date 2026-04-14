import { defer, effect, inert, reactive, type ScopedCallback, unreactive, unwrap } from 'mutts'
import { type HexBoard, isTileCoord } from 'ssh/board/board'
import { AlveolusGate } from 'ssh/board/border/alveolus-gate'
import { Alveolus } from 'ssh/board/content/alveolus'
import type { Tile } from 'ssh/board/tile'
import { assert, traces } from 'ssh/debug'
import { options } from 'ssh/globals'
import {
	allocationInvalidationInfo,
	findLiveAllocations,
	isAllocationValid,
} from 'ssh/storage/guard'
import type { AllocationBase, Storage } from 'ssh/storage/storage'
import type { GoodType } from 'ssh/types'
import { type AxialCoord, axial, findPath, type Positioned, setPop } from 'ssh/utils'
import {
	type Advertisement,
	AdvertisementManager,
	type ExchangePriority,
	type GoodsRelations,
} from 'ssh/utils/advertisement'
import { AxialKeyMap } from 'ssh/utils/mem'
import { toAxialCoord } from 'ssh/utils/position'
import type { StorageAlveolus } from './storage'

function isLogisticsStorageAlveolusAction(actionType: string | undefined): boolean {
	return (
		actionType === 'slotted-storage' ||
		actionType === 'specific-storage' ||
		actionType === 'storage' ||
		actionType === 'road-fret'
	)
}

function collectSortedHiveTiles(hive: { alveoli: Iterable<Alveolus> }): AxialCoord[] {
	return Array.from(hive.alveoli, (alveolus) => toAxialCoord(alveolus.tile.position))
		.filter((coord): coord is AxialCoord => !!coord)
		.sort((a, b) => axial.key(a).localeCompare(axial.key(b)))
}

function sameTileSet(a: readonly AxialCoord[], b: readonly AxialCoord[]): boolean {
	if (a.length !== b.length) return false
	const aKeys = a.map((coord) => axial.key(coord))
	const bKeys = b.map((coord) => axial.key(coord))
	return aKeys.every((key, index) => key === bKeys[index])
}

export function generateRebuiltHiveName({
	originalTiles,
	originalName,
	resultingTiles,
	random,
}: {
	originalTiles: readonly AxialCoord[]
	originalName?: string
	resultingTiles: readonly AxialCoord[]
	random: (max?: number, min?: number) => number
}): string | undefined {
	const baseName = originalName?.trim()
	if (!baseName) return undefined
	if (sameTileSet(originalTiles, resultingTiles)) return baseName
	const suffix = String.fromCharCode(65 + Math.floor(random(26)))
	return `${baseName}-${suffix}`
}

function hiveSourceSortKey(hive: Hive): string {
	const [firstTile] = collectSortedHiveTiles(hive)
	return `${axial.key(firstTile ?? { q: 0, r: 0 })}:${hive.name ?? ''}`
}

function pickMetadataSourceHive(hives: Iterable<Hive>): Hive | undefined {
	return Array.from(hives).sort((a, b) =>
		hiveSourceSortKey(a).localeCompare(hiveSourceSortKey(b))
	)[0]
}

/**
 * Canonical in-flight logistics token owned by a {@link Hive}.
 *
 * Live runtime movements are created by `Hive.createMovement(...)`, tracked in
 * `activeMovementsById`, and indexed in `movingGoods`.
 */
export interface TrackedMovement {
	/**
	 * Stable movement id used for bookkeeping and persistence.
	 *
	 * All live tracked movements must have this set.
	 */
	_mgId: string
	/** Best-effort forensic trail for movement lifecycle and allocation debugging. */
	_debug?: {
		sourceTrail: string[]
		lifecycleTrail: string[]
		lastCleanupBy?: string
		lastCaughtError?: string
	}
	/** Good being moved. */
	goodType: GoodType
	/** Remaining route, including the next hop if any. Empty means terminal delivery state. */
	path: AxialCoord[]
	/** Alveolus currently providing the good. */
	provider: Alveolus
	/** Alveolus currently demanding the good. */
	demander: Alveolus
	/** Current coord where the movement token is tracked or expected to be tracked. */
	from: AxialCoord
	/** Used during hive topology refresh to temporarily suspend invariant checks/rebinding. */
	refreshState?: 'steady' | 'suspended-refresh'
	/** Set by conveyStep to prevent a second worker from picking up the same movement */
	claimed: boolean
	/** Character uid that currently owns the claim (best-effort diagnostic metadata). */
	claimedBy?: string
	/** Epoch millis when claim was taken (best-effort watchdog metadata). */
	claimedAtMs?: number
	allocations: {
		source?: AllocationBase
		target: AllocationBase
	}
	/** Advance the movement by one coord and return the new coord. */
	hop(): AxialCoord
	/** Re-index the movement at its current coord after a non-terminal hop. */
	place(): void
	/** Complete successful delivery and settle allocations. */
	finish(): void
	/** Tear down a failed or canceled movement without pretending it delivered successfully. */
	abort(): void
}

/** Temporary compatibility alias while call sites migrate to `TrackedMovement`. */
export type MovingGood = TrackedMovement

/**
 * Worker-facing immutable selection context for a movement visible from a specific alveolus.
 *
 * This preserves the local `from` snapshot used for selection and cycle detection while exposing
 * the canonical runtime movement explicitly.
 */
export interface MovementSelection {
	movementId: string
	fromSnapshot: AxialCoord
	movement: TrackedMovement
}

type MovementInvariantFailure =
	| 'missing-source-allocation'
	| 'missing-target-allocation'
	| 'invalid-source-allocation'
	| 'invalid-target-allocation'
	| 'empty-path'
	| 'not-tracked'
	| 'tracked-at-wrong-position'
	| 'destroyed-provider'
	| 'destroyed-demander'

type AllocationReasonInfo = {
	type?: string
	movementId?: string
	movement?: TrackedMovement
}

/**
 * Serializable snapshot used to carry a movement across hive refresh/reconstruction.
 */
export interface PersistentMovementSnapshot {
	/** Stable movement id copied from {@link MovingGood._mgId}. */
	movementId: string
	goodType: GoodType
	/** Coord where the good currently exists while the hive is being rebuilt. */
	currentCoord: AxialCoord
	/** Last known demander coord, if still resolvable. */
	targetCoord?: AxialCoord
	/** Last known provider coord, if still resolvable. */
	providerCoord?: AxialCoord
	/** Hive that produced the snapshot so rebinding can distinguish moves vs splits. */
	originHive: Hive
	/** Optional live movement object when a snapshot is taken from an existing runtime movement. */
	movement?: TrackedMovement
	/** Whether the movement was still indexed in `movingGoods` when snapshotted. */
	wasTracked: boolean
	/** Whether a worker had currently claimed the movement. */
	claimed: boolean
	claimedBy?: string
	claimedAtMs?: number
	/** Whether `currentCoord` is a border coord instead of a tile coord. */
	onBorder: boolean
}

/**
 * Debug/assertion contract for `assertMovementMine(...)`.
 *
 * These options describe which phase-specific invariants should hold at a particular probe point.
 */
type MovementMineOptions = {
	expectedFrom?: AxialCoord
	expectClaimed?: boolean
	requireTracked?: boolean
	requireSourceValid?: boolean
	requireTargetValid?: boolean
	allowClaimedSourceGap?: boolean
	allowClaimedTerminalPath?: boolean
	allowTerminalSourceGap?: boolean
	allowTerminalPath?: boolean
	/** After `fulfillMovementSource`, the source allocation is intentionally invalid while in-flight. */
	allowFulfilledSourceAllocation?: boolean
	allowUntracked?: boolean
	label: string
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
	private reconstructing = false
	private wakeWanderingWorkersScheduled = false
	private advertisementFlushScheduled = false
	private pendingAdvertisements = new Map<
		Alveolus,
		import('ssh/utils/advertisement').GoodsRelations
	>()
	private pendingBrokenMovementDiscardIds = new Set<string>()
	private pendingDetachedAllocationCleanupIds = new Set<string>()
	private activeMovementsById = new Map<string, TrackedMovement>()
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

		const hivesArray = Array.from(hives).sort((a, b) =>
			hiveSourceSortKey(a).localeCompare(hiveSourceSortKey(b))
		)
		const targetHive = hivesArray.shift()!
		for (const hive of hivesArray) {
			for (const alveolus of hive.alveoli) targetHive.attach(alveolus)
			hive.destroy()
		}
		return targetHive
	}
	get isDestroyed() {
		return this.destroyed
	}
	private readonly metadata = reactive({
		name: undefined as string | undefined,
		working: true,
	})
	get name() {
		return this.metadata.name
	}
	set name(value: string | undefined) {
		this.metadata.name = value?.trim() ? value : undefined
	}
	get working() {
		return this.metadata.working
	}
	set working(value: boolean) {
		this.metadata.working = value
	}
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
		if (this.destroyed || this.reconstructing || !alveolus || !alveolus.tile) {
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
			if (this.destroyed || this.reconstructing) return
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
		this.name = generateRebuiltHiveName({
			originalTiles: collectSortedHiveTiles(hive),
			originalName: hive.name,
			resultingTiles: collectSortedHiveTiles(this),
			random: this.board.game.random,
		})
		this.working = hive.working
		this.configurations.clear()
		for (const [key, value] of hive.configurations.entries()) this.configurations.set(key, value)
		return this
	}
	/**
	 * This hive is defined as a part of another hive who had just been divided by an alveolus removal
	 * @param hive
	 */
	private partOf(hive: Hive) {
		this.name = generateRebuiltHiveName({
			originalTiles: collectSortedHiveTiles(hive),
			originalName: hive.name,
			resultingTiles: collectSortedHiveTiles(this),
			random: this.board.game.random,
		})
		this.working = hive.working
		for (const [key, value] of hive.configurations.entries()) {
			if (!this.configurations.has(key)) this.configurations.set(key, value)
		}
		// TODO: destroying an alveolus (and its borders) should "loose" the goods and cancel all the movements going through
		return this
	}
	/**
	 * Has to be called *after* tile.content is not a alveolus anymore
	 * @param alveolus
	 */
	removeAlveolus(alveolus: Alveolus) {
		this.detachAlveolusForRefresh(alveolus)
		this.board.markHiveTopologyDirty(this)
	}

	public markTopologyRefreshPending() {
		if (this.destroyed) return
		this.reconstructing = true
		for (const movement of this.activeMovementsById.values()) {
			movement.refreshState = 'suspended-refresh'
		}
	}

	public detachAlveolusForRefresh(alveolus: Alveolus) {
		this.markTopologyRefreshPending()
		this.alveoli.delete(alveolus)
		this.invalidatePathCache()
	}

	public flushTopologyRefreshBatch(hives: Set<Hive>) {
		const touchedHives = Array.from(hives).filter((hive) => !hive.destroyed)
		if (touchedHives.length === 0) return

		const snapshots: PersistentMovementSnapshot[] = []
		const seenMovementIds = new Set<string>()
		const toPlaceAlveoli = new Set<Alveolus>()

		for (const hive of touchedHives) {
			hive.markTopologyRefreshPending()
			for (const snapshot of hive.snapshotReconstructionMovements()) {
				if (seenMovementIds.has(snapshot.movementId)) continue
				seenMovementIds.add(snapshot.movementId)
				snapshots.push(snapshot)
			}
			for (const alveolus of hive.alveoli) {
				if (alveolus.destroyed) continue
				if (alveolus.tile?.content !== alveolus) continue
				toPlaceAlveoli.add(alveolus)
			}
		}

		traces.advertising?.log?.('[HIVE] Reorganisation begin', {
			hives: touchedHives.map((hive) => hive.name),
			alveoliBefore: Array.from(toPlaceAlveoli).map((alveolus) => alveolus.name),
			snapshottedMovements: snapshots.length,
			movementIds: snapshots.map((snapshot) => snapshot.movementId),
		})

		const rebuiltHives: Hive[] = []
		while (toPlaceAlveoli.size > 0) {
			const hive = new Hive(this.board)
			rebuiltHives.push(hive)
			const sourceHives = new Set<Hive>()
			const toAddSet = new Set<Alveolus>()
			toAddSet.add(setPop(toPlaceAlveoli)!)
			while (toAddSet.size > 0) {
				const alveolus = setPop(toAddSet)!
				toPlaceAlveoli.delete(alveolus)
				sourceHives.add(alveolus.hive)
				hive.attach(alveolus)
				for (const neighbor of alveolus.neighborAlveoli) {
					if (neighbor.destroyed || neighbor.tile?.content !== neighbor) continue
					if (hive.alveoli.has(neighbor)) continue
					toAddSet.add(neighbor)
				}
			}
			const primarySourceHive = pickMetadataSourceHive(sourceHives)
			if (sourceHives.size <= 1 && primarySourceHive) hive.copyFrom(primarySourceHive)
			else if (primarySourceHive) hive.partOf(primarySourceHive)
		}

		traces.advertising?.log?.('[HIVE] Reorganisation topology rebuilt', {
			resultingHiveCount: rebuiltHives.length,
			resultingHives: rebuiltHives.map((hive) => ({
				name: hive.name,
				alveoli: Array.from(hive.alveoli).map((candidate) => candidate.name),
			})),
			snapshottedMovements: snapshots.length,
		})

		if (rebuiltHives.length > 0) rebuiltHives[0].finalizeReconstructedMovements(snapshots)
		else if (snapshots.length > 0) {
			for (const snapshot of snapshots) this.offloadCancelledMovementSnapshot(snapshot)
		}
		for (const hive of touchedHives) hive.destroy()
	}
	//#endregion

	//#region Path caching
	private invalidatePathCache() {
		this.pathCache.clear()
	}

	private isTraversableRelayTile(
		coord: AxialCoord,
		_goodType: GoodType,
		source: AxialCoord,
		destination: AxialCoord
	): boolean {
		const key = axial.key(coord)
		if (key === axial.key(source) || key === axial.key(destination)) return true

		const content = this.board.getTileContent(coord)

		// Border -> tile -> border is a pure bridge handoff. The good does not
		// logically enter the alveolus storage, so relay traversability must not
		// depend on current room or on whether that alveolus stores this good.
		return content instanceof Alveolus
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
			(c) => this.getNeighborsForGood(c, goodType, fromCoord, toCoord).map((n) => toAxialCoord(n)),
			fromCoord,
			toCoord,
			Number.POSITIVE_INFINITY,
			true
		)

		if (path && path.length > 0) {
			// Pathfinding returns a full route starting on the provider tile:
			// tile -> border -> tile -> border -> ... -> destination tile.
			// Convey movements must keep every hop after the origin tile so workers see:
			// border -> tile -> border -> ... -> destination tile.
			const trimmed = path.slice(1)
			if (trimmed.length < 1) return undefined
			this.pathCache.set(key, trimmed)
			return trimmed
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
			if (this.destroyed || this.reconstructing) return
			try {
				this.scanForStalledExchanges()
			} catch (error) {
				if (this.exchangeWatchdogTimer) {
					clearInterval(this.exchangeWatchdogTimer)
					this.exchangeWatchdogTimer = undefined
				}
				traces.allocations?.log?.('[WATCHDOG] Exchange watchdog stopped after internal error', {
					hive: this.name,
					error: error instanceof Error ? error.message : String(error),
				})
			}
		}, intervalMs)
	}

	private scanForStalledExchanges() {
		if (this.destroyed || this.reconstructing) return
		const now = Date.now()
		const settleMs = Math.max(
			options.stalledMovementSettleMs,
			Number(options.stalledMovementScanIntervalMs) || 0
		)
		this.scanForStuckClaimedMovements(now, settleMs)
		this.scanForDetachedMovementAllocations()
		const activeKeys = new Set<string>()

		for (const provider of this.alveoli) {
			const providerGoodTypes = new Set<GoodType>(
				(Object.entries(provider.goodsRelations) as [GoodType, GoodsRelations[GoodType]][])
					.filter(([, relation]) => relation?.advertisement === 'provide')
					.map(([goodType]) => goodType)
			)

			for (const goodType of providerGoodTypes) {
				const provideRelation = provider.goodsRelations[goodType]
				const providePriority = provideRelation?.priority ?? '2-use'
				if (!provider.canGive(goodType, providePriority)) continue

				for (const demander of this.alveoli) {
					if (demander === provider) continue

					const demandRelation = demander.goodsRelations[goodType]
					if (demandRelation?.advertisement !== 'demand') continue
					if (
						!this.shouldAllowWatchdogExchange(
							provider,
							demander,
							goodType,
							providePriority,
							demandRelation.priority
						)
					) {
						continue
					}
					if (this.hasActiveMovement(provider, demander, goodType)) continue
					if (!this.getPath(provider, demander, goodType)) continue

					const key = this.stalledExchangeKey(provider, demander, goodType)
					activeKeys.add(key)

					const firstSeenAt = this.stalledExchangeSeenAt.get(key) ?? now
					this.stalledExchangeSeenAt.set(key, firstSeenAt)
					if (now - firstSeenAt < settleMs) continue

					const canceledOrphans = this.cancelOrphanedExchangeAllocations(
						provider,
						demander,
						goodType
					)
					const recreated = this.createMovement(goodType, provider, demander)
					if (!recreated) {
						;(traces.advertising ?? console).warn?.(
							`[WATCHDOG] STALLED EXCHANGE: ${goodType} ${provider.name} -> ${demander.name}`,
							{
								goodType,
								provider: provider.name,
								demander: demander.name,
								providePriority,
								demandPriority: demandRelation.priority,
								stableForMs: now - firstSeenAt,
								canceledOrphans,
							}
						)
						this.scheduleAdvertisement(provider)
						this.scheduleAdvertisement(demander)
					} else {
						traces.advertising?.log?.('[WATCHDOG] Recreated stalled exchange', {
							goodType,
							provider: provider.name,
							demander: demander.name,
							stableForMs: now - firstSeenAt,
							canceledOrphans,
						})
					}
					this.stalledExchangeSeenAt.set(key, now)
				}
			}
		}

		for (const key of this.stalledExchangeSeenAt.keys()) {
			if (!activeKeys.has(key)) this.stalledExchangeSeenAt.delete(key)
		}
	}

	private pendingAllocatedQuantity(storage: Storage, goodType: GoodType): number {
		return storage.renderedGoods().slots.reduce((total, slot) => {
			if (slot.goodType !== goodType) return total
			return total + (slot.allocated || 0)
		}, 0)
	}

	private activeMovementById(movementId: string): TrackedMovement | undefined {
		const activeMovement = this.activeMovementsById.get(movementId)
		if (activeMovement) return activeMovement
		for (const goods of this.movingGoods.values()) {
			for (const movement of goods) {
				if (movement._mgId === movementId) return movement
			}
		}
		return undefined
	}

	private alveolusUnavailableForMovement(alveolus: Alveolus | undefined): boolean {
		if (!alveolus) return true
		if (!alveolus.tile || alveolus.destroyed) return true
		return !this.alveoli.has(alveolus)
	}

	private queueDetachedAllocationCleanup(
		allocation: AllocationBase,
		details: {
			goodType: GoodType
			provider?: Alveolus
			demander?: Alveolus
			movementId?: string
			reasonType?: string
			silent?: boolean
			repair?: () => void
		}
	) {
		const cleanupId = [
			details.reasonType ?? 'movement-allocation',
			details.movementId ?? 'unknown',
			details.goodType,
			details.provider?.name ?? 'unknown-provider',
			details.demander?.name ?? 'unknown-demander',
		].join(':')
		if (this.pendingDetachedAllocationCleanupIds.has(cleanupId)) return
		this.pendingDetachedAllocationCleanupIds.add(cleanupId)
		defer(() => {
			this.pendingDetachedAllocationCleanupIds.delete(cleanupId)
			if (this.destroyed || this.reconstructing) return
			const allocationsToCancel = new Set<AllocationBase>()
			if (isAllocationValid(allocation)) allocationsToCancel.add(allocation)
			if (details.movementId) {
				for (const { allocation: candidateAllocation } of findLiveAllocations((candidate) => {
					const reason = candidate.reason as
						| {
								type?: string
								goodType?: GoodType
								movementId?: string
								movement?: { _mgId?: string }
						  }
						| undefined
					if (!reason) return false
					if (details.reasonType && reason.type !== details.reasonType) return false
					if (details.goodType && reason.goodType && reason.goodType !== details.goodType)
						return false
					const candidateMovementId = reason.movementId ?? reason.movement?._mgId
					return candidateMovementId === details.movementId
				})) {
					if (!isAllocationValid(candidateAllocation as AllocationBase)) continue
					allocationsToCancel.add(candidateAllocation as AllocationBase)
				}
			}
			if (allocationsToCancel.size === 0) return
			try {
				for (const candidateAllocation of allocationsToCancel) {
					candidateAllocation.cancel()
				}
				if (details.silent) {
					traces.advertising?.log?.(
						'[WATCHDOG] Cancelled detached allocation during structural teardown',
						{
							goodType: details.goodType,
							provider: details.provider?.name,
							demander: details.demander?.name,
							movementId: details.movementId,
							reasonType: details.reasonType,
							cancelledAllocations: allocationsToCancel.size,
						}
					)
				} else {
					;(traces.advertising ?? console).warn?.(
						'[WATCHDOG] Cancelled detached movement allocation',
						{
							goodType: details.goodType,
							provider: details.provider?.name,
							demander: details.demander?.name,
							movementId: details.movementId,
							reasonType: details.reasonType,
							cancelledAllocations: allocationsToCancel.size,
						}
					)
				}
			} catch (error) {
				traces.allocations?.warn?.('[WATCHDOG] Failed to cancel detached movement allocation', {
					goodType: details.goodType,
					provider: details.provider?.name,
					demander: details.demander?.name,
					movementId: details.movementId,
					reasonType: details.reasonType,
					error: error instanceof Error ? error.message : String(error),
				})
				return
			}
			details.provider && this.scheduleAdvertisement(details.provider)
			details.demander && this.scheduleAdvertisement(details.demander)
			if (details.provider && details.demander) {
				this.wakeWanderingWorkersNear(details.provider, details.demander)
			}
			details.repair?.()
		})
	}

	private scanForDetachedMovementAllocations() {
		if (this.destroyed || this.reconstructing) return
		for (const { held, allocation } of findLiveAllocations((candidate) => {
			const reason = candidate.reason as { type?: string } | undefined
			return reason?.type === 'hive-transfer' || reason?.type === 'convey.path'
		})) {
			const reason = held.reason as
				| {
						type?: string
						goodType?: GoodType
						movementId?: string
						provider?: Alveolus
						demander?: Alveolus
						providerRef?: Alveolus
						demanderRef?: Alveolus
						movement?: TrackedMovement
				  }
				| undefined
			if (!reason) continue
			const goodType = reason.goodType
			if (!goodType) continue
			const provider = reason.providerRef ?? reason.provider ?? reason.movement?.provider
			const demander = reason.demanderRef ?? reason.demander ?? reason.movement?.demander
			if (!this.movementRefsBelongToThisHive(provider, demander)) continue
			const structuralTeardown =
				this.alveolusUnavailableForMovement(provider) ||
				this.alveolusUnavailableForMovement(demander)
			const movementId = reason.movementId ?? reason.movement?._mgId
			const trackedMovement = movementId ? this.activeMovementById(movementId) : undefined
			if (structuralTeardown) {
				if (trackedMovement?._mgId) this.activeMovementsById.delete(trackedMovement._mgId)
				traces.advertising?.log?.(
					'[WATCHDOG] Dropping detached allocation during structural teardown',
					{
						goodType,
						provider: provider?.name,
						demander: demander?.name,
						movementId,
						reasonType: reason.type,
						tracked: !!trackedMovement,
						pathLength: trackedMovement?.path.length,
					}
				)
				this.queueDetachedAllocationCleanup(allocation as AllocationBase, {
					goodType,
					provider,
					demander,
					movementId,
					reasonType: reason.type,
					silent: true,
				})
				continue
			}
			if (trackedMovement) {
				const trackedFailure = this.validateMovementInvariant(trackedMovement, {
					allowClaimedSourceGap: trackedMovement.claimed,
					allowClaimedTerminalPath: trackedMovement.claimed,
					requireTracked: !trackedMovement.claimed,
				})
				if (trackedFailure === 'not-tracked') {
					if (trackedMovement._mgId) this.activeMovementsById.delete(trackedMovement._mgId)
					this.queueDetachedAllocationCleanup(allocation as AllocationBase, {
						goodType,
						provider,
						demander,
						movementId,
						reasonType: reason.type,
						silent: true,
						repair: () => {
							if (!provider || !demander) return
							if (this.hasActiveMovement(provider, demander, goodType)) return
							const providePriority = this.movementProvidePriority(provider, goodType)
							const demandPriority = demander.goodsRelations[goodType]?.priority ?? '2-use'
							if (!providePriority) return
							if (
								!this.shouldAllowWatchdogExchange(
									provider,
									demander,
									goodType,
									providePriority,
									demandPriority
								)
							) {
								return
							}
							if (!this.getPath(provider, demander, goodType)) return
							this.createMovement(goodType, provider, demander)
						},
					})
					continue
				}
				this.queueBrokenMovementDiscard(trackedMovement, {
					warnLabel: '[WATCHDOG] Invalid movement token',
					allowClaimedSourceGap: trackedMovement.claimed,
					allowClaimedTerminalPath: trackedMovement.claimed,
					requireTracked: !trackedMovement.claimed,
				})
				continue
			}

			;(traces.advertising ?? console).warn?.('[WATCHDOG] Detached movement allocation', {
				goodType,
				provider: provider?.name,
				demander: demander?.name,
				movementId,
				reasonType: reason.type,
			})

			this.queueDetachedAllocationCleanup(allocation as AllocationBase, {
				goodType,
				provider,
				demander,
				movementId,
				reasonType: reason.type,
				silent: false,
				repair: () => {
					if (!provider || !demander) return
					if (this.hasActiveMovement(provider, demander, goodType)) return
					const providePriority = this.movementProvidePriority(provider, goodType)
					const demandPriority = demander.goodsRelations[goodType]?.priority ?? '2-use'
					if (!providePriority) return
					if (
						!this.shouldAllowWatchdogExchange(
							provider,
							demander,
							goodType,
							providePriority,
							demandPriority
						)
					) {
						return
					}
					if (!this.getPath(provider, demander, goodType)) return
					this.createMovement(goodType, provider, demander)
				},
			})
		}
	}

	private isGeneralStorageAlveolus(alveolus: Alveolus): alveolus is StorageAlveolus {
		return isLogisticsStorageAlveolusAction(alveolus.action?.type)
	}

	private movementRefsBelongToThisHive(provider?: Alveolus, demander?: Alveolus): boolean {
		return provider?.hive === this || demander?.hive === this
	}

	private shouldAllowWatchdogExchange(
		provider: Alveolus,
		demander: Alveolus,
		goodType: GoodType,
		providePriority: ExchangePriority,
		demandPriority: ExchangePriority
	): boolean {
		if (provider === demander) return false
		const providerCanGiveNow = provider.canGive(goodType, providePriority)
		const providerHasLatentStock = (provider.storage.stock[goodType] ?? 0) > 0
		const providerIsDemandOnly =
			provider.workingGoodsRelations[goodType]?.advertisement === 'demand'
		if (!providerCanGiveNow && (!providerHasLatentStock || providerIsDemandOnly)) return false
		if (
			!demander.canTake(goodType, demandPriority) &&
			this.pendingAllocatedQuantity(demander.storage, goodType) <= 0
		) {
			return false
		}
		if (
			this.isGeneralStorageAlveolus(provider) &&
			this.isGeneralStorageAlveolus(demander) &&
			demandPriority !== '1-buffer'
		) {
			return false
		}
		return true
	}

	private movementProvidePriority(
		provider: Alveolus,
		goodType: GoodType
	): ExchangePriority | undefined {
		const canGive =
			'canGive' in provider && typeof provider.canGive === 'function'
				? provider.canGive.bind(provider)
				: undefined
		const advertised = provider.goodsRelations?.[goodType]?.priority
		if (advertised && (!canGive || canGive(goodType, advertised))) return advertised
		for (const priority of ['2-use', '1-buffer', '0-store'] as const) {
			if (canGive?.(goodType, priority)) return priority
		}
		return undefined
	}

	private movementIdentityMatches(candidate: TrackedMovement, movement: TrackedMovement): boolean {
		return candidate._mgId === movement._mgId
	}

	private isMovementRefreshSuspended(movement: Partial<TrackedMovement>): boolean {
		return movement.refreshState === 'suspended-refresh'
	}

	private activeMovementIds(): Set<string> {
		const ids = new Set<string>(this.activeMovementsById.keys())
		for (const goods of this.movingGoods.values()) {
			for (const movement of goods) {
				ids.add(movement._mgId)
			}
		}
		return ids
	}

	private trackedMovementCoord(movement: TrackedMovement): AxialCoord | undefined {
		for (const [coord, goods] of this.movingGoods.entries()) {
			if (goods.some((candidate) => this.movementIdentityMatches(candidate, movement))) {
				return axial.keyAccess(coord)
			}
		}
		return undefined
	}

	private collapseDuplicateMovementTrackingIfNeeded(
		movement: TrackedMovement,
		preferredCoord: AxialCoord
	) {
		const trackedCoords = Array.from(this.movingGoods.entries())
			.filter(([, goods]) =>
				goods.some((candidate) => this.movementIdentityMatches(candidate, movement))
			)
			.map(([coord]) => axial.keyAccess(coord))
		if (trackedCoords.length <= 1) return

		this.forgetMovementTracking(movement)
		movement.from = preferredCoord
		this.activeMovementsById.set(movement._mgId, movement)
		this.ensureMovementTrackedAt(movement, preferredCoord)
		;(traces.advertising ?? console).warn?.('[WATCHDOG] Collapsed duplicate movement tracking', {
			goodType: movement.goodType,
			provider: this.movementProviderName(movement),
			demander: this.movementDemanderName(movement),
			preferredCoord,
			previousCoords: trackedCoords,
		})
	}

	validateMovementInvariant(
		movement: TrackedMovement,
		options: {
			requireTracked?: boolean
			expectedFrom?: AxialCoord
			allowClaimedSourceGap?: boolean
			allowClaimedTerminalPath?: boolean
			allowTerminalSourceGap?: boolean
			allowTerminalPath?: boolean
			allowFulfilledSourceAllocation?: boolean
		} = {}
	): MovementInvariantFailure | undefined {
		if (this.isMovementRefreshSuspended(movement)) return undefined
		if (this.isSyntheticMovement(movement)) return undefined
		if (!movement.provider.tile || movement.provider.destroyed) return 'destroyed-provider'
		if (!movement.demander.tile || movement.demander.destroyed) return 'destroyed-demander'
		const allowClaimedSourceGap = options.allowClaimedSourceGap !== false && movement.claimed
		const allowFulfilledSourceAllocation = options.allowFulfilledSourceAllocation === true
		const allowClaimedTerminalPath = options.allowClaimedTerminalPath !== false && movement.claimed
		const allowTerminalSourceGap =
			options.allowTerminalSourceGap === true && movement.path.length === 0
		const allowTerminalPath = options.allowTerminalPath === true && movement.path.length === 0
		if (!movement.allocations?.source && !allowClaimedSourceGap && !allowTerminalSourceGap)
			return 'missing-source-allocation'
		if (!movement.allocations?.target) return 'missing-target-allocation'
		if (
			movement.allocations?.source &&
			!isAllocationValid(movement.allocations.source) &&
			!allowClaimedSourceGap &&
			!allowFulfilledSourceAllocation &&
			!allowTerminalSourceGap
		) {
			return 'invalid-source-allocation'
		}
		if (!isAllocationValid(movement.allocations.target)) return 'invalid-target-allocation'
		if (movement.path.length === 0 && !allowClaimedTerminalPath && !allowTerminalPath)
			return 'empty-path'

		if (options.requireTracked !== false) {
			const trackedCoord = this.trackedMovementCoord(movement)
			if (!trackedCoord) return 'not-tracked'
			const expectedFrom = options.expectedFrom ?? movement.from
			if (axial.key(trackedCoord) !== axial.key(expectedFrom)) {
				return 'tracked-at-wrong-position'
			}
		}

		return undefined
	}

	private pushMovementDebugEntry(
		movement: TrackedMovement,
		key: 'sourceTrail' | 'lifecycleTrail',
		entry: string
	) {
		const debug = (movement._debug ??= { sourceTrail: [], lifecycleTrail: [] })
		debug[key].push(entry)
		if (debug[key].length > 20) debug[key].splice(0, debug[key].length - 20)
	}

	private movementAllocationLabel(allocation: AllocationBase | undefined) {
		if (!allocation) return 'missing'
		const reason = (allocation as AllocationBase & { reason?: AllocationReasonInfo }).reason
		const invalidation = allocationInvalidationInfo(allocation)
		const invalidationLabel = invalidation ? `:${invalidation.label}` : ''
		return `${isAllocationValid(allocation) ? 'valid' : 'invalid'}:${reason?.type ?? 'unknown'}:${reason?.movementId ?? 'no-id'}${invalidationLabel}`
	}

	private movementAllocationReason(allocation: AllocationBase | undefined) {
		return (allocation as (AllocationBase & { reason?: AllocationReasonInfo }) | undefined)?.reason
	}

	private assertMovementAllocationOwnership(movement: TrackedMovement, label: string) {
		const sourceReason = this.movementAllocationReason(movement.allocations.source)
		if (movement.allocations.source) {
			assert(
				!!sourceReason,
				`${label}: source allocation reason missing; ${this.movementMineContext(movement)}`
			)
			assert(
				sourceReason.movementId === movement._mgId,
				`${label}: source allocation movementId mismatch; ${this.movementMineContext(movement)}`
			)
			if (sourceReason.movement) {
				assert(
					sourceReason.movement === movement,
					`${label}: source allocation movement ref mismatch; ${this.movementMineContext(movement)}`
				)
			}
		}

		const targetReason = this.movementAllocationReason(movement.allocations.target)
		assert(
			!!targetReason,
			`${label}: target allocation reason missing; ${this.movementMineContext(movement)}`
		)
		assert(
			targetReason.movementId === movement._mgId,
			`${label}: target allocation movementId mismatch; ${this.movementMineContext(movement)}`
		)
		if (targetReason.movement) {
			assert(
				targetReason.movement === movement,
				`${label}: target allocation movement ref mismatch; ${this.movementMineContext(movement)}`
			)
		}
	}

	private movementMineContext(movement: TrackedMovement) {
		const debug = movement._debug
		const sourceTrail = debug?.sourceTrail?.join(' => ') ?? 'none'
		const lifecycleTrail = debug?.lifecycleTrail?.join(' => ') ?? 'none'
		return `movementId=${movement._mgId ?? 'none'} from=${axial.key(movement.from)} source=${this.movementAllocationLabel(movement.allocations.source)} target=${this.movementAllocationLabel(movement.allocations.target)} sourceTrail=[${sourceTrail}] lifecycleTrail=[${lifecycleTrail}] cleanupBy=${debug?.lastCleanupBy ?? 'none'} caughtError=${debug?.lastCaughtError ?? 'none'}`
	}

	private storageSnapshot(storage: Storage | undefined, goodType: GoodType) {
		if (!storage) {
			return {
				kind: 'missing' as const,
				stock: 0,
				available: 0,
				allocated: 0,
				room: 0,
			}
		}
		return {
			kind: storage.constructor.name,
			stock: storage.stock[goodType] || 0,
			available: storage.available(goodType),
			allocated: storage.allocated(goodType),
			room: storage.hasRoom(goodType),
		}
	}

	noteMovementStorageCheckpoint(
		movement: TrackedMovement,
		label: string,
		coord: AxialCoord = movement.from
	) {
		const snapshot = this.storageSnapshot(this.storageAt(coord), movement.goodType)
		this.noteMovementLifecycle(
			movement,
			`${label}:${axial.key(coord)}:${snapshot.kind}:stock=${snapshot.stock}:available=${snapshot.available}:allocated=${snapshot.allocated}:room=${snapshot.room}`
		)
	}

	private warnMovementRecoveryFailure(
		movement: TrackedMovement,
		label: string,
		coord: AxialCoord,
		error: unknown
	) {
		const storage = this.storageSnapshot(this.storageAt(coord), movement.goodType)
		;(traces.advertising ?? console).warn?.(`[WATCHDOG] ${label}`, {
			goodType: movement.goodType,
			provider: this.movementProviderName(movement),
			demander: this.movementDemanderName(movement),
			coord,
			storage,
			error: error instanceof Error ? error.message : String(error),
			movement: this.movementMineContext(movement),
		})
	}

	describeMovementMineContext(movement: TrackedMovement) {
		return this.movementMineContext(movement)
	}

	noteMovementLifecycle(movement: TrackedMovement, label: string) {
		this.pushMovementDebugEntry(movement, 'lifecycleTrail', `${label}@${Date.now()}`)
	}

	movementLifecycleIncludes(movement: TrackedMovement, label: string) {
		return movement._debug?.lifecycleTrail?.some((entry) => entry.startsWith(`${label}@`)) ?? false
	}

	noteMovementCaughtError(movement: TrackedMovement, label: string, error: unknown) {
		const debug = (movement._debug ??= { sourceTrail: [], lifecycleTrail: [] })
		const message = error instanceof Error ? error.message : String(error)
		debug.lastCaughtError = `${label}:${message}`
		this.noteMovementLifecycle(movement, `${label}:${message}`)
	}

	assignMovementSource(movement: TrackedMovement, source: AllocationBase, label: string) {
		movement.allocations.source = source
		this.pushMovementDebugEntry(
			movement,
			'sourceTrail',
			`assign:${label}:${this.movementAllocationLabel(source)}@${Date.now()}`
		)
	}

	fulfillMovementSource(movement: TrackedMovement, label: string) {
		const source = movement.allocations.source
		assert(source, `${label}: source allocation missing before fulfill`)
		this.pushMovementDebugEntry(
			movement,
			'sourceTrail',
			`fulfill:before:${label}:${this.movementAllocationLabel(source)}@${Date.now()}`
		)
		source.fulfill()
		this.pushMovementDebugEntry(
			movement,
			'sourceTrail',
			`fulfill:after:${label}:${this.movementAllocationLabel(movement.allocations.source)}@${Date.now()}`
		)
	}

	cancelMovementSource(movement: TrackedMovement, label: string) {
		const source = movement.allocations.source
		this.pushMovementDebugEntry(
			movement,
			'sourceTrail',
			`cancel:before:${label}:${this.movementAllocationLabel(source)}@${Date.now()}`
		)
		source?.cancel()
		this.pushMovementDebugEntry(
			movement,
			'sourceTrail',
			`cancel:after:${label}:${this.movementAllocationLabel(movement.allocations.source)}@${Date.now()}`
		)
	}

	/**
	 * Returns true when this hive still owns the exact object reference.
	 * After a topology refresh that falls through to `rebindMovementSnapshot`,
	 * the old movement becomes a zombie: same `_mgId`, different object.
	 */
	isMovementAlive(movement: TrackedMovement): boolean {
		return this.activeMovementsById.get(movement._mgId) === movement
	}

	assertMovementMine(
		movement: TrackedMovement,
		{
			expectedFrom,
			expectClaimed,
			requireTracked = true,
			requireSourceValid = true,
			requireTargetValid = true,
			allowClaimedSourceGap,
			allowClaimedTerminalPath,
			allowTerminalSourceGap,
			allowTerminalPath,
			allowFulfilledSourceAllocation,
			allowUntracked = false,
			label,
		}: MovementMineOptions
	) {
		const preferredTrackingCoord = expectedFrom ?? movement.from
		this.assertMovementAllocationOwnership(movement, `${label}:allocation-ownership`)
		this.collapseDuplicateMovementTrackingIfNeeded(movement, preferredTrackingCoord)
		const validateOpts = {
			expectedFrom,
			requireTracked: allowUntracked ? false : requireTracked,
			allowClaimedSourceGap,
			allowClaimedTerminalPath,
			allowTerminalSourceGap,
			allowTerminalPath,
			allowFulfilledSourceAllocation,
		}
		let failure = this.validateMovementInvariant(movement, validateOpts)
		if (
			failure === 'tracked-at-wrong-position' &&
			this.tryRecoverMovementInvariant(movement, failure, { expectedFrom })
		) {
			failure = this.validateMovementInvariant(movement, validateOpts)
		}
		const trackedCoords = Array.from(this.movingGoods.entries())
			.filter(([, goods]) =>
				goods.some((candidate) => this.movementIdentityMatches(candidate, movement))
			)
			.map(([coord]) => axial.keyAccess(coord))
		const trackedCoord = trackedCoords[0]
		assert(
			!failure,
			`${label}: invariant failure ${failure}; ${this.movementMineContext(movement)}`
		)
		assert(
			expectClaimed === undefined || movement.claimed === expectClaimed,
			`${label}: expected claimed=${expectClaimed} but got ${movement.claimed}; ${this.movementMineContext(movement)}`
		)
		assert(
			trackedCoords.length <= 1,
			`${label}: movement tracked in multiple buckets ${trackedCoords.map((coord) => axial.key(coord)).join(', ')}; ${this.movementMineContext(movement)}`
		)
		if (!allowUntracked && requireTracked) {
			assert(
				trackedCoord,
				`${label}: movement is not tracked; ${this.movementMineContext(movement)}`
			)
			const mineExpectedFrom = expectedFrom ?? movement.from
			assert(
				axial.key(trackedCoord) === axial.key(mineExpectedFrom),
				`${label}: tracked at ${axial.key(trackedCoord)} but expected ${axial.key(mineExpectedFrom)}; ${this.movementMineContext(movement)}`
			)
		}
		if (requireSourceValid) {
			const source = movement.allocations.source
			assert(source, `${label}: source allocation missing; ${this.movementMineContext(movement)}`)
			assert(
				isAllocationValid(source),
				`${label}: source allocation invalid; ${this.movementMineContext(movement)}`
			)
		}
		if (requireTargetValid) {
			const target = movement.allocations.target
			assert(target, `${label}: target allocation missing; ${this.movementMineContext(movement)}`)
			assert(
				isAllocationValid(target),
				`${label}: target allocation invalid; ${this.movementMineContext(movement)}`
			)
		}
	}

	ensureMovementInvariant(
		movement: TrackedMovement,
		options: {
			requireTracked?: boolean
			expectedFrom?: AxialCoord
			warnLabel?: string
			allowClaimedSourceGap?: boolean
			allowClaimedTerminalPath?: boolean
		} = {}
	): boolean {
		if (this.destroyed || this.reconstructing) return true
		const failure = this.validateMovementInvariant(movement, options)
		if (!failure) return true
		if (this.tryRecoverMovementInvariant(movement, failure, options)) return true
		;(traces.advertising ?? console).warn?.(
			options.warnLabel ?? '[WATCHDOG] Invalid movement token',
			{
				goodType: movement.goodType,
				provider: this.movementProviderName(movement),
				demander: this.movementDemanderName(movement),
				failure,
				from: movement.from,
				pathLength: movement.path.length,
			}
		)
		this.discardBrokenMovement(movement)
		return false
	}

	queueBrokenMovementDiscard(
		movement: TrackedMovement,
		options: {
			requireTracked?: boolean
			expectedFrom?: AxialCoord
			warnLabel?: string
			allowClaimedSourceGap?: boolean
			allowClaimedTerminalPath?: boolean
		} = {}
	): boolean {
		if (this.destroyed || this.reconstructing) return true
		const failure = this.validateMovementInvariant(movement, options)
		if (!failure) return true
		if (this.tryRecoverMovementInvariant(movement, failure, options)) return true
		const discardId =
			movement._mgId ??
			`${movement.provider.name}:${movement.demander.name}:${movement.goodType}:${axial.key(movement.from)}`
		if (this.pendingBrokenMovementDiscardIds.has(discardId)) return false
		this.pendingBrokenMovementDiscardIds.add(discardId)
		if (this.shouldDelayBrokenMovementDiscard(movement, failure, options)) {
			defer(() => {
				this.pendingBrokenMovementDiscardIds.delete(discardId)
				if (this.destroyed || this.reconstructing) return
				const retriedFailure = this.validateMovementInvariant(movement, options)
				if (!retriedFailure) return
				if (this.tryRecoverMovementInvariant(movement, retriedFailure, options)) return
				;(traces.advertising ?? console).warn?.(
					options.warnLabel ?? '[WATCHDOG] Invalid movement token',
					{
						goodType: movement.goodType,
						provider: this.movementProviderName(movement),
						demander: this.movementDemanderName(movement),
						failure: retriedFailure,
						from: movement.from,
						pathLength: movement.path.length,
					}
				)
				this.discardBrokenMovement(movement)
			})
			return false
		}
		;(traces.advertising ?? console).warn?.(
			options.warnLabel ?? '[WATCHDOG] Invalid movement token',
			{
				goodType: movement.goodType,
				provider: this.movementProviderName(movement),
				demander: this.movementDemanderName(movement),
				failure,
				from: movement.from,
				pathLength: movement.path.length,
			}
		)
		defer(() => {
			this.pendingBrokenMovementDiscardIds.delete(discardId)
			if (this.destroyed || this.reconstructing) return
			this.discardBrokenMovement(movement)
		})
		return false
	}

	hasIncomingMovementFor(alveolus: Alveolus): boolean {
		const here = toAxialCoord(alveolus.tile.position)!
		for (const { border } of alveolus.tile.surroundings) {
			const borderCoord = toAxialCoord(border.position)!
			const goods = this.movingGoods.get(borderCoord)
			if (!goods) continue
			for (const movement of goods) {
				if (
					!this.queueBrokenMovementDiscard(movement, {
						expectedFrom: borderCoord,
						warnLabel: '[INCOMING] Invalid border movement',
					})
				) {
					continue
				}
				const nextStep = movement.path[0]
				if (!nextStep) continue
				if (axial.key(nextStep) === axial.key(here)) return true
			}
		}
		return false
	}

	private cancelOrphanedExchangeAllocations(
		provider: Alveolus,
		demander: Alveolus,
		goodType: GoodType
	): number {
		if (this.hasActiveMovement(provider, demander, goodType)) return 0
		const activeMovementIds = this.activeMovementIds()
		const matches = findLiveAllocations((held) => {
			const reason = held.reason as
				| {
						type?: string
						goodType?: GoodType
						movementId?: string
						provider?: Alveolus
						demander?: Alveolus
						providerRef?: Alveolus
						demanderRef?: Alveolus
						providerName?: string
						demanderName?: string
						movement?: {
							_mgId?: string
							provider?: { name?: string }
							demander?: { name?: string }
							goodType?: GoodType
						}
				  }
				| undefined
			if (!reason) return false
			if (reason.type !== 'hive-transfer' && reason.type !== 'convey.path') return false
			const reasonGoodType = reason.goodType ?? reason.movement?.goodType
			if (reasonGoodType !== goodType) return false
			const movementId = reason.movementId ?? reason.movement?._mgId
			if (movementId && activeMovementIds.has(movementId)) return false
			const reasonProviderRef = reason.providerRef ?? reason.provider ?? reason.movement?.provider
			const reasonDemanderRef = reason.demanderRef ?? reason.demander ?? reason.movement?.demander
			const reasonProviderName = reason.providerName ?? reason.movement?.provider?.name
			const reasonDemanderName = reason.demanderName ?? reason.movement?.demander?.name
			const providerMatches =
				reasonProviderRef === provider ||
				(!!reasonProviderName && reasonProviderName === provider.name)
			const demanderMatches =
				reasonDemanderRef === demander ||
				(!!reasonDemanderName && reasonDemanderName === demander.name)
			return providerMatches && demanderMatches
		})
		let canceled = 0
		for (const { allocation } of matches) {
			const token = allocation as AllocationBase
			if (!isAllocationValid(token)) continue
			try {
				token.cancel()
				canceled += 1
			} catch (error) {
				traces.allocations?.warn?.('[WATCHDOG] Failed to cancel orphaned allocation', {
					goodType,
					provider: provider.name,
					demander: demander.name,
					error: error instanceof Error ? error.message : String(error),
				})
			}
		}
		if (canceled > 0) {
			;(traces.advertising ?? console).warn?.(
				'[WATCHDOG] Cancelled orphaned exchange allocations',
				{
					goodType,
					provider: provider.name,
					demander: demander.name,
					canceled,
				}
			)
		}
		return canceled
	}

	private scanForStuckClaimedMovements(now: number, settleMs: number) {
		for (const [, goods] of this.movingGoods.entries()) {
			for (const mg of goods) {
				if (
					!this.queueBrokenMovementDiscard(mg, {
						allowClaimedSourceGap: mg.claimed,
						allowClaimedTerminalPath: mg.claimed,
						warnLabel: '[WATCHDOG] Invalid movement token',
						requireTracked: !mg.claimed,
					})
				) {
					continue
				}
				if (!mg.claimed) continue

				// If the movement is claimed but no longer has a source allocation, it can never progress.
				if (!mg.allocations?.source) {
					;(traces.advertising ?? console).warn?.('[WATCHDOG] Releasing invalid claimed movement', {
						goodType: mg.goodType,
						provider: mg.provider.name,
						demander: mg.demander.name,
						reason: 'missing-source-allocation',
					})
					mg.claimed = false
					delete mg.claimedBy
					delete mg.claimedAtMs
					this.scheduleAdvertisement(mg.provider)
					this.scheduleAdvertisement(mg.demander)
					this.wakeWanderingWorkersNear(mg.provider, mg.demander)
					continue
				}

				const claimedAt = mg.claimedAtMs ?? now
				if (now - claimedAt < settleMs) continue

				const claimer = mg.claimedBy
					? Array.from(this.board.game.population).find((worker) => worker.uid === mg.claimedBy)
					: undefined
				const claimerActionDescription = claimer ? claimer.actionDescription : []
				const claimerStillBusy =
					!!claimer && (!!claimer.stepExecutor || claimer.runningScripts.length > 0)
				const claimerLikelyOwnsMovement =
					claimerStillBusy &&
					(claimerActionDescription.includes('work.conveyStep') ||
						claimerActionDescription.includes('work.goWork') ||
						claimer.assignedAlveolus === mg.provider ||
						claimer.assignedAlveolus === mg.demander)

				// Claimed long enough and no active conveyor looks responsible: release the claim.
				if (!claimerLikelyOwnsMovement) {
					;(traces.advertising ?? console).warn?.('[WATCHDOG] Releasing stale claimed movement', {
						goodType: mg.goodType,
						provider: mg.provider.name,
						demander: mg.demander.name,
						claimedBy: mg.claimedBy,
						claimedForMs: now - claimedAt,
						claimerActionDescription,
						claimerStillBusy,
					})
					mg.claimed = false
					delete mg.claimedBy
					delete mg.claimedAtMs
					this.scheduleAdvertisement(mg.provider)
					this.scheduleAdvertisement(mg.demander)
					this.wakeWanderingWorkersNear(mg.provider, mg.demander)
				}
			}
		}
	}

	private movementReason(mg: TrackedMovement) {
		return {
			type: 'convey.path',
			goodType: mg.goodType,
			movementId: mg._mgId,
			providerRef: mg.provider,
			demanderRef: mg.demander,
			providerName: mg.provider.name,
			demanderName: mg.demander.name,
			movement: mg,
		}
	}

	private movementProviderName(mg: Partial<TrackedMovement>): string {
		return mg.provider?.name ?? 'unknown-provider'
	}

	private installMovementRuntimeMethods(movement: TrackedMovement) {
		movement.hop = function (this: TrackedMovement) {
			const hive = this.provider.hive
			assert(hive, `movement.hop.before: provider hive missing for ${this._mgId}`)
			assert(
				this.demander.hive === hive,
				`movement.hop.before: provider/demander hive mismatch for ${this._mgId}`
			)
			hive.noteMovementLifecycle(this, 'movement.hop.before')
			hive.noteMovementStorageCheckpoint(this, 'movement.hop.before.storage', this.from)
			hive.assertMovementMine(this, {
				label: 'movement.hop.before',
				expectedFrom: this.from,
				expectClaimed: true,
				requireTracked: false,
				requireSourceValid: false,
				requireTargetValid: true,
				allowClaimedSourceGap: true,
				allowClaimedTerminalPath: true,
				allowFulfilledSourceAllocation: true,
				allowUntracked: true,
			})
			assert(
				this.path.length > 0,
				`movement.hop.before: empty path; ${hive.describeMovementMineContext(this)}`
			)
			const nextCoord = this.path.shift()!
			traces.advertising?.log(
				`[MOVEMENT] HOP: ${this.goodType} ${this.provider.name} -> ${this.demander.name} to ${nextCoord.q},${nextCoord.r} (path left: ${this.path.length})`
			)
			hive.removeMovementFromCoordTracking(this._mgId)
			this.from = nextCoord
			hive.noteMovementStorageCheckpoint(this, 'movement.hop.after.storage', nextCoord)
			hive.noteMovementLifecycle(this, `movement.hop.after:${axial.key(nextCoord)}`)
			hive.scheduleAdvertisement(this.provider)
			hive.scheduleAdvertisement(this.demander)
			return nextCoord
		}

		movement.place = function (this: TrackedMovement) {
			const hive = this.provider.hive
			assert(hive, `movement.place.before: provider hive missing for ${this._mgId}`)
			assert(
				this.demander.hive === hive,
				`movement.place.before: provider/demander hive mismatch for ${this._mgId}`
			)
			const here = this.from
			hive.noteMovementLifecycle(this, `movement.place.before:${axial.key(here)}`)
			hive.noteMovementStorageCheckpoint(this, 'movement.place.before.storage', here)
			hive.replaceMovementTracking(this, here)
			hive.assertMovementMine(this, {
				label: 'movement.place.after',
				expectedFrom: here,
				expectClaimed: this.claimed,
				requireTracked: true,
				requireSourceValid: !this.claimed,
				requireTargetValid: true,
				allowClaimedSourceGap: this.claimed,
				allowClaimedTerminalPath: this.claimed,
			})
			hive.noteMovementStorageCheckpoint(this, 'movement.place.after.storage', here)
			traces.advertising?.log(`[MOVEMENT] PLACE: ${this.goodType} placed at ${here.q},${here.r}`)
		}

		movement.finish = function (this: TrackedMovement) {
			const hive = this.provider.hive
			assert(hive, `movement.finish.before: provider hive missing for ${this._mgId}`)
			assert(
				this.demander.hive === hive,
				`movement.finish.before: provider/demander hive mismatch for ${this._mgId}`
			)
			assert(
				!hive.movementLifecycleIncludes(this, 'movement.finish.before'),
				`movement.finish.reentrant: finish entered twice; ${hive.describeMovementMineContext(this)}`
			)
			hive.noteMovementLifecycle(this, 'movement.finish.before')
			hive.assertMovementMine(this, {
				label: 'movement.finish.before',
				expectedFrom: this.from,
				expectClaimed: false,
				requireTracked: false,
				requireSourceValid: false,
				requireTargetValid: true,
				allowUntracked: true,
				allowClaimedTerminalPath: true,
				allowTerminalSourceGap: true,
				allowTerminalPath: true,
				allowFulfilledSourceAllocation: true,
			})
			traces.allocations?.log(
				`[MOVEMENT] FINISH: ${this.goodType} ${this.provider.name} -> ${this.demander.name}`,
				{
					movementId: this._mgId,
					goodType: this.goodType,
					provider: this.provider.name,
					demander: this.demander.name,
				}
			)
			this.claimed = false
			delete this.claimedBy
			delete this.claimedAtMs
			hive.forgetMovementTracking(this)
			hive.noteMovementLifecycle(this, 'movement.finish.remove-tracking.after')

			try {
				hive.noteMovementLifecycle(this, 'movement.finish.target-fulfill.before')
				this.allocations.target.fulfill()
				hive.noteMovementLifecycle(this, 'movement.finish.target-fulfill.after')
				traces.allocations?.log(`[MOVEMENT] TARGET FULFILLED: ${this.goodType}`, {
					movementId: this._mgId,
					goodType: this.goodType,
					provider: this.provider.name,
					demander: this.demander.name,
				})
			} catch (error) {
				traces.allocations?.error(`[MOVEMENT] TARGET FULFILL FAILED: ${this.goodType}`, {
					movementId: this._mgId,
					goodType: this.goodType,
					provider: this.provider.name,
					demander: this.demander.name,
					error: error instanceof Error ? error.message : String(error),
				})
				try {
					hive.noteMovementLifecycle(
						this,
						'movement.finish.target-cancel.after-failed-fulfill.before'
					)
					this.allocations.target.cancel()
					hive.noteMovementLifecycle(
						this,
						'movement.finish.target-cancel.after-failed-fulfill.after'
					)
				} catch (cancelError) {
					traces.allocations?.error(
						`[MOVEMENT] TARGET CANCEL AFTER FAILED FULFILL FAILED: ${this.goodType}`,
						{
							movementId: this._mgId,
							goodType: this.goodType,
							provider: this.provider.name,
							demander: this.demander.name,
							error: cancelError instanceof Error ? cancelError.message : String(cancelError),
						}
					)
				}
			}

			traces.allocations?.log(`[MOVEMENT] SOURCE SHOULD AUTO-FULFILL: ${this.goodType}`, {
				movementId: this._mgId,
				goodType: this.goodType,
				provider: this.provider.name,
				demander: this.demander.name,
			})

			hive.scheduleAdvertisement(this.provider)
			hive.scheduleAdvertisement(this.demander)
			hive.noteMovementLifecycle(this, 'movement.finish.after')
		}

		movement.abort = function (this: TrackedMovement) {
			const hive = this.provider.hive
			assert(hive, `movement.abort.before: provider hive missing for ${this._mgId}`)
			assert(
				this.demander.hive === hive,
				`movement.abort.before: provider/demander hive mismatch for ${this._mgId}`
			)
			hive.noteMovementLifecycle(this, 'movement.abort.before')
			this.claimed = false
			delete this.claimedBy
			delete this.claimedAtMs
			hive.forgetMovementTracking(this)
			hive.noteMovementLifecycle(this, 'movement.abort.remove-tracking.after')
			hive.scheduleAdvertisement(this.provider)
			hive.scheduleAdvertisement(this.demander)
			hive.noteMovementLifecycle(this, 'movement.abort.after')
		}
	}

	private movementDemanderName(mg: Partial<TrackedMovement>): string {
		return mg.demander?.name ?? 'unknown-demander'
	}

	private isSyntheticMovement(mg: Partial<TrackedMovement>): boolean {
		return !mg.provider || !mg.demander || !mg.allocations
	}

	private isStructuralMovementTeardownFailure(failure: MovementInvariantFailure): boolean {
		return failure === 'destroyed-provider' || failure === 'destroyed-demander'
	}

	private getPathFromCoord(source: AxialCoord, demander: Alveolus, goodType: GoodType) {
		const destination = toAxialCoord(demander.tile.position)
		const path = findPath(
			(c) => this.getNeighborsForGood(c, goodType, source, destination).map((n) => toAxialCoord(n)),
			source,
			destination,
			Number.POSITIVE_INFINITY,
			true
		)
		if (!path) return undefined
		if (path.length === 1) return []
		if (path.length < 2) return undefined
		return path.slice(1)
	}

	private sourceHiveAt(coord: AxialCoord): Hive | undefined {
		if (isTileCoord(coord)) {
			const content = this.board.getTileContent(coord)
			return content instanceof Alveolus && !content.destroyed ? content.hive : undefined
		}
		const border = this.board.getBorder(coord)
		if (!border) return undefined
		const adjacent = [border.tile.a.content, border.tile.b.content].filter(
			(content): content is Alveolus => content instanceof Alveolus && !content.destroyed
		)
		const hives = new Set(adjacent.map((alveolus) => alveolus.hive).filter(Boolean))
		return hives.size === 1 ? Array.from(hives)[0] : undefined
	}

	private alveolusAt(coord: AxialCoord | undefined): Alveolus | undefined {
		if (!coord || !isTileCoord(coord)) return undefined
		const content = this.board.getTileContent(coord)
		return content instanceof Alveolus && !content.destroyed ? content : undefined
	}

	private snapshotReconstructionMovements(): PersistentMovementSnapshot[] {
		const snapshots: PersistentMovementSnapshot[] = []
		const seen = new Set<string>()
		for (const movement of this.activeMovementsById.values()) {
			if (!movement._mgId || seen.has(movement._mgId)) continue
			seen.add(movement._mgId)
			const trackedCoord = this.trackedMovementCoord(movement)
			const currentCoord = trackedCoord ?? movement.from
			snapshots.push({
				movementId: movement._mgId,
				goodType: movement.goodType,
				currentCoord,
				targetCoord: movement.demander.tile
					? toAxialCoord(movement.demander.tile.position)
					: undefined,
				providerCoord: movement.provider.tile
					? toAxialCoord(movement.provider.tile.position)
					: undefined,
				originHive: this,
				movement,
				wasTracked: !!trackedCoord,
				claimed: movement.claimed,
				claimedBy: movement.claimedBy,
				claimedAtMs: movement.claimedAtMs,
				onBorder: !isTileCoord(currentCoord),
			})
		}
		return snapshots
	}

	private offloadCancelledMovementSnapshot(snapshot: PersistentMovementSnapshot): false {
		this.cancelSnapshotMovement(snapshot)
		const sourceStorage = this.storageAt(snapshot.currentCoord)
		const tile = !isTileCoord(snapshot.currentCoord)
			? (this.board.getBorder(snapshot.currentCoord)?.tile.a ??
					this.board.getBorder(snapshot.currentCoord)?.tile.b)!
			: this.board.getTile(snapshot.currentCoord)!
		try {
			sourceStorage?.removeGood(snapshot.goodType, 1)
		} catch {}
		this.board.looseGoods.add(tile, snapshot.goodType)
		traces.advertising?.log?.('[RECONSTRUCT] Cancelled movement as free good', {
			goodType: snapshot.goodType,
			movementId: snapshot.movementId,
			coord: snapshot.currentCoord,
		})
		return false
	}

	private cancelSnapshotMovement(snapshot: PersistentMovementSnapshot) {
		const movement = snapshot.movement
		if (!movement) return
		snapshot.originHive.forgetMovementTracking(movement)
		try {
			movement.allocations?.source?.cancel()
		} catch {}
		try {
			movement.allocations?.target?.cancel()
		} catch {}
	}

	private resolveProviderForSnapshot(
		snapshot: PersistentMovementSnapshot,
		sourceHive: Hive,
		demander: Alveolus
	): Alveolus | undefined {
		const direct = this.alveolusAt(snapshot.providerCoord)
		if (direct) return direct
		if (isTileCoord(snapshot.currentCoord)) {
			const here = this.alveolusAt(snapshot.currentCoord)
			if (here) return here
		}
		if (!isTileCoord(snapshot.currentCoord)) {
			const border = this.board.getBorder(snapshot.currentCoord)
			const adjacent = [border?.tile.a.content, border?.tile.b.content].filter(
				(content): content is Alveolus =>
					content instanceof Alveolus && !content.destroyed && content.hive === sourceHive
			)
			if (adjacent.length > 0) return adjacent[0]
		}
		return Array.from(sourceHive.alveoli).find((candidate) => !candidate.destroyed) ?? demander
	}

	private rehomeMovementSnapshot(snapshot: PersistentMovementSnapshot): boolean {
		const existing = snapshot.movement
		if (!existing) return false
		const demander = this.alveolusAt(snapshot.targetCoord)
		const sourceHive = this.sourceHiveAt(snapshot.currentCoord)
		if (!demander || !sourceHive || sourceHive !== this || sourceHive !== demander.hive)
			return false
		if (existing.demander.destroyed || existing.demander !== demander) return false
		if (existing.provider.destroyed) return false
		const path = this.getPathFromCoord(snapshot.currentCoord, demander, snapshot.goodType)
		if (!path) return false

		snapshot.originHive.forgetMovementTracking(existing)
		existing.provider =
			this.resolveProviderForSnapshot(snapshot, sourceHive, demander) ?? existing.provider
		existing.demander = demander
		existing.from = snapshot.currentCoord
		existing.path = [...path]
		existing.refreshState = 'steady'
		existing.claimed = snapshot.claimed
		existing.claimedBy = snapshot.claimedBy
		existing.claimedAtMs = snapshot.claimedAtMs
		this.installMovementRuntimeMethods(existing)
		this.activeMovementsById.set(existing._mgId, existing)
		if (!existing.claimed || snapshot.wasTracked)
			this.ensureMovementTrackedAt(existing, snapshot.currentCoord)
		return true
	}

	private rebindMovementSnapshot(snapshot: PersistentMovementSnapshot): boolean {
		if (this.rehomeMovementSnapshot(snapshot)) {
			this.wakeWanderingWorkersNear(
				snapshot.movement?.provider ?? this.alveolusAt(snapshot.providerCoord)!,
				this.alveolusAt(snapshot.targetCoord)!
			)
			return true
		}
		const demander = this.alveolusAt(snapshot.targetCoord)
		const sourceHive = this.sourceHiveAt(snapshot.currentCoord)
		if (!demander || !sourceHive || sourceHive !== demander.hive) {
			return this.offloadCancelledMovementSnapshot(snapshot)
		}
		if (sourceHive !== this) return false

		const provider = this.resolveProviderForSnapshot(snapshot, sourceHive, demander)
		if (!provider) return this.offloadCancelledMovementSnapshot(snapshot)

		const sourceStorage = this.storageAt(snapshot.currentCoord)
		const path = this.getPathFromCoord(snapshot.currentCoord, demander, snapshot.goodType)
		if ((!snapshot.claimed && !sourceStorage) || !path) {
			return this.offloadCancelledMovementSnapshot(snapshot)
		}

		const reason = {
			type: 'hive-transfer',
			goodType: snapshot.goodType,
			provider,
			demander,
			providerName: provider.name,
			demanderName: demander.name,
			movementId: snapshot.movementId,
			createdAt: Date.now(),
			source: snapshot.currentCoord,
		}

		let sourceToken: AllocationBase | undefined
		let targetToken: AllocationBase | undefined
		try {
			this.cancelSnapshotMovement(snapshot)
			if (!snapshot.claimed) {
				sourceToken = sourceStorage!.reserve({ [snapshot.goodType]: 1 }, reason)
			}
			targetToken = demander.storage.allocate({ [snapshot.goodType]: 1 }, reason)
			if ((!snapshot.claimed && !sourceToken) || !targetToken) {
				throw new Error('Failed to recreate movement allocations')
			}
		} catch {
			try {
				sourceToken?.cancel()
			} catch {}
			try {
				targetToken?.cancel()
			} catch {}
			return this.offloadCancelledMovementSnapshot(snapshot)
		}

		const movingGood: TrackedMovement = {
			_mgId: snapshot.movementId,
			goodType: snapshot.goodType,
			path: [...path],
			provider,
			demander,
			from: snapshot.currentCoord,
			refreshState: 'steady',
			claimed: snapshot.claimed,
			claimedBy: snapshot.claimedBy,
			claimedAtMs: snapshot.claimedAtMs,
			allocations: {
				source: sourceToken,
				target: targetToken,
			},
			hop() {
				throw new Error('movement runtime not installed')
			},
			place() {
				throw new Error('movement runtime not installed')
			},
			finish() {
				throw new Error('movement runtime not installed')
			},
			abort() {
				throw new Error('movement runtime not installed')
			},
		}

		this.installMovementRuntimeMethods(movingGood)
		this.activeMovementsById.set(movingGood._mgId, movingGood)
		if (!movingGood.claimed) movingGood.place()
		this.wakeWanderingWorkersNear(provider, demander)
		traces.advertising?.log?.('[RECONSTRUCT] Rebound movement after hive reconstruction', {
			goodType: snapshot.goodType,
			provider: provider.name,
			demander: demander.name,
			movementId: snapshot.movementId,
			sourceCoord: snapshot.currentCoord,
			claimed: snapshot.claimed,
		})
		return true
	}

	private finalizeReconstructedMovements(snapshots: PersistentMovementSnapshot[]) {
		traces.advertising?.log?.('[HIVE] Reorganisation finalize begin', {
			hive: this.name,
			snapshottedMovements: snapshots.length,
			movementIds: snapshots.map((snapshot) => snapshot.movementId),
		})
		let rebound = 0
		let orphaned = 0
		for (const snapshot of snapshots) {
			const sourceHive = this.sourceHiveAt(snapshot.currentCoord)
			if (sourceHive) {
				if (sourceHive.rebindMovementSnapshot(snapshot)) rebound += 1
				else orphaned += 1
			} else {
				this.offloadCancelledMovementSnapshot(snapshot)
				orphaned += 1
			}
		}
		traces.advertising?.log?.('[HIVE] Reorganisation finalize end', {
			hive: this.name,
			snapshottedMovements: snapshots.length,
			rebound,
			orphaned,
		})
		for (const movement of this.activeMovementsById.values()) {
			movement.refreshState = 'steady'
			this.ensureMovementInvariant(movement, {
				requireTracked: !movement.claimed,
				allowClaimedSourceGap: true,
				allowClaimedTerminalPath: true,
			})
		}
	}

	private ensureMovementTrackedAt(mg: TrackedMovement, coord: AxialCoord) {
		const current = this.movingGoods.get(coord) ?? []
		if (current.some((candidate) => candidate._mgId === mg._mgId)) {
			return
		}
		this.movingGoods.set(coord, [...current, mg])
	}

	private replaceMovementTracking(mg: TrackedMovement, coord: AxialCoord) {
		const movementId = mg._mgId
		this.forgetMovementTracking(mg)
		this.activeMovementsById.set(movementId, mg)
		const current = this.movingGoods.get(coord) ?? []
		this.movingGoods.set(coord, [...current, mg])
	}

	private removeMovementFromCoordTracking(mgId: string) {
		for (const [coord, goods] of [...this.movingGoods.entries()]) {
			const kept = goods.filter((candidate) => candidate._mgId !== mgId)
			if (kept.length !== goods.length) {
				if (kept.length === 0) this.movingGoods.delete(coord)
				else this.movingGoods.set(coord, kept)
			}
		}
	}

	private forgetMovementTracking(mg: TrackedMovement) {
		this.activeMovementsById.delete(mg._mgId)
		this.removeMovementFromCoordTracking(mg._mgId)
	}

	private preferredBorderOffloadTile(mg: TrackedMovement, coord: AxialCoord): Tile {
		const border = this.board.getBorder(coord)!
		const nextTileCoord = mg.path.find((step) => isTileCoord(step))
		if (nextTileCoord) {
			const nextTile = this.board.getTile(nextTileCoord)
			if (nextTile) return nextTile
		}
		return border.tile.a ?? border.tile.b
	}

	private offloadBrokenBorderMovement(mg: TrackedMovement, coord: AxialCoord) {
		const borderStorage = this.storageAt(coord)
		const sourceToken = mg.allocations?.source
		const targetToken = mg.allocations?.target
		const sourceValid = !!sourceToken && isAllocationValid(sourceToken)
		const targetValid = !!targetToken && isAllocationValid(targetToken)

		if (sourceValid) {
			try {
				sourceToken.fulfill()
			} catch {
				try {
					sourceToken.cancel()
				} catch {}
			}
		} else if (borderStorage) {
			try {
				borderStorage.removeGood(mg.goodType, 1)
			} catch {}
		}

		if (targetValid) {
			try {
				targetToken.cancel()
			} catch {}
		}

		const tile = this.preferredBorderOffloadTile(mg, coord)
		this.board.looseGoods.add(tile, mg.goodType)

		for (const [movementCoord, goods] of this.movingGoods.entries()) {
			const kept = goods.filter((candidate) => candidate._mgId !== mg._mgId)
			if (kept.length !== goods.length) {
				if (kept.length === 0) this.movingGoods.delete(movementCoord)
				else this.movingGoods.set(movementCoord, kept)
			}
		}
		mg.claimed = false
		delete mg.claimedBy
		delete mg.claimedAtMs
		this.scheduleAdvertisement(mg.provider)
		this.scheduleAdvertisement(mg.demander)
		this.wakeWanderingWorkersNear(mg.provider, mg.demander)
		;(traces.advertising ?? console).warn?.('[WATCHDOG] Offloaded broken border movement', {
			goodType: mg.goodType,
			provider: mg.provider.name,
			demander: mg.demander.name,
			coord,
		})
	}

	private recoverBorderMovement(mg: TrackedMovement, coord: AxialCoord): boolean {
		const borderStorage = this.storageAt(coord)
		if (!borderStorage) return false
		if (!mg.provider.tile || !mg.demander.tile || mg.provider.destroyed || mg.demander.destroyed) {
			// TODO: when destroyed alveoli/path invalidation exists, reroute or explicitly loose the border good.
			return false
		}

		try {
			this.noteMovementStorageCheckpoint(mg, 'recoverBorderMovement.before', coord)
			if (!mg.allocations?.source || !isAllocationValid(mg.allocations.source)) {
				const source = borderStorage.reserve({ [mg.goodType]: 1 }, this.movementReason(mg))
				if (!source) return false
				this.assignMovementSource(mg, source, 'recoverBorderMovement')
			}

			if (!mg.allocations?.target || !isAllocationValid(mg.allocations.target)) {
				const target = mg.demander.storage.allocate({ [mg.goodType]: 1 }, this.movementReason(mg))
				if (!target) return false
				mg.allocations.target = target
			}

			mg.from = coord
			this.ensureMovementTrackedAt(mg, coord)
			mg.claimed = false
			delete mg.claimedBy
			delete mg.claimedAtMs
			this.scheduleAdvertisement(mg.provider)
			this.scheduleAdvertisement(mg.demander)
			this.wakeWanderingWorkersNear(mg.provider, mg.demander)
			this.noteMovementStorageCheckpoint(mg, 'recoverBorderMovement.after', coord)
			;(traces.advertising ?? console).warn?.('[WATCHDOG] Recovered border movement bookkeeping', {
				goodType: mg.goodType,
				provider: mg.provider.name,
				demander: mg.demander.name,
				coord,
			})
			return true
		} catch (error) {
			this.noteMovementCaughtError(mg, 'recoverBorderMovement.catch', error)
			this.noteMovementStorageCheckpoint(mg, 'recoverBorderMovement.catch', coord)
			this.warnMovementRecoveryFailure(mg, 'Border recovery failed', coord, error)
			return false
		}
	}

	private recoverTileMovement(mg: TrackedMovement, coord: AxialCoord): boolean {
		if (this.isSyntheticMovement(mg)) return false
		if (!mg.provider.tile || !mg.demander.tile || mg.provider.destroyed || mg.demander.destroyed) {
			return false
		}
		const tileStorage = this.storageAt(coord)
		if (!tileStorage) return false

		try {
			this.noteMovementStorageCheckpoint(mg, 'recoverTileMovement.before', coord)
			if (!mg.allocations?.source || !isAllocationValid(mg.allocations.source)) {
				const source = tileStorage.reserve({ [mg.goodType]: 1 }, this.movementReason(mg))
				if (!source) return false
				this.assignMovementSource(mg, source, 'recoverTileMovement')
			}

			if (!mg.allocations?.target || !isAllocationValid(mg.allocations.target)) {
				const target = mg.demander.storage.allocate({ [mg.goodType]: 1 }, this.movementReason(mg))
				if (!target) return false
				mg.allocations.target = target
			}

			mg.from = coord
			this.ensureMovementTrackedAt(mg, coord)
			this.scheduleAdvertisement(mg.provider)
			this.scheduleAdvertisement(mg.demander)
			this.wakeWanderingWorkersNear(mg.provider, mg.demander)
			this.noteMovementStorageCheckpoint(mg, 'recoverTileMovement.after', coord)
			;(traces.advertising ?? console).warn?.('[WATCHDOG] Recovered tile movement bookkeeping', {
				goodType: mg.goodType,
				provider: mg.provider.name,
				demander: mg.demander.name,
				coord,
			})
			return true
		} catch (error) {
			this.noteMovementCaughtError(mg, 'recoverTileMovement.catch', error)
			this.noteMovementStorageCheckpoint(mg, 'recoverTileMovement.catch', coord)
			this.warnMovementRecoveryFailure(mg, 'Tile recovery failed', coord, error)
			return false
		}
	}

	private silentlyDiscardMovement(mg: TrackedMovement) {
		this.activeMovementsById.delete(mg._mgId)
		for (const [coord, goods] of this.movingGoods.entries()) {
			const kept = goods.filter((candidate) => candidate._mgId !== mg._mgId)
			if (kept.length !== goods.length) {
				if (kept.length === 0) this.movingGoods.delete(coord)
				else this.movingGoods.set(coord, kept)
			}
		}
		mg.claimed = false
		delete mg.claimedBy
		delete mg.claimedAtMs
		try {
			mg.allocations?.source?.cancel()
		} catch {}
		try {
			mg.allocations?.target?.cancel()
		} catch {}
	}

	private tryRecoverMovementInvariant(
		mg: TrackedMovement,
		failure: MovementInvariantFailure,
		options: { expectedFrom?: AxialCoord } = {}
	): boolean {
		if (this.isSyntheticMovement(mg)) return false
		const coord = options.expectedFrom ?? this.trackedMovementCoord(mg) ?? mg.from
		if (!coord) return false
		if (this.isStructuralMovementTeardownFailure(failure)) {
			this.silentlyDiscardMovement(mg)
			return true
		}
		if (failure === 'not-tracked') {
			if (!isTileCoord(coord)) return false
			return this.recoverTileMovement(mg, coord)
		}
		if (
			failure === 'missing-source-allocation' ||
			failure === 'missing-target-allocation' ||
			failure === 'invalid-source-allocation' ||
			failure === 'invalid-target-allocation'
		) {
			if (isTileCoord(coord)) return this.recoverTileMovement(mg, coord)
			return this.recoverBorderMovement(mg, coord)
		}
		if (failure === 'tracked-at-wrong-position') {
			this.noteMovementStorageCheckpoint(mg, 'recover.tracked-at-wrong-position.before', coord)
			this.forgetMovementTracking(mg)
			mg.from = coord
			this.activeMovementsById.set(mg._mgId, mg)
			this.ensureMovementTrackedAt(mg, coord)
			this.noteMovementStorageCheckpoint(mg, 'recover.tracked-at-wrong-position.after', coord)
			;(traces.advertising ?? console).warn?.('[WATCHDOG] Recovered stale movement tracking', {
				goodType: mg.goodType,
				provider: this.movementProviderName(mg),
				demander: this.movementDemanderName(mg),
				coord,
			})
			return true
		}
		return false
	}

	private shouldDelayBrokenMovementDiscard(
		mg: TrackedMovement,
		failure: MovementInvariantFailure,
		options: { expectedFrom?: AxialCoord } = {}
	): boolean {
		if (mg.claimed || mg.path.length === 0) return false
		if (failure !== 'missing-source-allocation' && failure !== 'invalid-source-allocation') {
			return false
		}
		const coord = options.expectedFrom ?? this.trackedMovementCoord(mg) ?? mg.from
		return !!coord
	}

	discardBrokenMovement(mg: TrackedMovement) {
		this.activeMovementsById.delete(mg._mgId)
		const trackedCoord = this.trackedMovementCoord(mg) ?? mg.from
		;(traces.advertising ?? console).warn?.('[WATCHDOG] Broken movement', {
			goodType: mg.goodType,
			provider: this.movementProviderName(mg),
			demander: this.movementDemanderName(mg),
			movementId: mg._mgId,
			from: mg.from,
			trackedCoord,
			pathLength: mg.path.length,
			onBorder: !!trackedCoord && !isTileCoord(trackedCoord),
			claimed: mg.claimed,
			// This path should stay exceptional until explicit destroyed-path handling exists.
			todo: 'unexpected-until-destroyed-path-handling',
		})
		if (trackedCoord && !isTileCoord(trackedCoord)) {
			if (this.recoverBorderMovement(mg, trackedCoord)) return
			this.offloadBrokenBorderMovement(mg, trackedCoord)
			return
		}

		for (const [coord, goods] of this.movingGoods.entries()) {
			const kept = goods.filter((candidate) => candidate._mgId !== mg._mgId)
			if (kept.length !== goods.length) {
				if (kept.length === 0) this.movingGoods.delete(coord)
				else this.movingGoods.set(coord, kept)
			}
		}
		mg.claimed = false
		delete mg.claimedBy
		delete mg.claimedAtMs
		try {
			mg.allocations?.source?.cancel()
		} catch {}
		try {
			mg.allocations?.target?.cancel()
		} catch {}
		this.scheduleAdvertisement(mg.provider)
		this.scheduleAdvertisement(mg.demander)
		this.wakeWanderingWorkersNear(mg.provider, mg.demander)
	}

	private stalledExchangeKey(provider: Alveolus, demander: Alveolus, goodType: GoodType) {
		const from = toAxialCoord(provider.tile.position)
		const to = toAxialCoord(demander.tile.position)
		return `${goodType}:${from.q},${from.r}->${to.q},${to.r}`
	}

	private hasActiveMovement(provider: Alveolus, demander: Alveolus, goodType: GoodType) {
		for (const mg of this.activeMovementsById.values()) {
			if (mg.goodType === goodType && mg.provider === provider && mg.demander === demander) {
				return true
			}
		}
		const providerCoord = toAxialCoord(provider.tile.position)
		const demanderCoord = toAxialCoord(demander.tile.position)
		for (const goods of this.movingGoods.values()) {
			if (
				goods.some(
					(mg) =>
						mg.goodType === goodType &&
						axial.key(toAxialCoord(mg.provider.tile.position)) === axial.key(providerCoord) &&
						axial.key(toAxialCoord(mg.demander.tile.position)) === axial.key(demanderCoord)
				)
			) {
				return true
			}
		}
		return false
	}

	getNeighborsForGood(
		ref: Positioned,
		goodType: GoodType,
		source?: AxialCoord,
		destination?: AxialCoord
	) {
		const coord = toAxialCoord(ref)
		if (isTileCoord(coord)) {
			const content = this.board.getTileContent(ref)
			const gates = (content as Alveolus | undefined)?.gates
			if (!content?.tile || !gates) return []
			return gates.map((g) => g.border.position)
		}
		// Get a border's neighbors - find tileA's and tileB's borders who are gates but not me
		const border = this.board.getBorder(ref)!
		return [border.tile.a.position, border.tile.b.position].filter((tilePosition) => {
			const tileCoord = toAxialCoord(tilePosition)
			if (!source || !destination) return true
			return this.isTraversableRelayTile(tileCoord, goodType, source, destination)
		})
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

	movingGoods = reactive(new AxialKeyMap<TrackedMovement[]>())
	storageAt(coord: Positioned): Storage | undefined {
		if (isTileCoord(toAxialCoord(coord))) {
			const content = this.board.getTileContent(coord) as Alveolus
			return content.storage
		}
		const border = this.board.getBorder(coord)!
		return border.content?.storage
	}

	wakeWanderingWorkersNear(_provider: Alveolus, _demander: Alveolus) {
		if (this.destroyed || this.reconstructing) return
		if (this.wakeWanderingWorkersScheduled) return
		this.wakeWanderingWorkersScheduled = true
		defer(() => {
			if (this.destroyed) return
			this.wakeWanderingWorkersScheduled = false
			for (const worker of this.board.game.population) {
				const actionDescription = worker.actionDescription || []
				const wandering = actionDescription.includes('selfCare.wander')
				const waitingIncoming = actionDescription.includes('waitForIncomingGoods')
				if (!wandering && !waitingIncoming) continue
				const assignedHere =
					worker.assignedAlveolus === _provider || worker.assignedAlveolus === _demander
				if (worker.assignedAlveolus && !assignedHere) continue
				const nextAction = worker.findAction()
				if (!nextAction) continue
				const running = worker.runningScript
				// Same script name can still be a different target/job (e.g. goWork on another alveolus).
				// Only suppress if it is truly the same execution object.
				if (running && nextAction === running) continue
				worker.abandonAnd(nextAction)
			}
		})
	}

	public createMovement(goodType: GoodType, provider: Alveolus, demander: Alveolus) {
		if (this.reconstructing) return false
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

		const providePriority = this.movementProvidePriority(provider, goodType)
		if (!providePriority) {
			traces.advertising?.log(`[CREATE] SKIP PROVIDER: ${goodType} ${provider.name} cannot give`, {
				goodType,
				provider: provider.name,
				demander: demander.name,
				providePriority,
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
		const computedPath = this.getPath(provider, demander, goodType)
		if (!computedPath || computedPath.length < 1) {
			traces.advertising?.log(`[CREATE] NO PATH: ${goodType} ${provider.name} -> ${demander.name}`)
			return false
		}
		const path = [...computedPath]

		traces.advertising?.log(
			`[CREATE] PATH FOUND: ${goodType} ${provider.name} -> ${demander.name} length=${path.length}`
		)

		const reason = {
			type: 'hive-transfer',
			goodType,
			...positions,
			provider,
			demander,
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

			const movingGood: TrackedMovement = {
				_mgId: reason.movementId,
				goodType,
				path,
				provider,
				demander,
				from: positions.provider,
				refreshState: 'steady',
				claimed: false,
				allocations: {
					source: providerToken!,
					target: targetToken!,
				},
				hop() {
					throw new Error('movement runtime not installed')
				},
				place() {
					throw new Error('movement runtime not installed')
				},
				finish() {
					throw new Error('movement runtime not installed')
				},
				abort() {
					throw new Error('movement runtime not installed')
				},
			}

			this.installMovementRuntimeMethods(movingGood)
			this.activeMovementsById.set(movingGood._mgId, movingGood)
			this.pushMovementDebugEntry(
				movingGood,
				'sourceTrail',
				`create:initial:${this.movementAllocationLabel(providerToken!)}@${Date.now()}`
			)
			movingGood.place()
			this.assertMovementMine(movingGood, {
				label: 'movement.create.after-place',
				expectedFrom: movingGood.from,
				expectClaimed: false,
				requireTracked: true,
				requireSourceValid: true,
				requireTargetValid: true,
			})
			this.wakeWanderingWorkersNear(provider, demander)
			traces.advertising?.log(
				`[CREATE] SUCCESS: ${goodType} ${provider.name} -> ${demander.name} movement active`
			)

			return true
		})
	}

	get generalStorages() {
		return [
			...((this.byActionType['slotted-storage'] || []) as StorageAlveolus[]),
			...((this.byActionType['specific-storage'] || []) as StorageAlveolus[]),
			...((this.byActionType['storage'] || []) as StorageAlveolus[]),
			...((this.byActionType['road-fret'] || []) as StorageAlveolus[]),
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
	): Alveolus | undefined {
		traces.advertising?.log(
			`[SELECT] START: ${goodType} ${advertisement} from ${alveolus.name} to ${storages.length} candidates`
		)

		// We consider A->B === B->A
		const storage = inert(() => this.findNearest(alveolus, new Set(storages), goodType))
		if (storage === undefined) {
			traces.advertising?.log(
				`[SELECT] NO REACHABLE: ${goodType} from ${alveolus.name} to any of: ${storages.map((s) => (s as any).name || 'unnamed').join(', ')}`
			)
			return undefined
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

				// Check provider can give the goods
				if ('canGive' in providerStorage && typeof providerStorage.canGive === 'function') {
					const providerCanGive = providerStorage.canGive(goodType, sourcePriority)

					if (!providerCanGive) {
						traces.advertising?.log(
							`[SELECT] SKIP: ${goodType} - ${providerStorage.name} has no goods to give`
						)
						return storage
					}
				}

				// Check target can take the goods
				if ('canTake' in targetStorage && typeof targetStorage.canTake === 'function') {
					const targetCanTake = targetStorage.canTake(goodType, targetPriority)

					if (!targetCanTake) {
						traces.advertising?.log(
							`[SELECT] SKIP: ${goodType} - ${targetStorage.name} cannot accept goods`
						)
						return storage
					}
				}
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
		this.reconstructing = false
		this.wakeWanderingWorkersScheduled = false
		if (this.exchangeWatchdogTimer) {
			clearInterval(this.exchangeWatchdogTimer)
			this.exchangeWatchdogTimer = undefined
		}
		this.stalledExchangeSeenAt.clear()

		const knownMovements = new Set<TrackedMovement>()
		for (const [, goods] of this.movingGoods.entries()) {
			for (const movingGood of goods) knownMovements.add(movingGood)
		}
		for (const movingGood of this.activeMovementsById.values()) {
			knownMovements.add(movingGood)
		}
		for (const movingGood of knownMovements) {
			const movementId =
				movingGood.allocations?.source && (movingGood.allocations.source as any).reason?.movementId
			traces.allocations?.log(
				`[MOVEMENT] CANCELLED DURING DESTROY: ${movingGood.goodType} ${movingGood.provider.name} -> ${movingGood.demander.name}`,
				{
					movementId,
					goodType: movingGood.goodType,
					provider: movingGood.provider.name,
					demander: movingGood.demander.name,
					coord: this.trackedMovementCoord(movingGood) ?? movingGood.from,
					claimed: movingGood.claimed,
				}
			)
			try {
				movingGood.allocations?.source?.cancel()
			} catch {}
			try {
				movingGood.allocations?.target?.cancel()
			} catch {}
		}
		this.movingGoods.clear()
		this.activeMovementsById.clear()
		// Clean up all advertising effects
		for (const cleanup of this.advertising) {
			cleanup()
		}
		this.advertising.length = 0
	}
	//#endregion
}
