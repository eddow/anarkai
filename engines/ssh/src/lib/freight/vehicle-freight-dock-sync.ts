import type { Alveolus } from 'ssh/board/content/alveolus'
import { VehicleFreightDock } from 'ssh/freight/vehicle-freight-dock'
import { StorageAlveolus } from 'ssh/hive/storage'
import type { VehicleEntity } from 'ssh/population/vehicle/entity'
import { isVehicleLineService, isVehicleMaintenanceService } from 'ssh/population/vehicle/vehicle'
import { traces } from '../dev/debug.ts'

export function freightVehicleDockBay(vehicle: VehicleEntity): StorageAlveolus | undefined {
	const svc = vehicle.service
	if (!isVehicleLineService(svc) || !vehicle.isDocked) return undefined
	if (!('anchor' in svc.stop)) return undefined
	if (vehicle.vehicleType !== 'wheelbarrow') return undefined
	const tile = vehicle.game.hex.getTile({
		q: svc.stop.anchor.coord[0],
		r: svc.stop.anchor.coord[1],
	})
	const content = tile?.content
	if (!(content instanceof StorageAlveolus) || content.action?.type !== 'road-fret') {
		traces.vehicle.warn?.('[dock.sync] docked vehicle has no road-fret bay', {
			vehicleUid: vehicle.uid,
			lineId: svc.line.id,
			stopId: svc.stop.id,
			anchor: svc.stop.anchor.coord,
			contentType: content?.constructor?.name,
			actionType: content instanceof StorageAlveolus ? content.action?.type : undefined,
		})
		return undefined
	}
	return content
}

/** Registers or clears the hive advertisement endpoint for a docked wheelbarrow at a road-fret bay. */
export function syncFreightVehicleDockRegistration(vehicle: VehicleEntity): void {
	for (const tile of vehicle.game.hex.tiles) {
		const content = tile.content
		const hive = content && 'hive' in content ? (content as Alveolus).hive : undefined
		hive?.unregisterFreightVehicleDock(vehicle.uid)
	}
	const bay = freightVehicleDockBay(vehicle)
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
	traces.vehicle.log?.('[dock.sync] registered vehicle dock', {
		vehicleUid: vehicle.uid,
		bay: bay.name,
		stock: { ...vehicle.storage.stock },
		virtualGoodsCount: vehicle.storage.virtualGoodsCount,
	})
	bay.hive.registerFreightVehicleDock(new VehicleFreightDock(vehicle, bay))
}
