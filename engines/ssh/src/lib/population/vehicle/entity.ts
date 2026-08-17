import { effect, reactive } from 'mutts'
import type { Tile } from 'ssh/board/tile'
import { isTileCoord } from 'ssh/board/tile-coord'
import { cancelVehicleReservationsOnSites } from 'ssh/build-site'
import { debugObjectId } from 'ssh/dev/debug-object-id'
import type { FreightLineDefinition, FreightStop } from 'ssh/freight/freight-line'
import {
	refreshDockedVehicleAdvertisement,
	vehicleDockBlockingVirtualGoodsCount,
} from 'ssh/freight/vehicle-freight-dock'
import {
	freightVehicleDockBay,
	syncFreightVehicleDockRegistration,
} from 'ssh/freight/vehicle-freight-dock-sync'
import { maybeAdvanceVehicleFromCompletedAnchorStop } from 'ssh/freight/vehicle-run'
import { collectVehicleAdvertisedJobs, collectVehicleProposedJobs } from 'ssh/freight/vehicle-work'
import type { Game } from 'ssh/game/game'
import { GameObject, withInteractive } from 'ssh/game/object'
import type { ProposedJob, VehicleProposedJob } from 'ssh/jobs/offers'
import type { Storage } from 'ssh/storage'
import { axial } from 'ssh/utils'
import { publicRef, sameRef } from 'ssh/utils/identity'
import { type Position, toAxialCoord, xyDistance } from 'ssh/utils/position'
import { RevisionedCache } from 'ssh/utils/revisioned-cache'
import { assert, profile, traces } from '../../dev/debug.ts'
import { traceProjection } from '../../dev/trace.ts'
import type { Character } from '../character'
import {
	createVehicleStorage,
	isVehicleLineService,
	isVehicleMaintenanceService,
	type VehicleLineService,
	type VehicleMaintenanceService,
	type VehicleMaintenanceServiceSpec,
	type VehicleService,
	type WorldVehicleType,
} from './vehicle'

function sameAnchorStop(left: FreightStop, right: FreightStop): boolean {
	if (!('anchor' in left) || !('anchor' in right)) return false
	return (
		left.anchor.kind === right.anchor.kind &&
		left.anchor.hiveName === right.anchor.hiveName &&
		left.anchor.alveolusType === right.anchor.alveolusType &&
		left.anchor.coord[0] === right.anchor.coord[0] &&
		left.anchor.coord[1] === right.anchor.coord[1]
	)
}

@reactive
export class Vehicle extends withInteractive(GameObject) {
	declare readonly storage: Storage
	/**
	 * Backing field for {@link position}.  Vehicle world position is managed
	 * through the getter/setter below so that every write — whether from
	 * {@link MoveToStep.lerp} (via the driving character's position setter),
	 * {@link dock}, {@link undock}, or an inline assignment — passes the same
	 * per-frame teleport assertion as {@link Character.set position}.
	 */
	private _position?: Position
	/**
	 * Snapshot of the vehicle position *before* the current setter call.
	 * Used by {@link set position} to assert that no teleport occurs within
	 * a single clock advance — regardless of which step or method triggered
	 * the position write.
	 */
	private _lastPositionBeforeSet?: Position
	/** Virtual time of the last position write, from {@link Game.clock.virtualTime}. */
	private _lastPositionTime = 0
	public servedLines: FreightLineDefinition[]
	/** Optional stable fixture/debug label. Not used as runtime identity. */
	public readonly name?: string
	/** Whether this vehicle currently has an active bay queue dock request. Set by the controller. */
	public isInBayQueue = false
	public service?: VehicleService
	private readonly proposedJobsCache = new RevisionedCache<readonly VehicleProposedJob[]>()
	private readonly advertisedJobsCache = new RevisionedCache<readonly ProposedJob[]>()
	private readonly dockStorageCompletionLifecycle = reactive({ revision: 0 })
	private dockStorageCompletionEffect?: () => void
	private dockStorageCompletionScheduled = false
	public get operator(): Character | undefined {
		return this.service?.operator
	}

	/**
	 * World position of the vehicle, or `undefined` when the vehicle is docked
	 * (its position is then derived from {@link dockTile}).
	 *
	 * The setter applies the same per-frame teleport assertion as
	 * {@link Character.set position}: every write must respect a maximum
	 * velocity (~2000 px/s, ~38 hex/s).  Setting the position to `undefined`
	 * (dock) bypasses the check, as does the very first write (no previous
	 * snapshot).  This catches the "vehicle teleports back to the bay empty"
	 * regression where a stale dock restoration overwrites an in-flight
	 * driving position.
	 */
	get position(): Position | undefined {
		return this._position
	}

