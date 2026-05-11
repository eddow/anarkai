import type { Game } from 'ssh/game/game'
import type { InspectorSelectableObject } from 'ssh/game/object'
import type { Position } from 'ssh/utils/position'
import type { Tile } from './tile'
import {
	type Zone,
	isZoneObjectUid,
	ZONES_OBJECT_UID,
	zoneIdFromObjectUid,
	zoneObjectUid,
} from './zone'

export class ZonesCollectionObject implements InspectorSelectableObject {
	readonly uid = ZONES_OBJECT_UID
	readonly logs: string[] = []

	constructor(readonly game: Game) {}

	get title(): string {
		return 'Zones'
	}

	get debugInfo(): Record<string, any> {
		return {
			zones: this.game.hex.zoneManager.listCustomZoneDefinitions().map((zone) => zone.id),
		}
	}

	get position(): Position | undefined {
		return undefined
	}

	get hoverObject(): Tile | undefined {
		return undefined
	}
}

export class ZoneObject implements InspectorSelectableObject {
	readonly uid: string
	readonly logs: string[] = []

	constructor(
		readonly game: Game,
		readonly zoneId: Zone
	) {
		this.uid = zoneObjectUid(zoneId)
	}

	get definition() {
		return this.game.hex.zoneManager.getZoneDefinition(this.zoneId)
	}

	get title(): string {
		return this.definition?.name?.trim() || 'Zone'
	}

	get debugInfo(): Record<string, any> {
		return {
			zoneId: this.zoneId,
			tiles: this.game.hex.zoneManager.coordsForZone(this.zoneId).length,
		}
	}

	get position(): Position | undefined {
		return this.game.hex.zoneManager.centralCoordForZone(this.zoneId)
	}

	get tile(): Tile {
		return this.game.hex.getTile(this.position ?? { q: 0, r: 0 })!
	}

	get hoverObject(): Tile | undefined {
		return this.position ? this.tile : undefined
	}
}

export function createZoneObjectForUid(game: Game, uid: string) {
	if (uid === ZONES_OBJECT_UID) return new ZonesCollectionObject(game)
	if (!isZoneObjectUid(uid)) return undefined
	const zoneId = zoneIdFromObjectUid(uid)
	const definition = zoneId ? game.hex.zoneManager.getZoneDefinition(zoneId) : undefined
	if (!zoneId || !definition || definition.builtIn) return undefined
	return new ZoneObject(game, zoneId)
}
