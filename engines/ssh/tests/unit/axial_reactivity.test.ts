import { effect } from 'mutts'
import { AxialKeyMap } from 'ssh/utils/mem'
import { describe, expect, it } from 'vitest'

describe('AxialKeyMap', () => {
	it('keeps map storage raw because axial maps are transient query indexes', () => {
		const map = new AxialKeyMap<string>()
		const key = { q: 0, r: 0 }
		let count = 0
		let lastValue: string | undefined

		effect`test:axial-reactivity`(() => {
			count++
			lastValue = map.get(key)
		})

		expect(count).toBe(1)
		expect(lastValue).toBeUndefined()

		map.set(key, 'hello')
		expect(count).toBe(1)
		expect(map.get(key)).toBe('hello')

		map.delete(key)
		expect(count).toBe(1)
		expect(map.get(key)).toBeUndefined()
	})
})
