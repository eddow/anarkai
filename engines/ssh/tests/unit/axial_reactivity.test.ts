
import { describe, it, expect } from 'vitest'
import { AxialKeyMap } from './src/lib/utils/mem'
import { effect } from 'mutts'
import { axial } from './src/lib/utils'

describe('AxialKeyMap Reactivity', () => {
    it('should be reactive', () => {
        const map = new AxialKeyMap<string>()
        const key = { q: 0, r: 0 }
        let count = 0
        let lastValue: string | undefined

        effect(() => {
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
