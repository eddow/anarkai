import { describe, expect, it } from 'vitest'
import { paletteCommandResultTitle } from './command-box'

describe('paletteCommandResultTitle', () => {
	it('returns label only when meta is absent', () => {
		expect(paletteCommandResultTitle({ label: 'Open game' })).toBe('Open game')
	})

	it('returns label only when meta is blank', () => {
		expect(paletteCommandResultTitle({ label: 'Theme', meta: '   ' })).toBe('Theme')
	})

	it('combines label and meta', () => {
		expect(paletteCommandResultTitle({ label: 'Light', meta: 'appearance' })).toBe(
			'Light — appearance'
		)
	})
})
