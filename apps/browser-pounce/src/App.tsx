import './app.css'
import { initConsoleTrap } from 'ssh/debug'
initConsoleTrap()
import { effect, reactive, untracked } from 'mutts'
import {
	Button,
	ButtonGroup,
	DisplayProvider,
	ThemeToggle,
	type ThemeValue,
	Dockview,
	RadioButton,
	Toolbar,
} from '@pounce'
import {
	tablerFilledAdjustments,
	tablerFilledArrowBigRight,
	tablerFilledFlask,
	tablerFilledPlayerPause,
	tablerFilledPlayerPlay,
	tablerFilledPlayerSkipForward,
	tablerFilledPlayerTrackNext,
	tablerFilledPointer,
	tablerFilledSquareRoundedMinus,
	tablerFilledZoomMoney,
	tablerOutlineTrees,
} from 'pure-glyf/icons'

import * as gameContent from 'ssh/assets/game-content'
import { alveoli as visualAlveoli } from 'engine-pixi/assets/visual-content'
import { configuration, games, interactionMode, selectionState, getDockviewLayout, dockviewLayout, uiConfiguration } from '@app/lib/globals'
import ResourceImage from './components/ResourceImage'
import widgetsImport from './widgets'

// Create local copy to avoid import reassignment issues
const widgets = { ...widgetsImport }

// Expose globals for Playwright testing
if (typeof window !== 'undefined') {
	(window as any).games = games;
	(window as any).selectionState = selectionState;
}

const timeControls = [
	{ value: 'pause', label: 'Pause', icon: tablerFilledPlayerPause },
	{ value: 'play', label: 'Play', icon: tablerFilledPlayerPlay },
	{ value: 'fast-forward', label: 'Fast Forward', icon: tablerFilledPlayerSkipForward },
	{ value: 'gonzales', label: 'Gonzales', icon: tablerFilledPlayerTrackNext },
] as const

const zoneActions = [
	{ value: 'zone:residential', label: 'Residential', icon: tablerFilledZoomMoney },
	{ value: 'zone:harvest', label: 'Harvest', icon: tablerOutlineTrees },
	{ value: 'zone:none', label: 'Unzone', icon: tablerFilledSquareRoundedMinus },
] as const

const buildableAlveoli = Object.entries(gameContent.alveoli).filter(
	([, alveolus]) => 'construction' in alveolus,
)

const dockviewEl = {
	class: 'dockview-container',
}

const dockviewOptions = reactive({})

const themeSettings: { theme: ThemeValue } = {
	get theme() {
		return uiConfiguration.darkMode ? 'dark' : 'light'
	},
	set theme(value: ThemeValue) {
		uiConfiguration.darkMode = value === 'dark'
	},
}

const Clock = ({ game }: { game: any }) => {
	const state = reactive({ time: '--:--' })
	effect(() => {
		const seconds = Math.floor(game.clock.virtualTime)
		const minutes = Math.floor(seconds / 60)
		const displaySeconds = seconds % 60
		state.time = `${minutes.toString().padStart(2, '0')}:${displaySeconds.toString().padStart(2, '0')}`
	})
	return <span>{state.time}</span>
}

const ToolbarIcon = ({ icon, label }: { icon: string; label: string }) => (
	<span class={`app-toolbar-icon ${icon}`} aria-hidden="true" title={label} />
)