	set position(value: Position | undefined) {
		// ── Global teleport assertion ──────────────────────────────────────
		// Docking clears the world position (`value === undefined`); that is
		// intentional and must not trip the velocity check.  The very first
		// real position write (constructor / deserialize) also has no
		// previous snapshot to compare against.
		if (value && this._lastPositionBeforeSet) {
			const ds = this.game.clock.virtualTime - this._lastPositionTime
			if (ds > 0) {
				const moved = xyDistance(this._lastPositionBeforeSet, value)
				// 2000 px/s is ~38 hex/s at tileSize=30 — far beyond any
				// legitimate drive speed even with 2× clock jitter margin.
				const maxAllowed = Math.max(1, 2000 * ds * 2)
				assert(
					moved <= maxAllowed + 1e-3,
					`VehicleEntity.position: teleport — moved ${moved.toFixed(1)} px ` +
						`in ${ds.toFixed(4)} s (max ${maxAllowed.toFixed(1)} px) ` +
						`from ${axial.key(axial.round(toAxialCoord(this._lastPositionBeforeSet)!))} ` +
						`to ${axial.key(axial.round(toAxialCoord(value)!))} ` +
						`(vehicle ${debugObjectId(this) ?? ''})`
				)
			}
		}
		if (value) {
			this._lastPositionBeforeSet = { ...value }
			this._lastPositionTime = this.game.clock.virtualTime
		}
		// ── End teleport assertion ────────────────────────────────────────
		this._position = value ? reactive(value) : undefined
	}

	constructor(
		game: Game,
		public readonly vehicleType: WorldVehicleType,
		position: Position,
		servedLines: readonly FreightLineDefinition[] = [],
		name?: string
	) {
		super(game)
		// First position write — no previous snapshot, so the teleport
		// assertion in the setter is a no-op.  The setter wraps the value
		// in `reactive(...)` itself.
		this.position = position
		this.storage = createVehicleStorage(vehicleType)
		this.storage.setPresentationChangeNotifier(() =>
			this.game.enqueueStoragePresentationChange(this)
		)
		this.servedLines = reactive([...servedLines])
		const trimmedName = name?.trim()
		this.name = trimmedName || undefined
		this.installStorageChangeHooks()
		this.installDockStorageCompletionEffect()
	}

	private installStorageChangeHooks(): void {
		const addGood = this.storage.addGood.bind(this.storage)
		this.storage.addGood = ((goodType, qty) => {
			const stored = addGood(goodType, qty)
			if (stored > 0) this.onStorageChanged()
			return stored
		}) as typeof this.storage.addGood

		const removeGood = this.storage.removeGood.bind(this.storage)
		this.storage.removeGood = ((goodType, qty) => {
			const removed = removeGood(goodType, qty)
			if (removed > 0) this.onStorageChanged()
			return removed
		}) as typeof this.storage.removeGood
	}

	private onStorageChanged(): void {
		this.game.invalidateWorkPlanning('vehicle.storage')
		const svc = this.service
		if (isVehicleLineService(svc) && 'anchor' in svc.stop && this.isDocked) {
			syncFreightVehicleDockRegistration(this)
		}
		this.pokeDockStorageCompletionLifecycle()
		this.scheduleDockStorageCompletionCheck()
	}

	private installDockStorageCompletionEffect(): void {
		this.dockStorageCompletionEffect = effect`vehicle.dock.storage-completion`(() => {
			this.dockStorageCompletionLifecycle.revision
			const svc = this.service
			if (!isVehicleLineService(svc) || !('anchor' in svc.stop) || !this.isDocked) return
			if (svc.operator) return
			if (vehicleDockBlockingVirtualGoodsCount(this) > 0) return
			this.scheduleDockStorageCompletionCheck()
		})
	}

