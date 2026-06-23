import { jobBalance } from 'engine-rules'
import { Alveolus } from 'ssh/board/content/alveolus'
import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import { freightConstructionDemandTarget } from 'ssh/freight/construction-demand'
import type {
	FreightLineDefinition,
	FreightStop,
	FreightZoneDefinition,
} from 'ssh/freight/freight-line'
import {
	distributeSegmentAllowsGoodTypeForSegment,
	distributeSegmentAllowsTile,
	distributeSegmentBayTile,
	distributeSegmentWithinRadius,
	findDistributeRouteSegments,
	findGatherRouteSegments,
	freightLineStopOrder,
	freightZoneFallbackPosition,
	freightZoneTiles,
	gatherSegmentAllowsGoodType,
	gatherSegmentAllowsGoodTypeForSegment,
	nextFreightLineStop,
} from 'ssh/freight/freight-line'
import {
	computeLineFurtherGoods,
	measureFreightStopNeededGoods,
	measureFreightStopProvidedGoods,
} from 'ssh/freight/freight-stop-utility'
import { executeNpcTradeStopTransfer, npcTradeStopHasTransfer } from 'ssh/freight/npc-trade-stop'
import { scoreVehicleCandidate } from 'ssh/freight/vehicle-candidate-policy'
import {
	refreshDockedVehicleAdvertisement,
	vehicleDockBlockingVirtualGoodsCount,
} from 'ssh/freight/vehicle-freight-dock'
import {
	freightVehicleDockBay,
	syncFreightVehicleDockRegistration,
} from 'ssh/freight/vehicle-freight-dock-sync'
import { pickVehicleZoneBrowseSelection, zoneBrowseUrgency } from 'ssh/freight/vehicle-zone-browse'
import type { Game } from 'ssh/game/game'
import type { Character } from 'ssh/population/character'
import type { Vehicle } from 'ssh/population/vehicle/entity'
import { isVehicleLineService, isVehicleMaintenanceService } from 'ssh/population/vehicle/vehicle'
import type { GoodType } from 'ssh/types/base'
import { axial } from 'ssh/utils/axial'
import { axialDistance, type Position, toAxialCoord } from 'ssh/utils/position'
import { assert, traces } from '../dev/debug.ts'

/**
 * `parkVehicle` is only meaningful when the current hex matters for the board independently of the
 * wheelbarrow itself. A clean `UnBuiltLand` rest tile is fine; alveoli, projects, residential, and
 * tiles with loose goods / deposits should be vacated.
 */
export function vehicleNeedsParkingOnCurrentTile(vehicle: Vehicle): boolean {
	const here = vehicle.tile
	const hereCoord = toAxialCoord(here.position)
	if (
		hereCoord &&
		!vehicle.isDocked &&
		isVehicleLineService(vehicle.service) &&
		vehicle.servedLines.some((line) =>
			line.stops.some(
				(stop) =>
					'anchor' in stop &&
					stop.anchor.coord[0] === hereCoord.q &&
					stop.anchor.coord[1] === hereCoord.r
			)
		)
	) {
		return false
	}
	if (!(here.content instanceof UnBuiltLand)) return true
	if (here.content.project) return true
	if (here.zone === 'residential') return true
	if (!here.isClear) return true
	return false
}

/** Tile center for an anchor stop; best loose-good tile target for a gather zone stop. */
export function freightStopMovementTarget(
	game: Game,
	character: Character,
	line: FreightLineDefinition,
	stop: FreightStop
): Position | undefined {
	if ('anchor' in stop) {
		const t = game.hex.getTile({ q: stop.anchor.coord[0], r: stop.anchor.coord[1] })
		return t?.position
	}
	if ('zone' in stop) {
		const vehicle = character.operates
		if (vehicle) {
			const pick = pickVehicleZoneBrowseSelection(game, character, vehicle, line, stop)
			if (pick) return pick.targetTile.position
		}
		return freightZoneFallbackPosition(game, stop.zone)
	}
	if ('trade' in stop) {
		return game.getSettlementTradeProfile(stop.trade.settlementId)?.cityHall.position
	}
	return undefined
}

/** @deprecated Use {@link freightStopMovementTarget} (zone stops target loose goods, not zone center). */
export function freightStopTargetPosition(game: Game, stop: FreightStop): Position | undefined {
	if ('anchor' in stop) {
		const t = game.hex.getTile({ q: stop.anchor.coord[0], r: stop.anchor.coord[1] })
		return t?.position
	}
	if ('zone' in stop && stop.zone.kind === 'radius') {
		return { q: stop.zone.center[0], r: stop.zone.center[1] }
	}
	if ('zone' in stop && stop.zone.kind === 'named')
		return freightZoneFallbackPosition(game, stop.zone)
	if ('trade' in stop)
		return game.getSettlementTradeProfile(stop.trade.settlementId)?.cityHall.position
	return undefined
}

/**
 * Legacy preview: first served line, first anchor stop else first stop. Prefer
 * {@link pickInitialVehicleServiceCandidate} when `Game` + `Character` are available.
 */
