import { reactive } from 'mutts'
import { debugObjectId, debugRawObjectId, resetDebugObjectIds } from 'ssh/dev/debug-object-id'
import { describe, expect, it } from 'vitest'

describe('debugObjectId', () => {
	it('assigns stable ephemeral ids to objects only', () => {
		resetDebugObjectIds()
		const first = {}
		const second = {}

		expect(debugObjectId(undefined)).toBeUndefined()
		expect(debugObjectId(null)).toBeUndefined()
		expect(debugObjectId('x')).toBeUndefined()
		expect(debugObjectId(first)).toBe('obj:1')
		expect(debugObjectId(first)).toBe('obj:1')
		expect(debugObjectId(second)).toBe('obj:2')
	})

	it('can compare proxy identity with raw object identity', () => {
		resetDebugObjectIds()
		const raw = { value: 1 }
		const proxy = reactive(raw)

		expect(debugObjectId(raw)).toBe('obj:1')
		expect(debugRawObjectId(raw)).toBe('obj:1')
		expect(debugObjectId(proxy)).toBe('obj:2')
		expect(debugRawObjectId(proxy)).toBe('obj:1')
	})

	it('resets the debug id registry', () => {
		resetDebugObjectIds()
		expect(debugObjectId({})).toBe('obj:1')
		resetDebugObjectIds()
		expect(debugObjectId({})).toBe('obj:1')
	})
})