const App = () => {
	// trackEffect((obj, evolution, prop) => {
	// });
	const state = reactive({
		api: undefined as any,
		theme: undefined as 'light' | 'dark' | undefined,
	})

	const gameInstance = games.game('GameX')

	effect(() => {
		if (typeof window === 'undefined') return
		const preventBackNavigation = (event: MouseEvent) => {
			if (event.button === 3 || event.button === 4) {
				event.preventDefault()
			}
		}
		window.addEventListener('mouseup', preventBackNavigation)
		window.addEventListener('mousedown', preventBackNavigation)
		return () => {
			window.removeEventListener('mouseup', preventBackNavigation)
			window.removeEventListener('mousedown', preventBackNavigation)
		}
	})

	const ensurePanel = (component: keyof typeof widgets, id: string, params?: Record<string, any>, options?: { floating?: boolean }) => {
		if (!state.api) return
		const existing = state.api.getPanel?.(id)
		if (existing) {
			if (params) existing.api?.updateParameters?.(params)
			existing.focus?.()
			return existing
		}
		return state.api.addPanel?.({
			id,
			component,
			params,
			floating: options?.floating === false ? undefined : {
				width: 400,
				height: 600,
			},
		})
	}

	const openGamePanel = () =>
		ensurePanel('game', 'game-view', {
			game: 'GameX',
		}, { floating: false })

	const openConfigurationPanel = () => ensurePanel('configuration', 'system.configuration')

	const openTestPanel = () => ensurePanel('test', 'test')

	const handleDockviewReady = (api: unknown) => {
		state.api = api
	}



	effect(() => {
		if (state.api && !getDockviewLayout()) {
			// If no layout is saved, open a game by default
			untracked(openGamePanel)
		}
	})

	return (
		<DisplayProvider theme={themeSettings.theme}>
			<div class="app-shell">
				<Toolbar el={{ class: 'app-toolbar' }}>
					<ButtonGroup>
						<Button aria-label="Open configuration" onClick={openConfigurationPanel}>
							<ToolbarIcon icon={tablerFilledAdjustments} label="Open configuration" />
						</Button>
						<Button aria-label="Open game view" onClick={openGamePanel}>
							<ToolbarIcon icon={tablerFilledArrowBigRight} label="Open game view" />
						</Button>
						<Button aria-label="Open multiselect test" onClick={openTestPanel}>
							<ToolbarIcon icon={tablerFilledFlask} label="Open multiselect test" />
						</Button>
					</ButtonGroup>
					<Toolbar.Spacer if={timeControls.length > 0} />
					<div class="app-toolbar-clock">
						<Clock game={gameInstance} />
					</div>
					<ButtonGroup>
						<for each={timeControls}>
							{(option: (typeof timeControls)[number]) => (
								<RadioButton
									value={option.value}
									group={configuration.timeControl}
									aria-label={option.label}
								>
									<ToolbarIcon icon={option.icon} label={option.label} />
								</RadioButton>
							)}
						</for>
					</ButtonGroup>
					<Toolbar.Spacer if={timeControls.length > 0} />
					<ButtonGroup>
						<RadioButton
							value=""
							group={interactionMode.selectedAction}
							aria-label="Select"
						>
							<ToolbarIcon icon={tablerFilledPointer} label="Select" />
						</RadioButton>
					</ButtonGroup>
					<Toolbar.Spacer if={timeControls.length > 0} />
					<ButtonGroup>
						<for each={buildableAlveoli}>
							{([name]: (typeof buildableAlveoli)[number]) => (
								<RadioButton
									value={`build:${name}`}
									group={interactionMode.selectedAction}
									aria-label={`Build ${name}`}
								>
									<ResourceImage
										game={gameInstance}
										sprite={visualAlveoli[name]?.sprites?.[0]}
										width={24}
										height={24}
										alt={name}
									/>
								</RadioButton>
							)}
						</for>
					</ButtonGroup>
					<Toolbar.Spacer if={timeControls.length > 0} />
					<ButtonGroup>
						<for each={zoneActions}>
							{(zone: (typeof zoneActions)[number]) => (
								<RadioButton
									value={zone.value}
									group={interactionMode.selectedAction}
									aria-label={zone.label}
								>
									<ToolbarIcon icon={zone.icon} label={zone.label} />
								</RadioButton>
							)}
						</for>
					</ButtonGroup>
					<Toolbar.Spacer />
					<ThemeToggle settings={themeSettings} simple />
				</Toolbar>

				<main class="app-main">
					<Dockview
						el={dockviewEl}
						api={state.api}
						onReady={handleDockviewReady}
						widgets={widgets}
						layout={dockviewLayout.sshLayout}
						options={dockviewOptions}
					/>
				</main>
			</div>
		</DisplayProvider>
	)
}

export default App
