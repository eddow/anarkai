import { jobBalance } from 'engine-rules'
import { Alveolus } from 'ssh/board/content/alveolus'
import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import { isStandaloneBuildSiteShell } from 'ssh/build-site'
import type {
	FreightLineDefinition,
	FreightStop,
	FreightZoneDefinitionRadius,
} from 'ssh/freight/freight-line'
import {
	distributeSegmentAllowsGoodTypeForSegment,
	distributeSegmentBayTile,
	distributeSegmentWithinRadius,
	findDistributeRouteSegments,
	findGatherRouteSegments,
	gatherSegmentAllowsGoodType,
	gatherSegmentAllowsGoodTypeForSegment,
} from 'ssh/freight/freight-line'
import { scoreVehicleCandidate } from 'ssh/freight/vehicle-candidate-policy'
import {
	freightVehicleDockBay,
	syncFreightVehicleDockRegistration,
} from 'ssh/freight/vehicle-freight-dock-sync'
import { pickVehicleZoneBrowseSelection } from 'ssh/freight/vehicle-zone-browse'
import type { Game } from 'ssh/game/game'
import type { Character } from 'ssh/population/character'
import type { VehicleEntity } from 'ssh/population/vehicle/entity'
import { isVehicleLineService, isVehicleMaintenanceService } from 'ssh/population/vehicle/vehicle'
import type { GoodType } from 'ssh/types/base'
import { type AxialCoord, axial } from 'ssh/utils/axial'
import { axialDistance, type Position, toAxialCoord } from 'ssh/utils/position'
import { assert, traces } from '../dev/debug.ts'

/**
 * `parkVehicle` is only meaningful when the current hex matters for the board independently of the
 * wheelbarrow itself. A clean `UnBuiltLand` rest tile is fine; alveoli, projects, residential, and
 * tiles with loose goods / deposits should be vacated.
 */
