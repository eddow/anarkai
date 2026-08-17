import type { Game } from 'ssh/game/game'
import type { InspectorSelectableObject } from 'ssh/game/object'
import type { Position } from 'ssh/utils/position'
import type { Tile } from './tile'
import type { ZoneDefinition } from './zone'
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
		readonly definition: ZoneDefinition
	) {}

	get title(): string {
		return this.definition?.name?.trim() || 'Zone'
	}

	get debugInfo(): Record<string, any> {
		return {
			tiles: this.game.hex.zoneManager.coordsForZone(this.definition).length,
		}
	}

	get position(): Position | undefined {
		return this.game.hex.zoneManager.centralCoordForZone(this.definition)
	}

	get tile(): Tile {
		return this.game.hex.getTile(this.position ?? { q: 0, r: 0 })!
	}

	get hoverObject(): Tile | undefined {
		return this.position ? this.tile : undefined
	}
}
