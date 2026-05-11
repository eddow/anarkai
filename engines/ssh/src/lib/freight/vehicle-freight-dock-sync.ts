import type { Alveolus } from 'ssh/board/content/alveolus'
import { VehicleFreightDock } from 'ssh/freight/vehicle-freight-dock'
import { FreightBayAlveolus } from 'ssh/hive/freight-bay'
import type { VehicleEntity } from 'ssh/population/vehicle/entity'
import { isVehicleLineService, isVehicleMaintenanceService } from 'ssh/population/vehicle/vehicle'
import { traces } from '../dev/debug.ts'

export function freightVehicleDockBay(vehicle: VehicleEntity): FreightBayAlveolus | undefined {
	const svc = vehicle.service
	if (!isVehicleLineService(svc) || !vehicle.isDocked) return undefined
	if (!('anchor' in svc.stop)) return undefined
	if (vehicle.vehicleType !== 'wheelbarrow') return undefined
	const tile = vehicle.game.hex.getTile({
		q: svc.stop.anchor.coord[0],
		r: svc.stop.anchor.coord[1],
	})
	const content = tile?.content
	if (!(content instanceof FreightBayAlveolus)) {
		traces.vehicle.warn?.('[dock.sync] docked vehicle has no freight bay', {
			vehicleUid: vehicle.uid,
			lineId: svc.line.id,
			stopId: svc.stop.id,
			anchor: svc.stop.anchor.coord,
			contentType: content?.constructor?.name,
			actionType: content instanceof FreightBayAlveolus ? content.action?.type : undefined,
		})
		return undefined
	}
	return content
}

export function ensureFreightVehicleDockRegistration(
	vehicle: VehicleEntity
): FreightBayAlveolus | undefined {
	const bay = freightVehicleDockBay(vehicle)
	if (!bay) return undefined
	const existing = bay.hive.freightVehicleDockFor(vehicle.uid)
	if (existing?.bay === bay) return bay
	traces.vehicle.warn?.('[dock.sync] repairing missing dock registration', {
		vehicleUid: vehicle.uid,
		bay: bay.name,
		hadRegistration: !!existing,
		registeredBay: existing?.bay.name,
	})
	bay.hive.registerFreightVehicleDock(new VehicleFreightDock(vehicle, bay))
	return bay
}

/** Registers or clears the hive advertisement endpoint for a docked wheelbarrow at a freight bay. */
export function syncFreightVehicleDockRegistration(vehicle: VehicleEntity): void {
	const bay = freightVehicleDockBay(vehicle)
	for (const tile of vehicle.game.hex.tiles) {
		const content = tile.content
		const hive = content && 'hive' in content ? (content as Alveolus).hive : undefined
		if (bay && hive === bay.hive) continue
		hive?.unregisterFreightVehicleDock(vehicle.uid)
	}
	if (!bay) {
		traces.vehicle.log?.('[dock.sync] no dock registration', {
			vehicleUid: vehicle.uid,
			isDocked: vehicle.isDocked,
			serviceKind: isVehicleLineService(vehicle.service)
				? 'line'
				: isVehicleMaintenanceService(vehicle.service)
					? vehicle.service.kind
					: undefined,
		})
		return
	}
	const existing = bay.hive.freightVehicleDockFor(vehicle.uid)
	if (existing?.bay === bay) {
		bay.hive.invalidateConveyPlanning('dock.lifecycle')
		bay.hive.invalidateAdvertisements([existing, bay], 'dock.lifecycle')
		traces.vehicle.log?.('[dock.sync] refreshed vehicle dock', {
			vehicleUid: vehicle.uid,
			bay: bay.name,
			stock: { ...vehicle.storage.stock },
			virtualGoodsCount: vehicle.storage.virtualGoodsCount,
		})
		return
	}
	traces.vehicle.log?.('[dock.sync] registered vehicle dock', {
		vehicleUid: vehicle.uid,
		bay: bay.name,
		stock: { ...vehicle.storage.stock },
		virtualGoodsCount: vehicle.storage.virtualGoodsCount,
	})
	bay.hive.registerFreightVehicleDock(new VehicleFreightDock(vehicle, bay))
}