export function vehicleNeedsParkingOnCurrentTile(vehicle: VehicleEntity): boolean {
	const here = vehicle.tile
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
	if ('zone' in stop && stop.zone.kind === 'radius') {
		const vehicle = character.operates
		if (vehicle) {
			const pick = pickVehicleZoneBrowseSelection(game, character, vehicle, line, stop)
			if (pick) return pick.targetTile.position
		}
		return { q: stop.zone.center[0], r: stop.zone.center[1] }
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
	return undefined
}

/**
 * Legacy preview: first served line, first anchor stop else first stop. Prefer
 * {@link pickInitialVehicleServiceCandidate} when `Game` + `Character` are available.
 */
export function previewInitialVehicleService(
	vehicle: VehicleEntity
): { line: FreightLineDefinition; stop: FreightStop } | undefined {
	const line = vehicle.servedLines[0]
	if (!line) return undefined
	const stop = line.stops.find((s) => 'anchor' in s) ?? line.stops[0]
	if (!stop) return undefined
	return { line, stop }
}

function vehicleLineStockAffinity(line: FreightLineDefinition, vehicle: VehicleEntity): number {
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

/**
 * Finds the first meaningful target for {@link vehicleBeginService}. Gather routes need at least one
 * reachable loose good of an allowed type within zone radius (with carrier room); distribute routes
 * qualify only when a standalone construction shell in range still advertises segment-allowed needs.
 */
function findBeginServiceActionableWork(
	game: Game,
	character: Character,
	vehicle: VehicleEntity,
	line: FreightLineDefinition
): BeginServiceActionableWork | undefined {
	const gatherSegs = findGatherRouteSegments(line)
	if (gatherSegs.length > 0) {
		let bestLoaded: { target: Position; stop: FreightStop; pathLen: number } | undefined
		for (const segment of gatherSegs) {
			if (segment.loadStopIndex !== 0) continue
			const loadStop = line.stops[segment.loadStopIndex]
			const unloadStop = line.stops[segment.unloadStopIndex]
			if (!loadStop || !('zone' in loadStop) || loadStop.zone.kind !== 'radius') continue
			if (!unloadStop) continue
			const center: AxialCoord = { q: loadStop.zone.center[0], r: loadStop.zone.center[1] }
			const vehicleCoord = toAxialCoord(vehicle.effectivePosition)
			if (!vehicleCoord || axial.distance(center, vehicleCoord) > loadStop.zone.radius) continue
			for (const good of Object.keys(vehicle.storage.stock) as GoodType[]) {
				if (vehicle.storage.available(good) <= 0) continue
				if (!gatherSegmentAllowsGoodTypeForSegment(line, segment, good)) continue
				if (!gatherUnloadAnchorHiveDemandsGood(game, unloadStop, good)) continue
				const target = freightStopTargetPosition(game, unloadStop)
				if (!target) continue
				const path = game.hex.findPathForCharacter(
					vehicle.effectivePosition,
					target,
					character,
					Number.POSITIVE_INFINITY,
					true
				)
				if (path && (!bestLoaded || path.length < bestLoaded.pathLen)) {
					bestLoaded = { target, stop: unloadStop, pathLen: path.length }
				}
			}
		}
		if (bestLoaded) return { target: bestLoaded.target, stop: bestLoaded.stop }

		let best: { target: Position; stop: FreightStop; pathLen: number } | undefined
		for (const segment of gatherSegs) {
			const zoneLoad = line.stops[segment.loadStopIndex]
			if (!zoneLoad || !('zone' in zoneLoad) || zoneLoad.zone.kind !== 'radius') continue
			const selection = pickVehicleZoneBrowseSelection(
				game,
				character,
				vehicle,
				line,
				zoneLoad,
				vehicle.effectivePosition
			)
			if (selection?.action !== 'load') continue
			if (!best || selection.path.length < best.pathLen) {
				best = {
					target: selection.targetTile.position,
					stop: zoneLoad,
					pathLen: selection.path.length,
				}
			}
		}
		return best ? { target: best.target, stop: best.stop } : undefined
	}
	for (const segment of findDistributeRouteSegments(line)) {
		const loadStop = line.stops[segment.loadStopIndex]
		if (!loadStop) continue
		const bayTile = distributeSegmentBayTile(game, line, segment)
		if (!bayTile) continue
		const bayPos = toAxialCoord(bayTile.position)
		if (!bayPos) continue
		const unloadStop = line.stops[segment.unloadStopIndex]
		const tiles =
			unloadStop && 'zone' in unloadStop && unloadStop.zone.kind === 'radius'
				? game.hex.tilesAround(bayPos, unloadStop.zone.radius)
				: game.hex.tiles
		for (const tile of tiles) {
			const c = tile.content
			if (!isStandaloneBuildSiteShell(c) || c.destroyed || c.isReady) continue
			const tilePos = toAxialCoord(tile.position)
			if (!tilePos) continue
			if (!distributeSegmentWithinRadius(line, segment, axial.distance(bayPos, tilePos))) continue
			for (const g of Object.keys(c.remainingNeeds) as GoodType[]) {
				if ((c.remainingNeeds[g] ?? 0) <= 0) continue
				if (distributeSegmentAllowsGoodTypeForSegment(line, segment, g)) {
					return { target: bayTile.position, stop: loadStop }
				}
			}
		}
	}
	return undefined
}

/**
 * Choose initial `line` + `stop` for `vehicleBeginService`: among served lines with actionable
 * work, minimize travel distance from the vehicle to the first meaningful hop target for that
 * line's primary stop; ties favor lines whose goods policy matches current vehicle stock.
 */
export function pickInitialVehicleServiceCandidate(
	game: Game,
	character: Character,
	vehicle: VehicleEntity
): { line: FreightLineDefinition; stop: FreightStop } | undefined {
	let best:
		| { line: FreightLineDefinition; stop: FreightStop; score: number; affinity: number }
		| undefined
	for (const line of vehicle.servedLines) {
		const actionable = findBeginServiceActionableWork(game, character, vehicle, line)
		if (!actionable) continue
		const distance = axialDistance(vehicle.effectivePosition, actionable.target)
		const score = scoreVehicleCandidate({
			kind: 'beginService',
			urgency: jobBalance.vehicleBeginService,
			distance,
		}).score
		const affinity = vehicleLineStockAffinity(line, vehicle)
		if (!best || score > best.score || (score === best.score && affinity > best.affinity)) {
			best = { line, stop: actionable.stop, score, affinity }
		}
	}
	return best ? { line: best.line, stop: best.stop } : undefined
}

/**
 * Read-only projection of which line/stop the next hop should aim for: if the current zone gather is
 * complete, behave as if already advanced to the next stop (without mutating `vehicle.service`).
 */
export function projectedLineStopForVehicleHop(
	game: Game,
	character: Character,
	vehicle: VehicleEntity
): { line: FreightLineDefinition; stop: FreightStop } | undefined {
	const svc = vehicle.service
	if (!isVehicleLineService(svc)) return undefined
	const line = svc.line
	const stop = svc.stop
	if (!('zone' in stop) || stop.zone.kind !== 'radius') return { line, stop }
	if (
		!shouldAdvancePastZoneStop(
			game,
			character,
			vehicle,
			line,
			stop as FreightStop & { zone: FreightZoneDefinitionRadius }
		)
	)
		return { line, stop }
	const idx = line.stops.findIndex((s) => s.id === stop.id)
	if (idx < 0) return { line, stop }
	if (idx >= line.stops.length - 1) return { line, stop }
	return { line, stop: line.stops[idx + 1]! }
}

export type VehicleServiceStartCandidate = {
	readonly lineId: string
	readonly stopId: string
}

/** Start line `service` if none; uses explicit line/stop ids when given, else {@link pickInitialVehicleServiceCandidate}. */
export function ensureVehicleServiceStarted(
	vehicle: VehicleEntity,
	operator: Character,
	game: Game,
	character: Character,
	candidate?: VehicleServiceStartCandidate
): boolean {
	const existing = vehicle.service
	if (isVehicleLineService(existing)) {
		if (candidate) {
			const line = vehicle.servedLines.find((l) => l.id === candidate.lineId)
			const stop = line?.stops.find((s) => s.id === candidate.stopId)
			if (!line || !stop) return false
			if (existing.line.id !== line.id) {
				vehicle.endService()
				vehicle.beginLineService(line, stop, operator)
				return true
			}
			if (existing.stop.id !== stop.id) {
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
		const line = vehicle.servedLines.find((l) => l.id === candidate.lineId)
		const stop = line?.stops.find((s) => s.id === candidate.stopId)
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
	vehicle: VehicleEntity,
	line: FreightLineDefinition,
	stop: FreightStop & { zone: FreightZoneDefinitionRadius }
): boolean {
	if (pickVehicleZoneBrowseSelection(game, character, vehicle, line, stop)) return false
	return true
}

/**
 * When the current service stop is a gather zone and there is nothing left to load (or no capacity),
 * advance the vehicle to the next route stop before planning the next hop.
 */
export function maybeAdvanceVehiclePastCompletedZoneStop(
	game: Game,
	vehicle: VehicleEntity,
	character: Character
): void {
	const svc = vehicle.service
	if (!isVehicleLineService(svc)) return
	const { line, stop } = svc
	if (!('zone' in stop) || stop.zone.kind !== 'radius') return
	const zoneStop = stop as FreightStop & { zone: FreightZoneDefinitionRadius }
	if (!shouldAdvancePastZoneStop(game, character, vehicle, line, zoneStop)) return
	const idx = line.stops.findIndex((s) => s.id === stop.id)
	if (idx < 0) return
	if (idx >= line.stops.length - 1) {
		vehicle.endService()
		return
	}
	vehicle.advanceToStop(line.stops[idx + 1]!)
}

/** Advance a docked anchor stop once vehicle-side storage reservations/allocations are drained. */
export function maybeAdvanceVehicleFromCompletedAnchorStop(
	_game: Game,
	vehicle: VehicleEntity,
	_character?: Character
): void {
	const svc = vehicle.service
	if (!isVehicleLineService(svc)) {
		traces.vehicle.log?.('vehicleJob.dock.check', {
			vehicleUid: vehicle.uid,
			outcome: 'skip',
			reason: 'not-line-service',
		})
		return
	}
	const stop = svc.stop
	if (!('anchor' in stop)) {
		traces.vehicle.log?.('vehicleJob.dock.check', {
			vehicleUid: vehicle.uid,
			lineId: svc.line.id,
			stopId: stop.id,
			outcome: 'skip',
			reason: 'not-anchor-stop',
		})
		return
	}
	if (!vehicle.isDocked) {
		traces.vehicle.log?.('vehicleJob.dock.check', {
			vehicleUid: vehicle.uid,
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
			vehicleUid: vehicle.uid,
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
			vehicleUid: vehicle.uid,
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
			vehicleUid: vehicle.uid,
			lineId: svc.line.id,
			stopId: stop.id,
			outcome: 'skip',
			reason: 'no-dock-registration',
			anchorCoord: stop.anchor.coord,
		})
		return
	}
	const stockCount = Object.values(vehicle.storage.stock).reduce(
		(total, qty) => total + Math.max(0, qty ?? 0),
		0
	)
	const virtualGoodsCount = vehicle.storage.virtualGoodsCount
	if (virtualGoodsCount > 0) {
		traces.vehicle.log?.('vehicleJob.dock.check', {
			vehicleUid: vehicle.uid,
			lineId: svc.line.id,
			stopId: stop.id,
			outcome: 'wait',
			reason: 'vehicle-storage-not-drained',
			anchorCoord: stop.anchor.coord,
			stockCount,
			virtualGoodsCount,
			stock: vehicle.storage.stock,
		})
		return
	}
	const idx = svc.line.stops.findIndex((s) => s.id === stop.id)
	const isLastStop = idx < 0 || idx >= svc.line.stops.length - 1
	const hasStock = stockCount > 0
	const parkNext = isLastStop && !hasStock && vehicleNeedsParkingOnCurrentTile(vehicle)
	traces.vehicle.log?.('vehicleJob.dock.complete', {
		vehicleUid: vehicle.uid,
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
	syncFreightVehicleDockRegistration(vehicle)
}

/** After docking at a **bay anchor** stop, advance to the next stop or end the run. */
export function advanceVehicleAfterDock(vehicle: VehicleEntity): void {
	const svc = vehicle.service
	if (!isVehicleLineService(svc)) return
	const { line, stop } = svc
	const idx = line.stops.findIndex((s) => s.id === stop.id)
	if (idx < 0) {
		vehicle.endService()
		return
	}
	if (idx >= line.stops.length - 1) {
		vehicle.endService()
		return
	}
	const next = line.stops[idx + 1]!
	vehicle.advanceToStop(next)
}

/**
 * If the vehicle has an active service but empty storage, clear service (e.g. after a canceled empty run).
 * When storage is non-empty, does nothing — stock remains meaningful without service (see roadmap §9).
 */
export function detachVehicleServiceIfStorageEmpty(vehicle: VehicleEntity): void {
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
 * Bay anchor docked: vehicle keeps line {@link VehicleEntity.service} without an operator.
 */
export function disembarkOperatorLeavingDockedVehicleInService(
	character: Character,
	vehicle: VehicleEntity
): void {
	assert(
		character.operates?.uid === vehicle.uid,
		`disembark dock: operated vehicle mismatch (expected ${vehicle.uid}, was ${character.operates?.uid})`
	)
	character.disembarkVehicleKeepingService()
}

export type VehicleFreightInterruptSubject = {
	readonly uid: string
	operates?: VehicleEntity
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
			vehicleUid: v.uid,
			characterUid: subject.uid,
		})
		return
	}
	if (v.operator?.uid !== subject.uid) {
		if (subject.disengageVehicleKeepingService) subject.disengageVehicleKeepingService()
		else subject.operates = undefined
		traces.vehicle.log?.('vehicle freight stale operator mismatch cleared on plan interrupt', {
			vehicleUid: v.uid,
			characterUid: subject.uid,
			operatorUid: v.operator?.uid,
		})
		return
	}
	if (subject.disengageVehicleKeepingService) subject.disengageVehicleKeepingService()
	else v.releaseOperator()
	traces.vehicle.log?.('vehicle freight operator released on plan interrupt', {
		vehicleUid: v.uid,
		characterUid: subject.uid,
		stillHasService: !!v.service,
	})
}

/** World vehicle on the same tile as `tile` (by rounded axial position). */
export function findVehicleEntityAtTile(
	game: Game,
	tile: { position: Position }
): VehicleEntity | undefined {
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
