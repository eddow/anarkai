import { freightStopAnchorMatchesAlveolus } from 'ssh/freight/freight-line'
import { describe, expect, it } from 'vitest'

describe('freightStopAnchorMatchesAlveolus', () => {
	it('does not throw when hive is missing (inspector retarget / transient shell)', () => {
		const anchor = {
			kind: 'alveolus' as const,
			hiveName: '',
			alveolusType: 'freight_bay' as const,
			coord: [0, 0] as const,
		}
		const alveolus = {
			hive: undefined,
			name: 'freight_bay',
			tile: { position: { q: 0, r: 0 } },
		}
		expect(() => freightStopAnchorMatchesAlveolus(anchor, alveolus)).not.toThrow()
		expect(freightStopAnchorMatchesAlveolus(anchor, alveolus)).toBe(true)
	})

	it('returns false when tile is missing', () => {
		const anchor = {
			kind: 'alveolus' as const,
			hiveName: 'H',
			alveolusType: 'freight_bay' as const,
			coord: [0, 0] as const,
		}
		const alveolus = {
			hive: { name: 'H' },
			name: 'freight_bay',
			tile: undefined,
		}
		expect(freightStopAnchorMatchesAlveolus(anchor, alveolus)).toBe(false)
	})
})
