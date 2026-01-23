import { reactive } from 'mutts'
import type { AxialCoord } from '$lib/utils'
import { AxialKeyMap } from '$lib/utils/mem'

export type Zone = 'residential' | 'harvest'

export class ZoneManager {
	private readonly zones = reactive(new AxialKeyMap<Zone>())

	setZone(coord: AxialCoord, zone: Zone): void {
		this.zones.set(coord, zone)
	}

	getZone(coord: AxialCoord): Zone | undefined {
		return this.zones.get(coord)
	}

	removeZone(coord: AxialCoord): boolean {
		return this.zones.delete(coord)
	}

	hasZone(coord: AxialCoord): boolean {
		return this.zones.has(coord)
	}
}
