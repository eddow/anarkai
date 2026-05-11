import { showProps } from '@app/lib/follow-selection'
import { game } from '@app/lib/globals'
import { zoneOverlayState } from '@app/lib/freight-line-overlay'
import { reactive } from 'mutts'
import {
	ZONES_OBJECT_UID,
	isZoneObjectUid,
	type Zone,
	zoneIdFromObjectUid,
	zoneObjectUid,
} from 'ssh/board/zone'
import type { ZoneObject, ZonesCollectionObject } from 'ssh/board/zone-object'

export const unnamedZoneOwnership = reactive({
	zoneId: undefined as string | undefined,
	panelId: undefined as string | undefined,
})

export function getZonesObject(): ZonesCollectionObject | undefined {
	return game.getObject(ZONES_OBJECT_UID) as ZonesCollectionObject | undefined
}

export function getZoneObject(zoneId: Zone | string): ZoneObject | undefined {
	return game.getObject(zoneObjectUid(zoneId)) as ZoneObject | undefined
}

export function showZonesObject(): void {
	const object = getZonesObject()
	if (object) showProps(object)
}

export function showZoneObject(zoneId: Zone | string): void {
	const object = getZoneObject(zoneId)
	if (object) showProps(object)
}

export function isZonesUid(uid: string): boolean {
	return uid === ZONES_OBJECT_UID
}

export { ZONES_OBJECT_UID, isZoneObjectUid, zoneIdFromObjectUid, zoneObjectUid }
export { zoneOverlayState }
