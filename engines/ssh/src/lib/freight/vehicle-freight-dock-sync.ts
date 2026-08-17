import type { Alveolus } from 'ssh/board/content/alveolus'
import type { Tile } from 'ssh/board/tile'
import { debugObjectId } from 'ssh/dev/debug-object-id'
import { isLineFreightVehicleType } from 'ssh/freight/line-freight-vehicles'
import { VehicleFreightDock } from 'ssh/freight/vehicle-freight-dock'
import type { Game } from 'ssh/game/game'
import { FreightBayAlveolus } from 'ssh/hive/freight-bay'
import type { Vehicle } from 'ssh/population/vehicle/entity'
import { isVehicleLineService, isVehicleMaintenanceService } from 'ssh/population/vehicle/vehicle'
import { traces } from '../dev/debug.ts'

export function freightVehicleDockBay(vehicle: Vehicle): FreightBayAlveolus | undefined {
	const svc = vehicle.service
	if (!isVehicleLineService(svc) || !vehicle.isDocked) return undefined
	if (!('anchor' in svc.stop)) return undefined
	if (!isLineFreightVehicleType(vehicle.vehicleType)) return undefined
	const tile = vehicle.game.hex.getTile({
		q: svc.stop.anchor.coord[0],
		r: svc.stop.anchor.coord[1],
	})
	const content = tile?.content
	if (!(content instanceof FreightBayAlveolus)) {
		traces.vehicle.warn?.('[dock.sync] docked vehicle has no freight bay', {
			lineId: debugObjectId(svc.line),
			stopIndex: svc.line.stops.indexOf(svc.stop),
			anchor: svc.stop.anchor.coord,
			contentType: content?.constructor?.name,
			actionType: content instanceof FreightBayAlveolus ? content.action?.type : undefined,
		})
		return undefined
	}
	return content
}

export function ensureFreightVehicleDockRegistration(
	vehicle: Vehicle
): FreightBayAlveolus | undefined {
	const bay = freightVehicleDockBay(vehicle)
	if (!bay) return undefined
	const existing = bay.hive.freightVehicleDockFor(vehicle)
	if (existing?.bay === bay) return bay
	traces.vehicle.warn?.('[dock.sync] repairing missing dock registration', {
		bay: bay.name,
		hadRegistration: !!existing,
		registeredBay: existing?.bay.name,
	})
	bay.hive.registerFreightVehicleDock(new VehicleFreightDock(vehicle, bay))
	return bay
}

/** Registers or clears the hive advertisement endpoint for a docked wheelbarrow at a freight bay. */
export function syncFreightVehicleDockRegistration(vehicle: Vehicle): void {
	const bay = freightVehicleDockBay(vehicle)
	for (const tile of vehicle.game.hex.tiles) {
		const content = tile.content
		const hive = content && 'hive' in content ? (content as Alveolus).hive : undefined
		if (bay && hive === bay.hive) continue
		hive?.unregisterFreightVehicleDock(vehicle)
	}
	if (!bay) {
		traces.vehicle.log?.('[dock.sync] no dock registration', {
			isDocked: vehicle.isDocked,
			serviceKind: isVehicleLineService(vehicle.service)
				? 'line'
				: isVehicleMaintenanceService(vehicle.service)
					? vehicle.service.kind
					: undefined,
		})
		return
	}
	const existing = bay.hive.freightVehicleDockFor(vehicle)
	if (existing?.bay === bay) {
		bay.hive.invalidateConveyPlanning('dock.lifecycle')
		bay.hive.invalidateAdvertisements([existing, bay], 'dock.lifecycle')
		traces.vehicle.log?.('[dock.sync] refreshed vehicle dock', {
			bay: bay.name,
			stock: { ...vehicle.storage.stock },
			virtualGoodsCount: vehicle.storage.virtualGoodsCount,
		})
		return
	}
	traces.vehicle.log?.('[dock.sync] registered vehicle dock', {
		bay: bay.name,
		stock: { ...vehicle.storage.stock },
		virtualGoodsCount: vehicle.storage.virtualGoodsCount,
	})
	bay.hive.registerFreightVehicleDock(new VehicleFreightDock(vehicle, bay))
}

/**
 * Re-sync dock registrations for vehicles docked at a specific tile after its
 * content transitions (e.g. a freight bay finishes construction). A vehicle can
 * dock at a still-under-construction anchor tile: `Vehicle.dock` sets
 * `docked = true` but `syncFreightVehicleDockRegistration` no-ops because the
 * content is a `BuildAlveolus`, not a `FreightBayAlveolus`. When the bay then
 * completes, this re-establishes the registration.
 */
export function resyncDockedVehiclesAtTile(game: Game, tile: Tile): void {
	for (const vehicle of game.vehicles) {
		if (!vehicle.isDocked) continue
		if (vehicle.dockTile !== tile) continue
		syncFreightVehicleDockRegistration(vehicle)
	}
}