export function previewInitialVehicleService(
	vehicle: Vehicle
): { line: FreightLineDefinition; stop: FreightStop } | undefined {
	const line = vehicle.servedLines[0]
	if (!line) return undefined
	const stop = line.stops.find((s) => 'anchor' in s) ?? line.stops[0]
	if (!stop) return undefined
	return { line, stop }
}

function vehicleLineStockAffinity(line: FreightLineDefinition, vehicle: Vehicle): number {
	let score = 0
	const gatherSegs = findGatherRouteSegments(line)
	const distSegs = findDistributeRouteSegments(line)
	for (const good of Object.keys(vehicle.storage.stock) as GoodType[]) {
		if (vehicle.storage.available(good) <= 0) continue
		let matches = false
		if (gatherSegs.length > 0 && gatherSegmentAllowsGoodType(line, good)) matches = true
		else if (distSegs.length > 0) {
			for (const seg of distSegs) {
				if (distributeSegmentAllowsGoodTypeForSegment(line, seg, good)) {
					matches = true
					break
				}
			}
		}
		if (matches) score++
	}
	return score
}

type BeginServiceActionableWork = {
	readonly target: Position
	readonly stop: FreightStop
	readonly urgency: number
}

/**
 * Whether the hive at the gather segment's **unload** anchor currently advertises demand for
 * `good` (see {@link Hive.needs}). A line's gather filter can allow a good type even when no
 * alveolus in that hive actually demands it; loaded begin-service must not route that cargo to the
 * bay in that case.
 */
export function gatherUnloadAnchorHiveDemandsGood(
	game: Game,
	unloadStop: FreightStop,
	good: GoodType
): boolean {
	if (!('anchor' in unloadStop)) return false
	const tile = game.hex.getTile({ q: unloadStop.anchor.coord[0], r: unloadStop.anchor.coord[1] })
	const content = tile?.content
	if (!(content instanceof Alveolus) || !content.hive) return false
	return content.hive.needs[good] !== undefined
}

function vehicleCapacityForGood(vehicle: Vehicle, goodType: GoodType): number {
	const room = vehicle.storage.hasRoom(goodType) ?? 0
	const loaded = vehicle.storage.available(goodType) ?? 0
	return Math.max(0, room + loaded)
}

function hiveAvailableForGoodAtBay(bayTile: { content?: unknown }, goodType: GoodType): number {
	const content = bayTile.content
	if (!(content instanceof Alveolus) || !content.hive) return 0
	let available = 0
	for (const storage of content.hive.generalStorages) {
		const relation = storage.goodsRelations[goodType]
		const priority = relation?.advertisement === 'provide' ? relation.priority : '2-use'
		if (!storage.canGive(goodType, priority)) continue
		available += Math.max(0, storage.storage.available(goodType) ?? 0)
	}
	return available
}

function distributeBeginServiceUrgency(args: {
	readonly neededGood: number
	readonly vehicleCapacity: number
	readonly availableGoods: number
}): number {
	if (args.neededGood <= 0 || args.vehicleCapacity <= 0 || args.availableGoods <= 0) return 0
	return (
		jobBalance.vehicleBeginService *
		(Math.min(args.neededGood, args.vehicleCapacity) / args.availableGoods)
	)
}

function tradeBeginServiceUrgency(): number {
	return Math.max(jobBalance.vehicleBeginService, jobBalance.convey + 0.25)
}

function goodsIntersectAvailableStock(
	vehicle: Vehicle,
	goods: Partial<Record<GoodType, number>>
): boolean {
	for (const [goodType, quantity] of Object.entries(goods) as [GoodType, number][]) {
		if (quantity > 0 && vehicle.storage.available(goodType) > 0) return true
	}
	return false
}

export function stopHasPotentialVehicleTransfer(
	game: Game,
	character: Character | undefined,
	vehicle: Vehicle,
	line: FreightLineDefinition,
	stop: FreightStop
): boolean {
	const stopIndex = line.stops.indexOf(stop)
	if (stopIndex < 0) return false
	if ('zone' in stop && character) {
		return !!pickVehicleZoneBrowseSelection(game, character, vehicle, line, stop)
	}

	const neededHere = measureFreightStopNeededGoods(game, line, stopIndex).perGood
	if (goodsIntersectAvailableStock(vehicle, neededHere)) return true

	const providedHere = measureFreightStopProvidedGoods(game, line, stopIndex).perGood
	const further = computeLineFurtherGoods({ game, line, currentStopIndex: stopIndex })
	if (
		'trade' in stop &&
		goodsIntersectAvailableStock(vehicle, further.furtherNeededGoods.perGood)
	) {
		return false
	}
	for (const [goodType, quantity] of Object.entries(providedHere) as [GoodType, number][]) {
		if (quantity <= 0) continue
		if ((vehicle.storage.hasRoom(goodType) ?? 0) <= 0) continue
		if ((neededHere[goodType] ?? 0) > 0) return true
		if ((further.furtherNeededGoods.perGood[goodType] ?? 0) > 0) return true
	}
	return false
}

