import type { SaveState } from 'ssh/game'
import {
	anchorTileUidFromHiveUid,
	createSyntheticHiveObject,
	hiveUidForAnchorTile,
	isHiveUid,
	resolveHiveFromAnchorTile,
} from 'ssh/hive'
import { StorageAlveolus } from 'ssh/hive/storage'
import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine'

describe('hive inspector synthetic object', () => {
	it('encodes and decodes hive uids from anchor tile uid', () => {
		const anchor = 'tile:0,0'
		const uid = hiveUidForAnchorTile(anchor)
		expect(isHiveUid(uid)).toBe(true)
		expect(anchorTileUidFromHiveUid(uid)).toBe(anchor)
	})

	it('resolves a synthetic hive object via Game.getObject', async () => {
		const engine = new TestEngine({ terrainSeed: 1, characterCount: 0 })
		await engine.init()
		try {
			const scenario: Partial<SaveState> = {
				hives: [{ name: 'H', alveoli: [{ coord: [0, 0], alveolus: 'gather', goods: {} }] }],
			}
			engine.loadScenario(scenario)
			const tile = engine.game.hex.getTile({ q: 0, r: 0 })
			expect(tile).toBeDefined()
			expect(tile?.content).toBeInstanceOf(StorageAlveolus)
			const uid = hiveUidForAnchorTile(tile!.uid)
			const synthetic = engine.game.getObject(uid)
			expect(synthetic).toBeDefined()
			expect(synthetic && 'kind' in synthetic && synthetic.kind).toBe('hive')
			expect(synthetic?.uid).toBe(uid)
			expect(synthetic?.title).toBe('H')
			const hive = resolveHiveFromAnchorTile(engine.game, tile!.uid)
			expect(hive).toBeDefined()
		} finally {
			await engine.destroy()
		}
	})

	it('retargets hive when resolved from the same anchor tile after scenario reload', async () => {
		const engine = new TestEngine({ terrainSeed: 2, characterCount: 0 })
		await engine.init()
		try {
			engine.loadScenario({
				hives: [{ name: 'HiveA', alveoli: [{ coord: [1, 1], alveolus: 'gather', goods: {} }] }],
			})
			const tile = engine.game.hex.getTile({ q: 1, r: 1 })
			expect(tile).toBeDefined()
			const uid = hiveUidForAnchorTile(tile!.uid)
			const before = createSyntheticHiveObject(engine.game, tile!)
			expect(before?.title).toBe('HiveA')

			engine.loadScenario({
				hives: [{ name: 'HiveB', alveoli: [{ coord: [1, 1], alveolus: 'gather', goods: {} }] }],
			})
			const afterTile = engine.game.hex.getTile({ q: 1, r: 1 })
			expect(afterTile?.uid).toBe(tile!.uid)
			const after = engine.game.getObject(uid)
			expect(after && 'kind' in after && after.kind).toBe('hive')
			expect(after?.title).toBe('HiveB')
		} finally {
			await engine.destroy()
		}
	})
})
