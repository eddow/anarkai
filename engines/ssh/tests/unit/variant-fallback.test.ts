import { resolveAlveolusVariant } from 'ssh/construction-state'
import { describe, expect, it } from 'vitest'

describe('variant resolution fallback', () => {
	it('falls back to root when the entire variant path is unknown', () => {
		const resolved = resolveAlveolusVariant('pile', 'nonexistent.child')!
		expect(resolved.variant).toBeUndefined()
		expect(resolved.ancestorChain).toHaveLength(1)
		expect(resolved.ancestorChain[0]).toEqual({ goods: { wood: 4 }, workSeconds: 2 })
	})

	it('falls back to deepest existing prefix when a later segment is unknown', () => {
		const resolved = resolveAlveolusVariant('engineer', 'road.extra')!
		expect(resolved.variant).toBe('road')
		const chain = resolved.ancestorChain
		expect(chain).toHaveLength(2)
		const [root, road] = chain
		expect(root).toEqual({ goods: { wood: 1, stone: 1 }, workSeconds: 4 })
		expect(road).toEqual({ goods: { wood: 3, stone: 5 }, workSeconds: 8 })
	})
})