export function nextActionableVehicleLineStop(
	game: Game,
	vehicle: Vehicle,
	line: FreightLineDefinition,
	currentStop: FreightStop,
	character?: Character
): { line: FreightLineDefinition; stop: FreightStop } | undefined {
	if (!line.cyclic) {
		const stop = nextFreightLineStop(line, currentStop)
		return stop ? { line, stop } : undefined
	}
	const startIndex = line.stops.indexOf(currentStop)
	for (const stopIndex of freightLineStopOrder(line, startIndex).slice(1)) {
		const stop = line.stops[stopIndex]
		if (!stop) continue
		if (stopHasPotentialVehicleTransfer(game, character, vehicle, line, stop)) {
			return { line, stop }
		}
	}
	return undefined
}

/**
 * Finds the first meaningful target for {@link vehicleBeginService}. Gather routes need at least one
 * reachable loose good of an allowed type within zone radius (with carrier room); distribute routes
 * qualify only when a standalone construction shell in range still advertises segment-allowed needs
 * and the source hive has matching available goods to load.
 */
function findBeginServiceActionableWork(
	game: Game,
	character: Character,
	vehicle: Vehicle,
	line: FreightLineDefinition
): BeginServiceActionableWork | undefined {
	let best: (BeginServiceActionableWork & { score: number; distance: number }) | undefined
	const consider = (candidate: BeginServiceActionableWork) => {
		const distance = axialDistance(vehicle.effectivePosition, candidate.target)
		const score = scoreVehicleCandidate({
			kind: 'beginService',
			urgency: candidate.urgency,
			distance,
		}).score
		if (!best || score > best.score || (score === best.score && distance < best.distance)) {
			best = { ...candidate, score, distance }
		}
	}
	const gatherSegs = findGatherRouteSegments(line)
	if (gatherSegs.length > 0) {
		for (const segment of gatherSegs) {
			if (!line.cyclic && segment.loadStopIndex !== 0) continue
			const loadStop = line.stops[segment.loadStopIndex]
			const unloadStop = line.stops[segment.unloadStopIndex]
			if (!loadStop || !('zone' in loadStop)) continue
			if (!unloadStop) continue
			for (const good of Object.keys(vehicle.storage.stock) as GoodType[]) {
				if (vehicle.storage.available(good) <= 0) continue
				if (!gatherSegmentAllowsGoodTypeForSegment(line, segment, good)) continue
				if (!gatherUnloadAnchorHiveDemandsGood(game, unloadStop, good)) continue
				const target = freightStopTargetPosition(game, unloadStop)
				if (!target) continue
				const path = game.hex.findPathForVehicleServiceBorder(
					vehicle.effectivePosition,
					target,
					Number.POSITIVE_INFINITY
				)
				if (path) {
					consider({
						target,
						stop: unloadStop,
						urgency: jobBalance.vehicleBeginService,
					})
				}
			}
		}

		for (const segment of gatherSegs) {
			const zoneLoad = line.stops[segment.loadStopIndex]
			if (!zoneLoad || !('zone' in zoneLoad)) continue
			const selection = pickVehicleZoneBrowseSelection(
				game,
				character,
				vehicle,
				line,
				zoneLoad,
				vehicle.effectivePosition
			)
			if (selection?.action !== 'load') continue
			consider({
				target: selection.targetTile.position,
				stop: zoneLoad,
				urgency: zoneBrowseUrgency(selection.action, selection.priorityTier),
			})
		}
	}
	for (const segment of findDistributeRouteSegments(line)) {
		const loadStop = line.stops[segment.loadStopIndex]
		if (!loadStop) continue
		const bayTile = distributeSegmentBayTile(game, line, segment)
		if (!bayTile) continue
		const bayPos = toAxialCoord(bayTile.position)
		if (!bayPos) continue
		let bestUrgency = 0
		const unloadStop = line.stops[segment.unloadStopIndex]
		const tiles =
			unloadStop && 'zone' in unloadStop
				? unloadStop.zone.kind === 'radius'
					? game.hex.tilesAround(bayPos, unloadStop.zone.radius)
					: freightZoneTiles(game, unloadStop.zone)
				: game.hex.tiles
		for (const tile of tiles) {
			const c = freightConstructionDemandTarget(tile.content)
			if (!c || c.destroyed || c.isReady) continue
			const tilePos = toAxialCoord(tile.position)
			if (!tilePos) continue
			if (!distributeSegmentWithinRadius(line, segment, axial.distance(bayPos, tilePos))) continue
			if (!distributeSegmentAllowsTile(game, line, segment, tile)) continue
			const remaining = c.remainingNeeds
			for (const g of Object.keys(remaining) as GoodType[]) {
				const neededGood = remaining[g] ?? 0
				if (neededGood <= 0) continue
				if (distributeSegmentAllowsGoodTypeForSegment(line, segment, g)) {
					const availableGoods = hiveAvailableForGoodAtBay(bayTile, g)
					if (availableGoods <= 0) continue
					const vehicleCapacity = vehicleCapacityForGood(vehicle, g)
					if (vehicleCapacity <= 0) continue
					bestUrgency = Math.max(
						bestUrgency,
						distributeBeginServiceUrgency({
							neededGood,
							vehicleCapacity,
							availableGoods,
						})
					)
				}
			}
		}
		if (bestUrgency > 0) {
			consider({ target: bayTile.position, stop: loadStop, urgency: bestUrgency })
		}
	}
	for (const [idx, stop] of line.stops.entries()) {
		if (!('zone' in stop)) continue
		if (!line.cyclic && vehicleStorageStockCount(vehicle) <= 0 && idx !== 0) continue
		const selection = pickVehicleZoneBrowseSelection(
			game,
			character,
			vehicle,
			line,
			stop,
			vehicle.effectivePosition
		)
		if (!selection) continue
		if (vehicleStorageStockCount(vehicle) > 0 && selection.action !== 'provide') continue
		if (vehicleStorageStockCount(vehicle) <= 0 && selection.action !== 'load') continue
		consider({
			target: selection.targetTile.position,
			stop,
			urgency: zoneBrowseUrgency(selection.action, selection.priorityTier),
		})
	}
	for (const stop of line.stops) {
		if (!('trade' in stop)) continue
		if (!stopHasPotentialVehicleTransfer(game, character, vehicle, line, stop)) continue
		const target = freightStopTargetPosition(game, stop)
		if (!target) continue
		consider({
			target,
			stop,
			urgency: tradeBeginServiceUrgency(),
		})
	}
	return best ? { target: best.target, stop: best.stop, urgency: best.urgency } : undefined
}

