import { showProps } from '@app/lib/follow-selection'
import { zoneOverlayState } from '@app/lib/freight-line-overlay'
import { game } from '@app/lib/globals'
import { reactive } from 'mutts'
import { zoneObjectUid } from 'ssh/board/zone'
import { ZoneObject, ZonesCollectionObject } from 'ssh/board/zone-object'

export const unnamedZoneOwnership = reactive({
	zoneIndex: undefined as number | undefined,
	panelId: undefined as string | undefined,
})

export function getZonesObject(): ZonesCollectionObject | undefined {
	return new ZonesCollectionObject(game)
}

export function getZoneObject(index: number): ZoneObject | undefined {
	return new ZoneObject(game, index)
}

export function showZonesObject(): void {
	const object = getZonesObject()
	if (object) showProps(object)
}

export function showZoneObject(index: number): void {
	const object = getZoneObject(index)
	if (object) showProps(object)
}

export { zoneObjectUid }
export { zoneOverlayState }
