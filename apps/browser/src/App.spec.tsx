import { browserPaletteIdeConfig, getBrowserPalette } from '@app/palette/browser-palette'
import paletteDefaultJson from '@app/palette/palette.default.json'
import { PALETTE_INSPECTOR_DOCK_PANEL_ID } from '@app/palette/palette-inspector'
import { document, latch } from '@sursaut/core'
import { palettes } from '@sursaut/ui/palette'
import { registerGlyfIconFactory } from 'pure-glyf/sursaut'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

type PaletteToolRun = {
	run(): void
}

type PaletteToolValue<T> = {
	value: T
}

const { addPanel, getPanel, removePanel, dockviewApi, gameInstance, globals } = vi.hoisted(() => {
	const addPanel = vi.fn((panel: Record<string, unknown>) => panel)
	const getPanel = vi.fn<(id?: string) => { id: string } | undefined>(() => undefined)
	const removePanel = vi.fn()
	const dockviewApi = { addPanel, getPanel, removePanel }
	const gameInstance = {
		clock: {
			virtualTime: 125,
		},
	}
	const globals = {
		configuration: {
			timeControl: 0 as 0 | 1 | 2 | 3,
		},
		game: gameInstance,
		interactionMode: {
			selectedAction: '',
		},
		selectionState: {},
		bumpSelectionTitleVersion: vi.fn(),
		getDockviewLayout: vi.fn(() => undefined),
		dockviewLayout: {
			sshLayout: { root: 'layout' },
		},
		uiConfiguration: {
			darkMode: false,
		},
	}
	return { addPanel, getPanel, removePanel, dockviewApi, gameInstance, globals }
})

vi.mock('./app.css', () => ({}))

vi.mock('ssh/debug', () => ({
	initConsoleTrap: vi.fn(),
}))

vi.mock('@app/lib/globals', () => globals)

vi.mock('dockview-core', () => ({
	themeDracula: { name: 'dracula' },
	themeLight: { name: 'light' },
}))

vi.mock('ssh/assets/game-content', () => ({
	alveoli: {
		house: { construction: true },
		mine: { construction: true },
		decor: {},
	},
}))

vi.mock('engine-pixi/assets/visual-content', () => ({
	alveoli: {
		house: { sprites: ['house-sprite'] },
		mine: { sprites: ['mine-sprite'] },
	},
}))

vi.mock('pure-glyf/icons', () => ({
	tablerFilledAdjustments: 'pure-glyf-icon glyf-tabler-filled-adjustments',
	tablerFilledArrowBigRight: 'pure-glyf-icon glyf-tabler-filled-arrow-big-right',
	tablerFilledFlask: 'pure-glyf-icon glyf-tabler-filled-flask',
	tablerFilledPlayerPause: 'pure-glyf-icon glyf-tabler-filled-player-pause',
	tablerFilledPlayerPlay: 'pure-glyf-icon glyf-tabler-filled-player-play',
	tablerFilledPlayerSkipForward: 'pure-glyf-icon glyf-tabler-filled-player-skip-forward',
	tablerFilledPlayerTrackNext: 'pure-glyf-icon glyf-tabler-filled-player-track-next',
	tablerFilledPointer: 'pure-glyf-icon glyf-tabler-filled-pointer',
	tablerFilledSquareRoundedMinus: 'pure-glyf-icon glyf-tabler-filled-square-rounded-minus',
	tablerFilledZoomMoney: 'pure-glyf-icon glyf-tabler-filled-zoom-money',
	tablerOutlineTrees: 'pure-glyf-icon glyf-tabler-outline-trees',
}))

vi.mock('./components/ResourceImage', () => ({
	default: (props: { alt?: string }) => <span data-testid="resource-image">{props.alt ?? ''}</span>,
}))

vi.mock('./widgets/selection-info-tab', () => ({
	default: () => <div>selection-info-tab</div>,
}))

vi.mock('./widgets', () => ({
	default: {
		game: () => <div>game</div>,
		configuration: () => <div>configuration</div>,
		paletteInspector: () => <div data-testid="palette-inspector-widget">palette-inspector</div>,
		test: () => <div>test</div>,
	},
}))

vi.mock('@sursaut', () => ({
	Button: (props: { onClick?: () => void; children?: any; ['aria-label']?: string }) => (
		<button onClick={props.onClick} aria-label={props['aria-label']}>
			{props.children}
		</button>
	),
	ButtonGroup: (props: { children?: any }) => <div class="button-group">{props.children}</div>,
	DisplayProvider: (props: { children?: any }) => <>{props.children}</>,
	ThemeToggle: (props: { settings: { theme: 'light' | 'dark' } }) => (
		<button
			aria-label="Theme Toggle"
			onClick={() => {
				props.settings.theme = props.settings.theme === 'dark' ? 'light' : 'dark'
			}}
		>
			{props.settings.theme}
		</button>
	),
	Toolbar: Object.assign(
		(props: { children?: any }) => <div class="toolbar">{props.children}</div>,
		{
			Spacer: (props: { children?: any }) => <div class="toolbar-spacer">{props.children}</div>,
		}
	),
	RadioButton: (props: { value: unknown; group: any; children?: any; ['aria-label']?: string }) => (
		<button
			aria-label={props['aria-label']}
			onClick={() => {
				if (props.group && typeof props.group.set === 'function') {
					props.group.set(props.value)
					return
				}
				if (typeof props.group === 'object' && props.group) {
					if ('selectedAction' in props.group) props.group.selectedAction = props.value
					if ('timeControl' in props.group) props.group.timeControl = props.value
					return
				}
				if (
					['Pause', 'Play', 'Fast Forward', 'Gonzales'].includes(props['aria-label'] ?? '') &&
					typeof props.value === 'number'
				) {
					if ([0, 1, 2, 3].includes(props.value)) {
						globals.configuration.timeControl = props.value as 0 | 1 | 2 | 3
					}
					return
				}
				if (typeof props.value !== 'string') return
				globals.interactionMode.selectedAction = props.value
			}}
		>
			{props.children}
		</button>
	),
}))