/**
 * Choose initial `line` + `stop` for `vehicleBeginService`: among served lines with actionable
 * work, minimize travel distance from the vehicle to the first meaningful hop target for that
 * line's primary stop; ties favor lines whose goods policy matches current vehicle stock.
 */
export function pickInitialVehicleServiceCandidate(
	game: Game,
	character: Character,
	vehicle: Vehicle
): { line: FreightLineDefinition; stop: FreightStop; urgency: number } | undefined {
	let best:
		| {
				line: FreightLineDefinition
				stop: FreightStop
				score: number
				affinity: number
				urgency: number
		  }
		| undefined
	for (const line of vehicle.servedLines) {
		const actionable = findBeginServiceActionableWork(game, character, vehicle, line)
		if (!actionable) continue
		const distance = axialDistance(vehicle.effectivePosition, actionable.target)
		const score = scoreVehicleCandidate({
			kind: 'beginService',
			urgency: actionable.urgency,
			distance,
		}).score
		const affinity = vehicleLineStockAffinity(line, vehicle)
		if (!best || score > best.score || (score === best.score && affinity > best.affinity)) {
			best = { line, stop: actionable.stop, score, affinity, urgency: actionable.urgency }
		}
	}
	return best ? { line: best.line, stop: best.stop, urgency: best.urgency } : undefined
}

/**
 * Read-only projection of which line/stop the next hop should aim for: if the current zone gather is
 * complete, behave as if already advanced to the next stop (without mutating `vehicle.service`).
 */
export function projectedLineStopForVehicleHop(
	game: Game,
	character: Character,
	vehicle: Vehicle
): { line: FreightLineDefinition; stop: FreightStop } | undefined {
	const svc = vehicle.service
	if (!isVehicleLineService(svc)) return undefined
	const line = svc.line
	const stop = svc.stop
	if (!('zone' in stop)) {
		if ('trade' in stop) {
			if (stopHasPotentialVehicleTransfer(game, character, vehicle, line, stop)) {
				return { line, stop }
			}
			return line.cyclic
				? nextActionableVehicleLineStop(game, vehicle, line, stop, character)
				: { line, stop }
		}
		const targetPos = freightStopMovementTarget(game, character, line, stop)
		const targetCoord = targetPos ? axial.round(toAxialCoord(targetPos)!) : undefined
		const vehicleCoord = axial.round(toAxialCoord(vehicle.effectivePosition)!)
		if (targetCoord && axial.key(targetCoord) !== axial.key(vehicleCoord)) return { line, stop }
		if ('anchor' in stop && !vehicle.isDocked) return { line, stop }
		if (!line.cyclic) return { line, stop }
		if (stopHasPotentialVehicleTransfer(game, character, vehicle, line, stop)) return { line, stop }
		return nextActionableVehicleLineStop(game, vehicle, line, stop, character)
	}
	if (
		!shouldAdvancePastZoneStop(
			game,
			character,
			vehicle,
			line,
			stop as FreightStop & { zone: FreightZoneDefinition },
			vehicle.effectivePosition
		)
	)
		return { line, stop }
	return nextActionableVehicleLineStop(game, vehicle, line, stop, character)
}

