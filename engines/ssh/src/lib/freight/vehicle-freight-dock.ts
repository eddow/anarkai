import { jobBalance } from 'engine-rules'
import type { Alveolus } from 'ssh/board/content/alveolus'
import {
	type FreightLineDefinition,
	findDistributeRouteSegments,
} from 'ssh/freight/freight-line'
import {
	computeFutureFreightTransfer,
	measureFreightStopNeededGoods,
	snapshotFromGoodsCounts,
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
	const segment = findDistributeRouteSegments(line).find((s) => s.loadStopIndex === anchorStopIndex)
	if (segment) return segment
	const loadStop = line.stops[anchorStopIndex]
	const unloadStop = line.stops[anchorStopIndex + 1]
	if (!loadStop || !unloadStop) return undefined
	if (!('anchor' in loadStop) || !loadStop.loadSelection) return undefined
	if (!unloadStop.unloadSelection) return undefined
	if (!('anchor' in unloadStop) && !('zone' in unloadStop) && !('trade' in unloadStop)) {
		return undefined
	}
	return { loadStopIndex: anchorStopIndex, unloadStopIndex: anchorStopIndex + 1 }
}

export interface DockedVehicleAdvertisementCandidate {
	readonly goodType: GoodType
	readonly advertisement: 'demand' | 'provide'
	readonly quantity: number
	readonly score: number
}

function storageReservedGoods(vehicle: VehicleEntity, goodType: GoodType): number {
	return vehicle.storage.renderedGoods().slots.reduce(
		(total, slot) => total + (slot.goodType === goodType ? Math.max(0, slot.reserved) : 0),
		0
	)
}

function advertisedProviderQuantity(alveolus: Alveolus, goodType: GoodType): number {
	const relation = alveolus.goodsRelations[goodType]
	if (relation?.advertisement !== 'provide') return 0
	if (!alveolus.canGive(goodType, relation.priority)) return 0
	return alveolus.storage?.available(goodType) ?? 0
}

function advertisedDemanderQuantity(alveolus: Alveolus, goodType: GoodType): number {
	const relation = alveolus.goodsRelations[goodType]
	if (relation?.advertisement !== 'demand') return 0
	if (relation.priority === '0-store') return 0
	if (!alveolus.canTake(goodType, relation.priority)) return 0
	const acceptedRoomFor = (
		alveolus as {
			acceptedRoomFor?: (goodType: GoodType, priority: ExchangePriority) => number
		}
	).acceptedRoomFor
	return acceptedRoomFor
		? acceptedRoomFor.call(alveolus, goodType, relation.priority)
		: (alveolus.storage?.hasRoom(goodType) ?? 0)
}

function currentAdvertisedSupply(bay: FreightBayAlveolus, goodType: GoodType): number {
	let quantity = 0
	const counted = new Set<Alveolus>()
	for (const alveolus of bay.hive.alveoli) {
		if (alveolus === bay) continue
		const provided = advertisedProviderQuantity(alveolus, goodType)
		if (provided > 0) {
			counted.add(alveolus)
			quantity += provided
		}
	}
	for (const storage of bay.hive.generalStorages) {
		if (counted.has(storage)) continue
		if (!storage.canGive(goodType, '2-use')) continue
		quantity += storage.storage.available(goodType)
	}
	return quantity
}

function currentAdvertisedDemand(bay: FreightBayAlveolus, goodType: GoodType): number {
	let quantity = 0
	for (const alveolus of bay.hive.alveoli) {
		if (alveolus === bay) continue
		quantity += advertisedDemanderQuantity(alveolus, goodType)
	}
	return quantity
}

function dockedVehicleFutureTransfer(
	vehicle: VehicleEntity,
	bay: FreightBayAlveolus
):
	| {
			readonly routeNeed: Partial<Record<GoodType, number>>
			readonly routeReservedCargo: Partial<Record<GoodType, number>>
			readonly remainingRouteNeed: Partial<Record<GoodType, number>>
			readonly surplusCargo: Partial<Record<GoodType, number>>
	  }
	| undefined {
	const svc = vehicle.service
	if (!isVehicleLineService(svc) || !isLineFreightVehicleType(vehicle.vehicleType)) return undefined
	if (!vehicle.isDocked) return undefined
	if (bay.action.type !== 'road-fret') return undefined
	const { line, stop } = svc
	const stopIdx = line.stops.findIndex((s) => s.id === stop.id)
	if (stopIdx < 0 || !('anchor' in stop)) return undefined
	const future = computeFutureFreightTransfer({
		game: vehicle.game,
		line,
		currentStopIndex: stopIdx,
	})
	const routeNeed = future.routeNeedGoods.perGood
	const goods = new Set<GoodType>([
		...(Object.keys(vehicle.storage.stock) as GoodType[]),
		...(Object.keys(routeNeed) as GoodType[]),
	])
	const routeReservedCargo: Partial<Record<GoodType, number>> = {}
	const remainingRouteNeed: Partial<Record<GoodType, number>> = {}
	const surplusCargo: Partial<Record<GoodType, number>> = {}
	for (const goodType of goods) {
		const stock = vehicle.storage.stock[goodType] ?? 0
		const allocated = vehicle.storage.allocated(goodType)
		const reserved = storageReservedGoods(vehicle, goodType)
		const projectedOnVehicle = stock + allocated
		const needed = routeNeed[goodType] ?? 0
		const retained = Math.min(projectedOnVehicle, needed)
		const freeStock = Math.max(0, stock - reserved)
		const surplus = Math.max(0, freeStock - Math.max(0, needed - allocated))
		const remaining = Math.max(0, needed - projectedOnVehicle)
		if (retained > 0) routeReservedCargo[goodType] = retained
		if (surplus > 0) surplusCargo[goodType] = surplus
		if (remaining > 0) remainingRouteNeed[goodType] = remaining
	}
	return { routeNeed, routeReservedCargo, remainingRouteNeed, surplusCargo }
}