vi.mock('@sursaut/ui/dockview', () => ({
	Dockview: (props: { api?: any; onReady?: (api: typeof dockviewApi) => void }) => {
		if (props.api && typeof props.api.set === 'function') {
			props.api.set(dockviewApi)
		}
		props.onReady?.(dockviewApi)
		return <div data-testid="dockview" />
	},
}))

let App: typeof import('./App').default

describe('App shell', () => {
	let container: HTMLElement
	let stop: (() => void) | undefined

	beforeAll(async () => {
		registerGlyfIconFactory()
		;({ default: App } = await import('./App'))
	})

	beforeEach(() => {
		container = document.createElement('div')
		document.body.appendChild(container)
		addPanel.mockClear()
		getPanel.mockClear()
		removePanel.mockClear()
		getPanel.mockImplementation(() => undefined)
		delete palettes.editing
		globals.configuration.timeControl = 0
		globals.interactionMode.selectedAction = ''
		globals.uiConfiguration.darkMode = false
		globals.getDockviewLayout.mockReturnValue(undefined)
		gameInstance.clock.virtualTime = 125
	})

	afterEach(() => {
		stop?.()
		stop = undefined
		delete palettes.editing
		container.remove()
		document.body.innerHTML = ''
	})

	it('opens the default game panel when no layout is saved', () => {
		stop = latch(container, <App />)

		expect(addPanel).toHaveBeenCalledWith({
			id: 'game-view',
			component: 'game',
			params: undefined,
			floating: undefined,
		})
		expect(container.textContent).toContain('02:05')
	})
})

describe('Palette IDE shell', () => {
	let container: HTMLElement
	let stop: (() => void) | undefined

	beforeEach(() => {
		container = document.createElement('div')
		document.body.appendChild(container)
		addPanel.mockClear()
		getPanel.mockClear()
		removePanel.mockClear()
		getPanel.mockImplementation(() => undefined)
		delete palettes.editing
		globals.configuration.timeControl = 0
		globals.interactionMode.selectedAction = ''
		globals.uiConfiguration.darkMode = false
		globals.getDockviewLayout.mockReturnValue(undefined)
		gameInstance.clock.virtualTime = 125
	})

	afterEach(() => {
		stop?.()
		stop = undefined
		delete palettes.editing
		container.remove()
		document.body.innerHTML = ''
	})

	it('opens dockview panels and syncs time, theme, and action via palette tools', () => {
		stop = latch(container, <App />)

		const { palette } = getBrowserPalette()
		const openConfiguration = palette.tool('openConfiguration') as PaletteToolRun
		const openGame = palette.tool('openGame') as PaletteToolRun
		const openTest = palette.tool('openTest') as PaletteToolRun
		const timeControl = palette.tool('timeControl') as PaletteToolValue<
			(typeof globals.configuration)['timeControl']
		>
		const theme = palette.tool('theme') as PaletteToolValue<'light' | 'dark'>
		const selectedAction = palette.tool('selectedAction') as PaletteToolValue<string>
		addPanel.mockClear()

		openConfiguration.run()
		expect(addPanel).toHaveBeenCalledWith({
			id: 'system.configuration',
			component: 'configuration',
			params: undefined,
			floating: { width: 400, height: 600 },
		})

		addPanel.mockClear()
		openGame.run()
		expect(addPanel).toHaveBeenCalledWith({
			id: 'game-view',
			component: 'game',
			params: undefined,
			floating: undefined,
		})

		addPanel.mockClear()
		openTest.run()
		expect(addPanel).toHaveBeenCalledWith({
			id: 'test',
			component: 'test',
			params: undefined,
			floating: { width: 400, height: 600 },
		})

		timeControl.value = 1
		expect(globals.configuration.timeControl).toBe(1)

		theme.value = 'dark'
		expect(globals.uiConfiguration.darkMode).toBe(true)

		selectedAction.value = 'zone:residential'
		expect(globals.interactionMode.selectedAction).toBe('zone:residential')

		selectedAction.value = 'build:house'
		expect(globals.interactionMode.selectedAction).toBe('build:house')
	})

	it('adds a floating palette inspector panel when palette edit mode is enabled', () => {
		stop = latch(container, <App />)
		addPanel.mockClear()
		const { palette } = getBrowserPalette()
		palettes.editing = palette
		expect(addPanel).toHaveBeenCalledWith(
			expect.objectContaining({
				id: PALETTE_INSPECTOR_DOCK_PANEL_ID,
				component: 'paletteInspector',
				title: 'Toolbar item',
				floating: { width: 400, height: 520 },
			})
		)
	})

	it('removes the palette inspector panel when palette edit mode ends', () => {
		stop = latch(container, <App />)
		const { palette } = getBrowserPalette()
		const fakePanel = { id: PALETTE_INSPECTOR_DOCK_PANEL_ID }
		palettes.editing = palette
		getPanel.mockReturnValue(fakePanel)
		removePanel.mockClear()
		delete palettes.editing
		expect(removePanel).toHaveBeenCalledWith(fakePanel)
	})

	it('initializes the browser palette from the json preset', () => {
		const { palette } = getBrowserPalette()
		expect(browserPaletteIdeConfig.top).toEqual(paletteDefaultJson.top)
		expect(palette.keys.bindings).toEqual(paletteDefaultJson.keyBindings)
	})
})