export type VehicleServiceStartCandidate = {
	readonly lineId: string
	readonly stopId: string
	readonly line?: FreightLineDefinition
	readonly stop?: FreightStop
}

/** Start line `service` if none; uses explicit line/stop ids when given, else {@link pickInitialVehicleServiceCandidate}. */
export function ensureVehicleServiceStarted(
	vehicle: Vehicle,
	operator: Character,
	game: Game,
	character: Character,
	candidate?: VehicleServiceStartCandidate
): boolean {
	const existing = vehicle.service
	if (isVehicleLineService(existing)) {
		if (candidate) {
			const line = candidate.line ?? vehicle.servedLines.find((l) => l.id === candidate.lineId)
			const stop = candidate.stop ?? line?.stops.find((s) => s.id === candidate.stopId)
			if (!line || !stop) return false
			if (existing.line !== line) {
				const wasDriving = operator.driving
				vehicle.endService()
				vehicle.beginLineService(line, stop, operator)
				vehicle.setServiceOperator(operator)
				// endService→releaseOperator calls regainFootPosition when the
				// character was driving; restore the driving (footless) state.
				if (wasDriving) operator.onboard()
				return true
			}
			if (existing.stop !== stop) {
				vehicle.advanceToStop(stop)
			}
		}
		vehicle.setServiceOperator(operator)
		return true
	}
	if (isVehicleMaintenanceService(existing)) {
		vehicle.endService()
	}
	let chosen: { line: FreightLineDefinition; stop: FreightStop } | undefined
	if (candidate) {
		const line = candidate.line ?? vehicle.servedLines.find((l) => l.id === candidate.lineId)
		const stop = candidate.stop ?? line?.stops.find((s) => s.id === candidate.stopId)
		if (line && stop) chosen = { line, stop }
	}
	if (!chosen) chosen = pickInitialVehicleServiceCandidate(game, character, vehicle)
	if (!chosen) return false
	vehicle.beginLineService(chosen.line, chosen.stop, operator)
	return true
}

function shouldAdvancePastZoneStop(
	game: Game,
	character: Character,
	vehicle: Vehicle,
	line: FreightLineDefinition,
	stop: FreightStop & { zone: FreightZoneDefinition },
	startPos: Position = character.position
): boolean {
	if (pickVehicleZoneBrowseSelection(game, character, vehicle, line, stop, startPos)) return false
	return true
}

function vehicleStorageStockCount(vehicle: Vehicle): number {
	return Object.values(vehicle.storage.stock).reduce(
		(total, qty) => total + Math.max(0, qty ?? 0),
		0
	)
}

function isDistributeUnloadStop(line: FreightLineDefinition, stopIndex: number): boolean {
	return findDistributeRouteSegments(line).some((segment) => segment.unloadStopIndex === stopIndex)
}

function advanceVehicleToNextLineStopOrEnd(
	vehicle: Vehicle,
	line: FreightLineDefinition,
	stop: FreightStop,
	reason: string
): boolean {
	const next = nextFreightLineStop(line, stop)
	if (!next) {
		// Ending service here would strand any remaining goods on the tile. Keep the service alive
		// so the planner can rediscover a drop target on the next pass (e.g. a construction site
		// that transitions from foundation to shell mid-route and suddenly demands the surplus).
		if (vehicleStorageStockCount(vehicle) > 0) {
			traces.vehicle.log?.('vehicleJob.line.emptyStop', {
				lineId: line.id,
				stopId: stop.id,
				reason: 'line-finished-with-surplus-stock',
				fromReason: reason,
				cyclic: line.cyclic ?? false,
				stock: vehicle.storage.stock,
			})
			return true
		}
		traces.vehicle.log?.('vehicleJob.line.emptyStop', {
			lineId: line.id,
			stopId: stop.id,
			reason: 'line-finished-empty',
			fromReason: reason,
		})
		vehicle.endService()
		return true
	}
	vehicle.advanceToStop(next)
	return false
}

/**
 * Progress through line stops that are already known to have no actionable transfer.
 *
 * Docked anchor stops still honor the normal dock completion guards: active dock convey, dock
 * advertisement candidates, and virtual vehicle storage keep the stop alive. Zone stops use the
 * same browser selection predicate when an operator is available; without an operator we only skip
 * the empty distribute unload case that cannot produce work without cargo.
 */
