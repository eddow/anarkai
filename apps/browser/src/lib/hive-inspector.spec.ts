import type { HexBoard } from 'ssh/board/board'
import { Alveolus } from 'ssh/board/content/alveolus'
import { Tile } from 'ssh/board/tile'
import type { Game } from 'ssh/game'
import type { Hive } from 'ssh/hive'
import { describe, expect, it } from 'vitest'
import {
	anchorTileUidFromHiveUid,
	createSyntheticHiveObject,
	createSyntheticHiveObjectForUid,
	hiveInspectorTitle,
	hiveUidForAnchorTile,
	isHiveUid,
	resolveHiveFromAnchorTile,
} from './hive-inspector'

function makeHiveTile(name: string): { game: Game; tile: Tile; hive: Hive } {
	const game = {
		objects: new Map<string, object>(),
		enqueueInteractiveRegistration: () => undefined,
	} as unknown as Game
	const hive = { name } as Hive
	const alveolus = Object.create(Alveolus.prototype) as Alveolus
	alveolus.hive = hive
	const board = {
		game,
		getTileContent: () => alveolus,
		setTileContent: () => undefined,
	} as unknown as HexBoard
	const tile = new Tile(board, { q: 0, r: 0 })
	game.objects.set(tile.uid, tile)
	return { game, tile, hive }
}

describe('browser hive inspector synthetic object', () => {
	it('encodes and decodes hive uids from anchor tile uid', () => {
		const anchor = 'tile:0,0'
		const uid = hiveUidForAnchorTile(anchor)
		expect(isHiveUid(uid)).toBe(true)
		expect(anchorTileUidFromHiveUid(uid)).toBe(anchor)
	})

	it('creates a browser-owned synthetic hive object for inspector panels', () => {
		const { game, tile } = makeHiveTile('H')
		const synthetic = createSyntheticHiveObject(game, tile)
		expect(synthetic?.kind).toBe('hive')
		expect(synthetic?.uid).toBe(hiveUidForAnchorTile(tile.uid))
		expect(synthetic?.title).toBe('H')
		expect(synthetic?.hoverObject).toBe(tile)
		expect(resolveHiveFromAnchorTile(game, tile.uid)?.name).toBe('H')
	})

	it('retargets hive titles through the current anchor tile content', () => {
		const { game, tile, hive } = makeHiveTile('HiveA')
		const uid = hiveUidForAnchorTile(tile.uid)
		expect(createSyntheticHiveObjectForUid(game, uid)?.title).toBe('HiveA')

		hive.name = 'HiveB'
		expect(createSyntheticHiveObjectForUid(game, uid)?.title).toBe('HiveB')
		expect(hiveInspectorTitle({ name: '  ' } as Hive)).toBe('Hive')
	})
})
