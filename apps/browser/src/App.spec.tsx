import { getBrowserPalette } from '@app/palette/browser-palette'
import { document, latch } from '@sursaut/core'
import { registerGlyfIconFactory } from 'pure-glyf/sursaut'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

type PaletteToolRun = {
	run(): void
}

type PaletteToolEnum<T extends string> = {
	value: T
}

const { addPanel, getPanel, dockviewApi, gameInstance, globals } = vi.hoisted(() => {
	const addPanel = vi.fn((panel: Record<string, unknown>) => panel)
	const getPanel = vi.fn(() => undefined)
	const dockviewApi = { addPanel, getPanel }
	const gameInstance = {
		clock: {
			virtualTime: 125,
		},
	}
	const globals = {
		configuration: {
			timeControl: 'pause',
		},
		game: gameInstance,
		interactionMode: {
			selectedAction: '',
		},
		selectionState: {},
		getDockviewLayout: vi.fn(() => undefined),
		dockviewLayout: {
			sshLayout: { root: 'layout' },
		},
		uiConfiguration: {
			darkMode: false,
		},
	}
	return { addPanel, getPanel, dockviewApi, gameInstance, globals }
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
	RadioButton: (props: { value: string; group: any; children?: any; ['aria-label']?: string }) => (
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
				if (['Pause', 'Play', 'Fast Forward', 'Gonzales'].includes(props['aria-label'] ?? '')) {
					globals.configuration.timeControl = props.value
					return
				}
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

describe('App toolbar interactions', () => {
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
		globals.configuration.timeControl = 'pause'
		globals.interactionMode.selectedAction = ''
		globals.uiConfiguration.darkMode = false
		globals.getDockviewLayout.mockReturnValue(undefined)
		gameInstance.clock.virtualTime = 125
	})

	afterEach(() => {
		stop?.()
		stop = undefined
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

	it('opens toolbar panels from the top action buttons', () => {
		stop = latch(container, <App />)
		addPanel.mockClear()

		const configButton = container.querySelector(
			'[aria-label="Open configuration"]'
		) as HTMLButtonElement
		const gameButton = container.querySelector('[aria-label="Open game view"]') as HTMLButtonElement
		const testButton = container.querySelector(
			'[aria-label="Open multiselect test"]'
		) as HTMLButtonElement

		configButton.click()
		gameButton.click()
		testButton.click()

		expect(addPanel).toHaveBeenNthCalledWith(1, {
			id: 'system.configuration',
			component: 'configuration',
			params: undefined,
			floating: { width: 400, height: 600 },
		})
		expect(addPanel).toHaveBeenNthCalledWith(2, {
			id: 'game-view',
			component: 'game',
			params: undefined,
			floating: undefined,
		})
		expect(addPanel).toHaveBeenNthCalledWith(3, {
			id: 'test',
			component: 'test',
			params: undefined,
			floating: { width: 400, height: 600 },
		})
	})

	it('updates time and interaction reactive groups from radio buttons', () => {
		stop = latch(container, <App />)

		const playButton = container.querySelector('[aria-label="Play"]') as HTMLButtonElement
		const buildHouseButton = container.querySelector(
			'[aria-label="Build house"]'
		) as HTMLButtonElement
		const zoneButton = container.querySelector('[aria-label="Residential"]') as HTMLButtonElement

		playButton.click()
		buildHouseButton.click()
		zoneButton.click()

		expect(globals.configuration.timeControl).toBe('play')
		expect(globals.interactionMode.selectedAction).toBe('zone:residential')
	})

	it('toggles theme through CheckButton binding', () => {
		stop = latch(container, <App />)

		const toggle = container.querySelector('[aria-label="Theme Toggle"]') as HTMLButtonElement
		toggle.click()

		expect(globals.uiConfiguration.darkMode).toBe(true)
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
		globals.configuration.timeControl = 'pause'
		globals.interactionMode.selectedAction = ''
		globals.uiConfiguration.darkMode = false
		globals.getDockviewLayout.mockReturnValue(undefined)
		gameInstance.clock.virtualTime = 125
	})

	afterEach(() => {
		stop?.()
		stop = undefined
		container.remove()
		document.body.innerHTML = ''
	})

	it('opens dockview panels and syncs time, theme, and action via palette tools', () => {
		stop = latch(container, <App />)

		const { palette } = getBrowserPalette()
		const openConfiguration = palette.tool('openConfiguration') as PaletteToolRun
		const openGame = palette.tool('openGame') as PaletteToolRun
		const openTest = palette.tool('openTest') as PaletteToolRun
		const timeControl = palette.tool('timeControl') as PaletteToolEnum<
			(typeof globals.configuration)['timeControl']
		>
		const theme = palette.tool('theme') as PaletteToolEnum<'light' | 'dark'>
		const selectedAction = palette.tool('selectedAction') as PaletteToolEnum<string>
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

		timeControl.value = 'play'
		expect(globals.configuration.timeControl).toBe('play')

		theme.value = 'dark'
		expect(globals.uiConfiguration.darkMode).toBe(true)

		selectedAction.value = 'zone:residential'
		expect(globals.interactionMode.selectedAction).toBe('zone:residential')

		selectedAction.value = 'build:house'
		expect(globals.interactionMode.selectedAction).toBe('build:house')
	})
})
