import type { Alveolus } from 'ssh/board/content/alveolus'
import { type FreightLineDefinition, findDistributeRouteSegments } from 'ssh/freight/freight-line'
import {
	computeLineFurtherGoods,
	projectLoadedGoodsAgainstFurtherNeeds,
} from 'ssh/freight/freight-stop-utility'
import type { StorageAlveolus } from 'ssh/hive/storage'
import type { VehicleEntity } from 'ssh/population/vehicle/entity'
import { isVehicleLineService } from 'ssh/population/vehicle/vehicle'
import type { GoodType } from 'ssh/types/base'
import type { ExchangePriority, GoodsRelations } from 'ssh/utils/advertisement'

/** Hive convey party for a docked line vehicle sharing a road-fret bay tile. */
export class VehicleFreightDock {
	static readonly kind = 'vehicle-freight-dock' as const

	readonly kind = VehicleFreightDock.kind

	constructor(
		public readonly vehicle: VehicleEntity,
		public readonly bay: StorageAlveolus
	) {}

	get name(): string {
		return `vehicle-dock:${this.vehicle.uid}`
	}

	get hive() {
		return this.bay.hive
	}

	get tile() {
		return this.bay.tile
	}

	get storage() {
		return this.vehicle.storage
	}

	get destroyed(): boolean {
		return this.bay.destroyed
	}

	canTake(goodType: GoodType, priority: ExchangePriority): boolean {
		if (priority !== '2-use') return false
		const rel = dockedVehicleGoodsRelations(this.vehicle, this.bay)
		const ad = rel[goodType]
		return ad?.advertisement === 'demand'
	}

	canGive(goodType: GoodType, priority: ExchangePriority): boolean {
		if (priority !== '2-use') return false
		const rel = dockedVehicleGoodsRelations(this.vehicle, this.bay)
		const ad = rel[goodType]
		return ad?.advertisement === 'provide'
	}
}

export type FreightMovementParty = Alveolus | VehicleFreightDock

export function isVehicleFreightDock(p: FreightMovementParty): p is VehicleFreightDock {
	return (p as VehicleFreightDock).kind === VehicleFreightDock.kind
}

/** True when a convey worker assigned to `alveolus` is responsible for `party` (bay tile or dock). */
export function freightPartyMatchesAssignedAlveolus(
	party: FreightMovementParty,
	alveolus: Alveolus | undefined
): boolean {
	if (!alveolus) return false
	if (party === alveolus) return true
	return isVehicleFreightDock(party) && party.bay === alveolus
}

function distributeLoadSegmentForAnchor(
	line: FreightLineDefinition,
	anchorStopIndex: number
): ReturnType<typeof findDistributeRouteSegments>[number] | undefined {
	return findDistributeRouteSegments(line).find((s) => s.loadStopIndex === anchorStopIndex)
}

/**
 * `2-use` advertisements for a docked wheelbarrow at a road-fret bay.
 *
 * Current cargo is first projected against downstream line need:
 * - surplus loaded goods can be unloaded into the bay
 * - remaining downstream need can be loaded from the bay when this anchor is a distribute pickup
 */
export function dockedVehicleGoodsRelations(
	vehicle: VehicleEntity,
	bay: StorageAlveolus
): GoodsRelations {
	const svc = vehicle.service
	if (!isVehicleLineService(svc) || vehicle.vehicleType !== 'wheelbarrow') return {}
	if (!svc.docked) return {}
	if (bay.action?.type !== 'road-fret') return {}

	const { line, stop } = svc
	const stopIdx = line.stops.findIndex((s) => s.id === stop.id)
	if (stopIdx < 0) return {}
	if (!('anchor' in stop)) return {}

	const relations: GoodsRelations = {}
	const further = computeLineFurtherGoods({
		game: vehicle.game,
		line,
		currentStopIndex: stopIdx,
	})
	const projected = projectLoadedGoodsAgainstFurtherNeeds(
		vehicle.storage.stock,
		further.furtherNeededGoods.perGood
	)

	for (const goodType of Object.keys(projected.surplusLoadedGoods.perGood) as GoodType[]) {
		if (vehicle.storage.available(goodType) <= 0) continue
		if ((bay.storage.hasRoom(goodType) ?? 0) <= 0) continue
		relations[goodType] = { advertisement: 'provide', priority: '2-use' }
	}

	const distLoad = distributeLoadSegmentForAnchor(line, stopIdx)
	if (distLoad) {
		for (const goodType of Object.keys(projected.remainingNeededGoods.perGood) as GoodType[]) {
			if ((bay.storage.available(goodType) ?? 0) <= 0) continue
			if ((vehicle.storage.hasRoom(goodType) ?? 0) <= 0) continue
			relations[goodType] = { advertisement: 'demand', priority: '2-use' }
		}
	}

	return relations
}
