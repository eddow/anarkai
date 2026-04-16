import type { Alveolus } from 'ssh/board/content/alveolus'
import { VehicleFreightDock } from 'ssh/freight/vehicle-freight-dock'
import { StorageAlveolus } from 'ssh/hive/storage'
import type { VehicleEntity } from 'ssh/population/vehicle/entity'
import { isVehicleLineService } from 'ssh/population/vehicle/vehicle'

/** Registers or clears the hive advertisement endpoint for a docked wheelbarrow at a road-fret bay. */
export function syncFreightVehicleDockRegistration(vehicle: VehicleEntity): void {
	const content = vehicle.tile.content
	const hive = content && 'hive' in content ? (content as Alveolus).hive : undefined
	if (hive) hive.unregisterFreightVehicleDock(vehicle.uid)
	if (!(content instanceof StorageAlveolus) || content.action?.type !== 'road-fret') return
	if (
		!isVehicleLineService(vehicle.service) ||
		!vehicle.service.docked ||
		vehicle.vehicleType !== 'wheelbarrow'
	)
		return
	content.hive.registerFreightVehicleDock(new VehicleFreightDock(vehicle, content))
}
