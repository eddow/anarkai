import { showProps } from '@app/lib/follow-selection'
import { zoneOverlayState } from '@app/lib/freight-line-overlay'
import { game } from '@app/lib/globals'
import { reactive } from 'mutts'
import type { ZoneDefinition } from 'ssh/board/zone'
import { ZoneObject, ZonesCollectionObject } from 'ssh/board/zone-object'

export const unnamedZoneOwnership = reactive({
	zone: undefined as ZoneDefinition | undefined,
})

export function getZonesObject(): ZonesCollectionObject | undefined {
	return new ZonesCollectionObject(game)
}

export function getZoneObject(definition: ZoneDefinition): ZoneObject | undefined {
	return new ZoneObject(game, definition)
}

export function showZonesObject(): void {
	const object = getZonesObject()
	if (object) showProps(object)
}

export function showZoneObject(definition: ZoneDefinition): void {
	const object = getZoneObject(definition)
	if (object) showProps(object)
}

export { zoneOverlayState }
