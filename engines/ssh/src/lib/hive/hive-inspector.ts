import { Alveolus } from 'ssh/board/content/alveolus'
import { Tile } from 'ssh/board/tile'
import type { Game } from 'ssh/game'
import type { InspectorSelectableObject } from 'ssh/game/object'
import type { Hive } from './hive'

export const HIVE_UID_PREFIX = 'hive:'

export interface SyntheticHiveObject extends InspectorSelectableObject {
	readonly kind: 'hive'
	/** Tile uid used as stable anchor; hive is resolved from that tile's alveolus at read time. */
	readonly anchorTileUid: string
	/** Anchor tile for linked-entity visuals / hover parity with freight-line synthetics. */
	readonly tile: Tile
}

export function hiveUidForAnchorTile(tileUid: string): string {
	return `${HIVE_UID_PREFIX}${encodeURIComponent(tileUid)}`
}

export function isHiveUid(uid: string): boolean {
	return uid.startsWith(HIVE_UID_PREFIX)
}

export function anchorTileUidFromHiveUid(uid: string): string | undefined {
	if (!isHiveUid(uid)) return undefined
	const encoded = uid.slice(HIVE_UID_PREFIX.length)
	return encoded ? decodeURIComponent(encoded) : undefined
}

export function resolveHiveFromAnchorTile(game: Game, anchorTileUid: string): Hive | undefined {
	const tile = game.objects.get(anchorTileUid)
	if (!(tile instanceof Tile)) return undefined
	const content = tile.content
	return content instanceof Alveolus ? content.hive : undefined
}

export function hiveInspectorTitle(hive: Hive | undefined): string {
	if (!hive) return 'Hive'
	const name = hive.name?.trim()
	return name ? name : 'Hive'
}

export function createSyntheticHiveObject(game: Game, anchorTile: Tile): SyntheticHiveObject | undefined {
	const content = anchorTile.content
	if (!(content instanceof Alveolus)) return undefined
	const hive = content.hive
	return {
		kind: 'hive',
		uid: hiveUidForAnchorTile(anchorTile.uid),
		title: hiveInspectorTitle(hive),
		game,
		logs: [],
		position: anchorTile.position,
		hoverObject: anchorTile,
		anchorTileUid: anchorTile.uid,
		tile: anchorTile,
	}
}
