import { reactive } from 'mutts'
import type { Tile } from 'ssh/board/tile'
import { assert } from 'ssh/debug'
import type { FreightLineDefinition, FreightStop } from 'ssh/freight/freight-line'
import { syncFreightVehicleDockRegistration } from 'ssh/freight/vehicle-freight-dock-sync'
import type { Game } from 'ssh/game/game'
import { GameObject, withInteractive } from 'ssh/game/object'
import type { Storage } from 'ssh/storage'
import type { GoodType } from 'ssh/types'
import { axial } from 'ssh/utils'
import { type Position, toAxialCoord } from 'ssh/utils/position'
import type { Character } from '../character'
import {
	createVehicleStorage,
	isVehicleLineService,
	isVehicleOffloadService,
	type LegacyLineVehicleServiceSerialized,
	type VehicleLineService,
	type VehicleOffloadService,
	type VehicleSerializedState,
	type VehicleService,
	type VehicleServiceSerialized,
	type WorldVehicleType,
} from './vehicle'

export class VehicleEntity extends withInteractive(GameObject) {
	declare readonly storage: Storage
	public position: Position
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
		const coord = axial.round(toAxialCoord(this.position)!)
		return this.game.hex.getTile(coord)!
	}

	get debugInfo(): Record<string, unknown> {
		const svc = this.service
		return {
			vehicleType: this.vehicleType,
			position: this.position,
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
					: svc && isVehicleOffloadService(svc)
						? { kind: 'offload' as const, operatorUid: svc.operator?.uid }
						: undefined,
			storage: this.storage.stock,
		}
	}

	canInteract(_action: string): boolean {
		return false
	}

	/**
	 * Sets `service.operator`. The vehicle must already have a {@link service} object
	 * (line or offload); use {@link beginLineService} / {@link beginOffloadService} first.
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

	beginOffloadService(operator?: Character): void {
		const next: VehicleOffloadService = { operator }
		this.service = next
		syncFreightVehicleDockRegistration(this)
	}

	/** @deprecated Prefer {@link beginLineService}. */
	beginService(line: FreightLineDefinition, stop: FreightStop, operator?: Character): void {
		this.beginLineService(line, stop, operator)
	}

	dock(): void {
		const svc = this.service
		if (!isVehicleLineService(svc)) return
		svc.docked = true
		syncFreightVehicleDockRegistration(this)
	}

	undock(): void {
		const svc = this.service
		if (!isVehicleLineService(svc)) return
		svc.docked = false
		syncFreightVehicleDockRegistration(this)
	}

	advanceToStop(stop: FreightStop): void {
		const svc = this.service
		if (!isVehicleLineService(svc)) return
		svc.stop = stop
		svc.docked = false
		syncFreightVehicleDockRegistration(this)
	}

	endService(): void {
		this.releaseOperator()
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
		return {
			kind: 'offload',
			operatorUid: svc.operator?.uid,
		}
	}

	serialize(): VehicleSerializedState {
		const coord = axial.round(toAxialCoord(this.position)!)
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
		saved: VehicleServiceSerialized | LegacyLineVehicleServiceSerialized
	): void {
		const operator = saved.operatorUid ? game.population.character(saved.operatorUid) : undefined
		if ('kind' in saved && saved.kind === 'offload') {
			vehicle.service = { operator }
			return
		}
		const linePayload = saved as
			| LegacyLineVehicleServiceSerialized
			| Extract<VehicleServiceSerialized, { kind: 'line' }>
		const line = game.freightLines.find((l) => l.id === linePayload.lineId)
		if (!line) return
		const stop = line.stops.find((s) => s.id === linePayload.stopId)
		if (!stop) return
		vehicle.service = { line, stop, docked: linePayload.docked, operator } as VehicleLineService
	}
}
