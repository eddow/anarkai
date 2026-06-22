import { resolveAlveolusVariant } from 'ssh/construction-state'
import { createAlveolus } from 'ssh/hive'
import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine/engine'

describe('resolveAlveolusVariant validation', () => {
	it('returns undefined for unknown alveolus type', () => {
		expect(resolveAlveolusVariant('non_existent_type' as never)).toBeUndefined()
	})

	it('returns root definition for variant-less alveolus', () => {
		const result = resolveAlveolusVariant('sawmill')
		expect(result).toBeDefined()
		expect(result!.variant).toBeUndefined()
		expect(result!.ancestorChain).toHaveLength(1)
	})

	it('resolves full variant path for pile.wood.extra with correct construction chain', () => {
		const resolved = resolveAlveolusVariant('pile', 'wood.extra')
		expect(resolved?.variant).toBe('wood.extra')
		expect(resolved?.ancestorChain).toHaveLength(3)
		const [root, wood, extra] = resolved!.ancestorChain
		expect(root).toEqual({ goods: { wood: 4 }, workSeconds: 2 })
		expect(wood).toEqual({ goods: { wood: 8 }, workSeconds: 4 })
		expect(extra).toEqual({ goods: { steel: 3, wood: 5 }, workSeconds: 6 })
	})

	it('falls back to the deepest existing variant segment when a child is missing', () => {
		const resolved = resolveAlveolusVariant('pile', 'wood.missing.child')
		expect(resolved?.variant).toBe('wood')
		expect(resolved?.ancestorChain).toHaveLength(2)
		const [, wood] = resolved!.ancestorChain
		expect(wood).toEqual({ goods: { wood: 8 }, workSeconds: 4 })
	})

	it('assigns variant and variantSpec on engineer variants', async () => {
		const engine = new TestEngine({ terrainSeed: 9_999, characterCount: 0 })
		await engine.init()
		try {
			engine.loadScenario({
				tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }],
				hives: [],
			})
			const tile = engine.game.hex.getTile({ q: 0, r: 0 })!
			const roadEngineer = createAlveolus('engineer', tile, 'road')
			const baseEngineer = createAlveolus('engineer', tile)
			expect(roadEngineer?.variant).toBe('road')
			expect(roadEngineer?.variantSpec).toEqual({ kind: 'road' })
			expect(baseEngineer?.variant).toBeUndefined()
			expect(baseEngineer?.variantSpec).toBeUndefined()
		} finally {
			await engine.destroy()
		}
	})
})
