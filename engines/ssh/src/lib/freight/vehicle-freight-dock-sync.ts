import type { Alveolus } from 'ssh/board/content/alveolus'
import { VehicleFreightDock } from 'ssh/freight/vehicle-freight-dock'
import { StorageAlveolus } from 'ssh/hive/storage'
import type { VehicleEntity } from 'ssh/population/vehicle/entity'
import { isVehicleLineService } from 'ssh/population/vehicle/vehicle'

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
	if (!(content instanceof StorageAlveolus) || content.action?.type !== 'road-fret')
		return undefined
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
	if (!bay) return
	bay.hive.registerFreightVehicleDock(new VehicleFreightDock(vehicle, bay))
}
