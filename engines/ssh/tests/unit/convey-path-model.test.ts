import { isTileCoord } from 'ssh/board/board'
import { Alveolus } from 'ssh/board/content/alveolus'
import type { SaveState } from 'ssh/game'
import type { Hive, TrackedMovement } from 'ssh/hive/hive'
import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine'

async function flushDeferred(turns = 8) {
	for (let i = 0; i < turns; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

function assertTrimmedConveyPath(movement: TrackedMovement) {
	const { path } = movement
	expect(path.length).toBeGreaterThanOrEqual(1)
	expect(isTileCoord(path[path.length - 1]!)).toBe(true)
	if (path.length === 1) {
		expect(isTileCoord(path[0]!)).toBe(true)
		return
	}
	expect(isTileCoord(path[0]!)).toBe(false)
	for (let i = 0; i < path.length - 1; i++) {
		expect(isTileCoord(path[i]!) && isTileCoord(path[i + 1]!)).toBe(false)
	}
}

describe('convey path model', () => {
	it('uses border hops then a terminal demander tile (no consecutive tiles)', {
		timeout: 15000,
	}, async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()
		const scenario: Partial<SaveState> = {
			hives: [
				{
					name: 'PathShapeHive',
					alveoli: [
						{ coord: [0, 0], alveolus: 'storage', goods: { wood: 2 } },
						{ coord: [1, 0], alveolus: 'sawmill', goods: {} },
					],
				},
			],
		}
		engine.loadScenario(scenario)
		await flushDeferred()

		const tileContent = engine.game.hex.getTile({ q: 0, r: 0 })?.content
		expect(tileContent).toBeInstanceOf(Alveolus)
		if (!(tileContent instanceof Alveolus)) throw new Error('expected alveolus')
		const hive: Hive = tileContent.hive

		const movements: TrackedMovement[] = []
		for (const [, goods] of hive.movingGoods) {
			for (const mg of goods) movements.push(mg)
		}
		expect(movements.length).toBeGreaterThan(0)
		for (const mg of movements) assertTrimmedConveyPath(mg)

		await engine.destroy()
	})
})
