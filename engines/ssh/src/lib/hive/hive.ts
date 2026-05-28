/**
 * hive.ts — Hive class (3155 lines)
 *
 * Table of Contents:
 *   1-89    Imports & module-level helpers
 *   90-249  Hive class: fields, constructor, postStep
 *   250-549 Hives management on tile add/remove (attach, detach, flushTopologyRefreshBatch)
 *   550-699 Path caching (getPath, findNearest, etc.)
 *   700-899 Exchange watchdog (scanForStalledExchanges, queueDetachedAllocationCleanup, etc.)
 *   900-1099 Movement invariant validation & debugging (validateMovementInvariant, assertMovementMine, etc.)
 *  1100-1299 Movement invariant assertions and diagnostics
 *  1300-1499 Movement lifecycle (hop, place, finish, abort, installMovementRuntimeMethods)
 *  1500-1699 Movement creation & selection (createMovement, selectMovement, restoreSerializedConveyRow)
 *  1700-1899 Topology refresh internals (snapshotReconstructionMovements, finalizeReconstructedMovements, etc.)
 *  1900-2099 Movement discard & offload (discardBrokenMovement, offloadBrokenBorderMovement, etc.)
 *  2100-2299 Movement structural teardown cleanup
 *  2300-2499 Movement tracking (ensureMovementTrackedAt, replaceMovementTracking, forgetMovementTracking, etc.)
 *  2500-2699 Broken movement disposal
 *  2700-2899 Topology refresh snapshot helpers (resolveProviderForSnapshot, cancelSnapshotMovement, etc.)
 *  2900-3099 Movement selection & advertisement (selectMovement, getNeighborsForGood, needs, etc.)
 *  3100-3155 destroy() & cleanup
 */

import { effect, inert, reactive, type ScopedCallback, unreactive, unwrap } from 'mutts'
import { type HexBoard, isTileCoord } from 'ssh/board/board'
import { AlveolusGate } from 'ssh/board/border/alveolus-gate'
import { Alveolus } from 'ssh/board/content/alveolus'
import type { Tile } from 'ssh/board/tile'
import { Commitment } from 'ssh/commitment'
import {
	dockedVehicleGoodsRelations,
	type FreightMovementParty,
	freightPartyMatchesAssignedAlveolus,
	isVehicleFreightDock,
	type VehicleFreightDock,
} from 'ssh/freight/vehicle-freight-dock'
import { defaultNameTheme, generateName } from 'ssh/generation/names'
import { options } from 'ssh/globals'
import type { Character } from 'ssh/population/character'
import { findLiveAllocations, trackAllocation, untrackAllocation } from 'ssh/storage/guard'
import { NoStorage } from 'ssh/storage/no-storage'
import type { Storage } from 'ssh/storage/storage'
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
import { assert, traces } from '../dev/debug.ts'
import type { SerializedConveyMovement } from './convey-serialize'
import { createMovementRef, type MovementRef, movementRefId } from './movement-ref'
import {
	isTerminalState,
	MovementState,
	type MovementState as MovementStateType,
	transitionMovement,
} from './movement-state'
import type { StorageAlveolus } from './storage'

type AdvertisementInvalidationReason =
	| 'storage.stock'
	| 'transform.processBuffer'
	| 'movement.lifecycle'
	| 'alveolus.config'
	| 'dock.lifecycle'
	| 'hive.attach'
	| 'general-storage.attach'
	| 'hive.working'
	| 'audit.cleanup'

