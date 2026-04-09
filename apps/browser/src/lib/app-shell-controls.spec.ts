import { describe, expect, it, vi } from 'vitest'
import {
	appShellTimeControls,
	appShellZoneActions,
	buildPaletteSelectedActionValues,
	getAppShellBuildableAlveoli,
} from './app-shell-controls'

vi.mock('ssh/assets/game-content', () => ({
	alveoli: {
		house: { construction: true },
		mine: { construction: true },
		decor: {},
	},
}))

describe('app-shell-controls', () => {
	it('shares one time-control catalog for toolbar and palette', () => {
		expect(appShellTimeControls.map((t) => t.value)).toEqual([0, 1, 2, 3])
	})

	it('shares zone action values between toolbar and palette', () => {
		expect(appShellZoneActions.map((z) => z.value)).toEqual([
			'zone:residential',
			'zone:harvest',
			'zone:none',
		])
	})

	it('buildable alveoli and palette selected-action values stay aligned', () => {
		const buildable = getAppShellBuildableAlveoli()
		expect([...buildable.map(([name]) => name)].sort()).toEqual(['house', 'mine'].sort())

		const values = buildPaletteSelectedActionValues(buildable)
		const buildValues = values.filter((v) => v.value.startsWith('build:')).map((v) => v.value)
		expect([...buildValues].sort()).toEqual(['build:house', 'build:mine'].sort())
		expect(values.some((v) => v.value === '')).toBe(true)
		expect(values.some((v) => v.value === 'zone:residential')).toBe(true)
	})
})
