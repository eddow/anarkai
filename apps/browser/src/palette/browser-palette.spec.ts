import { isRunTool } from '@sursaut/ui/palette'
import { reactive } from 'mutts'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@app/lib/globals', () => ({
	configuration: reactive({
		timeControl: 'pause' as 'pause' | 'play' | 'fast-forward' | 'gonzales',
	}),
	interactionMode: reactive({ selectedAction: '' }),
	uiConfiguration: reactive({ darkMode: false }),
}))

vi.mock('ssh/assets/game-content', () => ({
	alveoli: {
		house: { construction: true },
		decor: {},
	},
}))

import { disposeBrowserPalette, getBrowserPalette, palettePanelBridge } from './browser-palette'

describe('browser palette registry & palettePanelBridge', () => {
	afterEach(() => {
		disposeBrowserPalette()
		palettePanelBridge.openConfiguration = () => {}
		palettePanelBridge.openGame = () => {}
		palettePanelBridge.openTest = () => {}
	})

	it('run tools resolve to palettePanelBridge panel openers', () => {
		const palette = getBrowserPalette().palette
		const openCfg = palette.tool('openConfiguration')
		const openGame = palette.tool('openGame')
		const openTest = palette.tool('openTest')
		expect(isRunTool(openCfg)).toBe(true)
		expect(isRunTool(openGame)).toBe(true)
		expect(isRunTool(openTest)).toBe(true)

		const spyConfiguration = vi.fn()
		const spyGame = vi.fn()
		const spyTest = vi.fn()
		palettePanelBridge.openConfiguration = spyConfiguration
		palettePanelBridge.openGame = spyGame
		palettePanelBridge.openTest = spyTest

		if (isRunTool(openCfg)) openCfg.run()
		if (isRunTool(openGame)) openGame.run()
		if (isRunTool(openTest)) openTest.run()

		expect(spyConfiguration).toHaveBeenCalledTimes(1)
		expect(spyGame).toHaveBeenCalledTimes(1)
		expect(spyTest).toHaveBeenCalledTimes(1)
	})
})