	private scheduleDockStorageCompletionCheck(): void {
		const svc = this.service
		if (!isVehicleLineService(svc) || !('anchor' in svc.stop) || !this.isDocked) return
		if (svc.operator) return
		if (vehicleDockBlockingVirtualGoodsCount(this) > 0) return
		if (this.dockStorageCompletionScheduled) return
		this.dockStorageCompletionScheduled = true
		setTimeout(() => {
			this.dockStorageCompletionScheduled = false
			if (this.destroyed) return
			const current = this.service
			if (!isVehicleLineService(current) || !('anchor' in current.stop) || !this.isDocked) return
			if (current.operator) return
			if (vehicleDockBlockingVirtualGoodsCount(this) > 0) return
			const bay = freightVehicleDockBay(this)
			const candidates = bay ? refreshDockedVehicleAdvertisement(this, bay) : []
			if (candidates.length > 0) return
			const currentStockCount = Object.values(this.storage.stock).reduce(
				(total, qty) => total + Math.max(0, qty ?? 0),
				0
			)
			traces.vehicle.log?.('vehicleJob.dock.storageDrained', {
				lineId: debugObjectId(current.line),
				stopIndex: current.line.stops.indexOf(current.stop),
				stockCount: currentStockCount,
				virtualGoodsCount: this.storage.virtualGoodsCount,
			})
			maybeAdvanceVehicleFromCompletedAnchorStop(this.game, this)
		}, 0)
	}

	private pokeDockStorageCompletionLifecycle(): void {
		this.dockStorageCompletionLifecycle.revision++
	}

	get title(): string {
		return this.name?.trim() || `${this.vehicleType} ${debugObjectId(this) ?? ''}`
	}

	get tile(): Tile {
		return this.effectiveTile
	}

	get effectivePosition(): Position {
		if (this.position) return this.position
		const tile = this.dockTile
		assert(tile, `Vehicle ${debugObjectId(this) ?? ''}: docked vehicle has no anchor tile`)
		return tile.position
	}

	get effectiveTile(): Tile {
		if (this.position) {
			return this.tileForWorldPosition(this.position)
		}
		const tile = this.dockTile
		assert(tile, `Vehicle ${debugObjectId(this) ?? ''}: unpositioned vehicle has no dock tile`)
		return tile
	}

	private tileForWorldPosition(position: Position): Tile {
		const coord = toAxialCoord(position)!
		if (isTileCoord(coord)) return this.game.hex.getTile(coord)!
		const border = this.game.hex.getBorder(coord)
		if (border) {
			const serviceSide = !border.tile.a.isBlockingSpace
				? border.tile.a
				: !border.tile.b.isBlockingSpace
					? border.tile.b
					: undefined
			if (serviceSide) return serviceSide
		}
		return this.game.hex.getTile(axial.round(coord))!
	}

	get isDocked(): boolean {
		const svc = this.service
		return isVehicleLineService(svc) && svc.docked && !this.position
	}

	get dockTile(): Tile | undefined {
		const svc = this.service
		if (!isVehicleLineService(svc)) return undefined
		if (!('anchor' in svc.stop)) return undefined
		return this.game.hex.getTile({ q: svc.stop.anchor.coord[0], r: svc.stop.anchor.coord[1] })
	}

	private restoreWorldPositionFromDock(reason: string): void {
		if (this.position) return
		const tile = this.dockTile
		assert(
			tile,
			`Vehicle ${debugObjectId(this) ?? ''}: cannot restore docked position without anchor tile`
		)
		this.position = { ...tile.position }
		traces.vehicle.log?.('vehicleJob.dock.placement', {
			outcome: 'restore-position',
			reason,
			anchorCoord: toAxialCoord(tile.position),
		})
	}

	private traceDockPlacement(outcome: string): void {
		const tile = this.dockTile
		traces.vehicle.log?.('vehicleJob.dock.placement', {
			outcome,
			anchorCoord: tile ? toAxialCoord(tile.position) : undefined,
			hasWorldPosition: !!this.position,
		})
	}

	private enqueueDockPresentationChange(): void {
		const tile = this.dockTile
		if (tile) this.game.enqueueVehicleDockPresentationChange(tile, this)
	}

	get worldTile(): Tile | undefined {
		if (!this.position) return undefined
		return this.tileForWorldPosition(this.position)
	}

	get debugInfo(): Record<string, unknown> {
		const svc = this.service
		return {
			vehicleType: this.vehicleType,
			position: this.position,
			effectivePosition: this.effectivePosition,
			servedLineIds: this.servedLines.map((line) => debugObjectId(line) ?? ''),
			operatorUid: debugObjectId(this.operator),
			service:
				svc && isVehicleLineService(svc)
					? {
							kind: 'line' as const,
							lineId: debugObjectId(svc.line),
							stopIndex: svc.line.stops.indexOf(svc.stop),
							docked: svc.docked,
							operatorUid: debugObjectId(svc.operator),
						}
					: svc && isVehicleMaintenanceService(svc)
						? {
								kind: 'maintenance' as const,
								maintenanceKind: svc.kind,
								targetCoord: svc.targetCoord,
								operatorUid: debugObjectId(svc.operator),
							}
						: undefined,
			storage: this.storage.stock,
		}
	}

