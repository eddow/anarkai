import { document, latch } from '@pounce/core'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const addPanel = vi.fn((panel: Record<string, unknown>) => panel)
const getPanel = vi.fn(() => undefined)
const dockviewApi = {
	addPanel,
	getPanel,
}
const gameInstance = {
	clock: {
		virtualTime: 125,
	},
}
const globals = {
	configuration: {
		timeControl: 'pause',
	},
	games: {
		game: vi.fn(() => gameInstance),
	},
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
	tablerFilledAdjustments: 'tablerFilledAdjustments',
	tablerFilledArrowBigRight: 'tablerFilledArrowBigRight',
	tablerFilledFlask: 'tablerFilledFlask',
	tablerFilledPlayerPause: 'tablerFilledPlayerPause',
	tablerFilledPlayerPlay: 'tablerFilledPlayerPlay',
	tablerFilledPlayerSkipForward: 'tablerFilledPlayerSkipForward',
	tablerFilledPlayerTrackNext: 'tablerFilledPlayerTrackNext',
	tablerFilledPointer: 'tablerFilledPointer',
	tablerFilledSquareRoundedMinus: 'tablerFilledSquareRoundedMinus',
	tablerFilledZoomMoney: 'tablerFilledZoomMoney',
	tablerOutlineTrees: 'tablerOutlineTrees',
}))

vi.mock('./components/ResourceImage', () => ({
	default: (props: { alt?: string }) => <span data-testid="resource-image">{props.alt ?? ''}</span>,
}))

vi.mock('./widgets', () => ({
	default: {
		game: () => <div>game</div>,
		configuration: () => <div>configuration</div>,
		test: () => <div>test</div>,
	},
}))

vi.mock('@pounce', () => ({
	Button: (props: { onClick?: () => void; children?: any; ['aria-label']?: string }) => (
		<button onClick={props.onClick} aria-label={props['aria-label']}>{props.children}</button>
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
		{ Spacer: (props: { children?: any }) => <div class="toolbar-spacer">{props.children}</div> },
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
			params: { game: 'GameX' },
			floating: undefined,
		})
		expect(container.textContent).toContain('02:05')
	})

	it('opens toolbar panels from the top action buttons', () => {
		stop = latch(container, <App />)
		addPanel.mockClear()

		const configButton = container.querySelector('[aria-label="Open configuration"]') as HTMLButtonElement
		const gameButton = container.querySelector('[aria-label="Open game view"]') as HTMLButtonElement
		const testButton = container.querySelector('[aria-label="Open multiselect test"]') as HTMLButtonElement

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
			params: { game: 'GameX' },
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
		const buildHouseButton = container.querySelector('[aria-label="Build house"]') as HTMLButtonElement
		const zoneButton = container.querySelector('[aria-label="Residential"]') as HTMLButtonElement

		playButton.click()
		buildHouseButton.click()
		zoneButton.click()

		expect(globals.configuration.timeControl).toBe('play')
		expect(globals.interactionMode.selectedAction).toBe('zone:residential')
	})

	it('toggles theme through ThemeToggle binding', () => {
		stop = latch(container, <App />)

		const toggle = container.querySelector('[aria-label="Theme Toggle"]') as HTMLButtonElement
		toggle.click()

		expect(globals.uiConfiguration.darkMode).toBe(true)
	})
})
