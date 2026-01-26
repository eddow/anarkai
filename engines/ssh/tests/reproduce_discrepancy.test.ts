import { describe, it, expect, vi } from 'vitest'
import { reactive, memoize, reactiveOptions } from 'mutts'

describe('Memoize Discrepancy Reproduction', () => {
    it('should reproduce discrepancy when dependency is updated via internal map', () => {
        const discrepancies: any[] = []
        reactiveOptions.onMemoizationDiscrepancy = (cached, fresh, fn, _args, cause) => {
            discrepancies.push({ cached, fresh, name: fn.name, cause })
        }

        class Storage {
            private data = new Map<string, string>()
            
            get(key: string) { return this.data.get(key) }
            set(key: string, val: string) { this.data.set(key, val) }
        }

        @reactive
        class Container {
            public storage = reactive(new Storage())
            
            @memoize
            get value() {
                return this.storage.get('foo')
            }
        }

        const c = new Container()
        
        // 1. First access, should cache 'undefined'
        expect(c.value).toBeUndefined()
        
        // 2. Update underlying data
        c.storage.set('foo', 'bar')
        
        // 3. Second access. If invalidation worked, this should be 'bar'.
        // If it didn't, and onMemoizationDiscrepancy is set, it will call it.
        const val = c.value
        
        if (discrepancies.length > 0) {
            console.error('REPRODUCED DISCREPANCY:', discrepancies[0])
        }
        
        expect(discrepancies.length).toBe(0)
        expect(val).toBe('bar')
    })

    it('should reproduce discrepancy with AxialKeyMap-like structure', () => {
        const discrepancies: any[] = []
        const originalOnDiscrepancy = reactiveOptions.onMemoizationDiscrepancy
        reactiveOptions.onMemoizationDiscrepancy = (cached, fresh, fn, _args, cause) => {
            discrepancies.push({ cached, fresh, name: fn.name, cause })
        }

        @reactive
        class SimpleAxialMap {
            private map = new Map<string, any>()
            get(k: {q: number, r: number}) { return this.map.get(`${k.q},${k.r}`) }
            set(k: {q: number, r: number}, v: any) { this.map.set(`${k.q},${k.r}`, v) }
        }

        @reactive
        class Tile {
            constructor(public map: SimpleAxialMap, public pos: {q: number, r: number}) {}
            
            @memoize
            get content() {
                return this.map.get(this.pos)
            }
        }

        const m = new SimpleAxialMap()
        const t = new Tile(m, {q: 0, r: 0})

        expect(t.content).toBeUndefined()
        m.set({q: 0, r: 0}, 'something')

        const val = t.content
        reactiveOptions.onMemoizationDiscrepancy = originalOnDiscrepancy

        expect(discrepancies.length).toBe(0)
        expect(val).toBe('something')
    })

    it('should NOT reproduce discrepancy when setter is called (theory: set handler uses unwrapped receiver - FIXED)', () => {
        const discrepancies: any[] = []
        const originalOnDiscrepancy = reactiveOptions.onMemoizationDiscrepancy
        reactiveOptions.onMemoizationDiscrepancy = (cached, fresh, fn, localArgs, cause) => {
            console.error(`[TEST] DISCREPANCY in ${fn.name}:`, { cached, fresh, host: localArgs[0], cause })
            discrepancies.push({ cached, fresh, name: fn.name, cause })
        }

        @reactive
        class Container {
            public _data = 'A'

            @memoize
            get value() {
                return this._data
            }

            set value(v: string) {
                const old = this.value // this.value should be cached 'A' on Proxy
                this._data = v
            }
        }

        const c = new Container()
        
        // 1. Initial call on PROXY, caches 'A'
        expect(c.value).toBe('A')

        // 2. First set. FIXED: now uses Proxy receiver, so it reads cached 'A' from Proxy cache.
        c.value = 'B'

        // 3. Second set. Reads cached 'B' (or recomputes if invalidated).
        c.value = 'C'

        // 4. Check if discrepancy occurred
        reactiveOptions.onMemoizationDiscrepancy = originalOnDiscrepancy
        expect(discrepancies.length).toBe(0)
    })

    it('should NOT reproduce discrepancy for ReactiveArray with same content', () => {
        const discrepancies: any[] = []
        const originalOnDiscrepancy = reactiveOptions.onMemoizationDiscrepancy
        reactiveOptions.onMemoizationDiscrepancy = (cached, fresh, fn, localArgs) => {
            console.error(`[TEST ARRAY] DISCREPANCY in ${fn.name}:`, { cached, fresh })
            discrepancies.push({ cached, fresh, name: fn.name })
        }

        @reactive
        class Container {
            public _items = reactive(['a', 'b', 'c'])
            
            @memoize
            get filtered() {
                return this._items.filter(i => i !== 'b')
            }
        }

        const c = new Container()
        
        // 1. First call, caches ['a', 'c']
        expect([...c.filtered]).toEqual(['a', 'c'])

        // 2. Someone mutates underlying items?
        // Let's replace the whole array with same content
        c._items = reactive(['a', 'b', 'c'])

        // 3. Second call. Invalidation should have happened.
        // If not, and it finds old ['a', 'c'] and new ['a', 'c'],
        // they should be deepEqual.
        expect([...c.filtered]).toEqual(['a', 'c'])

        reactiveOptions.onMemoizationDiscrepancy = originalOnDiscrepancy
        expect(discrepancies.length).toBe(0)
    })
})
