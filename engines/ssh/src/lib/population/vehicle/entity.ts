import { effect, reactive } from 'mutts'
import type { Tile } from 'ssh/board/tile'
import { isTileCoord } from 'ssh/board/tile-coord'
import type { FreightLineDefinition, FreightStop } from 'ssh/freight/freight-line'
import { collectDockedVehicleAdvertisementCandidates } from 'ssh/freight/vehicle-freight-dock'
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
import type { GoodType } from 'ssh/types'
import { axial } from 'ssh/utils'
import { type Position, toAxialCoord } from 'ssh/utils/position'
import { RevisionedCache } from 'ssh/utils/revisioned-cache'
import { assert, profile, traces } from '../../dev/debug.ts'
import { traceProjection } from '../../dev/trace.ts'
import type { Character } from '../character'
import {
	createVehicleStorage,
	isVehicleLineService,
	isVehicleMaintenanceService,
	type LegacyLineVehicleServiceSerialized,
	type LegacyOffloadVehicleServiceSerialized,
	type VehicleLineService,
	type VehicleMaintenanceService,
	type VehicleMaintenanceServiceSpec,
	type VehicleSerializedState,
	type VehicleService,
	type VehicleServiceSerialized,
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
export class VehicleEntity extends withInteractive(GameObject) {
	declare readonly storage: Storage
	public position: Position | undefined
	public servedLines: FreightLineDefinition[]
	public service?: VehicleService
	private readonly proposedJobsCache = new RevisionedCache<readonly VehicleProposedJob[]>()
	private readonly advertisedJobsCache = new RevisionedCache<readonly ProposedJob[]>()
	private readonly dockStorageCompletionLifecycle = reactive({ revision: 0 })
	private dockStorageCompletionEffect?: () => void
	private dockStorageCompletionScheduled = false
	public get operator(): Character | undefined {
		return this.service?.operator
	}

	constructor(
		game: Game,
		uid: string,
		public readonly vehicleType: WorldVehicleType,
		position: Position,
		servedLines: readonly FreightLineDefinition[] = []
	) {
		super(game, uid)
		this.position = reactive(position)
		this.storage = createVehicleStorage(vehicleType)
		this.storage.setPresentationChangeNotifier(() =>
			this.game.enqueueStoragePresentationChange(this)
		)
		this.servedLines = reactive([...servedLines])
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
			const virtualGoodsCount = this.storage.virtualGoodsCount
			if (virtualGoodsCount > 0) return
			this.scheduleDockStorageCompletionCheck()
		})
	}

	private scheduleDockStorageCompletionCheck(): void {
		const svc = this.service
		if (!isVehicleLineService(svc) || !('anchor' in svc.stop) || !this.isDocked) return
		if (svc.operator) return
		if (this.storage.virtualGoodsCount > 0) return
		if (this.dockStorageCompletionScheduled) return
		this.dockStorageCompletionScheduled = true
		setTimeout(() => {
			this.dockStorageCompletionScheduled = false
			if (this.destroyed) return
			const current = this.service
			if (!isVehicleLineService(current) || !('anchor' in current.stop) || !this.isDocked) return
			if (current.operator) return
			if (this.storage.virtualGoodsCount > 0) return
			const bay = freightVehicleDockBay(this)
			const candidates = bay ? collectDockedVehicleAdvertisementCandidates(this, bay) : []
			if (candidates.length > 0) return
			const currentStockCount = Object.values(this.storage.stock).reduce(
				(total, qty) => total + Math.max(0, qty ?? 0),
				0
			)
			traces.vehicle.log?.('vehicleJob.dock.storageDrained', {
				vehicleUid: this.uid,
				lineId: current.line.id,
				stopId: current.stop.id,
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
		return `${this.vehicleType} ${this.uid}`
	}

	get tile(): Tile {
		return this.effectiveTile
	}

	get effectivePosition(): Position {
		if (this.position) return this.position
		const tile = this.dockTile
		assert(tile, `Vehicle ${this.uid}: docked vehicle has no anchor tile`)
		return tile.position
	}

	get effectiveTile(): Tile {
		if (this.position) {
			return this.tileForWorldPosition(this.position)
		}
		const tile = this.dockTile
		assert(tile, `Vehicle ${this.uid}: unpositioned vehicle has no dock tile`)
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
		assert(tile, `Vehicle ${this.uid}: cannot restore docked position without anchor tile`)
		this.position = reactive({ ...tile.position })
		this.game.invalidateWorkPlanning('vehicle.position')
		traces.vehicle.log?.('vehicleJob.dock.placement', {
			vehicleUid: this.uid,
			outcome: 'restore-position',
			reason,
			anchorCoord: toAxialCoord(tile.position),
		})
	}

	private traceDockPlacement(outcome: string): void {
		const tile = this.dockTile
		traces.vehicle.log?.('vehicleJob.dock.placement', {
			vehicleUid: this.uid,
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
			servedLineIds: this.servedLines.map((line) => line.id),
			operatorUid: this.operator?.uid,
			service:
				svc && isVehicleLineService(svc)
					? {
							kind: 'line' as const,
							lineId: svc.line.id,
							stopId: svc.stop.id,
							docked: svc.docked,
							operatorUid: svc.operator?.uid,
						}
					: svc && isVehicleMaintenanceService(svc)
						? {
								kind: 'maintenance' as const,
								maintenanceKind: svc.kind,
								targetCoord: svc.targetCoord,
								operatorUid: svc.operator?.uid,
							}
						: undefined,
			storage: this.storage.stock,
		}
	}

	get proposedJobs(): readonly VehicleProposedJob[] {
		const end = profile.proposedJobs.begin?.('vehicle.proposedJobs', () => ({
			vehicleUid: this.uid,
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
			vehicleUid: this.uid,
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
			uid: this.uid,
			vehicleType: this.vehicleType,
			position: this.position,
			effectivePosition: this.effectivePosition,
			operatorUid: this.operator?.uid,
			service:
				svc && isVehicleLineService(svc)
					? {
							kind: 'line' as const,
							lineId: svc.line.id,
							stopId: svc.stop.id,
							docked: svc.docked,
							operatorUid: svc.operator?.uid,
						}
					: svc && isVehicleMaintenanceService(svc)
						? {
								kind: 'maintenance' as const,
								maintenanceKind: svc.kind,
								targetCoord: svc.targetCoord,
								operatorUid: svc.operator?.uid,
							}
						: undefined,
			servedLineIds: this.servedLines.map((line) => line.id),
			stock: this.storage.stock,
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
		assert(this.service, `Vehicle ${this.uid}: setServiceOperator requires an active service`)
		assert(
			!operator || !this.service.operator || this.service.operator.uid === operator.uid,
			`Vehicle ${this.uid} already operated by ${this.service.operator?.uid}`
		)
		const previous = this.service.operator
		if (previous?.uid === operator?.uid) {
			if (operator) operator.setOperatedVehicleFromService(this)
			return
		}
		if (previous) previous.setOperatedVehicleFromService(undefined)
		this.service.operator = operator
		this.game.invalidateWorkPlanning('vehicle.operator')
		if (operator) {
			const currentVehicle = operator.operates
			if (currentVehicle && currentVehicle.uid !== this.uid) {
				currentVehicle.releaseOperator(operator)
			}
			operator.setOperatedVehicleFromService(this)
		}
	}

	releaseOperator(operator?: Character): void {
		if (operator && this.service?.operator?.uid !== operator.uid) return
		const current = this.service?.operator
		if (!this.service) return
		this.service.operator = undefined
		this.game.invalidateWorkPlanning('vehicle.operator')
		current?.setOperatedVehicleFromService(undefined)
		this.pokeDockStorageCompletionLifecycle()
	}

	beginLineService(line: FreightLineDefinition, stop: FreightStop, operator?: Character): void {
		const next: VehicleLineService = { line, stop, docked: false, operator }
		this.service = next
		this.game.invalidateWorkPlanning('vehicle.service')
		syncFreightVehicleDockRegistration(this)
		this.pokeDockStorageCompletionLifecycle()
	}

	/**
	 * Attach a maintenance offload service describing one of the three sub-kinds
	 * (`loadFromBurden` / `unloadToTile` / `park`). Per-kind state lives on the service so scripts
	 * read intent from `vehicle.service` rather than the transient job payload.
	 */
	beginMaintenanceService(spec: VehicleMaintenanceServiceSpec, operator?: Character): void {
		// Distribute over the discriminated union via the spec helper so each kind keeps its fields.
		const next = { ...spec, operator } as VehicleMaintenanceService
		this.service = next
		this.game.invalidateWorkPlanning('vehicle.service')
		syncFreightVehicleDockRegistration(this)
		this.pokeDockStorageCompletionLifecycle()
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
		assert('anchor' in svc.stop, `Vehicle ${this.uid}: dock requires an anchor stop`)
		if (svc.docked && !this.position) return
		const dockTile = this.dockTile
		assert(dockTile, `Vehicle ${this.uid}: dock requires an anchor tile`)
		assert(this.position, `Vehicle ${this.uid}: dock requires a world position on the anchor tile`)
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
			if (serviceBorder) this.position = reactive({ ...serviceBorder.position })
		}
		const dockPosition = toAxialCoord(this.position)!
		const dockBorder = this.game.hex.getBorder(dockPosition)
		const isAtDockBorder =
			!!dockBorder &&
			(axial.key(toAxialCoord(dockBorder.tile.a.position)!) === axial.key(dockCoord) ||
				axial.key(toAxialCoord(dockBorder.tile.b.position)!) === axial.key(dockCoord))
		assert(
			axial.key(axial.round(dockPosition)) === axial.key(dockCoord) || isAtDockBorder,
			`Vehicle ${this.uid}: dock requires vehicle to be on the anchor tile or its border`
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
		syncFreightVehicleDockRegistration(this)
		this.service = undefined
		this.game.invalidateWorkPlanning('vehicle.service')
		this.pokeDockStorageCompletionLifecycle()
	}

	setServedLines(lines: readonly FreightLineDefinition[], reason = 'vehicle.served-lines'): void {
		const unique = new Map<string, FreightLineDefinition>()
		for (const line of lines) unique.set(line.id, line)
		const next = [...unique.values()]
		const currentIds = this.servedLines.map((line) => line.id).join('\n')
		const nextIds = next.map((line) => line.id).join('\n')
		const sameReferences =
			this.servedLines.length === next.length &&
			this.servedLines.every((line, index) => line === next[index])
		if (currentIds === nextIds && sameReferences) return
		this.servedLines = reactive(next)
		this.game.invalidateWorkPlanning(reason)
	}

	setServedLineIds(lineIds: readonly string[], reason = 'vehicle.served-lines'): void {
		const lines = lineIds
			.map((lineId) => this.game.freightLines.find((line) => line.id === lineId))
			.filter((line): line is FreightLineDefinition => !!line)
		this.setServedLines(lines, reason)
	}

	assignFreightLine(line: FreightLineDefinition): boolean {
		if (this.servedLines.some((entry) => entry.id === line.id)) return false
		this.setServedLines([...this.servedLines, line], 'vehicle.assign-line')
		return true
	}

	unassignFreightLine(lineId: string): boolean {
		const next = this.servedLines.filter((line) => line.id !== lineId)
		if (next.length === this.servedLines.length) return false
		this.setServedLines(next, 'vehicle.unassign-line')
		const svc = this.service
		if (isVehicleLineService(svc) && svc.line.id === lineId) this.endService()
		return true
	}

	refreshFreightLineReference(line: FreightLineDefinition): void {
		let changed = false
		const next = this.servedLines.map((entry) => {
			if (entry.id !== line.id) return entry
			changed = changed || entry !== line
			return line
		})
		const svc = this.service
		if (isVehicleLineService(svc) && svc.line.id === line.id) {
			svc.line = line
			const stop = line.stops.find((entry) => entry.id === svc.stop.id)
			if (stop) {
				const wasDocked = this.isDocked
				if (wasDocked && !sameAnchorStop(svc.stop, stop)) {
					this.enqueueDockPresentationChange()
					this.restoreWorldPositionFromDock('refresh-line')
					svc.docked = false
				}
				svc.stop = stop
			}
			changed = true
		}
		if (changed) this.setServedLines(next, 'vehicle.refresh-line')
		if (changed) this.game.invalidateWorkPlanning('vehicle.refresh-line')
	}

	private serializeService(): VehicleServiceSerialized | undefined {
		const svc = this.service
		if (!svc) return undefined
		if (isVehicleLineService(svc)) {
			return {
				kind: 'line',
				lineId: svc.line.id,
				stopId: svc.stop.id,
				docked: svc.docked,
				operatorUid: svc.operator?.uid,
			}
		}
		if (!isVehicleMaintenanceService(svc)) return undefined
		return {
			kind: 'maintenance',
			maintenanceKind: svc.kind,
			targetCoord: { q: svc.targetCoord.q, r: svc.targetCoord.r },
			operatorUid: svc.operator?.uid,
		}
	}

	override destroy(): void {
		this.dockStorageCompletionEffect?.()
		this.dockStorageCompletionEffect = undefined
		super.destroy()
	}

	serialize(): VehicleSerializedState {
		const coord = axial.round(toAxialCoord(this.effectivePosition)!)
		return {
			uid: this.uid,
			vehicleType: this.vehicleType,
			position: { q: coord.q, r: coord.r },
			goods: this.storage.stock,
			servedLineIds: this.servedLines.map((line) => line.id),
			service: this.serializeService(),
		}
	}

	static deserialize(game: Game, data: VehicleSerializedState): VehicleEntity {
		const vehicle = new VehicleEntity(
			game,
			data.uid,
			data.vehicleType,
			data.position,
			data.servedLineIds
				.map((lineId) => game.freightLines.find((line) => line.id === lineId))
				.filter((line): line is FreightLineDefinition => !!line)
		)
		for (const [goodType, qty] of Object.entries(data.goods ?? {})) {
			vehicle.storage.addGood(goodType as GoodType, qty as number)
		}
		if (data.service) {
			VehicleEntity.restoreService(game, vehicle, data.service)
		}
		return vehicle
	}

	private static restoreService(
		game: Game,
		vehicle: VehicleEntity,
		saved:
			| VehicleServiceSerialized
			| LegacyLineVehicleServiceSerialized
			| LegacyOffloadVehicleServiceSerialized
	): void {
		const operator = saved.operatorUid ? game.population.character(saved.operatorUid) : undefined
		// Pre-discriminator legacy offload save: the planner re-discovers maintenance work.
		if ('kind' in saved && saved.kind === 'offload') return
		// New maintenance save: also transient — planner re-validates targets against current world.
		if ('kind' in saved && saved.kind === 'maintenance') return
		const linePayload = saved as
			| LegacyLineVehicleServiceSerialized
			| Extract<VehicleServiceSerialized, { kind: 'line' }>
		const line = game.freightLines.find((l) => l.id === linePayload.lineId)
		if (!line) return
		const stop = line.stops.find((s) => s.id === linePayload.stopId)
		if (!stop) return
		vehicle.service = { line, stop, docked: false, operator } as VehicleLineService
		if (linePayload.docked) vehicle.dock()
		else syncFreightVehicleDockRegistration(vehicle)
	}
}