export function advanceVehicleLineServicePastEmptyStops(
	game: Game,
	vehicle: Vehicle,
	character?: Character
): void {
	let lastSkippedStopId: string | undefined
	for (
		let guard = 0;
		guard <
		Math.max(
			1,
			vehicle.service && isVehicleLineService(vehicle.service)
				? vehicle.service.line.stops.length + 1
				: 1
		);
		guard++
	) {
		const svc = vehicle.service
		if (!isVehicleLineService(svc)) return
		const { line, stop } = svc
		const idx = line.stops.indexOf(stop)
		if (idx < 0) {
			vehicle.endService()
			return
		}

		if ('anchor' in stop) {
			if (!vehicle.isDocked) {
				if (!line.cyclic || lastSkippedStopId === undefined) return
				if (stopHasPotentialVehicleTransfer(game, character, vehicle, line, stop)) return
				traces.vehicle.log?.('vehicleJob.line.emptyStop', {
					lineId: line.id,
					stopId: stop.id,
					reason: 'empty-undocked-anchor-stop',
					anchorCoord: stop.anchor.coord,
				})
				const ended = advanceVehicleToNextLineStopOrEnd(
					vehicle,
					line,
					stop,
					'empty-undocked-anchor-stop'
				)
				if (ended) return
				const advancedService = vehicle.service
				if (
					line.cyclic &&
					isVehicleLineService(advancedService) &&
					lastSkippedStopId === advancedService.stop.id
				) {
					if (vehicleStorageStockCount(vehicle) > 0) return
					vehicle.endService()
					return
				}
				lastSkippedStopId = stop.id
				continue
			}
			const content = freightVehicleDockBay(vehicle)
			if (!(content instanceof Alveolus)) return
			const hive = content.hive
			if (!hive) return
			if (!hive.freightVehicleDockFor(vehicle.uid)) return
			if (hive.hasActiveFreightVehicleDockMovement(vehicle.uid)) return
			const candidates = refreshDockedVehicleAdvertisement(vehicle, content)
			if (vehicle.storage.virtualGoodsCount > 0) return
			if (candidates.length > 0) return
			if (vehicleStorageStockCount(vehicle) > 0) {
				const next = line.cyclic
					? nextActionableVehicleLineStop(game, vehicle, line, stop, character)
					: nextFreightLineStop(line, stop)
						? { line, stop: nextFreightLineStop(line, stop)! }
						: undefined
				if (!next) return
			}

			traces.vehicle.log?.('vehicleJob.line.emptyStop', {
				lineId: line.id,
				stopId: stop.id,
				reason: 'empty-dock-load-stop',
				anchorCoord: stop.anchor.coord,
			})
			const ended = advanceVehicleToNextLineStopOrEnd(vehicle, line, stop, 'empty-dock-load-stop')
			syncFreightVehicleDockRegistration(vehicle)
			if (ended) return
			const advancedService = vehicle.service
			if (
				line.cyclic &&
				isVehicleLineService(advancedService) &&
				lastSkippedStopId === advancedService.stop.id
			) {
				if (vehicleStorageStockCount(vehicle) > 0) return
				vehicle.endService()
				return
			}
			lastSkippedStopId = stop.id
			continue
		}

		if ('zone' in stop) {
			const zoneStop = stop as FreightStop & { zone: FreightZoneDefinition }
			const isDistributeUnload = isDistributeUnloadStop(line, idx)
			let shouldSkip = false
			if (character) {
				shouldSkip = shouldAdvancePastZoneStop(game, character, vehicle, line, zoneStop)
			} else if (
				isDistributeUnload &&
				vehicleStorageStockCount(vehicle) <= 0 &&
				!zoneStop.loadSelection
			) {
				shouldSkip = true
			}
			if (!shouldSkip) return

			traces.vehicle.log?.('vehicleJob.line.emptyStop', {
				lineId: line.id,
				stopId: stop.id,
				reason: 'empty-zone-unload-stop',
				zone: zoneStop.zone,
			})
			const ended = advanceVehicleToNextLineStopOrEnd(vehicle, line, stop, 'empty-zone-unload-stop')
			if (ended) return
			const advancedService = vehicle.service
			if (
				line.cyclic &&
				isVehicleLineService(advancedService) &&
				lastSkippedStopId === advancedService.stop.id
			) {
				if (vehicleStorageStockCount(vehicle) > 0) return
				vehicle.endService()
				return
			}
			lastSkippedStopId = stop.id
			continue
		}

		if ('trade' in stop) {
			if (stopHasPotentialVehicleTransfer(game, character, vehicle, line, stop)) return

			traces.vehicle.log?.('vehicleJob.line.emptyStop', {
				lineId: line.id,
				stopId: stop.id,
				reason: 'empty-trade-stop',
				trade: stop.trade,
			})
			const ended = advanceVehicleToNextLineStopOrEnd(vehicle, line, stop, 'empty-trade-stop')
			if (ended) return
			const advancedService = vehicle.service
			if (
				line.cyclic &&
				isVehicleLineService(advancedService) &&
				lastSkippedStopId === advancedService.stop.id
			) {
				if (vehicleStorageStockCount(vehicle) > 0) return
				vehicle.endService()
				return
			}
			lastSkippedStopId = stop.id
			continue
		}

		return
	}
	if (
		isVehicleLineService(vehicle.service) &&
		vehicle.service.line.cyclic &&
		vehicleStorageStockCount(vehicle) <= 0
	)
		vehicle.endService()
}

/**
 * When the current service stop is a gather zone and there is nothing left to load (or no capacity),
 * advance the vehicle to the next route stop before planning the next hop.
 */
