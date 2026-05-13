import { ensureWasmLoaded, generateSectorRegionAsync } from 'engine-terrain'
import { BoardGenerator } from 'ssh/generation/board'
import { describe, expect, it } from 'vitest'

describe('BoardGenerator riverFlow projection', () => {
	it('projects terrain riverFlow onto hydrology samples for channel tiles', async () => {
		await ensureWasmLoaded()
		const snapshot = await generateSectorRegionAsync(1, [{ q: 0, r: 0 }], {
			sectorStep: 17,
			padding: 1,
			hydrologyPadding: 16,
		})
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
