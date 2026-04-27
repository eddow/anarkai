import type { FreightLineDefinition, FreightStop } from 'ssh/freight/freight-line'
import type { Game } from 'ssh/game'
import type { Hive } from 'ssh/hive'
import { StorageAlveolus } from 'ssh/hive/storage'
import type { VehicleEntity } from 'ssh/population/vehicle/entity'
import { isVehicleLineService } from 'ssh/population/vehicle/vehicle'

export interface DockedVehicleEntry {
	readonly vehicle: VehicleEntity
	readonly line: FreightLineDefinition
	readonly stop: FreightStop
}

function dockedLineEntry(vehicle: VehicleEntity): DockedVehicleEntry | undefined {
	const service = vehicle.service
	if (!isVehicleLineService(service)) return undefined
	if (!service.docked) return undefined
	return { vehicle, line: service.line, stop: service.stop }
}

export function collectDockedVehiclesForBay(
	game: Game,
	bay: StorageAlveolus
): DockedVehicleEntry[] {
	const entries: DockedVehicleEntry[] = []
	for (const vehicle of game.vehicles) {
		const content = vehicle.tile.content
		if (!(content instanceof StorageAlveolus)) continue
		if (content.action?.type !== 'road-fret') continue
		if (content.tile.uid !== bay.tile.uid) continue
		const entry = dockedLineEntry(vehicle)
		if (entry) entries.push(entry)
	}
	return entries.sort((a, b) => a.vehicle.uid.localeCompare(b.vehicle.uid))
}

export function collectDockedVehiclesForHive(game: Game, hive: Hive): DockedVehicleEntry[] {
	const entries: DockedVehicleEntry[] = []
	for (const vehicle of game.vehicles) {
		const content = vehicle.tile.content
		if (!(content instanceof StorageAlveolus)) continue
		if (content.action?.type !== 'road-fret') continue
		// Prefer reference identity; hive display names are not guaranteed unique across hives.
		if (content.hive !== hive) continue
		const entry = dockedLineEntry(vehicle)
		if (entry) entries.push(entry)
	}
	return entries.sort((a, b) => a.vehicle.uid.localeCompare(b.vehicle.uid))
}
