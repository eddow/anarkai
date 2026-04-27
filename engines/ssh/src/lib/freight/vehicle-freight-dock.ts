import { jobBalance } from 'engine-rules'
import type { Alveolus } from 'ssh/board/content/alveolus'
import { type FreightLineDefinition, findDistributeRouteSegments } from 'ssh/freight/freight-line'
import {
	computeLineFurtherGoods,
	projectLoadedGoodsAgainstFurtherNeeds,
} from 'ssh/freight/freight-stop-utility'
import { scoreVehicleCandidate } from 'ssh/freight/vehicle-candidate-policy'
import type { StorageAlveolus } from 'ssh/hive/storage'
import type { VehicleEntity } from 'ssh/population/vehicle/entity'
import { isVehicleLineService } from 'ssh/population/vehicle/vehicle'
import type { GoodType } from 'ssh/types/base'
import type { ExchangePriority, GoodsRelations } from 'ssh/utils/advertisement'
import { assert } from '../dev/debug.ts'

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

export interface DockedVehicleAdvertisementCandidate {
	readonly goodType: GoodType
	readonly advertisement: 'demand' | 'provide'
	readonly quantity: number
	readonly score: number
}

/**
 * Scored dock transfer candidates for a docked wheelbarrow at a road-fret bay.
 *
 * Current cargo is first projected against downstream line need:
 * - surplus loaded goods can be unloaded into the bay
 * - remaining downstream need can be loaded from the bay when this anchor is a distribute pickup
 */
export function collectDockedVehicleAdvertisementCandidates(
	vehicle: VehicleEntity,
	bay: StorageAlveolus
): DockedVehicleAdvertisementCandidate[] {
	const svc = vehicle.service
	if (!isVehicleLineService(svc) || vehicle.vehicleType !== 'wheelbarrow') return []
	if (!vehicle.isDocked) return []
	if (bay.action?.type !== 'road-fret') return []

	const { line, stop } = svc
	const stopIdx = line.stops.findIndex((s) => s.id === stop.id)
	if (stopIdx < 0) return []
	if (!('anchor' in stop)) return []

	const candidates: DockedVehicleAdvertisementCandidate[] = []
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
		const quantity = vehicle.storage.available(goodType)
		if (quantity <= 0) continue
		if ((bay.storage.hasRoom(goodType) ?? 0) <= 0) continue
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
				bay.storage.available(goodType) ?? 0,
				vehicle.storage.hasRoom(goodType) ?? 0,
				projected.remainingNeededGoods.perGood[goodType] ?? 0
			)
			if (quantity <= 0) continue
			if ((vehicle.storage.hasRoom(goodType) ?? 0) <= 0) continue
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

	return candidates
}

/** `2-use` advertisements for a docked wheelbarrow at a road-fret bay. */
export function dockedVehicleGoodsRelations(
	vehicle: VehicleEntity,
	bay: StorageAlveolus
): GoodsRelations {
	const relations: GoodsRelations = {}
	for (const candidate of collectDockedVehicleAdvertisementCandidates(vehicle, bay)) {
		const current = relations[candidate.goodType]
		assert(
			!current || current.advertisement === candidate.advertisement,
			`dockedVehicleGoodsRelations: ${candidate.goodType} cannot be both ${current?.advertisement} and ${candidate.advertisement}`
		)
		relations[candidate.goodType] = {
			advertisement: candidate.advertisement,
			priority: '2-use',
		}
	}
	return relations
}
