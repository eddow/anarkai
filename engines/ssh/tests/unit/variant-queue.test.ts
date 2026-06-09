import type { Tile } from 'ssh/board/tile'
import { BuildAlveolus } from 'ssh/hive/build'
import { describe, expect, it } from 'vitest'

describe('variant construction queue expansion', () => {
	it('expands pile.wood.extra into three construction steps with correct recipes', () => {
		const tile = {
			board: { game: { enqueueStoragePresentationChange: () => undefined } },
			position: { q: 0, r: 0 },
		} as unknown as Tile

		const build = new BuildAlveolus(tile, 'pile', undefined, 'wood.extra')

		expect(build.constructionQueue).toHaveLength(3)
		expect(build.constructionStepIndex).toBe(0)
		expect(build.targetVariantId).toBe('wood.extra')
		expect(build.nextVariantId).toBe('wood')

		const [root, wood, extra] = build.constructionQueue
		expect(root).toEqual({ goods: { wood: 4 }, workSeconds: 2 })
		expect(wood).toEqual({ goods: { wood: 10 }, workSeconds: 4 })
		expect(extra).toEqual({ goods: { wood: 15, planks: 10 }, workSeconds: 6 })
	})
})
