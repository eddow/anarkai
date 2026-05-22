import { gameTimeSpeedFactors } from 'engine-rules'
import { reactive } from 'mutts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import defaultPalette from './palette.default.json'

vi.mock('@app/lib/globals', () => ({
	configuration: reactive({
		timeControl: 0 as 0 | 1 | 2 | 3,
	}),
	game: {
		rendererReady: Promise.resolve(),
		getTexture: vi.fn(),
		playerAccount: reactive({ balanceVp: 200 }),
	},
	interactionMode: reactive({ selectedAction: '' }),
	uiConfiguration: reactive({ darkMode: false }),
}))

vi.mock('@app/lib/zone-selection', () => ({
	showZonesObject: vi.fn(),
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
		palettePanelBridge.openLines = () => {}
		palettePanelBridge.openZones = () => {}
	})

	it('run tools resolve to palettePanelBridge panel openers', () => {
		const palette = getBrowserPalette().palette
		const openCfg = palette.tool('openConfiguration') as { run(): void }
		const openGame = palette.tool('openGame') as { run(): void }
		const openLines = palette.tool('openLines') as { run(): void }
		const openZones = palette.tool('openZones') as { run(): void }

		const spyConfiguration = vi.fn()
		const spyGame = vi.fn()
		const spyLines = vi.fn()
		const spyZones = vi.fn()
		palettePanelBridge.openConfiguration = spyConfiguration
		palettePanelBridge.openGame = spyGame
		palettePanelBridge.openLines = spyLines
		palettePanelBridge.openZones = spyZones

		openCfg.run()
		openGame.run()
		openLines.run()
		openZones.run()

		expect(spyConfiguration).toHaveBeenCalledTimes(1)
		expect(spyGame).toHaveBeenCalledTimes(1)
		expect(spyLines).toHaveBeenCalledTimes(1)
		expect(spyZones).toHaveBeenCalledTimes(1)
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

	it('exposes road tools as selected actions', () => {
		const palette = getBrowserPalette().palette
		const selectedAction = palette.tool('selectedAction') as {
			values: Array<{ value: string; icon?: string }>
		}

		const path = selectedAction.values.find((entry) => entry.value === 'road:path')
		const asphalt = selectedAction.values.find((entry) => entry.value === 'road:asphalt')
		expect(path?.icon).toBeTruthy()
		expect(asphalt?.icon).toBeTruthy()
	})

	it('exposes freight add-stop as a selected action while line picking is active', () => {
		const palette = getBrowserPalette().palette
		const selectedAction = palette.tool('selectedAction') as {
			values: Array<{ value: string; icon?: string; keywords?: string[] }>
		}

		const addStop = selectedAction.values.find((entry) => entry.value === 'freight:add-stop')
		expect(addStop?.icon).toBeTruthy()
		expect(addStop?.keywords).toContain('freight')
	})

	it('uses the freight bay visual for the freight bay build entry', () => {
		const palette = getBrowserPalette().palette
		const selectedAction = palette.tool('selectedAction') as {
			values: Array<{ value: string; icon?: string | JSX.Element | (() => JSX.Element) }>
		}

		const freightBay = selectedAction.values.find((entry) => entry.value === 'build:freight_bay')
		expect(freightBay?.icon).toBeTruthy()
	})

	it('exposes build, zone, and road tools in the top toolbar', () => {
		const acceptedKeywords = defaultPalette.top
			.flat(2)
			.flatMap((entry) => entry.toolbar)
			.filter((entry) => entry.tool === 'selectedAction')
			.flatMap((entry) => entry.config.acceptedKeywords ?? [])

		expect(acceptedKeywords).toContain('select')
		expect(acceptedKeywords).toContain('build')
		expect(acceptedKeywords).toContain('zone')
		expect(acceptedKeywords).toContain('road')
		expect(acceptedKeywords).not.toContain('path')
	})

	it('derives the speed tool max from gameTimeSpeedFactors length', () => {
		const palette = getBrowserPalette().palette
		const timeControl = palette.tool('timeControl') as {
			min: number
			max: number
			step: number
			value: number
		}

		expect(timeControl.min).toBe(0)
		expect(timeControl.max).toBe(gameTimeSpeedFactors.length - 1)
		expect(timeControl.step).toBe(1)
		expect(timeControl.value).toBe(0)
	})

	it('keeps the account balance visible in the top toolbar preset', () => {
		const accountItem = defaultPalette.top
			.flat(2)
			.flatMap((entry) => entry.toolbar)
			.find((entry) => entry.editor === 'account')

		expect(accountItem?.config?.label).toBe('Account')
	})

	it('keeps the lines panel in the top toolbar preset', () => {
		const linesItem = defaultPalette.top
			.flat(2)
			.flatMap((entry) => entry.toolbar)
			.find((entry) => entry.tool === 'openLines')

		expect(linesItem?.config?.label).toBe('Lines')
	})
})
