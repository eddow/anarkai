import { reactive } from 'mutts'
import type { Tile } from 'ssh/board/tile'
import type { FreightLineDefinition, FreightStop } from 'ssh/freight/freight-line'
import { syncFreightVehicleDockRegistration } from 'ssh/freight/vehicle-freight-dock-sync'
import type { Game } from 'ssh/game/game'
import { GameObject, withInteractive } from 'ssh/game/object'
import type { Storage } from 'ssh/storage'
import type { GoodType } from 'ssh/types'
import { axial } from 'ssh/utils'
import { type Position, toAxialCoord } from 'ssh/utils/position'
import { assert, traces } from '../../dev/debug.ts'
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

export class VehicleEntity extends withInteractive(GameObject) {
	declare readonly storage: Storage
	public position: Position | undefined
	public servedLines: FreightLineDefinition[]
	public service?: VehicleService
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
		this.servedLines = reactive([...servedLines])
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
			const coord = axial.round(toAxialCoord(this.position)!)
			return this.game.hex.getTile(coord)!
		}
		const tile = this.dockTile
		assert(tile, `Vehicle ${this.uid}: unpositioned vehicle has no dock tile`)
		return tile
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

	get worldTile(): Tile | undefined {
		if (!this.position) return undefined
		const coord = axial.round(toAxialCoord(this.position)!)
		return this.game.hex.getTile(coord)!
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
		current?.setOperatedVehicleFromService(undefined)
	}

	beginLineService(line: FreightLineDefinition, stop: FreightStop, operator?: Character): void {
		const next: VehicleLineService = { line, stop, docked: false, operator }
		this.service = next
		syncFreightVehicleDockRegistration(this)
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
		syncFreightVehicleDockRegistration(this)
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
		svc.docked = true
		this.position = undefined
		this.traceDockPlacement('clear-position')
		syncFreightVehicleDockRegistration(this)
	}

	undock(): void {
		const svc = this.service
		if (!isVehicleLineService(svc)) return
		this.restoreWorldPositionFromDock('undock')
		svc.docked = false
		this.traceDockPlacement('undock')
		syncFreightVehicleDockRegistration(this)
	}

	advanceToStop(stop: FreightStop): void {
		const svc = this.service
		if (!isVehicleLineService(svc)) return
		this.restoreWorldPositionFromDock('advance-stop')
		svc.stop = stop
		svc.docked = false
		syncFreightVehicleDockRegistration(this)
	}

	endService(): void {
		this.releaseOperator()
		this.restoreWorldPositionFromDock('end-service')
		if (isVehicleLineService(this.service)) this.service.docked = false
		syncFreightVehicleDockRegistration(this)
		this.service = undefined
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