	get proposedJobs(): readonly VehicleProposedJob[] {
		const end = profile.proposedJobs.begin?.('vehicle.proposedJobs', () => ({
			vehicleType: this.vehicleType,
		}))
		try {
			return this.proposedJobsCache.get(this.game.workPlanningRevision, () =>
				collectVehicleProposedJobs(this.game, this)
			)
		} finally {
			end?.()
		}
	}

	get advertisedJobs(): readonly ProposedJob[] {
		const end = profile.proposedJobs.begin?.('vehicle.advertisedJobs', () => ({
			vehicleType: this.vehicleType,
		}))
		try {
			const dockBay = freightVehicleDockBay(this)
			const revision = `${this.game.workPlanningRevision}|${dockBay?.hive.conveyPlanningRevision ?? 0}`
			return this.advertisedJobsCache.get(revision, () =>
				collectVehicleAdvertisedJobs(this.game, this)
			)
		} finally {
			end?.()
		}
	}

	get [traceProjection]() {
		const svc = this.service
		return {
			$type: 'Vehicle',
			uid: debugObjectId(this) ?? '',
			vehicleType: this.vehicleType,
			position: this.position,
			effectivePosition: this.effectivePosition,
			operatorUid: debugObjectId(this.operator),
			service:
				svc && isVehicleLineService(svc)
					? {
							kind: 'line' as const,
							lineId: debugObjectId(svc.line),
							stopIndex: svc.line.stops.indexOf(svc.stop),
							docked: svc.docked,
							operatorUid: debugObjectId(svc.operator),
						}
					: svc && isVehicleMaintenanceService(svc)
						? {
								kind: 'maintenance' as const,
								maintenanceKind: svc.kind,
								targetCoord: svc.targetCoord,
								operatorUid: debugObjectId(svc.operator),
							}
						: undefined,
			servedLineIds: this.servedLines.map((line) => debugObjectId(line) ?? ''),
		}
	}

	canInteract(_action: string): boolean {
		return false
	}

	/**
	 * Sets `service.operator`. The vehicle must already have a {@link service} object
	 * (line or maintenance); use {@link beginLineService} / {@link beginMaintenanceService} first.
	 */
	setServiceOperator(operator: Character | undefined): void {
		assert(
			this.service,
			`Vehicle ${debugObjectId(this) ?? ''}: setServiceOperator requires an active service`
		)
		const nextOperator = operator ? publicRef(operator) : undefined
		const self = publicRef(this)
		assert(
			!nextOperator || !this.service.operator || sameRef(this.service.operator, nextOperator),
			`Vehicle ${debugObjectId(this) ?? ''} already operated by ${debugObjectId(this.service.operator)}`
		)
		const previous = this.service.operator
		if (sameRef(previous, nextOperator)) {
			// Normalize stored refs to public proxies and refresh the character back-link.
			if (nextOperator) {
				this.service.operator = nextOperator
				nextOperator.setOperatedVehicleFromService(self)
			}
			return
		}
		if (previous) previous.setOperatedVehicleFromService(undefined)
		this.service.operator = nextOperator
		this.game.invalidateWorkPlanning('vehicle.operator')
		if (nextOperator) {
			const currentVehicle = nextOperator.operates
			if (currentVehicle && !sameRef(currentVehicle, self)) {
				currentVehicle.releaseOperator(nextOperator)
			}
			nextOperator.setOperatedVehicleFromService(self)
		}
	}

	releaseOperator(operator?: Character): void {
		if (operator && this.service?.operator && !sameRef(this.service.operator, operator)) return
		const current = this.service?.operator
		if (!this.service) return
		if (!current) return
		this.service.operator = undefined
		this.game.invalidateWorkPlanning('vehicle.operator')
		current?.setOperatedVehicleFromService(undefined)
		this.pokeDockStorageCompletionLifecycle()
	}

