import type { Game } from 'ssh/game/game'
import type { InspectorSelectableObject } from 'ssh/game/object'
import type { Position } from 'ssh/utils/position'
import type { Tile } from './tile'
import { isZoneObjectUid, ZONES_OBJECT_UID, zoneIndexFromObjectUid } from './zone'

export class ZonesCollectionObject implements InspectorSelectableObject {
	readonly logs: string[] = []

	constructor(readonly game: Game) {}

	get title(): string {
		return 'Zones'
	}

	get debugInfo(): Record<string, any> {
		return {
			zones: this.game.hex.zoneManager.listZoneDefinitions().map((zone) => zone.name),
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
	readonly logs: string[] = []

	constructor(
		readonly game: Game,
		readonly zoneIndex: number
	) {}

	get definition() {
		return this.game.hex.zoneManager.zoneByIndex(this.zoneIndex)
	}

	get title(): string {
		return this.definition?.name?.trim() || `Zone ${this.zoneIndex}`
	}

	get debugInfo(): Record<string, any> {
		return {
			zoneIndex: this.zoneIndex,
			tiles: this.definition ? this.game.hex.zoneManager.coordsForZone(this.definition).length : 0,
		}
	}

	get position(): Position | undefined {
		return this.definition
			? this.game.hex.zoneManager.centralCoordForZone(this.definition)
			: undefined
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
	const index = zoneIndexFromObjectUid(uid)
	if (index === undefined) return undefined
	const definition = game.hex.zoneManager.zoneByIndex(index)
	if (!definition) return undefined
	return new ZoneObject(game, index)
}