export function maybeAdvanceVehiclePastCompletedZoneStop(
	game: Game,
	vehicle: Vehicle,
	character: Character
): void {
	const svc = vehicle.service
	if (!isVehicleLineService(svc)) return
	const { stop } = svc
	if (!('zone' in stop)) return
	advanceVehicleLineServicePastEmptyStops(game, vehicle, character)
}

/** Advance a docked anchor stop once vehicle-side storage reservations/allocations are drained. */
export function maybeAdvanceVehicleFromCompletedAnchorStop(
	game: Game,
	vehicle: Vehicle,
	character?: Character
): void {
	const svc = vehicle.service
	if (!isVehicleLineService(svc)) {
		traces.vehicle.log?.('vehicleJob.dock.check', {
			outcome: 'skip',
			reason: 'not-line-service',
		})
		return
	}
	const stop = svc.stop
	if (!('anchor' in stop)) {
		traces.vehicle.log?.('vehicleJob.dock.check', {
			lineId: svc.line.id,
			stopId: stop.id,
			outcome: 'skip',
			reason: 'not-anchor-stop',
		})
		return
	}
	if (!vehicle.isDocked) {
		traces.vehicle.log?.('vehicleJob.dock.check', {
			lineId: svc.line.id,
			stopId: stop.id,
			outcome: 'skip',
			reason: 'not-docked',
			anchorCoord: stop.anchor.coord,
		})
		return
	}
	const content = freightVehicleDockBay(vehicle)
	if (!(content instanceof Alveolus)) {
		traces.vehicle.log?.('vehicleJob.dock.check', {
			lineId: svc.line.id,
			stopId: stop.id,
			outcome: 'skip',
			reason: 'not-alveolus-tile',
			anchorCoord: 'anchor' in stop ? stop.anchor.coord : undefined,
			vehicleEffectiveCoord: toAxialCoord(vehicle.effectivePosition),
		})
		return
	}
	const hive = content.hive
	if (!hive) {
		traces.vehicle.log?.('vehicleJob.dock.check', {
			lineId: svc.line.id,
			stopId: stop.id,
			outcome: 'skip',
			reason: 'no-hive',
			anchorCoord: stop.anchor.coord,
		})
		return
	}
	const dock = hive.freightVehicleDockFor(vehicle.uid)
	if (!dock) {
		traces.vehicle.log?.('vehicleJob.dock.check', {
			lineId: svc.line.id,
			stopId: stop.id,
			outcome: 'skip',
			reason: 'no-dock-registration',
			anchorCoord: stop.anchor.coord,
		})
		return
	}
	if (hive.hasActiveFreightVehicleDockMovement(vehicle.uid)) {
		traces.vehicle.log?.('vehicleJob.dock.check', {
			lineId: svc.line.id,
			stopId: stop.id,
			outcome: 'wait',
			reason: 'active-dock-convey',
			anchorCoord: stop.anchor.coord,
			stock: vehicle.storage.stock,
			virtualGoodsCount: vehicle.storage.virtualGoodsCount,
		})
		return
	}
	const stockCount = vehicleStorageStockCount(vehicle)
	const virtualGoodsCount = vehicle.storage.virtualGoodsCount
	const blockingVirtualGoodsCount = vehicleDockBlockingVirtualGoodsCount(vehicle)
	const candidates = refreshDockedVehicleAdvertisement(vehicle, content)
	if (candidates.length > 0) {
		traces.vehicle.log?.('vehicleJob.dock.check', {
			lineId: svc.line.id,
			stopId: stop.id,
			outcome: 'wait',
			reason: 'dock-advertisement-candidates',
			anchorCoord: stop.anchor.coord,
			stock: vehicle.storage.stock,
			virtualGoodsCount,
			candidates,
		})
		return
	}
	if (blockingVirtualGoodsCount > 0) {
		traces.vehicle.log?.('vehicleJob.dock.check', {
			lineId: svc.line.id,
			stopId: stop.id,
			outcome: 'wait',
			reason: 'vehicle-storage-not-drained',
			anchorCoord: stop.anchor.coord,
			stockCount,
			virtualGoodsCount,
			blockingVirtualGoodsCount,
			stock: vehicle.storage.stock,
		})
		return
	}
	const idx = svc.line.stops.indexOf(stop)
	const isLastStop = idx < 0 || !nextFreightLineStop(svc.line, stop)
	const hasStock = stockCount > 0
	const parkNext = isLastStop && !hasStock && vehicleNeedsParkingOnCurrentTile(vehicle)
	traces.vehicle.log?.('vehicleJob.dock.complete', {
		lineId: svc.line.id,
		stopId: stop.id,
		outcome: isLastStop ? (parkNext ? 'park-next' : 'end-service') : 'advance',
		hasStock,
		anchorCoord: stop.anchor.coord,
		stockCount,
		virtualGoodsCount,
		stock: vehicle.storage.stock,
	})
	advanceVehicleAfterDock(vehicle)
	advanceVehicleLineServicePastEmptyStops(game, vehicle, character)
	syncFreightVehicleDockRegistration(vehicle)
}

