import './app.css'
import {
	browserPaletteIdeConfig,
	disposeBrowserPalette,
	getBrowserPalette,
	palettePanelBridge,
} from '@app/palette/browser-palette'
import { Button, ButtonGroup, CheckButton, RadioButton, Toolbar } from '@app/ui/anarkai'
import { initConsoleTrap } from 'ssh/debug'

initConsoleTrap()

import {
	appShellTimeControls,
	appShellZoneActions,
	getAppShellBuildableAlveoli,
} from '@app/lib/app-shell-controls'
import {
	configuration,
	dockviewLayout,
	game,
	getDockviewLayout,
	interactionMode,
	selectionState,
	uiConfiguration,
} from '@app/lib/globals'
import { DisplayProvider } from '@sursaut/kit'
import { Dockview } from '@sursaut/ui/dockview'
import { alveoli as visualAlveoli } from 'engine-pixi/assets/visual-content'
import { effect, reactive, untracked } from 'mutts'
import {
	tablerFilledAdjustments,
	tablerFilledArrowBigRight,
	tablerFilledFlask,
	tablerFilledPointer,
} from 'pure-glyf/icons'
import ResourceImage from './components/ResourceImage'
import widgetsImport from './widgets'
import SelectionInfoTab from './widgets/selection-info-tab'

// Create local copy to avoid import reassignment issues
const widgets = { ...widgetsImport }
const tabs = {
	'selection-info-tab': SelectionInfoTab,
}

// Expose globals for Playwright testing
if (typeof window !== 'undefined') {
	;(window as any).game = game
	;(window as any).selectionState = selectionState
}

const timeControls = appShellTimeControls
const zoneActions = appShellZoneActions
const buildableAlveoli = getAppShellBuildableAlveoli()

const dockviewEl = {
	class: 'dockview-container',
}

const dockviewOptions = reactive({})

const themeSettings: { theme: 'light' | 'dark' } = {
	get theme() {
		return uiConfiguration.darkMode ? 'dark' : 'light'
	},
	set theme(value: 'light' | 'dark') {
		uiConfiguration.darkMode = value === 'dark'
	},
}

const Clock = ({ game }: { game: { clock: { virtualTime: number } } }) => {
	const state = reactive({ time: '--:--' })
	effect`app:clock`(() => {
		const seconds = Math.floor(game.clock.virtualTime)
		const minutes = Math.floor(seconds / 60)
		const displaySeconds = seconds % 60
		state.time = `${minutes.toString().padStart(2, '0')}:${displaySeconds.toString().padStart(2, '0')}`
	})
	return <span>{state.time}</span>
}

const App = () => {
	// trackEffect((obj, evolution, prop) => {
	// });
	const state = reactive({
		api: undefined as any,
		theme: undefined as 'light' | 'dark' | undefined,
	})

	const gameInstance = game

	effect`app:prevent-back-nav`(() => {
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

	const ensurePanel = (
		component: keyof typeof widgets,
		id: string,
		params?: Record<string, any>,
		options?: { floating?: boolean }
	) => {
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
			floating:
				options?.floating === false
					? undefined
					: {
							width: 400,
							height: 600,
						},
		})
	}

	const openGamePanel = () => ensurePanel('game', 'game-view', undefined, { floating: false })

	const openConfigurationPanel = () => ensurePanel('configuration', 'system.configuration')

	const openTestPanel = () => ensurePanel('test', 'test')

	const handleDockviewReady = (api: unknown) => {
		state.api = api
	}

	effect`app:dockview-layout`(() => {
		if (state.api && !getDockviewLayout()) {
			// If no layout is saved, open a game by default
			untracked(openGamePanel)
		}
	})

	const { PaletteIde } = getBrowserPalette()

	effect`app:palette-bridge`(() => {
		palettePanelBridge.openConfiguration = openConfigurationPanel
		palettePanelBridge.openGame = openGamePanel
		palettePanelBridge.openTest = openTestPanel
	})

	effect`app:palette-dispose`(() => {
		return () => {
			disposeBrowserPalette()
		}
	})

	return (
		<DisplayProvider theme={themeSettings.theme}>
			<div class="app-shell">
				<Toolbar el={{ class: 'ak-app-toolbar' }}>
					<ButtonGroup>
						<Button
							ariaLabel="Open configuration"
							el:title="Open configuration"
							onClick={openConfigurationPanel}
							icon={tablerFilledAdjustments}
						/>
						<Button
							ariaLabel="Open game view"
							el:title="Open game view"
							onClick={openGamePanel}
							icon={tablerFilledArrowBigRight}
						/>
						<Button
							ariaLabel="Open multiselect test"
							el:title="Open multiselect test"
							onClick={openTestPanel}
							icon={tablerFilledFlask}
						/>
					</ButtonGroup>
					<Toolbar.Spacer if={timeControls.length > 0} />
					<div class="ak-app-toolbar__clock">
						<Clock game={gameInstance} />
					</div>
					<ButtonGroup>
						<for each={timeControls}>
							{(option: (typeof appShellTimeControls)[number]) => (
								<RadioButton
									value={option.value}
									group={configuration.timeControl}
									ariaLabel={option.label}
									el:title={option.label}
									icon={option.icon}
								/>
							)}
						</for>
					</ButtonGroup>
					<Toolbar.Spacer if={timeControls.length > 0} />
					<ButtonGroup>
						<RadioButton
							value=""
							group={interactionMode.selectedAction}
							ariaLabel="Select"
							el:title="Select"
							icon={tablerFilledPointer}
						/>
					</ButtonGroup>
					<Toolbar.Spacer if={timeControls.length > 0} />
					<ButtonGroup>
						<for each={buildableAlveoli}>
							{([name]: (typeof buildableAlveoli)[number]) => (
								<RadioButton
									value={`build:${name}`}
									group={interactionMode.selectedAction}
									ariaLabel={`Build ${name}`}
									el:title={`Build ${name}`}
									icon={
										visualAlveoli[name]?.sprites?.[0] && (
											<ResourceImage
												game={gameInstance}
												sprite={visualAlveoli[name]?.sprites?.[0]}
												width={24}
												height={24}
												alt={name}
											/>
										)
									}
								/>
							)}
						</for>
					</ButtonGroup>
					<Toolbar.Spacer if={timeControls.length > 0} />
					<ButtonGroup>
						<for each={zoneActions}>
							{(zone: (typeof appShellZoneActions)[number]) => (
								<RadioButton
									value={zone.value}
									group={interactionMode.selectedAction}
									ariaLabel={zone.label}
									el:title={zone.label}
									icon={zone.icon}
								/>
							)}
						</for>
					</ButtonGroup>
					<Toolbar.Spacer />
					<CheckButton
						checked={uiConfiguration.darkMode}
						ariaLabel="Theme Toggle"
						el:title="Toggle theme"
						icon={<span aria-hidden="true">{uiConfiguration.darkMode ? '☾' : '☀'}</span>}
					/>
				</Toolbar>

				<div class="app-palette-wrap">
					<env clockGame={gameInstance}>
						<PaletteIde
							config={browserPaletteIdeConfig}
							el={{ class: 'app-palette-ide' }}
							center={{ class: 'app-palette-center' }}
							toolbar={{ class: 'secondary' }}
						>
							<main class="app-main">
								<Dockview
									el={dockviewEl}
									api={state.api}
									onReady={handleDockviewReady}
									widgets={widgets}
									tabs={tabs}
									layout={dockviewLayout.sshLayout}
									options={dockviewOptions}
								/>
							</main>
						</PaletteIde>
					</env>
				</div>
			</div>
		</DisplayProvider>
	)
}

export default App
