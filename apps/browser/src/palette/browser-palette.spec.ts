import { reactive } from 'mutts'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@app/lib/globals', () => ({
	configuration: reactive({
		timeControl: 0 as 0 | 1 | 2 | 3,
	}),
	game: {
		rendererReady: Promise.resolve(),
		getTexture: vi.fn(),
	},
	interactionMode: reactive({ selectedAction: '' }),
	uiConfiguration: reactive({ darkMode: false }),
}))

vi.mock('ssh/assets/game-content', () => ({
	alveoli: {
		house: { construction: true },
		freight_bay: { construction: true },
		decor: {},
	},
}))

vi.mock('engine-pixi/assets/visual-content', () => ({
	alveoli: {
		house: { sprites: ['house-sprite'] },
		freight_bay: { sprites: ['freight-bay-sprite'] },
		storage: { sprites: ['storage-sprite'] },
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
		const openCfg = palette.tool('openConfiguration') as { run(): void }
		const openGame = palette.tool('openGame') as { run(): void }
		const openTest = palette.tool('openTest') as { run(): void }

		const spyConfiguration = vi.fn()
		const spyGame = vi.fn()
		const spyTest = vi.fn()
		palettePanelBridge.openConfiguration = spyConfiguration
		palettePanelBridge.openGame = spyGame
		palettePanelBridge.openTest = spyTest

		openCfg.run()
		openGame.run()
		openTest.run()

		expect(spyConfiguration).toHaveBeenCalledTimes(1)
		expect(spyGame).toHaveBeenCalledTimes(1)
		expect(spyTest).toHaveBeenCalledTimes(1)
	})

	it('provides an icon for build selectedAction entries', () => {
		const palette = getBrowserPalette().palette
		const selectedAction = palette.tool('selectedAction') as {
			values: Array<{ value: string; icon?: string | JSX.Element }>
		}

		const buildHouse = selectedAction.values.find((entry) => entry.value === 'build:house')
		expect(buildHouse?.icon).toBeTruthy()
	})

	it('keeps freight bay in build selectedAction entries', () => {
		const palette = getBrowserPalette().palette
		const selectedAction = palette.tool('selectedAction') as {
			values: Array<{ value: string }>
		}

		expect(selectedAction.values.some((entry) => entry.value === 'build:freight_bay')).toBe(true)
	})

	it('uses the freight bay visual for the freight bay build entry', () => {
		const palette = getBrowserPalette().palette
		const selectedAction = palette.tool('selectedAction') as {
			values: Array<{ value: string; icon?: string | JSX.Element | (() => JSX.Element) }>
		}

		const freightBay = selectedAction.values.find((entry) => entry.value === 'build:freight_bay')
		expect(freightBay?.icon).toBeTruthy()
	})
})