/** After docking at a **bay anchor** stop, advance to the next stop or end the run. */
export function advanceVehicleAfterDock(vehicle: Vehicle): void {
	const svc = vehicle.service
	if (!isVehicleLineService(svc)) return
	const { line, stop } = svc
	const next = nextFreightLineStop(line, stop)
	if (!next) {
		// Do not strand surplus goods by ending service at the last stop.
		if (vehicleStorageStockCount(vehicle) > 0) {
			traces.vehicle.log?.('vehicleJob.dock.complete', {
				lineId: line.id,
				stopId: stop.id,
				outcome: 'skip-end-service-with-surplus-stock',
				cyclic: line.cyclic ?? false,
				stock: vehicle.storage.stock,
			})
			return
		}
		vehicle.endService()
		return
	}
	vehicle.advanceToStop(next)
}

export function executeNpcTradeStopAndAdvance(
	game: Game,
	vehicle: Vehicle,
	character?: Character
): boolean {
	const svc = vehicle.service
	if (!isVehicleLineService(svc)) return false
	const { line, stop } = svc
	if (!('trade' in stop)) return false
	const result = executeNpcTradeStopTransfer({ game, vehicle, line, stop })
	traces.vehicle.log?.('vehicleJob.tradeStop.transfer', {
		lineId: line.id,
		stopId: stop.id,
		result,
	})
	if (npcTradeStopHasTransfer(result)) {
		advanceVehicleAfterDock(vehicle)
		advanceVehicleLineServicePastEmptyStops(game, vehicle, character)
		return true
	}
	advanceVehicleLineServicePastEmptyStops(game, vehicle, character)
	return false
}

/**
 * If the vehicle has an active service but empty storage, clear service (e.g. after a canceled empty run).
 * When storage is non-empty, does nothing — stock remains meaningful without service (see roadmap §9).
 */
export function detachVehicleServiceIfStorageEmpty(vehicle: Vehicle): void {
	if (!vehicle.service) return
	const hasStock = Object.values(vehicle.storage.stock).some((n) => (n ?? 0) > 0)
	if (hasStock) return
	vehicle.endService()
	traces.vehicle.log?.('vehicle freight service detached (empty storage)', vehicle.uid)
}

/**
 * Line run finished or offload maintenance drained: ends freight `service` when still attached, then
 * disembarks (clears {@link Character.operates}).
 */
export function offboardOperatorAfterFreightWorkComplete(character: Character): void {
	character.offboard()
}

/**
 * Bay anchor docked: vehicle keeps line {@link Vehicle.service} without an operator.
 */
export function disembarkOperatorLeavingDockedVehicleInService(
	character: Character,
	vehicle: Vehicle
): void {
	assert(
		character.operates?.uid === vehicle.uid,
		`disembark dock: operated vehicle mismatch (expected ${vehicle.uid}, was ${character.operates?.uid})`
	)
	character.disembarkVehicleKeepingService()
}

export type VehicleFreightInterruptSubject = {
	readonly uid: string
	operates?: Vehicle
	readonly driving?: boolean
	offboard?: () => void
	disengageVehicleKeepingService?: () => void
}

/**
 * When a scripted work plan is abandoned or fully canceled while this subject still references the
 * operated vehicle, clear only the operator/control link. The service itself remains the vehicle's
 * unfinished work contract and may be continued by another worker.
 */
export function releaseVehicleFreightWorkOnPlanInterrupt(
	subject: VehicleFreightInterruptSubject
): void {
	const v = subject.operates
	if (!v) return
	if (!v.service) {
		if (subject.driving && subject.offboard) subject.offboard()
		else subject.operates = undefined
		traces.vehicle.log?.('vehicle freight stale operator link cleared on plan interrupt', {
			characterUid: subject.uid,
		})
		return
	}
	if (v.operator?.uid !== subject.uid) {
		if (subject.disengageVehicleKeepingService) subject.disengageVehicleKeepingService()
		else subject.operates = undefined
		traces.vehicle.log?.('vehicle freight stale operator mismatch cleared on plan interrupt', {
			characterUid: subject.uid,
			operatorUid: v.operator?.uid,
		})
		return
	}
	if (subject.disengageVehicleKeepingService) subject.disengageVehicleKeepingService()
	else v.releaseOperator()
	traces.vehicle.log?.('vehicle freight operator released on plan interrupt', {
		characterUid: subject.uid,
		stillHasService: !!v.service,
	})
}

/** World vehicle on the same tile as `tile` (by rounded axial position). */
export function findVehicleEntityAtTile(
	game: Game,
	tile: { position: Position }
): Vehicle | undefined {
	const key = toAxialCoord(tile.position)
	if (!key) return undefined
	const rounded = { q: Math.round(key.q), r: Math.round(key.r) }
	for (const v of game.vehicles) {
		if (!v.position) continue
		const p = toAxialCoord(v.position)
		if (!p) continue
		if (Math.round(p.q) === rounded.q && Math.round(p.r) === rounded.r) return v
	}
	return undefined
}