	beginLineService(line: FreightLineDefinition, stop: FreightStop, operator?: Character): void {
		// Attach service first without operator, then link via setServiceOperator so
		// character.operates / service.operator stay consistent (onboard requires operates).
		const next: VehicleLineService = { line, stop, docked: false, operator: undefined }
		this.service = next
		this.game.invalidateWorkPlanning('vehicle.service')
		syncFreightVehicleDockRegistration(this)
		this.pokeDockStorageCompletionLifecycle()
		if (operator) this.setServiceOperator(operator)
	}

	/**
	 * Attach a maintenance offload service describing one of the three sub-kinds
	 * (`loadFromBurden` / `unloadToTile` / `park`). Per-kind state lives on the service so scripts
	 * read intent from `vehicle.service` rather than the transient job payload.
	 */
	beginMaintenanceService(spec: VehicleMaintenanceServiceSpec, operator?: Character): void {
		// Attach service first without operator, then link via setServiceOperator so
		// character.operates / service.operator stay consistent (same as beginLineService).
		const next = { ...spec, operator: undefined } as VehicleMaintenanceService
		this.service = next
		this.game.invalidateWorkPlanning('vehicle.service')
		syncFreightVehicleDockRegistration(this)
		this.pokeDockStorageCompletionLifecycle()
		if (operator) this.setServiceOperator(operator)
	}

	/**
	 * Test seam: attach a generic `park` maintenance service pointing at the current vehicle tile.
	 * Production code uses {@link beginMaintenanceService} with the concrete sub-kind chosen by
	 * the planner (`vehicle-work.ts:allocateVehicleServiceForJob`).
	 */
	beginOffloadService(operator?: Character): void {
		const coord = axial.round(toAxialCoord(this.effectivePosition)!)
		this.beginMaintenanceService(
			{ kind: 'park', targetCoord: { q: coord.q, r: coord.r } },
			operator
		)
	}

	/** @deprecated Prefer {@link beginLineService}. */
	beginService(line: FreightLineDefinition, stop: FreightStop, operator?: Character): void {
		this.beginLineService(line, stop, operator)
	}

	dock(): void {
		const svc = this.service
		if (!isVehicleLineService(svc)) return
		assert(
			'anchor' in svc.stop,
			`Vehicle ${debugObjectId(this) ?? ''}: dock requires an anchor stop`
		)
		if (svc.docked && !this.position) {
			// Already docked. Re-assert the registration anyway: a transient
			// undock / hive rebuild may have dropped the dock while leaving
			// `docked` set, and `dock()` is the canonical place to restore it.
			syncFreightVehicleDockRegistration(this)
			return
		}
		const dockTile = this.dockTile
		assert(dockTile, `Vehicle ${debugObjectId(this) ?? ''}: dock requires an anchor tile`)
		assert(
			this.position,
			`Vehicle ${debugObjectId(this) ?? ''}: dock requires a world position on the anchor tile`
		)
		const rawVehicleCoord = toAxialCoord(this.position)!
		const vehicleCoord = axial.round(rawVehicleCoord)
		const dockCoord = axial.round(toAxialCoord(dockTile.position)!)
		const border = this.game.hex.getBorder(rawVehicleCoord)
		const isDockBorder =
			!!border &&
			(axial.key(toAxialCoord(border.tile.a.position)!) === axial.key(dockCoord) ||
				axial.key(toAxialCoord(border.tile.b.position)!) === axial.key(dockCoord))
		if (axial.key(vehicleCoord) !== axial.key(dockCoord) && !isDockBorder) {
			const vehicleTile = this.game.hex.getTile(vehicleCoord)
			const serviceBorder = vehicleTile?.borderWith(dockTile)
			if (serviceBorder) this.position = { ...serviceBorder.position }
		}
		const dockPosition = toAxialCoord(this.position)!
		const dockBorder = this.game.hex.getBorder(dockPosition)
		const isAtDockBorder =
			!!dockBorder &&
			(axial.key(toAxialCoord(dockBorder.tile.a.position)!) === axial.key(dockCoord) ||
				axial.key(toAxialCoord(dockBorder.tile.b.position)!) === axial.key(dockCoord))
		assert(
			axial.key(axial.round(dockPosition)) === axial.key(dockCoord) || isAtDockBorder,
			`Vehicle ${debugObjectId(this) ?? ''}: dock requires vehicle to be on the anchor tile or its border`
		)
		svc.docked = true
		this.position = undefined
		this.game.invalidateWorkPlanning('vehicle.dock')
		this.traceDockPlacement('clear-position')
		syncFreightVehicleDockRegistration(this)
		this.enqueueDockPresentationChange()
		this.pokeDockStorageCompletionLifecycle()
		this.scheduleDockStorageCompletionCheck()
	}