function isLogisticsStorageAlveolusAction(actionType: string | undefined): boolean {
	return (
		actionType === 'slotted-storage' ||
		actionType === 'specific-storage' ||
		actionType === 'storage'
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

function tileNameKey(tile: Tile): string {
	const coord = toAxialCoord(tile.position) ?? { q: 0, r: 0 }
	return axial.key(coord)
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
 * `activeMovements`, and indexed in `movingGoods`.
 */
export interface TrackedMovement {
	/**
	 * Stable runtime identity preserved across hive rebind and used as save-row linkage
	 * (see `SerializedConveyMovement.movementRef`).
	 */
	ref: MovementRef
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
	/** Party currently providing the good (bay storage or docked vehicle endpoint). */
	provider: FreightMovementParty
	/** Party currently demanding the good (bay storage or docked vehicle endpoint). */
	demander: FreightMovementParty
	/** Current coord where the movement token is tracked or expected to be tracked. */
	from: AxialCoord
	/** FSM state governing allowed lifecycle transitions. */
	_state: MovementStateType
	/** Used during hive topology refresh to temporarily suspend invariant checks/rebinding. */
	refreshState?: 'steady' | 'suspended-refresh'
	/** Set by conveyStep to prevent a second worker from picking up the same movement */
	claimed: boolean
	/** Worker currently holding the convey claim, if any. */
	claimedBy?: Character
	/** Epoch millis when claim was taken (best-effort watchdog metadata). */
	claimedAtMs?: number
	allocations: {
		source?: Commitment
		target: Commitment
	}
	/** Advance the movement by one coord and return the new coord. */
	hop(): AxialCoord
	prepareHop(): AxialCoord
	commitHop(): void
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
	fromSnapshot: AxialCoord
	movement: TrackedMovement
}

export type MovementInvariantFailure =
	| 'missing-source-allocation'
	| 'missing-target-allocation'
	| 'invalid-source-allocation'
	| 'invalid-target-allocation'
	| 'source-without-target-allocation'
	| 'empty-path'
	| 'not-tracked'
	| 'tracked-at-wrong-position'
	| 'destroyed-provider'
	| 'destroyed-demander'

/** A commitment is "valid" (not yet ended) when `ended` is `undefined` or `false`. */
export function commitmentValid(c: Commitment | undefined): boolean {
	return c !== undefined && (c.ended === undefined || c.ended === false)
}

export class MovementInvariantError extends Error {
	constructor(
		public readonly movement: TrackedMovement,
		public readonly failure: MovementInvariantFailure,
		message: string
	) {
		super(message)
		this.name = 'MovementInvariantError'
	}
}

type AllocationReasonInfo = {
	type?: string
	role?: 'movement-source' | 'movement-target'
	goodType?: GoodType
	movementRef?: MovementRef
	movementRefs?: MovementRef[]
	movement?: TrackedMovement
	movements?: TrackedMovement[]
	provider?: FreightMovementParty
	demander?: FreightMovementParty
	providerRef?: FreightMovementParty
	demanderRef?: FreightMovementParty
	providerName?: string
	demanderName?: string
	createdAt?: number
	source?: AxialCoord
}

function allocationReasonMovementRefs(reason: AllocationReasonInfo | undefined): MovementRef[] {
	if (!reason) return []
	const refs: MovementRef[] = []
	if (reason.movementRef) refs.push(reason.movementRef)
	for (const ref of reason.movementRefs ?? []) refs.push(ref)
	for (const movement of reason.movements ?? []) refs.push(movement.ref)
	if (reason.movement?.ref) refs.push(reason.movement.ref)
	const seen = new Set<number>()
	return refs.filter((ref) => {
		const id = movementRefId(ref)
		if (seen.has(id)) return false
		seen.add(id)
		return true
	})
}

function allocationReasonMovements(reason: AllocationReasonInfo | undefined): TrackedMovement[] {
	if (!reason) return []
	const movements: TrackedMovement[] = []
	if (reason.movement) movements.push(reason.movement)
	for (const movement of reason.movements ?? []) movements.push(movement)
	const seen = new Set<number>()
	return movements.filter((movement) => {
		const id = movementRefId(movement.ref)
		if (seen.has(id)) return false
		seen.add(id)
		return true
	})
}

function allocationReasonHasMovement(
	reason: AllocationReasonInfo | undefined,
	movement: TrackedMovement
): boolean {
	return allocationReasonMovementRefs(reason).some(
		(ref) => movementRefId(ref) === movementRefId(movement.ref)
	)
}

/**
 * Serializable snapshot used to carry a movement across hive refresh/reconstruction.
 */
export interface PersistentMovementSnapshot {
	/** Stable movement ref copied from {@link TrackedMovement.ref}. */
	movementRef: MovementRef
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
	claimedByUid?: string
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
export class Hive extends AdvertisementManager<FreightMovementParty> {
	private constructor(public readonly board: HexBoard) {
		super()
		this.runtimeEffects.push(
			effect`hive.exchange-watchdog`(() => {
				this.configureExchangeWatchdog(options.stalledMovementScanIntervalMs)
			})
		)
	}
	private destroyed = false
	private reconstructing = false
	private wakeWanderingWorkersScheduled = false
	private advertisementFlushScheduled = false
	private pendingAdvertisementReasons = new Map<
		FreightMovementParty,
		Set<AdvertisementInvalidationReason>
	>()
	private pendingBrokenMovementDiscardIds = new Set<object>()
	private pendingDetachedAllocationCleanupIds = new Set<string>()
	private creatingMovementKeys = new Set<string>()
	private pendingMovementSourceQuantities = new Map<string, number>()
	private pendingMovementTargetQuantities = new Map<string, number>()
	private activeMovements = new Set<TrackedMovement>()
	private _conveyPlanningRevision = 0
	private readonly freightVehicleDocks = new Map<string, VehicleFreightDock>()
	// Path cache for complete paths between alveoli
	private pathCache = new Map<string, AxialCoord[]>()
	private exchangeWatchdogTimer: ReturnType<typeof setInterval> | undefined
	private stalledExchangeSeenAt = new Map<string, number>()
	private postStepQueue: (() => void)[] = []
	private draining = false

	postStep(fn: () => void): void {
		this.postStepQueue.push(fn)
		if (!this.draining) this.drainPostStepQueue()
	}

	private drainPostStepQueue(): void {
		if (this.draining) return
		this.draining = true
		try {
			while (this.postStepQueue.length > 0) {
				const batch = this.postStepQueue.splice(0)
				for (const cb of batch) cb()
			}
		} finally {
			this.draining = false
		}
	}

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
		if (hives.size === 0) {
			const hive = new Hive(tile.board)
			hive.ensureGeneratedName(`hive:${tileNameKey(tile)}`)
			return hive
		}
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
	private ensureGeneratedName(key: string): void {
		if (this.metadata.name) return
		const generationOptions = this.board.game.generationOptions
		this.metadata.name = generateName({
			seed: generationOptions?.terrainSeed ?? 0,
			theme: generationOptions?.nameTheme ?? defaultNameTheme,
			kind: 'hive',
			key,
		})
	}
	get working() {
		return this.metadata.working
	}
	set working(value: boolean) {
		if (this.metadata.working === value) return
		this.metadata.working = value
		this.invalidateAdvertisements(this.alveoli, 'hive.working')
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
	private readonly runtimeEffects: ScopedCallback[] = []
	private readonly gates = new Set<AlveolusGate>()

	get conveyPlanningRevision(): number {
		return this._conveyPlanningRevision
	}

	public invalidateConveyPlanning(_reason: string): void {
		this._conveyPlanningRevision++
		this.board.game.invalidateWorkPlanning('convey')
	}

	public invalidateAdvertisement(
		party: FreightMovementParty | undefined,
		reason: AdvertisementInvalidationReason
	): void {
		if (this.destroyed || this.reconstructing || !party || !party.tile) {
			traces.advertising.log?.(`[SCHEDULE] SKIP: invalid party`, {
				party: party?.name,
				hasTile: !!party?.tile,
				reason,
			})
			return
		}
		const reasons = this.pendingAdvertisementReasons.get(party) ?? new Set()
		reasons.add(reason)
		this.pendingAdvertisementReasons.set(party, reasons)
		if (this.advertisementFlushScheduled) return
		this.advertisementFlushScheduled = true
		this.postStep(() => {
			if (this.destroyed || this.reconstructing) return
			this.advertisementFlushScheduled = false
			const pending = [...this.pendingAdvertisementReasons.entries()]
				.map(([advertiser, reasons]) => ({
					advertiser,
					reasons,
					relations: this.advertisementRelationsFor(advertiser),
				}))
				.sort((a, b) => {
					const demandOnly = (relations: GoodsRelations) => {
						const ads = Object.values(relations)
						return ads.length > 0 && ads.every((ad) => ad?.advertisement === 'demand')
					}
					return Number(demandOnly(b.relations)) - Number(demandOnly(a.relations))
				})
			this.pendingAdvertisementReasons.clear()
			for (const { advertiser, relations, reasons } of pending) {
				if (!advertiser || !advertiser.tile) {
					traces.advertising.log?.(`[SCHEDULE] SKIP PENDING: invalid advertiser`, {
						advertiser: advertiser?.name,
						reasons: [...reasons],
					})
					continue
				}
				traces.advertising.log?.(`[SCHEDULE] FLUSH: ${advertiser.name}`, {
					reasons: [...reasons],
					relations,
				})
				this.advertise(advertiser, unwrap(relations) ?? {})
			}
		})
	}

	public invalidateAdvertisements(
		parties: Iterable<FreightMovementParty | undefined>,
		reason: AdvertisementInvalidationReason
	): void {
		for (const party of parties) this.invalidateAdvertisement(party, reason)
	}

	private advertisementRelationsFor(party: FreightMovementParty): GoodsRelations {
		return isVehicleFreightDock(party)
			? dockedVehicleGoodsRelations(party.vehicle, party.bay)
			: (party as Alveolus).goodsRelations
	}

	/** Registers a docked wheelbarrow endpoint for bay↔vehicle convey matching. */
	registerFreightVehicleDock(dock: VehicleFreightDock): void {
		this.freightVehicleDocks.set(dock.vehicle.uid, dock)
		this.invalidateConveyPlanning('dock.lifecycle')
		this.invalidateAdvertisements([dock, dock.bay], 'dock.lifecycle')
	}

	@inert
	unregisterFreightVehicleDock(vehicleUid: string): void {
		const dock = this.freightVehicleDocks.get(vehicleUid)
		if (!dock) return
		this.freightVehicleDocks.delete(vehicleUid)
		this.pendingAdvertisementReasons.delete(dock)
		this.advertise(dock, {})
		this.invalidateConveyPlanning('dock.lifecycle')
		this.invalidateAdvertisement(dock.bay, 'dock.lifecycle')
	}

	freightVehicleDockFor(vehicleUid: string): VehicleFreightDock | undefined {
		return this.freightVehicleDocks.get(vehicleUid)
	}

	hasActiveFreightVehicleDockMovement(vehicleUid: string): boolean {
		for (const movement of this.activeMovements) {
			const providerDock = isVehicleFreightDock(movement.provider) ? movement.provider : undefined
			const demanderDock = isVehicleFreightDock(movement.demander) ? movement.demander : undefined
			if (providerDock?.vehicle.uid === vehicleUid || demanderDock?.vehicle.uid === vehicleUid) {
				return true
			}
		}
		return false
	}

	public attach(alveolus: Alveolus) {
		this.ensureGeneratedName(`hive:${tileNameKey(alveolus.tile)}`)
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
		this.invalidateConveyPlanning('hive.attach')
		this.invalidateAdvertisement(alveolus, 'hive.attach')
		if (this.isGeneralStorageAlveolus(alveolus)) {
			this.postStep(() => {
				for (const provider of this.alveoli) {
					if (provider === alveolus) continue
					if (
						Object.values(provider.goodsRelations).some(
							(relation) => relation?.advertisement === 'provide'
						)
					) {
						this.invalidateAdvertisement(provider, 'general-storage.attach')
					}
				}
			})
		}
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
		this.transferFreightVehicleDocksFrom(hive)
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
		this.transferFreightVehicleDocksFrom(hive)
		// TODO: destroying an alveolus (and its borders) should "loose" the goods and cancel all the movements going through
		return this
	}

	/**
	 * Transfer freight vehicle dock registrations from a source hive during topology refresh.
	 * Each dock is re-registered so the new hive owns the advertisement endpoint.
	 */
	private transferFreightVehicleDocksFrom(source: Hive) {
		for (const dock of source.freightVehicleDocks.values()) {
			// Only transfer docks whose bay alveolus belongs to this rebuilt hive.
			// After hive.attach() runs, dock.bay.hive already points to the new hive.
			if (dock.bay.hive === this) {
				this.registerFreightVehicleDock(dock)
			}
		}
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
		this.invalidateConveyPlanning('topology.refresh')
		for (const movement of this.activeMovements) {
			movement.refreshState = 'suspended-refresh'
			movement._state = transitionMovement(movement._state, MovementState.suspended)
		}
	}

	public detachAlveolusForRefresh(alveolus: Alveolus) {
		this.markTopologyRefreshPending()
		this.alveoli.delete(alveolus)
		this.invalidatePathCache()
		this.invalidateConveyPlanning('hive.detach')
	}

	public flushTopologyRefreshBatch(hives: Set<Hive>) {
		const touchedHives = Array.from(hives).filter((hive) => !hive.destroyed)
		if (touchedHives.length === 0) return

		const snapshots: PersistentMovementSnapshot[] = []
		const seenMovementRefs = new Set<number>()
		const toPlaceAlveoli = new Set<Alveolus>()

		for (const hive of touchedHives) {
			hive.markTopologyRefreshPending()
			for (const snapshot of hive.snapshotReconstructionMovements()) {
				const movementId = movementRefId(snapshot.movementRef)
				if (seenMovementRefs.has(movementId)) continue
				seenMovementRefs.add(movementId)
				snapshots.push(snapshot)
			}
			for (const alveolus of hive.alveoli) {
				if (alveolus.destroyed) continue
				if (alveolus.tile?.content !== alveolus) continue
				toPlaceAlveoli.add(alveolus)
			}
		}

		traces.advertising.log?.('[HIVE] Reorganisation begin', {
			hives: touchedHives.map((hive) => hive.name),
			alveoliBefore: Array.from(toPlaceAlveoli).map((alveolus) => alveolus.name),
			snapshottedMovements: snapshots.length,
			movementRefs: snapshots.map((snapshot) => movementRefId(snapshot.movementRef)),
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

		traces.advertising.log?.('[HIVE] Reorganisation topology rebuilt', {
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

	/**
	 * Whether a good may cross this **tile** when moving **border to border** (transit only).
	 * Does not depend on storage room or whether the alveolus stores the good type.
	 */
	private isRelayTransitTile(
		tileCoord: AxialCoord,
		_goodType: GoodType,
		source: AxialCoord | undefined,
		destination: AxialCoord | undefined
	): boolean {
		if (source && axial.key(tileCoord) === axial.key(source)) return true
		if (destination && axial.key(tileCoord) === axial.key(destination)) return true

		const content = this.board.getTileContent(tileCoord)
		return content instanceof Alveolus
	}

	/** Trimmed convey routes: border hops then a single terminal demander tile. */
	private assertLogisticsPathShape(path: readonly AxialCoord[], context: string) {
		assert(path.length >= 1, `${context}: convey path must be non-empty`)
		const last = path[path.length - 1]!
		assert(isTileCoord(last), `${context}: convey path must end on the demander tile`)
		if (path.length === 1) {
			assert(isTileCoord(path[0]!), `${context}: terminal-only remainder must be a tile`)
			return
		}
		assert(!isTileCoord(path[0]!), `${context}: multi-hop convey path must begin on a border hop`)
		for (let i = 0; i < path.length - 1; i++) {
			assert(
				!(isTileCoord(path[i]!) && isTileCoord(path[i + 1]!)),
				`${context}: convey path must not contain consecutive tile nodes`
			)
		}
	}

	private getPath(
		from: FreightMovementParty,
		to: FreightMovementParty,
		goodType: GoodType
	): AxialCoord[] | undefined {
		const fromCoord = toAxialCoord(from.tile.position)
		const toCoord = toAxialCoord(to.tile.position)
		const key = `${fromCoord.q},${fromCoord.r}-${toCoord.q},${toCoord.r}-${goodType}`

		if (this.pathCache.has(key)) {
			return this.pathCache.get(key)!
		}

		if (
			axial.key(fromCoord) === axial.key(toCoord) &&
			(isVehicleFreightDock(from) || isVehicleFreightDock(to))
		) {
			const trimmed: AxialCoord[] = [toCoord]
			this.assertLogisticsPathShape(trimmed, 'getPath.same-tile-vehicle-dock')
			this.pathCache.set(key, trimmed)
			return trimmed
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
			// Full route: provider tile -> border -> border -> ... -> border -> demander tile.
			// Movements keep hops after the origin tile: first hop is onto a gate border.
			const trimmed = path.slice(1)
			if (trimmed.length < 1) return undefined
			this.assertLogisticsPathShape(trimmed, 'getPath')
			this.pathCache.set(key, trimmed)
			return trimmed
		}

		return undefined
	}

	private getPathDistance(
		from: FreightMovementParty,
		to: FreightMovementParty,
		goodType: GoodType
	): number {
		const path = this.getPath(from, to, goodType)
		return path ? path.length : Number.POSITIVE_INFINITY
	}

	private findNearest<T extends FreightMovementParty>(
		from: FreightMovementParty,
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

		traces.advertising.log?.(
			`[FIND] START: ${from.name} to ${candidates.size} candidates for ${goodType}`,
			Array.from(candidates).map((c) => ({ name: c.name, type: c.constructor.name }))
		)

		let nearest: T | undefined
		let minDistance = Number.POSITIVE_INFINITY

		for (const candidate of candidates) {
			const distance = this.getPathDistance(from, candidate, goodType)
			traces.advertising.log?.(`[FIND] CANDIDATE: ${candidate.name} distance=${distance}`)
			if (distance < minDistance) {
				minDistance = distance
				nearest = candidate
			}
		}

		traces.advertising.log?.(
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
		if (this.destroyed) return
		if (!intervalMs || intervalMs <= 0) return
		traces.allocations.log?.('[AUDIT] Exchange watchdog timer disabled for runtime', {
			hive: this.name,
			intervalMs,
		})
	}

	scanForStalledExchanges() {
		if (this.destroyed || this.reconstructing) return
		const now = Date.now()
		const settleMs = Math.max(
			options.stalledMovementSettleMs,
			Number(options.stalledMovementScanIntervalMs) || 0
		)
		this.reconcileMovementAllocationPairs('exchange-watchdog')
		this.scanForDetachedMovementAllocations()
		this.scanBorderTransitStorageInvariant()
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

					this.stalledExchangeSeenAt.set(key, now)
					throw new Error(
						`[AUDIT] STALLED EXCHANGE: ${goodType} ${provider.name} -> ${demander.name}; stableForMs=${now - firstSeenAt}`
					)
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

	private activeMovementByRef(ref: MovementRef): TrackedMovement | undefined {
		for (const movement of this.activeMovements) {
			if (movement.ref === ref || movementRefId(movement.ref) === movementRefId(ref))
				return movement
		}
		for (const goods of this.movingGoods.values()) {
			for (const movement of goods) {
				if (movement.ref === ref || movementRefId(movement.ref) === movementRefId(ref))
					return movement
			}
		}
		return undefined
	}

	private freightPartyUnavailableForMovement(party: FreightMovementParty | undefined): boolean {
		if (!party) return true
		if (!party.tile || party.destroyed) return true
		if (isVehicleFreightDock(party)) {
			return (
				this.freightPartyUnavailableForMovement(party.bay) ||
				this.freightVehicleDocks.get(party.vehicle.uid) !== party
			)
		}
		return !this.alveoli.has(party as Alveolus)
	}

	private queueDetachedAllocationCleanup(
		allocation: Commitment,
		details: {
			goodType: GoodType
			provider?: FreightMovementParty
			demander?: FreightMovementParty
			movementRef?: MovementRef
			reasonType?: string
			silent?: boolean
		}
	) {
		const cleanupId = [
			details.reasonType ?? 'movement-allocation',
			details.movementRef ? `ref#${movementRefId(details.movementRef)}` : 'unknown',
			details.goodType,
			details.provider?.name ?? 'unknown-provider',
			details.demander?.name ?? 'unknown-demander',
		].join(':')
		if (this.pendingDetachedAllocationCleanupIds.has(cleanupId)) return
		this.pendingDetachedAllocationCleanupIds.add(cleanupId)
		this.postStep(() => {
			this.pendingDetachedAllocationCleanupIds.delete(cleanupId)
			if (this.destroyed || this.reconstructing) return
			const allocationsToCancel = new Set<Commitment>()
			if (commitmentValid(allocation)) allocationsToCancel.add(allocation)
			if (details.movementRef) {
				for (const { allocation: candidateAllocation } of findLiveAllocations((candidate) => {
					const reason = candidate.reason as
						| {
								type?: string
								goodType?: GoodType
								movementRef?: MovementRef
								movement?: TrackedMovement
						  }
						| undefined
					if (!reason) return false
					if (details.reasonType && reason.type !== details.reasonType) return false
					if (details.goodType && reason.goodType && reason.goodType !== details.goodType)
						return false
					const candidateRef = reason.movementRef ?? reason.movement?.ref
					return (
						!!candidateRef &&
						!!details.movementRef &&
						movementRefId(candidateRef) === movementRefId(details.movementRef)
					)
				})) {
					if (!commitmentValid(candidateAllocation as Commitment)) continue
					allocationsToCancel.add(candidateAllocation as Commitment)
				}
			}
			if (allocationsToCancel.size === 0) return
			try {
				for (const candidateAllocation of allocationsToCancel) {
					candidateAllocation.cancel('structural-teardown')
				}
				if (details.silent) {
					traces.advertising.log?.(
						'[WATCHDOG] Cancelled detached allocation during structural teardown',
						{
							goodType: details.goodType,
							provider: details.provider?.name,
							demander: details.demander?.name,
							movementRef: details.movementRef,
							reasonType: details.reasonType,
							cancelledAllocations: allocationsToCancel.size,
						}
					)
				} else {
					traces.advertising.warn?.('[WATCHDOG] Cancelled detached movement allocation', {
						goodType: details.goodType,
						provider: details.provider?.name,
						demander: details.demander?.name,
						movementRef: details.movementRef,
						reasonType: details.reasonType,
						cancelledAllocations: allocationsToCancel.size,
					})
				}
			} catch (error) {
				traces.allocations.warn?.('[WATCHDOG] Failed to cancel detached movement allocation', {
					goodType: details.goodType,
					provider: details.provider?.name,
					demander: details.demander?.name,
					movementRef: details.movementRef ? movementRefId(details.movementRef) : undefined,
					reasonType: details.reasonType,
					error: error instanceof Error ? error.message : String(error),
				})
				return
			}
			this.invalidateAdvertisements([details.provider, details.demander], 'audit.cleanup')
			if (details.provider && details.demander) {
				this.wakeWanderingWorkersNear(details.provider, details.demander)
			}
		})
	}

	private scanForDetachedMovementAllocations() {
		if (this.destroyed || this.reconstructing) return
		for (const { held, allocation } of findLiveAllocations((candidate) => {
			const reason = candidate.reason as { type?: string } | undefined
			return (
				reason?.type === 'hive-transfer' ||
				reason?.type === 'convey.path' ||
				reason?.type === 'convey.hop'
			)
		})) {
			const reason = held.reason as AllocationReasonInfo | undefined
			if (!reason) continue
			const goodType = reason.goodType
			if (!goodType) continue
			const provider = reason.providerRef ?? reason.provider ?? reason.movement?.provider
			const demander = reason.demanderRef ?? reason.demander ?? reason.movement?.demander
			if (!this.movementRefsBelongToThisHive(provider, demander)) continue
			const structuralTeardown =
				this.freightPartyUnavailableForMovement(provider) ||
				this.freightPartyUnavailableForMovement(demander)
			const movementRef = reason.movementRef ?? reason.movement?.ref
			const trackedMovement = movementRef ? this.activeMovementByRef(movementRef) : undefined
			if (
				this.pruneResolvedMovementAllocation(
					allocation as Commitment,
					reason,
					'[WATCHDOG]',
					trackedMovement
				)
			) {
				continue
			}
			if (structuralTeardown) {
				if (trackedMovement) this.silentlyDiscardMovement(trackedMovement)
				traces.advertising.log?.(
					'[WATCHDOG] Dropping detached allocation during structural teardown',
					{
						goodType,
						provider: provider?.name,
						demander: demander?.name,
						movementRef: movementRef ? movementRefId(movementRef) : undefined,
						reasonType: reason.type,
						tracked: !!trackedMovement,
						pathLength: trackedMovement?.path.length,
					}
				)
				this.queueDetachedAllocationCleanup(allocation as Commitment, {
					goodType,
					provider,
					demander,
					movementRef,
					reasonType: reason.type,
					silent: true,
				})
				continue
			}
			if (trackedMovement?._state === MovementState.delivering) continue
			if (trackedMovement) {
				const trackedFailure = this.validateMovementInvariant(trackedMovement, {
					allowClaimedTerminalPath: trackedMovement.claimed,
					requireTracked: !trackedMovement.claimed,
				})
				if (trackedFailure === 'not-tracked') {
					if (trackedMovement) this.activeMovements.delete(trackedMovement)
					this.queueDetachedAllocationCleanup(allocation as Commitment, {
						goodType,
						provider,
						demander,
						movementRef,
						reasonType: reason.type,
						silent: true,
					})
					this.throwMovementInvariantFailure(
						trackedMovement,
						trackedFailure,
						'[WATCHDOG] Detached tracked movement'
					)
				}
				this.queueBrokenMovementDiscard(trackedMovement, {
					warnLabel: '[WATCHDOG] Invalid movement token',
					allowClaimedTerminalPath: trackedMovement.claimed,
					requireTracked: !trackedMovement.claimed,
				})
				continue
			}

			traces.advertising.warn?.('[WATCHDOG] Detached movement allocation', {
				goodType,
				provider: provider?.name,
				demander: demander?.name,
				movementRef: movementRef ? movementRefId(movementRef) : undefined,
				reasonType: reason.type,
			})

			this.queueDetachedAllocationCleanup(allocation as Commitment, {
				goodType,
				provider,
				demander,
				movementRef,
				reasonType: reason.type,
				silent: false,
			})
		}
	}

	public reconcileMovementBookkeeping(label = 'movement-bookkeeping'): void {
		this.reconcileMovementAllocationPairs(label)
		this.scanForDetachedMovementAllocations()
	}

	private isMovementSourceAllocationReason(reason: AllocationReasonInfo | undefined): boolean {
		if (!reason) return false
		if (reason.role === 'movement-source') return true
		return reason.type === 'convey.path'
	}

	private hasLiveMovementTargetAllocation(
		movementRef: MovementRef | undefined,
		trackedMovement: TrackedMovement | undefined
	): boolean {
		if (
			trackedMovement?.allocations?.target &&
			commitmentValid(trackedMovement.allocations.target)
		) {
			return true
		}
		if (!movementRef) return false
		const movementRefKey = movementRefId(movementRef)
		return findLiveAllocations((held) => {
			const reason = held.reason as AllocationReasonInfo | undefined
			return (
				reason?.role === 'movement-target' &&
				!!reason.movementRef &&
				movementRefId(reason.movementRef) === movementRefKey
			)
		}).some(({ allocation }) => commitmentValid(allocation as Commitment))
	}

	private pruneResolvedMovementAllocation(
		allocation: Commitment,
		reason: AllocationReasonInfo | undefined,
		label: string,
		trackedMovement?: TrackedMovement
	): boolean {
		if (commitmentValid(allocation)) return false
		traces.advertising.log?.(`${label} Dropping resolved movement allocation`, {
			goodType: reason?.goodType,
			provider: (reason?.providerRef ?? reason?.provider ?? reason?.movement?.provider)?.name,
			demander: (reason?.demanderRef ?? reason?.demander ?? reason?.movement?.demander)?.name,
			movementRef: reason?.movementRef ? movementRefId(reason.movementRef) : undefined,
			reasonType: reason?.type,
			role: reason?.role,
			ended: allocation.ended,
			allocation: this.movementAllocationLabel(allocation),
			movementContext: trackedMovement
				? this.movementMineContext(trackedMovement)
				: 'no-tracked-movement',
		})
		untrackAllocation(allocation)
		return true
	}

	public bindMovementSourceToTransitStorage(
		movement: TrackedMovement,
		storage: Storage,
		label: string
	): boolean {
		const sourceCommitment = new Commitment(`convey.path.${movement.goodType}`)
		const sourceReason: AllocationReasonInfo = {
			type: 'convey.path',
			role: 'movement-source',
			goodType: movement.goodType,
			movementRef: movement.ref,
			providerRef: movement.provider,
			demanderRef: movement.demander,
			providerName: movement.provider.name,
			demanderName: movement.demander.name,
			movement,
		}
		;(sourceCommitment as { reason?: AllocationReasonInfo }).reason = sourceReason
		trackAllocation(sourceCommitment, sourceReason)
		sourceCommitment.onFinal(() => untrackAllocation(sourceCommitment))
		const reserveResult = storage.reserve({ [movement.goodType]: 1 }, sourceCommitment)
		if (reserveResult !== undefined) {
			sourceCommitment.cancel(`${label}.reserve-failed`)
			traces.advertising.warn?.(`[${label}] Failed to reserve transit source`, {
				goodType: movement.goodType,
				movementRef: movementRefId(movement.ref),
				from: axial.key(movement.from),
				reason: reserveResult,
			})
			return false
		}
		const previousSource = movement.allocations.source
		this.assignMovementSource(movement, sourceCommitment, label)
		if (previousSource && previousSource !== sourceCommitment && commitmentValid(previousSource)) {
			try {
				previousSource.fulfill()
			} catch {
				try {
					previousSource.cancel(`${label}.old-source-cancel`)
				} catch {}
			}
		}
		return true
	}

	public reconcileMovementAllocationPairs(label = 'movement-pair-invariant'): void {
		if (this.destroyed || this.reconstructing) return
		for (const { held, allocation } of findLiveAllocations((candidate) => {
			const reason = candidate.reason as AllocationReasonInfo | undefined
			if (!reason) return false
			if (
				reason.type !== 'hive-transfer' &&
				reason.type !== 'convey.path' &&
				reason.type !== 'convey.hop'
			)
				return false
			return this.isMovementSourceAllocationReason(reason)
		})) {
			const reason = held.reason as AllocationReasonInfo | undefined
			if (!reason?.goodType) continue
			const provider = reason.providerRef ?? reason.provider ?? reason.movement?.provider
			const demander = reason.demanderRef ?? reason.demander ?? reason.movement?.demander
			if (!this.movementRefsBelongToThisHive(provider, demander)) continue
			const movementRef = reason.movementRef ?? reason.movement?.ref
			const trackedMovement = movementRef ? this.activeMovementByRef(movementRef) : undefined
			if (
				this.pruneResolvedMovementAllocation(
					allocation as Commitment,
					reason,
					`[${label}]`,
					trackedMovement
				)
			) {
				continue
			}
			if (this.hasLiveMovementTargetAllocation(movementRef, trackedMovement)) continue

			const invariantLabel = '[WATCHDOG] Movement source reservation without target allocation'
			traces.advertising.warn?.(invariantLabel, {
				label,
				goodType: reason.goodType,
				provider: provider?.name,
				demander: demander?.name,
				movementRef: movementRef ? movementRefId(movementRef) : undefined,
				reasonType: reason.type,
			})
			if (trackedMovement) {
				this.throwMovementInvariantFailure(
					trackedMovement,
					'source-without-target-allocation',
					invariantLabel
				)
			}
			this.queueDetachedAllocationCleanup(allocation as Commitment, {
				goodType: reason.goodType,
				provider,
				demander,
				movementRef,
				reasonType: reason.type,
				silent: false,
			})
		}
	}

	private repairBorderTransitStorageReservations(label: string) {
		for (const gate of this.gates) {
			const coord = toAxialCoord(gate.border.position)
			if (!coord) continue
			for (const goodType of Object.keys(gate.storage.stock) as GoodType[]) {
				while (gate.storage.available(goodType) > 0) {
					const trackedCandidates = this.movingGoods.get(coord) ?? []
					const untrackedCandidates = Array.from(this.activeMovements).filter(
						(candidate) =>
							axial.key(candidate.from) === axial.key(coord) &&
							!this.trackedMovementCoord(candidate)
					)
					const movement = [...trackedCandidates, ...untrackedCandidates].find(
						(candidate) =>
							candidate.goodType === goodType &&
							candidate.path.length > 0 &&
							!candidate.claimed &&
							this.isMovementAlive(candidate)
					)
					if (!movement) {
						gate.storage.removeGood(goodType, 1)
						this.board.looseGoods.add(gate.border.tile.a ?? gate.border.tile.b, goodType)
						traces.advertising.warn?.(`[${label}] Offloaded orphan border transit stock`, {
							goodType,
							border: axial.key(coord),
						})
						continue
					}
					if (
						!this.bindMovementSourceToTransitStorage(
							movement,
							gate.storage,
							`${label}.repair-border-reservation`
						)
					) {
						break
					}
					if (!this.trackedMovementCoord(movement)) movement.place()
				}
			}
		}
	}

	public assertBorderTransitStorageInvariant(label = '[WATCHDOG]') {
		if (this.destroyed || this.reconstructing) return
		this.repairBorderTransitStorageReservations(label)
		for (const gate of this.gates) {
			const coord = toAxialCoord(gate.border.position)
			if (!coord) continue
			for (const [goodType, quantity] of Object.entries(gate.storage.stock) as [
				GoodType,
				number,
			][]) {
				if (!quantity || quantity <= 0) continue
				const available = gate.storage.available(goodType)
				if (available <= 0) continue
				const invariantLabel = `${label} Border transit stock without movement reservation`
				const trackedMovements = (this.movingGoods.get(coord) ?? []).map((movement) => ({
					goodType: movement.goodType,
					from: axial.key(movement.from),
					pathLength: movement.path.length,
					claimed: movement.claimed,
					sourceValid:
						!!movement.allocations?.source && commitmentValid(movement.allocations.source),
					targetValid:
						!!movement.allocations?.target && commitmentValid(movement.allocations.target),
				}))
				const activeAtBorder = Array.from(this.activeMovements)
					.filter((movement) => axial.key(movement.from) === axial.key(coord))
					.map((movement) => ({
						goodType: movement.goodType,
						trackedAt: this.trackedMovementCoord(movement)
							? axial.key(this.trackedMovementCoord(movement)!)
							: undefined,
						pathLength: movement.path.length,
						claimed: movement.claimed,
						sourceValid:
							!!movement.allocations?.source && commitmentValid(movement.allocations.source),
						targetValid:
							!!movement.allocations?.target && commitmentValid(movement.allocations.target),
					}))
				traces.advertising.warn?.(invariantLabel, {
					goodType,
					quantity,
					available,
					border: axial.key(coord),
					trackedMovements,
					activeAtBorder,
				})
				throw new Error(
					`${invariantLabel}: ${goodType} available=${available} border=${axial.key(coord)} tracked=${JSON.stringify(trackedMovements)} activeAtBorder=${JSON.stringify(activeAtBorder)}`
				)
			}
		}
	}

	private scanBorderTransitStorageInvariant() {
		this.assertBorderTransitStorageInvariant('[WATCHDOG]')
	}

	private isGeneralStorageAlveolus(alveolus: Alveolus): alveolus is StorageAlveolus {
		return isLogisticsStorageAlveolusAction(alveolus.action?.type)
	}

	private movementRefsBelongToThisHive(
		provider?: FreightMovementParty,
		demander?: FreightMovementParty
	): boolean {
		if (provider && isVehicleFreightDock(provider)) return provider.hive === this
		if (provider?.hive === this) return true
		if (demander && isVehicleFreightDock(demander)) return demander.hive === this
		return demander?.hive === this
	}

	private shouldAllowWatchdogExchange(
		provider: FreightMovementParty,
		demander: FreightMovementParty,
		goodType: GoodType,
		providePriority: ExchangePriority,
		demandPriority: ExchangePriority
	): boolean {
		if (provider === demander) return false
		const providerCanGiveNow = provider.canGive(goodType, providePriority)
		const providerHasLatentStock = (provider.storage.stock[goodType] ?? 0) > 0
		const providerIsDemandOnly = isVehicleFreightDock(provider)
			? dockedVehicleGoodsRelations(provider.vehicle, provider.bay)[goodType]?.advertisement ===
				'demand'
			: (provider as Partial<StorageAlveolus>).workingGoodsRelations?.[goodType]?.advertisement ===
					'demand' || (provider as Alveolus).goodsRelations?.[goodType]?.advertisement === 'demand'
		if (!providerCanGiveNow && (!providerHasLatentStock || !!providerIsDemandOnly)) return false
		if (
			!demander.canTake(goodType, demandPriority) &&
			this.pendingAllocatedQuantity(demander.storage, goodType) <= 0
		) {
			return false
		}
		if (
			!isVehicleFreightDock(provider) &&
			!isVehicleFreightDock(demander) &&
			this.isGeneralStorageAlveolus(provider as Alveolus) &&
			this.isGeneralStorageAlveolus(demander as Alveolus) &&
			demandPriority !== '1-buffer'
		) {
			return false
		}
		return true
	}

	private movementProvidePriority(
		provider: FreightMovementParty,
		goodType: GoodType
	): ExchangePriority | undefined {
		const canGive =
			'canGive' in provider && typeof provider.canGive === 'function'
				? provider.canGive.bind(provider)
				: undefined
		const advertised = isVehicleFreightDock(provider)
			? dockedVehicleGoodsRelations(provider.vehicle, provider.bay)[goodType]?.priority
			: (provider as Alveolus).goodsRelations?.[goodType]?.priority
		if (advertised && (!canGive || canGive(goodType, advertised))) return advertised
		for (const priority of ['2-use', '1-buffer', '0-store'] as const) {
			if (canGive?.(goodType, priority)) return priority
		}
		return undefined
	}

	private movementIdentityMatches(candidate: TrackedMovement, movement: TrackedMovement): boolean {
		return (
			!!candidate &&
			(candidate.ref === movement.ref ||
				movementRefId(candidate.ref) === movementRefId(movement.ref))
		)
	}

	private isMovementRefreshSuspended(movement: Partial<TrackedMovement>): boolean {
		return movement.refreshState === 'suspended-refresh'
	}

	private activeMovementRefs(): Set<number> {
		const refs = new Set<number>()
		for (const movement of this.activeMovements) {
			if (movement._state === MovementState.delivering) {
				refs.add(movementRefId(movement.ref))
				continue
			}
			if (!movement.claimed && !this.trackedMovementCoord(movement)) continue
			refs.add(movementRefId(movement.ref))
		}
		for (const goods of this.movingGoods.values()) {
			for (const movement of goods) {
				refs.add(movementRefId(movement.ref))
			}
		}
		return refs
	}

	private trackedMovementCoord(movement: TrackedMovement): AxialCoord | undefined {
		for (const coord of this.movingGoods.coords()) {
			const goods = this.movingGoods.get(coord)
			if (goods?.some((candidate) => this.movementIdentityMatches(candidate, movement))) {
				return coord
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
		this.activeMovements.add(movement)
		this.ensureMovementTrackedAt(movement, preferredCoord)
		traces.advertising.warn?.('[WATCHDOG] Collapsed duplicate movement tracking', {
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
			!commitmentValid(movement.allocations.source) &&
			!allowClaimedSourceGap &&
			!allowFulfilledSourceAllocation &&
			!allowTerminalSourceGap
		) {
			return 'invalid-source-allocation'
		}
		if (!commitmentValid(movement.allocations.target)) return 'invalid-target-allocation'
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

	private movementAllocationLabel(allocation: Commitment | undefined) {
		if (!allocation) return 'missing'
		const reason = (allocation as Commitment & { reason?: AllocationReasonInfo }).reason
		const ended = allocation.ended
		const endedLabel =
			ended === undefined
				? 'not-begun'
				: ended === false
					? 'begun'
					: ended === true
						? 'fulfilled'
						: `cancelled:${ended}`
		const refs = allocationReasonMovementRefs(reason)
		const refLabel = refs.length
			? refs.map((ref) => `ref#${movementRefId(ref)}`).join(',')
			: 'no-ref'
		return `${commitmentValid(allocation) ? 'valid' : 'invalid'}:${reason?.type ?? 'unknown'}:${refLabel}:${endedLabel}`
	}

	private movementAllocationReason(allocation: Commitment | undefined) {
		return (allocation as (Commitment & { reason?: AllocationReasonInfo }) | undefined)?.reason
	}

	private assertMovementAllocationOwnership(movement: TrackedMovement, label: string) {
		const sourceReason = this.movementAllocationReason(movement.allocations.source)
		if (movement.allocations.source) {
			assert(
				!!sourceReason,
				`${label}: source allocation reason missing; ${this.movementMineContext(movement)}`
			)
			assert(
				allocationReasonHasMovement(sourceReason, movement),
				`${label}: source allocation movementRef mismatch; ${this.movementMineContext(movement)}`
			)
			for (const sourceMovement of allocationReasonMovements(sourceReason)) {
				if (movementRefId(sourceMovement.ref) !== movementRefId(movement.ref)) continue
				assert(
					this.movementIdentityMatches(sourceMovement, movement),
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
			!!targetReason.movementRef &&
				movementRefId(targetReason.movementRef) === movementRefId(movement.ref),
			`${label}: target allocation movementRef mismatch; ${this.movementMineContext(movement)}`
		)
		if (targetReason.movement) {
			assert(
				this.movementIdentityMatches(targetReason.movement, movement),
				`${label}: target allocation movement ref mismatch; ${this.movementMineContext(movement)}`
			)
		}
	}

	private movementMineContext(movement: TrackedMovement) {
		const debug = movement._debug
		const sourceTrail = debug?.sourceTrail?.join(' => ') ?? 'none'
		const lifecycleTrail = debug?.lifecycleTrail?.join(' => ') ?? 'none'
		return `ref#${movementRefId(movement.ref)} from=${axial.key(movement.from)} source=${this.movementAllocationLabel(movement.allocations.source)} target=${this.movementAllocationLabel(movement.allocations.target)} sourceTrail=[${sourceTrail}] lifecycleTrail=[${lifecycleTrail}] cleanupBy=${debug?.lastCleanupBy ?? 'none'} caughtError=${debug?.lastCaughtError ?? 'none'}`
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

	private movementInvariantMessage(
		movement: TrackedMovement,
		failure: MovementInvariantFailure,
		label: string
	): string {
		return `${label}: ${failure}; ${this.movementMineContext(movement)}`
	}

	private throwMovementInvariantFailure(
		movement: TrackedMovement,
		failure: MovementInvariantFailure,
		label: string
	): never {
		throw new MovementInvariantError(
			movement,
			failure,
			this.movementInvariantMessage(movement, failure, label)
		)
	}

	private handleStructuralMovementTeardown(
		movement: TrackedMovement,
		failure: MovementInvariantFailure
	): boolean {
		if (!this.isStructuralMovementTeardownFailure(failure)) return false
		this.silentlyDiscardMovement(movement)
		return true
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

	assignMovementSource(movement: TrackedMovement, source: Commitment, label: string) {
		movement.allocations.source = source
		this.pushMovementDebugEntry(
			movement,
			'sourceTrail',
			`assign:${label}:${this.movementAllocationLabel(source)}@${Date.now()}`
		)
	}

	bindMovementsSourceToHopStep(
		movements: readonly TrackedMovement[],
		sourceCommitment: Commitment,
		label: string
	) {
		assert(movements.length > 0, `${label}: no movements to bind to hop step`)
		const first = movements[0]!
		const sameGoodType = movements.every((movement) => movement.goodType === first.goodType)
		const sourceReason: AllocationReasonInfo = {
			type: 'convey.hop',
			role: 'movement-source',
			goodType: sameGoodType ? first.goodType : undefined,
			movementRef: first.ref,
			movementRefs: movements.map((movement) => movement.ref),
			providerRef: first.provider,
			demanderRef: first.demander,
			providerName: first.provider.name,
			demanderName: first.demander.name,
			movement: first,
			movements: [...movements],
		}
		;(sourceCommitment as { reason?: AllocationReasonInfo }).reason = sourceReason
		trackAllocation(sourceCommitment, sourceReason)
		sourceCommitment.onFinal(() => untrackAllocation(sourceCommitment))
		for (const movement of movements) {
			this.replaceMovementSourceAndFulfillPrevious(movement, sourceCommitment, label)
		}
	}

	replaceMovementSourceAndFulfillPrevious(
		movement: TrackedMovement,
		source: Commitment,
		label: string
	) {
		const previousSource = movement.allocations.source
		this.assignMovementSource(movement, source, label)
		if (previousSource && previousSource !== source && commitmentValid(previousSource)) {
			this.pushMovementDebugEntry(
				movement,
				'sourceTrail',
				`fulfill-previous:before:${label}:${this.movementAllocationLabel(previousSource)}@${Date.now()}`
			)
			previousSource.fulfill()
			this.pushMovementDebugEntry(
				movement,
				'sourceTrail',
				`fulfill-previous:after:${label}:${this.movementAllocationLabel(previousSource)}@${Date.now()}`
			)
		}
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
		source?.cancel('movement.source-cancel')
		this.pushMovementDebugEntry(
			movement,
			'sourceTrail',
			`cancel:after:${label}:${this.movementAllocationLabel(movement.allocations.source)}@${Date.now()}`
		)
	}

	/**
	 * Canonical in-flight movement for the same {@link TrackedMovement.ref}, if the hive still tracks it.
	 * After a topology refresh that falls through to `rebindMovementSnapshot`,
	 * a stale object reference may still share `ref` but differ by identity.
	 */
	getCanonicalMovement(movement: TrackedMovement): TrackedMovement | undefined {
		if (this.activeMovements.has(movement)) return movement
		return this.activeMovementByRef(movement.ref)
	}

	/**
	 * Returns true when this hive still owns the exact object reference.
	 * After a topology refresh that falls through to `rebindMovementSnapshot`,
	 * the old movement becomes a zombie: same `ref`, different object.
	 */
	isMovementAlive(movement: TrackedMovement): boolean {
		return this.getCanonicalMovement(movement) === movement
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
		const failure = this.validateMovementInvariant(movement, validateOpts)
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
				commitmentValid(source),
				`${label}: source allocation invalid; ${this.movementMineContext(movement)}`
			)
		}
		if (requireTargetValid) {
			const target = movement.allocations.target
			assert(target, `${label}: target allocation missing; ${this.movementMineContext(movement)}`)
			assert(
				commitmentValid(target),
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
		const canonical = this.getCanonicalMovement(movement) ?? movement
		const failure = this.validateMovementInvariant(canonical, options)
		if (!failure) return true
		if (this.handleStructuralMovementTeardown(canonical, failure)) return false
		this.throwMovementInvariantFailure(
			canonical,
			failure,
			options.warnLabel ?? '[WATCHDOG] Invalid movement token'
		)
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
		const canonical = this.getCanonicalMovement(movement) ?? movement
		if (isTerminalState(canonical._state)) return false
		const failure = this.validateMovementInvariant(canonical, options)
		if (!failure) return true
		traces.convey.log?.(
			`[QUEUE-DISCARD] ${canonical.goodType} failure=${failure} from=${axial.key(canonical.from)} pathLen=${canonical.path.length} state=${canonical._state}`
		)
		if (this.handleStructuralMovementTeardown(canonical, failure)) return false
		const discardId =
			canonical.ref ??
			`${canonical.provider.name}:${canonical.demander.name}:${canonical.goodType}:${axial.key(canonical.from)}`
		if (this.pendingBrokenMovementDiscardIds.has(discardId)) return false
		this.pendingBrokenMovementDiscardIds.add(discardId)
		if (this.shouldDelayBrokenMovementDiscard(canonical, failure, options)) {
			this.postStep(() => {
				this.pendingBrokenMovementDiscardIds.delete(discardId)
				if (this.destroyed || this.reconstructing) return
				const retry = this.getCanonicalMovement(movement) ?? movement
				const retriedFailure = this.validateMovementInvariant(retry, options)
				if (!retriedFailure) return
				if (this.handleStructuralMovementTeardown(retry, retriedFailure)) return
				this.throwMovementInvariantFailure(
					retry,
					retriedFailure,
					options.warnLabel ?? '[WATCHDOG] Invalid movement token'
				)
			})
			return false
		}
		this.pendingBrokenMovementDiscardIds.delete(discardId)
		this.throwMovementInvariantFailure(
			canonical,
			failure,
			options.warnLabel ?? '[WATCHDOG] Invalid movement token'
		)
	}

	isSelectableMovement(
		movement: TrackedMovement,
		expectedFrom: AxialCoord,
		label: string
	): boolean {
		if (this.destroyed || this.reconstructing) return false
		const canonical = this.getCanonicalMovement(movement) ?? movement
		const failure = this.validateMovementInvariant(canonical, {
			expectedFrom,
			requireTracked: true,
		})
		if (!failure) return true
		traces.convey.warn?.(
			`${label}: skipped ${canonical.goodType} ref#${movementRefId(canonical.ref)}`,
			{
				failure,
				expectedFrom: axial.key(expectedFrom),
				context: this.movementMineContext(canonical),
			}
		)
		return false
	}

	hasIncomingMovementFor(alveolus: Alveolus): boolean {
		const here = toAxialCoord(alveolus.tile.position)!
		const surroundingBorderKeys = new Set(
			alveolus.tile.surroundings.map(({ border }) => axial.key(toAxialCoord(border.position)!))
		)
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
				if (!isTileCoord(nextStep) && surroundingBorderKeys.has(axial.key(nextStep))) return true
			}
		}
		return false
	}

	cancelOrphanedExchangeAllocations(
		provider: Alveolus,
		demander: Alveolus,
		goodType: GoodType
	): number {
		if (this.hasActiveMovement(provider, demander, goodType)) return 0
		let canceled = 0
		const providerCoord = toAxialCoord(provider.tile.position)
		const demanderCoord = toAxialCoord(demander.tile.position)
		for (const movement of Array.from(this.activeMovements)) {
			if (movement.goodType !== goodType) continue
			if (movement.claimed || this.trackedMovementCoord(movement)) continue
			if (axial.key(toAxialCoord(movement.provider.tile.position)) !== axial.key(providerCoord))
				continue
			if (axial.key(toAxialCoord(movement.demander.tile.position)) !== axial.key(demanderCoord))
				continue
			try {
				movement.allocations.source?.cancel('orphaned-active.source')
				movement.allocations.target?.cancel('orphaned-active.target')
				canceled += 1
			} catch (error) {
				traces.allocations.warn?.('[WATCHDOG] Failed to cancel orphaned active movement', {
					goodType,
					provider: provider.name,
					demander: demander.name,
					error: error instanceof Error ? error.message : String(error),
				})
			}
			this.activeMovements.delete(movement)
		}
		const activeRefs = this.activeMovementRefs()
		const matches = findLiveAllocations((held) => {
			const reason = held.reason as
				| {
						type?: string
						goodType?: GoodType
						movementRef?: MovementRef
						provider?: Alveolus
						demander?: Alveolus
						providerRef?: Alveolus
						demanderRef?: Alveolus
						providerName?: string
						demanderName?: string
						movement?: {
							ref?: MovementRef
							provider?: { name?: string }
							demander?: { name?: string }
							goodType?: GoodType
						}
				  }
				| undefined
			if (!reason) return false
			if (
				reason.type !== 'hive-transfer' &&
				reason.type !== 'convey.path' &&
				reason.type !== 'convey.hop'
			)
				return false
			const reasonGoodType = reason.goodType ?? reason.movement?.goodType
			if (reasonGoodType !== goodType) return false
			const movementRef = reason.movementRef ?? reason.movement?.ref
			if (movementRef && activeRefs.has(movementRefId(movementRef))) return false
			const reasonProviderRef = reason.providerRef ?? reason.provider ?? reason.movement?.provider
			const reasonDemanderRef = reason.demanderRef ?? reason.demander ?? reason.movement?.demander
			const reasonProviderName = reason.providerName ?? reason.movement?.provider?.name
			const reasonDemanderName = reason.demanderName ?? reason.movement?.demander?.name
			const partyMatches = (
				reasonRef: { name?: string; tile?: Tile } | undefined,
				reasonName: string | undefined,
				expected: Alveolus
			) => {
				if (reasonRef === expected || unwrap(reasonRef) === unwrap(expected)) return true
				const reasonCoord = reasonRef?.tile ? toAxialCoord(reasonRef.tile.position) : undefined
				const expectedCoord = toAxialCoord(expected.tile.position)
				if (reasonCoord && expectedCoord && axial.key(reasonCoord) === axial.key(expectedCoord)) {
					return true
				}
				return !!reasonName && reasonName === expected.name
			}
			const providerMatches = partyMatches(reasonProviderRef, reasonProviderName, provider)
			const demanderMatches = partyMatches(reasonDemanderRef, reasonDemanderName, demander)
			return providerMatches && demanderMatches
		})
		for (const { allocation } of matches) {
			const token = allocation as Commitment
			if (!commitmentValid(token)) continue
			try {
				token.cancel('orphaned-allocation')
				canceled += 1
			} catch (error) {
				traces.allocations.warn?.('[WATCHDOG] Failed to cancel orphaned allocation', {
					goodType,
					provider: provider.name,
					demander: demander.name,
					error: error instanceof Error ? error.message : String(error),
				})
			}
		}
		if (canceled > 0) {
			traces.advertising.warn?.('[WATCHDOG] Cancelled orphaned exchange allocations', {
				goodType,
				provider: provider.name,
				demander: demander.name,
				canceled,
			})
		}
		return canceled
	}

	cancelOrphanedFreightVehicleDockAllocations(dock: VehicleFreightDock): number {
		const activeRefs = this.activeMovementRefs()
		const matches = findLiveAllocations((held) => {
			const reason = held.reason as
				| {
						type?: string
						movementRef?: MovementRef
						provider?: FreightMovementParty
						demander?: FreightMovementParty
						providerRef?: FreightMovementParty
						demanderRef?: FreightMovementParty
						providerName?: string
						demanderName?: string
						movement?: {
							ref?: MovementRef
							provider?: { name?: string }
							demander?: { name?: string }
						}
				  }
				| undefined
			if (!reason) return false
			if (
				reason.type !== 'hive-transfer' &&
				reason.type !== 'convey.path' &&
				reason.type !== 'convey.hop'
			) {
				return false
			}
			const movementRef = reason.movementRef ?? reason.movement?.ref
			if (movementRef && activeRefs.has(movementRefId(movementRef))) return false
			const matchesDock = (
				ref: { name?: string } | undefined,
				name: string | undefined
			): boolean => ref === dock || unwrap(ref) === unwrap(dock) || name === dock.name
			return (
				matchesDock(
					reason.providerRef ?? reason.provider ?? reason.movement?.provider,
					reason.providerName ?? reason.movement?.provider?.name
				) ||
				matchesDock(
					reason.demanderRef ?? reason.demander ?? reason.movement?.demander,
					reason.demanderName ?? reason.movement?.demander?.name
				)
			)
		})
		let canceled = 0
		for (const { allocation } of matches) {
			const token = allocation as Commitment
			if (!commitmentValid(token)) continue
			try {
				token.cancel('orphaned-dock-allocation')
				canceled += 1
			} catch (error) {
				traces.allocations.warn?.('[WATCHDOG] Failed to cancel orphaned dock allocation', {
					dock: dock.name,
					error: error instanceof Error ? error.message : String(error),
				})
			}
		}
		if (canceled > 0) {
			traces.advertising.log?.('[WATCHDOG] Cancelled orphaned dock allocations', {
				dock: dock.name,
				canceled,
			})
		}
		return canceled
	}

	scanForStuckClaimedMovements(now: number, settleMs: number) {
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

				const claimedAt = mg.claimedAtMs ?? now
				const claimer = mg.claimedBy
				const claimerActionDescription = claimer ? claimer.actionDescription : []
				const claimerStillBusy =
					!!claimer && (!!claimer.stepExecutor || claimer.runningScripts.length > 0)
				const claimerLikelyOwnsMovement =
					claimerStillBusy &&
					(claimerActionDescription.includes('work.conveyStep') ||
						claimerActionDescription.includes('work.goWork') ||
						freightPartyMatchesAssignedAlveolus(mg.provider, claimer.assignedAlveolus) ||
						freightPartyMatchesAssignedAlveolus(mg.demander, claimer.assignedAlveolus))

				// During an active convey.path hop, pickup fulfills the source before animation
				// finish rebinds it. Only release that gap once no live worker appears to own it.
				if (!mg.allocations?.source) {
					if (claimerLikelyOwnsMovement || now - claimedAt < settleMs) continue
					traces.advertising.warn?.('[WATCHDOG] Releasing invalid claimed movement', {
						goodType: mg.goodType,
						provider: mg.provider.name,
						demander: mg.demander.name,
						reason: 'missing-source-allocation',
					})
					mg.claimed = false
					delete mg.claimedBy
					delete mg.claimedAtMs
					this.invalidateAdvertisements([mg.provider, mg.demander], 'audit.cleanup')
					this.wakeWanderingWorkersNear(mg.provider, mg.demander)
					continue
				}

				if (now - claimedAt < settleMs) continue

				// Claimed long enough and no active conveyor looks responsible: release the claim.
				if (!claimerLikelyOwnsMovement) {
					traces.advertising.warn?.('[WATCHDOG] Releasing stale claimed movement', {
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
					this.invalidateAdvertisements([mg.provider, mg.demander], 'audit.cleanup')
					this.wakeWanderingWorkersNear(mg.provider, mg.demander)
				}
			}
		}
	}

	private movementProviderName(mg: Partial<TrackedMovement>): string {
		return mg.provider?.name ?? 'unknown-provider'
	}

	private installMovementRuntimeMethods(movement: TrackedMovement) {
		movement.prepareHop = function (this: TrackedMovement) {
			assert(
				this.path.length > 0,
				`movement.prepareHop: empty path for ref#${movementRefId(this.ref)}`
			)
			return this.path[0]
		}

		movement.commitHop = function (this: TrackedMovement) {
			const hive = this.provider.hive
			assert(hive, `movement.commitHop: provider hive missing for ref#${movementRefId(this.ref)}`)
			assert(
				this.demander.hive === hive,
				`movement.commitHop: provider/demander hive mismatch for ref#${movementRefId(this.ref)}`
			)
			const nextCoord = this.path.shift()!
			hive.removeMovementFromCoordTracking(this)
			this.from = nextCoord
			hive.noteMovementStorageCheckpoint(this, 'movement.hop.after.storage', nextCoord)
			hive.noteMovementLifecycle(this, `movement.hop.after:${axial.key(nextCoord)}`)
			hive.invalidateConveyPlanning('movement.hop')
			hive.invalidateAdvertisements([this.provider, this.demander], 'movement.lifecycle')
			traces.convey.log?.(
				`[HOP] ${this.goodType} ${this.provider.name} -> ${this.demander.name} to ${nextCoord.q},${nextCoord.r} (path left: ${this.path.length})`
			)
		}

		movement.hop = function (this: TrackedMovement) {
			const hive = this.provider.hive
			assert(hive, `movement.hop.before: provider hive missing for ref#${movementRefId(this.ref)}`)
			assert(
				this.demander.hive === hive,
				`movement.hop.before: provider/demander hive mismatch for ref#${movementRefId(this.ref)}`
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
			this.commitHop()
			return this.from
		}

		movement.place = function (this: TrackedMovement) {
			const hive = this.provider.hive
			assert(
				hive,
				`movement.place.before: provider hive missing for ref#${movementRefId(this.ref)}`
			)
			assert(
				this.demander.hive === hive,
				`movement.place.before: provider/demander hive mismatch for ref#${movementRefId(this.ref)}`
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
			traces.advertising.log?.(`[MOVEMENT] PLACE: ${this.goodType} placed at ${here.q},${here.r}`)
		}

		movement.finish = function (this: TrackedMovement) {
			const hive = this.provider.hive
			assert(
				hive,
				`movement.finish.before: provider hive missing for ref#${movementRefId(this.ref)}`
			)
			assert(
				this.demander.hive === hive,
				`movement.finish.before: provider/demander hive mismatch for ref#${movementRefId(this.ref)}`
			)
			const prior = this._state
			this._state =
				prior === MovementState.tracked
					? MovementState.delivering
					: transitionMovement(prior, MovementState.delivering)
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
			traces.allocations.log?.(
				`[MOVEMENT] FINISH: ${this.goodType} ${this.provider.name} -> ${this.demander.name}`,
				{
					movementRef: movementRefId(this.ref),
					goodType: this.goodType,
					provider: this.provider.name,
					demander: this.demander.name,
				}
			)
			this.claimed = false
			delete this.claimedBy
			delete this.claimedAtMs
			hive.removeMovementFromCoordTracking(this)
			hive.noteMovementLifecycle(this, 'movement.finish.remove-tracking.after')

			traces.allocations.log?.(`[MOVEMENT] SOURCE AUTO-FULFILL: ${this.goodType}`, {
				movementRef: movementRefId(this.ref),
				goodType: this.goodType,
				provider: this.provider.name,
				demander: this.demander.name,
			})
			try {
				hive.noteMovementLifecycle(this, 'movement.finish.source-fulfill.before')
				this.allocations.source?.fulfill()
				hive.noteMovementLifecycle(this, 'movement.finish.source-fulfill.after')
			} catch (sourceError) {
				traces.allocations.error?.(`[MOVEMENT] SOURCE FULFILL FAILED: ${this.goodType}`, {
					movementRef: movementRefId(this.ref),
					goodType: this.goodType,
					provider: this.provider.name,
					demander: this.demander.name,
					error: sourceError instanceof Error ? sourceError.message : String(sourceError),
				})
				try {
					hive.noteMovementLifecycle(
						this,
						'movement.finish.source-cancel.after-failed-fulfill.before'
					)
					this.allocations.source?.cancel('finish.source-cancel')
					hive.noteMovementLifecycle(
						this,
						'movement.finish.source-cancel.after-failed-fulfill.after'
					)
				} catch (cancelError) {
					traces.allocations.error?.(
						`[MOVEMENT] SOURCE CANCEL AFTER FAILED FULFILL FAILED: ${this.goodType}`,
						{
							movementRef: movementRefId(this.ref),
							goodType: this.goodType,
							provider: this.provider.name,
							demander: this.demander.name,
							error: cancelError instanceof Error ? cancelError.message : String(cancelError),
						}
					)
				}
			}

			try {
				hive.noteMovementLifecycle(this, 'movement.finish.target-fulfill.before')
				this.allocations.target.fulfill()
				hive.noteMovementLifecycle(this, 'movement.finish.target-fulfill.after')
				traces.allocations.log?.(`[MOVEMENT] TARGET FULFILLED: ${this.goodType}`, {
					movementRef: movementRefId(this.ref),
					goodType: this.goodType,
					provider: this.provider.name,
					demander: this.demander.name,
				})
			} catch (error) {
				traces.allocations.error?.(`[MOVEMENT] TARGET FULFILL FAILED: ${this.goodType}`, {
					movementRef: movementRefId(this.ref),
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
					this.allocations.target.cancel('finish.target-cancel')
					hive.noteMovementLifecycle(
						this,
						'movement.finish.target-cancel.after-failed-fulfill.after'
					)
				} catch (cancelError) {
					traces.allocations.error?.(
						`[MOVEMENT] TARGET CANCEL AFTER FAILED FULFILL FAILED: ${this.goodType}`,
						{
							movementRef: movementRefId(this.ref),
							goodType: this.goodType,
							provider: this.provider.name,
							demander: this.demander.name,
							error: cancelError instanceof Error ? cancelError.message : String(cancelError),
						}
					)
				}
			}

			hive.invalidateAdvertisements([this.provider, this.demander], 'movement.lifecycle')
			hive.noteMovementLifecycle(this, 'movement.finish.after')
			this._state = transitionMovement(this._state, MovementState.completed)
			hive.activeMovements.delete(this)
			hive.invalidateConveyPlanning('movement.finish')
			traces.convey.log?.(
				`[FINISH] ${this.goodType} ${this.provider.name} -> ${this.demander.name}`
			)
		}

		movement.abort = function (this: TrackedMovement) {
			this._state = transitionMovement(this._state, MovementState.aborted)
			traces.convey.log?.(
				`[ABORT] ${this.goodType} ${this.provider.name} -> ${this.demander.name} from=${axial.key(this.from)}`
			)
			const hive = this.provider.hive
			assert(
				hive,
				`movement.abort.before: provider hive missing for ref#${movementRefId(this.ref)}`
			)
			assert(
				this.demander.hive === hive,
				`movement.abort.before: provider/demander hive mismatch for ref#${movementRefId(this.ref)}`
			)
			hive.noteMovementLifecycle(this, 'movement.abort.before')
			this.claimed = false
			delete this.claimedBy
			delete this.claimedAtMs
			hive.forgetMovementTracking(this)
			hive.noteMovementLifecycle(this, 'movement.abort.remove-tracking.after')
			hive.invalidateConveyPlanning('movement.abort')
			hive.invalidateAdvertisements([this.provider, this.demander], 'movement.lifecycle')
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

	private alveolusAt(coord: AxialCoord | undefined): Alveolus | undefined {
		if (!coord || !isTileCoord(coord)) return undefined
		const content = this.board.getTileContent(coord)
		return content instanceof Alveolus && !content.destroyed ? content : undefined
	}

	private snapshotReconstructionMovements(): PersistentMovementSnapshot[] {
		const snapshots: PersistentMovementSnapshot[] = []
		const seen = new Set<number>()
		for (const movement of this.activeMovements) {
			const movementId = movementRefId(movement.ref)
			if (seen.has(movementId)) continue
			seen.add(movementId)
			const trackedCoord = this.trackedMovementCoord(movement)
			const currentCoord = trackedCoord ?? movement.from
			snapshots.push({
				movementRef: movement.ref,
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
				claimedByUid: movement.claimedBy?.uid,
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
		traces.advertising.log?.('[RECONSTRUCT] Cancelled movement as free good', {
			goodType: snapshot.goodType,
			movementRef: movementRefId(snapshot.movementRef),
			coord: snapshot.currentCoord,
		})
		return false
	}

	private cancelSnapshotMovement(snapshot: PersistentMovementSnapshot) {
		const movement = snapshot.movement
		if (!movement) return
		snapshot.originHive.forgetMovementTracking(movement)
		try {
			movement.allocations?.source?.cancel('reconstruction.source')
		} catch {}
		try {
			movement.allocations?.target?.cancel('reconstruction.target')
		} catch {}
	}

	private resolveProviderForSnapshot(
		snapshot: PersistentMovementSnapshot,
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
					content instanceof Alveolus && !content.destroyed && content.hive === demander.hive
			)
			if (adjacent.length > 0) return adjacent[0]
		}
		return Array.from(demander.hive.alveoli).find((candidate) => !candidate.destroyed) ?? demander
	}

	private finalizeReconstructedMovements(snapshots: PersistentMovementSnapshot[]) {
		traces.advertising.log?.('[HIVE] Reorganisation finalize begin', {
			hive: this.name,
			snapshottedMovements: snapshots.length,
			movementRefs: snapshots.map((snapshot) => movementRefId(snapshot.movementRef)),
		})
		let recreated = 0
		let orphaned = 0
		for (const snapshot of snapshots) {
			this.cancelSnapshotMovement(snapshot)
			const demander = this.alveolusAt(snapshot.targetCoord)
			const provider = demander ? this.resolveProviderForSnapshot(snapshot, demander) : undefined
			if (provider && demander && !demander.destroyed && !provider.destroyed) {
				const ownerHive = provider.hive
				if (
					ownerHive &&
					ownerHive === demander.hive &&
					ownerHive.createMovement(snapshot.goodType, provider, demander)
				) {
					recreated += 1
					continue
				}
			}
			this.offloadCancelledMovementSnapshot(snapshot)
			orphaned += 1
		}
		traces.advertising.log?.('[HIVE] Reorganisation finalize end', {
			hive: this.name,
			snapshottedMovements: snapshots.length,
			recreated,
			orphaned,
		})
		for (const movement of this.activeMovements) {
			movement.refreshState = 'steady'
			movement._state = transitionMovement(movement._state, MovementState.tracked)
			if (!movement.claimed && !this.trackedMovementCoord(movement)) {
				this.ensureMovementTrackedAt(movement, movement.from)
			}
			this.ensureMovementInvariant(movement, {
				requireTracked: !movement.claimed,
				allowClaimedSourceGap: true,
				allowClaimedTerminalPath: true,
			})
		}
	}

	private ensureMovementTrackedAt(mg: TrackedMovement, coord: AxialCoord) {
		const current = this.movingGoods.get(coord) ?? []
		if (current.some((candidate) => this.movementIdentityMatches(candidate, mg))) {
			return
		}
		this.movingGoods.set(coord, [...current, mg])
		this.invalidateConveyPlanning('movement.track')
	}

	private replaceMovementTracking(mg: TrackedMovement, coord: AxialCoord) {
		this.forgetMovementTracking(mg)
		this.activeMovements.add(mg)
		const current = this.movingGoods.get(coord) ?? []
		this.movingGoods.set(coord, [...current, mg])
		this.invalidateConveyPlanning('movement.track')
	}

	private removeMovementFromCoordTracking(mg: TrackedMovement) {
		let removed = false
		for (const [coord, goods] of [...this.movingGoods.entries()]) {
			const kept = goods.filter(
				(candidate): candidate is TrackedMovement =>
					!!candidate && !this.movementIdentityMatches(candidate, mg)
			)
			if (kept.length !== goods.length) {
				removed = true
				if (kept.length === 0) this.movingGoods.delete(coord)
				else this.movingGoods.set(coord, kept)
			}
		}
		if (removed) this.invalidateConveyPlanning('movement.untrack')
	}

	private forgetMovementTracking(mg: TrackedMovement) {
		const wasActive = this.activeMovements.delete(mg)
		this.removeMovementFromCoordTracking(mg)
		if (wasActive) this.invalidateConveyPlanning('movement.forget')
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
		const sourceValid = !!sourceToken && commitmentValid(sourceToken)
		const targetValid = !!targetToken && commitmentValid(targetToken)

		if (sourceValid) {
			try {
				sourceToken.fulfill()
			} catch {
				try {
					sourceToken.cancel('offload.source')
				} catch {}
			}
		} else if (borderStorage) {
			try {
				borderStorage.removeGood(mg.goodType, 1)
			} catch {}
		}

		if (targetValid) {
			try {
				targetToken.cancel('offload.target')
			} catch {}
		}

		const tile = this.preferredBorderOffloadTile(mg, coord)
		this.board.looseGoods.add(tile, mg.goodType)

		let removedTracking = false
		for (const [movementCoord, goods] of this.movingGoods.entries()) {
			const kept = goods.filter(
				(candidate): candidate is TrackedMovement =>
					!!candidate && !this.movementIdentityMatches(candidate, mg)
			)
			if (kept.length !== goods.length) {
				removedTracking = true
				if (kept.length === 0) this.movingGoods.delete(movementCoord)
				else this.movingGoods.set(movementCoord, kept)
			}
		}
		if (removedTracking) this.invalidateConveyPlanning('movement.offload')
		mg.claimed = false
		delete mg.claimedBy
		delete mg.claimedAtMs
		this.invalidateConveyPlanning('movement.offload')
		this.invalidateAdvertisements([mg.provider, mg.demander], 'movement.lifecycle')
		this.wakeWanderingWorkersNear(mg.provider, mg.demander)
		traces.advertising.warn?.('[WATCHDOG] Offloaded broken border movement', {
			goodType: mg.goodType,
			provider: mg.provider.name,
			demander: mg.demander.name,
			coord,
		})
	}

	private silentlyDiscardMovement(mg: TrackedMovement) {
		this.forgetMovementTracking(mg)
		mg.claimed = false
		delete mg.claimedBy
		delete mg.claimedAtMs
		try {
			mg.allocations?.source?.cancel('silent-discard.source')
		} catch {}
		try {
			mg.allocations?.target?.cancel('silent-discard.target')
		} catch {}
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
		if (isTerminalState(mg._state)) return
		this.activeMovements.delete(mg)
		mg._state = transitionMovement(mg._state, MovementState.aborted)
		traces.convey.log?.(
			`[DISCARD] ${mg.goodType} ref#${movementRefId(mg.ref)} state=${mg._state} from=${axial.key(mg.from)} pathLen=${mg.path.length}`
		)
		const trackedCoord = this.trackedMovementCoord(mg) ?? mg.from
		traces.advertising.warn?.('[WATCHDOG] Broken movement', {
			goodType: mg.goodType,
			provider: this.movementProviderName(mg),
			demander: this.movementDemanderName(mg),
			movementRef: movementRefId(mg.ref),
			from: mg.from,
			trackedCoord,
			pathLength: mg.path.length,
			onBorder: !!trackedCoord && !isTileCoord(trackedCoord),
			claimed: mg.claimed,
			// This path should stay exceptional until explicit destroyed-path handling exists.
			todo: 'unexpected-until-destroyed-path-handling',
		})
		if (trackedCoord && !isTileCoord(trackedCoord)) {
			this.offloadBrokenBorderMovement(mg, trackedCoord)
			return
		}

		let removedTracking = false
		for (const [coord, goods] of this.movingGoods.entries()) {
			const kept = goods.filter(
				(candidate): candidate is TrackedMovement =>
					!!candidate && !this.movementIdentityMatches(candidate, mg)
			)
			if (kept.length !== goods.length) {
				removedTracking = true
				if (kept.length === 0) this.movingGoods.delete(coord)
				else this.movingGoods.set(coord, kept)
			}
		}
		if (removedTracking) this.invalidateConveyPlanning('movement.discard')
		mg.claimed = false
		delete mg.claimedBy
		delete mg.claimedAtMs
		try {
			mg.allocations?.source?.cancel('discard.source')
		} catch {}
		try {
			mg.allocations?.target?.cancel('discard.target')
		} catch {}
		this.invalidateConveyPlanning('movement.discard')
		this.invalidateAdvertisements([mg.provider, mg.demander], 'movement.lifecycle')
		this.wakeWanderingWorkersNear(mg.provider, mg.demander)
	}

	private stalledExchangeKey(
		provider: FreightMovementParty,
		demander: FreightMovementParty,
		goodType: GoodType
	) {
		const from = toAxialCoord(provider.tile.position)
		const to = toAxialCoord(demander.tile.position)
		return `${goodType}:${from.q},${from.r}->${to.q},${to.r}`
	}

	private movementPartyQuantityKey(party: FreightMovementParty, goodType: GoodType) {
		const coord = toAxialCoord(party.tile.position)
		return `${goodType}:${party.name}@${coord.q},${coord.r}`
	}

	private pendingMovementQuantity(map: Map<string, number>, key: string) {
		return map.get(key) ?? 0
	}

	private bumpPendingMovementQuantity(map: Map<string, number>, key: string, delta: number) {
		const next = (map.get(key) ?? 0) + delta
		if (next <= 0) map.delete(key)
		else map.set(key, next)
	}

	private tryReservePendingMovementIntent(
		goodType: GoodType,
		provider: FreightMovementParty,
		demander: FreightMovementParty
	): (() => void) | undefined {
		const sourceKey = this.movementPartyQuantityKey(provider, goodType)
		const targetKey = this.movementPartyQuantityKey(demander, goodType)
		const pendingSource = this.pendingMovementQuantity(
			this.pendingMovementSourceQuantities,
			sourceKey
		)
		const pendingTarget = this.pendingMovementQuantity(
			this.pendingMovementTargetQuantities,
			targetKey
		)
		const availableSource = provider.storage.available(goodType)
		const availableTarget = demander.storage.hasRoom(goodType)

		if (availableSource - pendingSource <= 0) {
			traces.advertising.log?.(
				`[SELECT] SKIP PENDING SOURCE: ${goodType} ${provider.name} available=${availableSource} pending=${pendingSource}`
			)
			return undefined
		}

		if (availableTarget - pendingTarget <= 0) {
			traces.advertising.log?.(
				`[SELECT] SKIP PENDING TARGET: ${goodType} ${demander.name} room=${availableTarget} pending=${pendingTarget}`
			)
			return undefined
		}

		this.bumpPendingMovementQuantity(this.pendingMovementSourceQuantities, sourceKey, 1)
		this.bumpPendingMovementQuantity(this.pendingMovementTargetQuantities, targetKey, 1)
		let released = false
		return () => {
			if (released) return
			released = true
			this.bumpPendingMovementQuantity(this.pendingMovementSourceQuantities, sourceKey, -1)
			this.bumpPendingMovementQuantity(this.pendingMovementTargetQuantities, targetKey, -1)
		}
	}

	private hasActiveMovement(
		provider: FreightMovementParty,
		demander: FreightMovementParty,
		goodType: GoodType
	) {
		const providerCoord = toAxialCoord(provider.tile.position)
		const demanderCoord = toAxialCoord(demander.tile.position)
		for (const mg of this.activeMovements) {
			if (!mg.claimed && !this.trackedMovementCoord(mg)) continue
			if (
				mg.goodType === goodType &&
				axial.key(toAxialCoord(mg.provider.tile.position)) === axial.key(providerCoord) &&
				axial.key(toAxialCoord(mg.demander.tile.position)) === axial.key(demanderCoord)
			) {
				// The target commitment covers the movement for its whole lifetime. A
				// fulfilled source only says the good left this storage hop; it must not
				// open a duplicate demander allocation before delivery settles.
				if (!commitmentValid(mg.allocations.target) && mg.allocations.source?.ended === true)
					continue
				return true
			}
		}
		for (const goods of this.movingGoods.values()) {
			if (
				goods.some(
					(mg) =>
						mg.goodType === goodType &&
						axial.key(toAxialCoord(mg.provider.tile.position)) === axial.key(providerCoord) &&
						axial.key(toAxialCoord(mg.demander.tile.position)) === axial.key(demanderCoord) &&
						(commitmentValid(mg.allocations.target) || mg.allocations.source?.ended !== true)
				)
			) {
				return true
			}
		}
		return false
	}

	/** Snapshot of canonical active movements (for save indexing). */
	collectActiveMovements(): TrackedMovement[] {
		return Array.from(this.activeMovements)
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
		const border = this.board.getBorder(ref)!
		const hereKey = axial.key(coord)
		const seen = new Set<string>()
		const out: AxialCoord[] = []
		const push = (p: AxialCoord) => {
			const k = axial.key(p)
			if (seen.has(k)) return
			seen.add(k)
			out.push(p)
		}
		for (const tile of [border.tile.a, border.tile.b] as const) {
			const tileCoord = toAxialCoord(tile.position)
			if (source && destination) {
				if (!this.isRelayTransitTile(tileCoord, goodType, source, destination)) continue
			} else if (!this.isRelayTransitTile(tileCoord, goodType, undefined, undefined)) {
				continue
			}
			const content = tile.content
			if (!(content instanceof Alveolus)) continue
			for (const gate of content.gates) {
				const b = toAxialCoord(gate.border.position)
				if (axial.key(b) === hereKey) continue
				push(b)
			}
			if (destination && axial.key(tileCoord) === axial.key(destination)) {
				push(toAxialCoord(destination))
			}
			if (source && axial.key(tileCoord) === axial.key(source)) {
				push(toAxialCoord(source))
			}
		}
		return out
	}
	//#region Needy / events

	// Fresh by design: this aggregates mutable advertisement buckets whose invalidation is already
	// managed by the hive planning revisions.
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

	movingGoods = new AxialKeyMap<TrackedMovement[]>()
	storageAt(coord: Positioned): Storage | undefined {
		if (isTileCoord(toAxialCoord(coord))) {
			const content = this.board.getTileContent(coord) as Alveolus
			return content.storage
		}
		const border = this.board.getBorder(coord)!
		return border.content?.storage
	}

	wakeWanderingWorkersNear(_provider: FreightMovementParty, _demander: FreightMovementParty) {
		if (this.destroyed || this.reconstructing) return
		if (this.wakeWanderingWorkersScheduled) return
		this.wakeWanderingWorkersScheduled = true
		this.postStep(() => {
			if (this.destroyed) return
			this.wakeWanderingWorkersScheduled = false
			for (const worker of this.board.game.population) {
				let actionDescription: string[]
				try {
					actionDescription = worker.actionDescription || []
				} catch (error) {
					if (error instanceof Error && error.message.includes('Reactive system is broken')) {
						return
					}
					throw error
				}
				const assignedHere =
					freightPartyMatchesAssignedAlveolus(_provider, worker.assignedAlveolus) ||
					freightPartyMatchesAssignedAlveolus(_demander, worker.assignedAlveolus)
				if (worker.assignedAlveolus && !assignedHere) continue
				const wandering = actionDescription.includes('selfCare.wander')
				const waitingIncoming = actionDescription.includes('waitForIncomingGoods')
				const assignedPondering =
					assignedHere &&
					actionDescription.length === 0 &&
					worker.stepExecutor?.constructor?.name === 'PonderingStep'
				if (!wandering && !waitingIncoming && !assignedPondering) continue
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

	@inert
	public createMovement(
		goodType: GoodType,
		provider: FreightMovementParty,
		demander: FreightMovementParty
	) {
		if (this.reconstructing) return false
		// Check if either alveolus is destroyed
		if (!provider.tile || !demander.tile || provider.destroyed || demander.destroyed) {
			traces.advertising.log?.(`[CREATE] SKIP: destroyed alveolus`, {
				goodType,
				provider: provider.name,
				demander: demander.name,
				providerDestroyed: !provider.tile || provider.destroyed,
				demanderDestroyed: !demander.tile || demander.destroyed,
			})
			return false
		}
		// FreightBayAlveolus and other non-storage parties use NoStorage and can never
		// fulfill movement allocations. VehicleFreightDock must be used instead.
		if (
			provider.storage instanceof NoStorage ||
			demander.storage instanceof NoStorage
		) {
			traces.advertising.warn?.(`[CREATE] SKIP NO-STORAGE: ${goodType} ${provider.name} -> ${demander.name}`, {
				goodType,
				provider: provider.name,
				demander: demander.name,
				providerNoStorage: provider.storage instanceof NoStorage,
				demanderNoStorage: demander.storage instanceof NoStorage,
			})
			return false
		}
		if (this.hasActiveMovement(provider, demander, goodType)) {
			traces.advertising.log?.(
				`[CREATE] SKIP ACTIVE: ${goodType} ${provider.name} -> ${demander.name}`
			)
			return false
		}

		const providePriority = this.movementProvidePriority(provider, goodType)
		if (!providePriority) {
			traces.advertising.log?.(`[CREATE] SKIP PROVIDER: ${goodType} ${provider.name} cannot give`, {
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
			traces.advertising.log?.(
				`[CREATE] SKIP CAPACITY: ${goodType} ${provider.name} -> ${demander.name} (stock: ${currentStock}/${capacity})`
			)
			return false
		}

		const positions = {
			provider: toAxialCoord(provider.tile.position),
			demander: toAxialCoord(demander.tile.position),
		}
		const movementKey = this.stalledExchangeKey(provider, demander, goodType)
		if (this.creatingMovementKeys.has(movementKey)) {
			traces.advertising.log?.(
				`[CREATE] SKIP DUPLICATE: ${goodType} ${provider.name} -> ${demander.name}`
			)
			return false
		}
		this.creatingMovementKeys.add(movementKey)

		traces.advertising.log?.(`[CREATE] START: ${goodType} ${provider.name} -> ${demander.name}`)

		// Use cached path if available, otherwise calculate it
		const computedPath = this.getPath(provider, demander, goodType)
		if (!computedPath || computedPath.length < 1) {
			traces.advertising.log?.(`[CREATE] NO PATH: ${goodType} ${provider.name} -> ${demander.name}`)
			this.creatingMovementKeys.delete(movementKey)
			return false
		}
		const path = [...computedPath]

		traces.advertising.log?.(
			`[CREATE] PATH FOUND: ${goodType} ${provider.name} -> ${demander.name} length=${path.length}`
		)

		const movementRef = createMovementRef()
		const sourceCommitment = new Commitment(
			`hive-transfer.source.${goodType}.${provider.name}->${demander.name}`
		)
		const targetCommitment = new Commitment(
			`hive-transfer.target.${goodType}.${provider.name}->${demander.name}`
		)
		const movementReasonBase: AllocationReasonInfo = {
			type: 'hive-transfer',
			goodType,
			...positions,
			provider,
			demander,
			providerName: provider.name,
			demanderName: demander.name,
			movementRef,
			createdAt: Date.now(),
		}
		const sourceReason: AllocationReasonInfo = {
			...movementReasonBase,
			role: 'movement-source',
		}
		const targetReason: AllocationReasonInfo = {
			...movementReasonBase,
			role: 'movement-target',
		}
		;(sourceCommitment as { reason?: AllocationReasonInfo }).reason = sourceReason
		;(targetCommitment as { reason?: AllocationReasonInfo }).reason = targetReason
		trackAllocation(sourceCommitment, sourceReason)
		trackAllocation(targetCommitment, targetReason)
		sourceCommitment.onFinal(() => untrackAllocation(sourceCommitment))
		targetCommitment.onFinal(() => untrackAllocation(targetCommitment))

		traces.advertising.log?.(
			`[CREATE] INERT START: ${goodType} ${provider.name} -> ${demander.name}`,
			movementReasonBase
		)

		const providerResult = provider.storage.reserve({ [goodType]: 1 }, sourceCommitment)
		if (providerResult !== undefined) {
			traces.allocations.error?.(`[MOVEMENT] Provider allocation failed: ${goodType}`, {
				movementRef: movementRefId(movementRef),
				goodType,
				provider: provider.name,
				demander: demander.name,
				reason: providerResult,
			})
			sourceCommitment.cancel('create.provider-failed')
			targetCommitment.cancel('create.provider-failed')
			this.creatingMovementKeys.delete(movementKey)
			return false
		}

		const targetResult = demander.storage.allocate({ [goodType]: 1 }, targetCommitment)
		if (targetResult !== undefined) {
			traces.allocations.error?.(`[MOVEMENT] Target allocation failed: ${goodType}`, {
				movementRef: movementRefId(movementRef),
				goodType,
				provider: provider.name,
				demander: demander.name,
				reason: targetResult,
			})
			sourceCommitment.cancel('create.target-failed')
			targetCommitment.cancel('create.target-failed')
			this.creatingMovementKeys.delete(movementKey)
			return false
		}

		traces.allocations.log?.(`[MOVEMENT] ALLOCATIONS SUCCESS: ${goodType}`, {
			movementRef: movementRefId(movementRef),
			provider: provider.name,
			demander: demander.name,
		})

		const movingGood: TrackedMovement = {
			ref: movementRef,
			goodType,
			path,
			provider,
			demander,
			from: positions.provider,
			_state: MovementState.tracked,
			refreshState: 'steady',
			claimed: false,
			allocations: {
				source: sourceCommitment,
				target: targetCommitment,
			},
			prepareHop() {
				throw new Error('movement runtime not installed')
			},
			commitHop() {
				throw new Error('movement runtime not installed')
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
		sourceReason.movement = movingGood
		targetReason.movement = movingGood

		this.installMovementRuntimeMethods(movingGood)
		this.activeMovements.add(movingGood)
		this.pushMovementDebugEntry(
			movingGood,
			'sourceTrail',
			`create:initial:${this.movementAllocationLabel(sourceCommitment)}@${Date.now()}`
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
		traces.convey.log?.(
			`[CREATE] ${goodType} ${provider.name} -> ${demander.name} pathLen=${movingGood.path.length}`,
			{
				goodType,
				provider: provider.name,
				demander: demander.name,
				from: axial.key(movingGood.from),
				pathLength: movingGood.path.length,
			}
		)

		this.creatingMovementKeys.delete(movementKey)
		return true
	}

	get generalStorages() {
		return [
			...((this.byActionType['slotted-storage'] || []) as StorageAlveolus[]),
			...((this.byActionType['specific-storage'] || []) as StorageAlveolus[]),
			...((this.byActionType['storage'] || []) as StorageAlveolus[]),
		]
	}
	selectMovement(
		advertisement: Advertisement,
		alveolus: FreightMovementParty,
		storages: FreightMovementParty[],
		goodType: GoodType,
		sourcePriority: ExchangePriority,
		targetPriority: ExchangePriority,
		onCreated?: (storage: FreightMovementParty) => void
	): FreightMovementParty | undefined {
		traces.advertising.log?.(
			`[SELECT] START: ${goodType} ${advertisement} from ${alveolus.name} to ${storages.length} candidates`
		)

		// We consider A->B === B->A
		const storage = inert(() => this.findNearest(alveolus, new Set(storages), goodType))
		if (storage === undefined) {
			traces.advertising.log?.(
				`[SELECT] NO REACHABLE: ${goodType} from ${alveolus.name} to any of: ${storages.map((s) => (s as any).name || 'unnamed').join(', ')}`
			)
			return undefined
		}
		traces.advertising.log?.(
			`[SELECT] FOUND: ${goodType} ${advertisement} ${alveolus.name} -> ${storage.name}`
		)
		const isDemand = advertisement === 'demand'
		const targetStorage = isDemand ? alveolus : storage
		const providerStorage = isDemand ? storage : alveolus
		const releasePendingMovementIntent = this.tryReservePendingMovementIntent(
			goodType,
			providerStorage,
			targetStorage
		)
		if (!releasePendingMovementIntent) return undefined

		// Defer movement creation so the current advertisement flush remains a stable matching pass.
		this.postStep(() => {
			try {
				if (this.destroyed) return
				traces.advertising.log?.(
					`[SELECT] DEFERRED CREATE: ${goodType} ${alveolus.name} -> ${storage.name}`
				)

				// CRITICAL: Validate target can actually take the goods before creating movement

				// Check provider can give the goods
				if ('canGive' in providerStorage && typeof providerStorage.canGive === 'function') {
					const providerCanGive = providerStorage.canGive(goodType, sourcePriority)

					if (!providerCanGive) {
						traces.advertising.log?.(
							`[SELECT] SKIP: ${goodType} - ${providerStorage.name} has no goods to give`
						)
						return storage
					}
				}

				// Check target can take the goods
				if ('canTake' in targetStorage && typeof targetStorage.canTake === 'function') {
					const targetCanTake = targetStorage.canTake(goodType, targetPriority)
					if (!targetCanTake) {
						traces.advertising.log?.(
							`[SELECT] SKIP: ${goodType} - ${targetStorage.name} cannot accept goods`
						)
						return storage
					}
				}
				const created = this.createMovement(
					goodType,
					...((advertisement === 'provide' ? [alveolus, storage] : [storage, alveolus]) as [
						FreightMovementParty,
						FreightMovementParty,
					])
				)
				if (!created) {
					traces.advertising.log?.(
						`[SELECT] DEFERRED NOOP: ${goodType} ${alveolus.name} -> ${storage.name}`
					)
					return storage
				}
				onCreated?.(storage)
				traces.advertising.log?.(`[SELECT] DEFERRED SUCCESS: ${goodType} movement created`)
			} catch (e) {
				// Ignore allocation errors that occur if resources are no longer available
				// The system will retry naturally on next advertisement if needed
				const error = e as Error
				if (error.name === 'AllocationError') {
					traces.advertising.log?.(`[SELECT] ALLOCATION ERROR: ${goodType} - ${error.message}`)
				} else {
					traces.advertising.log?.(`[SELECT] ERROR: ${goodType} - ${error.message}`)
					console.error(e)
				}
			} finally {
				releasePendingMovementIntent()
			}
		})
		return storage
	}

	/**
	 * Restore one movement from save data after the board + vehicles exist (before NPC script restore).
	 * Uses the saved path verbatim to preserve mid-flight state.
	 */
	restoreSerializedConveyRow(
		row: SerializedConveyMovement,
		provider: FreightMovementParty,
		demander: FreightMovementParty
	): TrackedMovement | undefined {
		if (this.destroyed || this.reconstructing) return undefined
		const demanderAlv = isVehicleFreightDock(demander) ? demander.bay : (demander as Alveolus)
		if (demanderAlv.hive !== this) return undefined
		const sourceStorage = this.storageAt(row.from)
		const path = [...row.path]
		if ((!row.claimed && !sourceStorage) || path.length < 1) return undefined
		if (row.claimed) {
			const tile = !isTileCoord(row.from)
				? (this.board.getBorder(row.from)?.tile.a ?? this.board.getBorder(row.from)?.tile.b)
				: this.board.getTile(row.from)
			if (tile) this.board.looseGoods.add(tile, row.goodType)
			traces.advertising.warn?.('[RESTORE] Downgraded in-flight convey movement to loose good', {
				goodType: row.goodType,
				from: row.from,
				provider: provider.name,
				demander: demander.name,
			})
			return undefined
		}

		const ref = createMovementRef()
		const sourceCommitment = new Commitment(
			`hive-transfer.source.${row.goodType}.${provider.name}->${demander.name}`
		)
		const targetCommitment = new Commitment(
			`hive-transfer.target.${row.goodType}.${provider.name}->${demander.name}`
		)
		const movementReasonBase: AllocationReasonInfo = {
			type: 'hive-transfer',
			goodType: row.goodType,
			provider,
			demander,
			providerName: provider.name,
			demanderName: demander.name,
			movementRef: ref,
			createdAt: Date.now(),
			source: row.from,
		}
		const sourceReason: AllocationReasonInfo = {
			...movementReasonBase,
			role: 'movement-source',
		}
		const targetReason: AllocationReasonInfo = {
			...movementReasonBase,
			role: 'movement-target',
		}
		;(sourceCommitment as { reason?: AllocationReasonInfo }).reason = sourceReason
		;(targetCommitment as { reason?: AllocationReasonInfo }).reason = targetReason
		trackAllocation(sourceCommitment, sourceReason)
		trackAllocation(targetCommitment, targetReason)
		sourceCommitment.onFinal(() => untrackAllocation(sourceCommitment))
		targetCommitment.onFinal(() => untrackAllocation(targetCommitment))

		try {
			if (!row.claimed) {
				const sourceResult = sourceStorage!.reserve({ [row.goodType]: 1 }, sourceCommitment)
				if (sourceResult !== undefined) {
					sourceCommitment.cancel('restore.source-failed')
					targetCommitment.cancel('restore.source-failed')
					return undefined
				}
			}
			const targetResult = demander.storage.allocate({ [row.goodType]: 1 }, targetCommitment)
			if (targetResult !== undefined) {
				sourceCommitment.cancel('restore.target-failed')
				targetCommitment.cancel('restore.target-failed')
				return undefined
			}
		} catch {
			sourceCommitment.cancel('restore.exception')
			targetCommitment.cancel('restore.exception')
			return undefined
		}

		const movingGood: TrackedMovement = {
			ref,
			goodType: row.goodType,
			path,
			provider,
			demander,
			from: row.from,
			_state: row.claimed ? MovementState.claimed : MovementState.tracked,
			refreshState: 'steady',
			claimed: row.claimed,
			claimedBy: row.claimedByUid
				? Array.from(this.board.game.population).find((w) => w.uid === row.claimedByUid)
				: undefined,
			claimedAtMs: row.claimedAtMs,
			allocations: {
				source: row.claimed ? undefined : sourceCommitment,
				target: targetCommitment,
			},
			prepareHop() {
				throw new Error('movement runtime not installed')
			},
			commitHop() {
				throw new Error('movement runtime not installed')
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
		sourceReason.movement = movingGood
		targetReason.movement = movingGood

		this.installMovementRuntimeMethods(movingGood)
		this.activeMovements.add(movingGood)
		if (!movingGood.claimed) movingGood.place()
		this.wakeWanderingWorkersNear(provider, demander)
		return movingGood
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
		for (const movingGood of this.activeMovements) {
			knownMovements.add(movingGood)
		}
		for (const movingGood of knownMovements) {
			const movementRef =
				movingGood.allocations?.source &&
				(movingGood.allocations.source as { reason?: { movementRef?: MovementRef } }).reason
					?.movementRef
			traces.allocations.log?.(
				`[MOVEMENT] CANCELLED DURING DESTROY: ${movingGood.goodType} ${movingGood.provider.name} -> ${movingGood.demander.name}`,
				{
					movementRef: movementRef ? movementRefId(movementRef) : undefined,
					goodType: movingGood.goodType,
					provider: movingGood.provider.name,
					demander: movingGood.demander.name,
					coord: this.trackedMovementCoord(movingGood) ?? movingGood.from,
					claimed: movingGood.claimed,
				}
			)
			try {
				movingGood.allocations?.source?.cancel('destroy.source')
			} catch {}
			try {
				movingGood.allocations?.target?.cancel('destroy.target')
			} catch {}
		}
		this.movingGoods.clear()
		this.activeMovements.clear()
		for (const cleanup of this.runtimeEffects) {
			cleanup()
		}
		this.runtimeEffects.length = 0
	}
	//#endregion
}
