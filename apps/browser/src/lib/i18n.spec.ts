import { describe, expect, it } from 'vitest'
import { i18nState, T } from './i18n'

describe('browser i18n state', () => {
	it('starts with a placeholder translator while locale data loads', () => {
		const translator = i18nState.translator

		expect(translator('anything')).toBe('...')
		expect(translator.any.deep.key()).toBe('...')
		expect(translator.any.deep.key.toString()).toBe('...')
		expect(String(translator.any.deep.key)).toBe('...')
		expect(Reflect.get(translator, 'then')).toBeUndefined()
		expect(T.any.deep.key()).toBe('...')
	})
})
