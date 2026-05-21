import { jobBalance } from 'engine-rules'
import type { Alveolus } from 'ssh/board/content/alveolus'
import { type FreightLineDefinition, findDistributeRouteSegments } from 'ssh/freight/freight-line'
import {
	computeLineFurtherGoods,
	projectLoadedGoodsAgainstFurtherNeeds,
} from 'ssh/freight/freight-stop-utility'
import { isLineFreightVehicleType } from 'ssh/freight/line-freight-vehicles'
import { scoreVehicleCandidate } from 'ssh/freight/vehicle-candidate-policy'
import type { FreightBayAlveolus } from 'ssh/hive/freight-bay'
import type { VehicleEntity } from 'ssh/population/vehicle/entity'
import { isVehicleLineService } from 'ssh/population/vehicle/vehicle'
import type { GoodType } from 'ssh/types/base'
import type { ExchangePriority, GoodsRelations } from 'ssh/utils/advertisement'
import { traces } from '../dev/debug.ts'

/** Hive convey party for a docked line vehicle sharing a freight bay tile. */
export class VehicleFreightDock {
	static readonly kind = 'vehicle-freight-dock' as const

	readonly kind = VehicleFreightDock.kind

	constructor(
		public readonly vehicle: VehicleEntity,
		public readonly bay: FreightBayAlveolus
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

export interface DockedVehicleAdvertisementCandidate {
	readonly goodType: GoodType
	readonly advertisement: 'demand' | 'provide'
	readonly quantity: number
	readonly score: number
}

function dockedVehicleSurplusHasDestination(bay: FreightBayAlveolus, goodType: GoodType): boolean {
	if (bay.hive.needs[goodType] !== undefined) return true
	return bay.hive.generalStorages.some((storage) => storage.canTake(goodType, '0-store'))
}

function dockedVehicleLoadHasSource(bay: FreightBayAlveolus, goodType: GoodType): boolean {
	if (bay.tile.availableGoods.some((good) => good.goodType === goodType)) return true
	if ((bay.storage.stock[goodType] ?? 0) > 0) return true
	return bay.hive.generalStorages.some((storage) => (storage.storage.stock[goodType] ?? 0) > 0)
}

function projectedDockedVehicleGoods(
	vehicle: VehicleEntity,
	bay: FreightBayAlveolus
): ReturnType<typeof projectLoadedGoodsAgainstFurtherNeeds> | undefined {
	const svc = vehicle.service
	if (!isVehicleLineService(svc) || !isLineFreightVehicleType(vehicle.vehicleType)) return undefined
	if (!vehicle.isDocked) return undefined
	if (bay.action.type !== 'road-fret') return undefined
	const { line, stop } = svc
	const stopIdx = line.stops.findIndex((s) => s.id === stop.id)
	if (stopIdx < 0 || !('anchor' in stop)) return undefined
	const further = computeLineFurtherGoods({
		game: vehicle.game,
		line,
		currentStopIndex: stopIdx,
	})
	return projectLoadedGoodsAgainstFurtherNeeds(
		vehicle.storage.stock,
		further.furtherNeededGoods.perGood
	)
}

/**
 * Scored dock transfer candidates for a docked line freight vehicle at a freight bay.
 *
 * Current cargo is first projected against downstream line need:
 * - surplus loaded goods can be unloaded into real hive destinations
 * - remaining downstream need can be loaded from real hive providers when this anchor is a distribute pickup
 */
export function collectDockedVehicleAdvertisementCandidates(
	vehicle: VehicleEntity,
	bay: FreightBayAlveolus
): DockedVehicleAdvertisementCandidate[] {
	const svc = vehicle.service
	if (!isVehicleLineService(svc) || !isLineFreightVehicleType(vehicle.vehicleType)) {
		traces.vehicle.log?.('[dock.candidates] skipped: not line freight vehicle', {
			vehicleUid: vehicle.uid,
			vehicleType: vehicle.vehicleType,
			serviceKind: svc ? 'maintenance' : undefined,
		})
		return []
	}
	if (!vehicle.isDocked) {
		traces.vehicle.log?.('[dock.candidates] skipped: not docked', { vehicleUid: vehicle.uid })
		return []
	}
	if (bay.action.type !== 'road-fret') {
		traces.vehicle.log?.('[dock.candidates] skipped: bay is not freight bay', {
			vehicleUid: vehicle.uid,
			bay: bay.name,
			actionType: bay.action.type,
		})
		return []
	}

	const { line, stop } = svc
	const stopIdx = line.stops.findIndex((s) => s.id === stop.id)
	if (stopIdx < 0) {
		traces.vehicle.warn?.('[dock.candidates] skipped: stop not in line', {
			vehicleUid: vehicle.uid,
			lineId: line.id,
			stopId: stop.id,
		})
		return []
	}
	if (!('anchor' in stop)) {
		traces.vehicle.log?.('[dock.candidates] skipped: current stop is not an anchor', {
			vehicleUid: vehicle.uid,
			lineId: line.id,
			stopId: stop.id,
		})
		return []
	}

	const candidates: DockedVehicleAdvertisementCandidate[] = []
	const projected = projectedDockedVehicleGoods(vehicle, bay)
	if (!projected) return []

	for (const goodType of Object.keys(projected.surplusLoadedGoods.perGood) as GoodType[]) {
		const quantity = vehicle.storage.available(goodType)
		if (quantity <= 0) continue
		if (!dockedVehicleSurplusHasDestination(bay, goodType)) {
			traces.vehicle.warn?.('[dock.candidates] surplus has no destination', {
				vehicleUid: vehicle.uid,
				bay: bay.name,
				lineId: line.id,
				stopId: stop.id,
				goodType,
				vehicleStock: vehicle.storage.stock[goodType] ?? 0,
				vehicleAvailable: quantity,
			})
			continue
		}
		candidates.push({
			goodType,
			advertisement: 'provide',
			quantity,
			score: scoreVehicleCandidate({
				kind: 'dockProvide',
				urgency: jobBalance.unloadFromVehicle,
				distance: 0,
				priorityTier: 'pureLine',
				quantity,
			}).score,
		})
	}

	const distLoad = distributeLoadSegmentForAnchor(line, stopIdx)
	if (distLoad) {
		for (const goodType of Object.keys(projected.remainingNeededGoods.perGood) as GoodType[]) {
			const quantity = Math.min(
				vehicle.storage.hasRoom(goodType) ?? 0,
				projected.remainingNeededGoods.perGood[goodType] ?? 0
			)
			if (quantity <= 0) continue
			if ((vehicle.storage.hasRoom(goodType) ?? 0) <= 0) continue
			if (!dockedVehicleLoadHasSource(bay, goodType)) continue
			candidates.push({
				goodType,
				advertisement: 'demand',
				quantity,
				score: scoreVehicleCandidate({
					kind: 'dockDemand',
					urgency: jobBalance.loadOntoVehicle,
					distance: 0,
					priorityTier: 'pureLine',
					quantity,
				}).score,
			})
		}
	}

	traces.vehicle.log?.('[dock.candidates] collected', {
		vehicleUid: vehicle.uid,
		bay: bay.name,
		lineId: line.id,
		stopId: stop.id,
		stock: { ...vehicle.storage.stock },
		projectedSurplus: projected.surplusLoadedGoods.perGood,
		projectedRemainingNeed: projected.remainingNeededGoods.perGood,
		candidates,
	})
	return candidates
}

/** Advertisements for a docked wheelbarrow at a freight bay. */
export function dockedVehicleGoodsRelations(
	vehicle: VehicleEntity,
	bay: FreightBayAlveolus
): GoodsRelations {
	const relations: GoodsRelations = {}
	const projected = projectedDockedVehicleGoods(vehicle, bay)
	if (projected) {
		for (const goodType of Object.keys(projected.reservedLoadedGoods.perGood) as GoodType[]) {
			if (vehicle.storage.available(goodType) <= 0) continue
			relations[goodType] = {
				advertisement: 'provide',
				priority: '1-buffer',
			}
		}
	}
	for (const candidate of collectDockedVehicleAdvertisementCandidates(vehicle, bay)) {
		const current = relations[candidate.goodType]
		if (current && current.advertisement !== candidate.advertisement) {
			delete relations[candidate.goodType]
		}
		relations[candidate.goodType] = {
			advertisement: candidate.advertisement,
			priority: '2-use',
		}
	}
	return relations
}

export function refreshDockedVehicleAdvertisement(
	vehicle: VehicleEntity,
	bay: FreightBayAlveolus
): DockedVehicleAdvertisementCandidate[] {
	const candidates = collectDockedVehicleAdvertisementCandidates(vehicle, bay)
	const relations = dockedVehicleGoodsRelations(vehicle, bay)
	const dock = bay.hive.freightVehicleDockFor(vehicle.uid)
	if (!dock) return candidates
	bay.hive.advertise(dock, Object.keys(relations).length > 0 ? relations : {})
	return candidates
}