	undock(): void {
		const svc = this.service
		if (!isVehicleLineService(svc)) return
		this.enqueueDockPresentationChange()
		this.restoreWorldPositionFromDock('undock')
		svc.docked = false
		this.game.invalidateWorkPlanning('vehicle.undock')
		this.traceDockPlacement('undock')
		syncFreightVehicleDockRegistration(this)
		this.pokeDockStorageCompletionLifecycle()
	}

	advanceToStop(stop: FreightStop): void {
		const svc = this.service
		if (!isVehicleLineService(svc)) return
		if (svc.docked) this.enqueueDockPresentationChange()
		this.restoreWorldPositionFromDock('advance-stop')
		svc.stop = stop
		svc.docked = false
		this.game.invalidateWorkPlanning('vehicle.stop')
		syncFreightVehicleDockRegistration(this)
		this.pokeDockStorageCompletionLifecycle()
	}

	endService(): void {
		if (isVehicleMaintenanceService(this.service) && this.service.kind === 'loadFromBurden') {
			this.service.offloadPickupPlan?.commitment?.cancel('vehicle-service-ended')
			delete this.service.offloadPickupPlan
		}
		this.releaseOperator()
		this.restoreWorldPositionFromDock('end-service')
		if (isVehicleLineService(this.service)) {
			if (this.service.docked) this.enqueueDockPresentationChange()
			this.service.docked = false
		}
		// Release any in-transit reservations this vehicle holds on construction sites.
		cancelVehicleReservationsOnSites(this.game.hex.tiles, debugObjectId(this) ?? '')
		syncFreightVehicleDockRegistration(this)
		this.service = undefined
		this.game.invalidateWorkPlanning('vehicle.service')
		this.pokeDockStorageCompletionLifecycle()
	}

	setServedLines(lines: readonly FreightLineDefinition[], reason = 'vehicle.served-lines'): void {
		const seen = new Set<FreightLineDefinition>()
		const next = lines.filter((line) => {
			if (seen.has(line)) return false
			seen.add(line)
			return true
		})
		const sameReferences =
			this.servedLines.length === next.length &&
			this.servedLines.every((line, index) => line === next[index])
		if (sameReferences) return
		this.servedLines = reactive(next)
		this.game.invalidateWorkPlanning(reason)
	}

	assignFreightLine(line: FreightLineDefinition): boolean {
		if (this.servedLines.some((entry) => entry === line)) return false
		this.setServedLines([...this.servedLines, line], 'vehicle.assign-line')
		return true
	}

	unassignFreightLine(line: FreightLineDefinition): boolean {
		const next = this.servedLines.filter((entry) => entry !== line)
		if (next.length === this.servedLines.length) return false
		this.setServedLines(next, 'vehicle.unassign-line')
		const svc = this.service
		if (isVehicleLineService(svc) && svc.line === line) this.endService()
		return true
	}

	/**
	 * Current index of this vehicle's active line-service stop within `line`,
	 * or -1 when this vehicle has no active service on `line`.
	 */
	lineStopIndexFor(line: FreightLineDefinition): number {
		const svc = this.service
		if (!isVehicleLineService(svc) || svc.line !== line) return -1
		return svc.line.stops.indexOf(svc.stop)
	}

	/**
	 * Re-point the active line-service stop after the line's stops were edited in
	 * place. Line identity is unchanged; only the stops array was replaced, so
	 * `svc.stop` is re-resolved by its previous index.
	 */
	rebindFreightLineStop(line: FreightLineDefinition, previousStopIndex: number): void {
		const svc = this.service
		if (!isVehicleLineService(svc) || svc.line !== line) return
		const stop = previousStopIndex >= 0 ? line.stops[previousStopIndex] : undefined
		if (stop) {
			const wasDocked = this.isDocked
			if (wasDocked && !sameAnchorStop(svc.stop, stop)) {
				this.enqueueDockPresentationChange()
				this.restoreWorldPositionFromDock('refresh-line')
				svc.docked = false
			}
			svc.stop = stop
		}
	}

	override destroy(): void {
		this.dockStorageCompletionEffect?.()
		this.dockStorageCompletionEffect = undefined
		super.destroy()
	}
}
