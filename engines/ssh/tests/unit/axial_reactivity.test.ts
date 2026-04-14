import { effect } from 'mutts'
import { AxialKeyMap } from 'ssh/utils/mem'
import { describe, expect, it } from 'vitest'

describe('AxialKeyMap Reactivity', () => {
	it('should be reactive', () => {
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
		expect(count).toBe(2)
		expect(lastValue).toBe('hello')

		map.delete(key)
		expect(count).toBe(3)
		expect(lastValue).toBeUndefined()
	})
})
