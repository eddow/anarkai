import { generate } from 'engine-terrain'
import { BoardGenerator } from 'ssh/generation/board'
import { describe, expect, it } from 'vitest'

describe('BoardGenerator riverFlow projection', () => {
	it('projects terrain riverFlow onto hydrology samples for channel tiles', () => {
		const snapshot = generate(42, 10)
		expect(snapshot.hydrology.riverFlow?.size ?? 0).toBeGreaterThan(0)

		const board = new BoardGenerator().generateBoard(snapshot)
		const withFlow = board.filter((t) => t.hydrology?.riverFlow !== undefined)
		expect(withFlow.length).toBeGreaterThan(0)

		const landFlow = withFlow.filter((t) => t.terrain !== 'water')
		expect(landFlow.length).toBeGreaterThan(0)
		for (const tile of landFlow) {
			const f = tile.hydrology!.riverFlow!
			expect(f.upstreamDirections.length + f.downstreamDirections.length).toBeGreaterThan(0)
			expect(Number.isFinite(f.rankFromSource)).toBe(true)
			expect(Number.isFinite(f.rankToSea)).toBe(true)
			expect(f.tileRole).not.toBe('none')
		}
	})
})