function clearUnbackedVirtualGoods(vehicle: VehicleEntity): number {
	const storage = vehicle.storage as unknown as {
		slots?: Array<{ reserved: number; allocated: number } | undefined>
		_reserved?: Record<string, number | undefined>
		_allocated?: Record<string, number | undefined>
	}
	let cleared = 0
	if (Array.isArray(storage.slots)) {
		for (const slot of storage.slots) {
			if (!slot) continue
			cleared += Math.max(0, slot.reserved) + Math.max(0, slot.allocated)
			slot.reserved = 0
			slot.allocated = 0
		}
	}
	for (const bucket of [storage._reserved, storage._allocated]) {
		if (!bucket) continue
		for (const key of Object.keys(bucket)) {
			cleared += Math.max(0, bucket[key] ?? 0)
			delete bucket[key]
		}
	}
	if (cleared > 0) vehicle.game.invalidateWorkPlanning('vehicle.dock.orphaned-virtual-goods')
	return cleared
}

export function vehicleDockBlockingVirtualGoodsCount(vehicle: VehicleEntity): number {
	const rendered = vehicle.storage.renderedGoods()
	return rendered.slots.reduce((total, slot) => total + Math.max(0, slot.allocated), 0)
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
	const future = dockedVehicleFutureTransfer(vehicle, bay)
	if (!future) return []
	const distLoad = distributeLoadSegmentForAnchor(line, stopIdx)
	const currentNeeded = measureFreightStopNeededGoods(vehicle.game, line, stopIdx).perGood
	const goods = new Set<GoodType>([
		...(Object.keys(future.remainingRouteNeed) as GoodType[]),
		...(Object.keys(future.surplusCargo) as GoodType[]),
		...(Object.keys(currentNeeded) as GoodType[]),
	])
	for (const goodType of goods) {
		const currentSupply = distLoad ? currentAdvertisedSupply(bay, goodType) : 0
		const currentDemand = Math.max(
			currentAdvertisedDemand(bay, goodType),
			currentNeeded[goodType] ?? 0
		)
		const allocatedToVehicle = vehicle.storage.allocated(goodType)
		const room = vehicle.storage.hasRoom(goodType) ?? 0
		const freshVehicleDemand = Math.min(
			room,
			currentSupply,
			future.remainingRouteNeed[goodType] ?? 0
		)
		const pendingRouteLoad = Math.min(allocatedToVehicle, future.routeNeed[goodType] ?? 0)
		const vehicleDemand = Math.max(freshVehicleDemand, pendingRouteLoad)
		const vehicleProvide = Math.min(
			currentDemand,
			future.surplusCargo[goodType] ?? 0,
			vehicle.storage.available(goodType)
		)
		if (vehicleDemand > 0) {
			candidates.push({
				goodType,
				advertisement: 'demand',
				quantity: vehicleDemand,
				score: scoreVehicleCandidate({
					kind: 'dockDemand',
					urgency: jobBalance.loadOntoVehicle,
					distance: 0,
					priorityTier: 'pureLine',
					quantity: vehicleDemand,
				}).score,
			})
			continue
		}
		if (vehicleProvide > 0) {
			candidates.push({
				goodType,
				advertisement: 'provide',
				quantity: vehicleProvide,
				score: scoreVehicleCandidate({
					kind: 'dockProvide',
					urgency: jobBalance.unloadFromVehicle,
					distance: 0,
					priorityTier: 'pureLine',
					quantity: vehicleProvide,
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
		routeNeed: future.routeNeed,
		routeReservedCargo: snapshotFromGoodsCounts(future.routeReservedCargo).perGood,
		projectedSurplus: snapshotFromGoodsCounts(future.surplusCargo).perGood,
		projectedRemainingNeed: snapshotFromGoodsCounts(future.remainingRouteNeed).perGood,
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
	const dock = bay.hive.freightVehicleDockFor(vehicle.uid)
	if (!dock) return collectDockedVehicleAdvertisementCandidates(vehicle, bay)
	if (vehicle.storage.virtualGoodsCount > 0 && !bay.hive.hasActiveFreightVehicleDockMovement(vehicle.uid)) {
		const canceled = bay.hive.cancelOrphanedFreightVehicleDockAllocations(dock)
		if (canceled > 0 && vehicle.storage.virtualGoodsCount > 0) {
			const cleared = clearUnbackedVirtualGoods(vehicle)
			if (cleared > 0) {
				traces.vehicle.warn?.('[dock.candidates] cleared unbacked virtual goods', {
					vehicleUid: vehicle.uid,
					dock: dock.name,
					canceled,
					cleared,
				})
			}
		}
	}
	const candidates = collectDockedVehicleAdvertisementCandidates(vehicle, bay)
	const relations = dockedVehicleGoodsRelations(vehicle, bay)
	bay.hive.advertise(dock, Object.keys(relations).length > 0 ? relations : {})
	return candidates
}
