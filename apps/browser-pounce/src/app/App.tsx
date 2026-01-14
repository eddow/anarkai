import '../app.css'
import { initConsoleTrap } from '@ssh/lib/debug'
initConsoleTrap()
import { effect, reactive, trackEffect, untracked } from 'mutts'
import { Button, ButtonGroup, DarkModeButton, Dockview, RadioButton, Toolbar } from 'pounce-ui/src'

import * as gameContent from '$assets/game-content'
import { alveoli as visualAlveoli } from 'engine-pixi/assets/visual-content.js'
import { configuration, games, interactionMode, getDockviewLayout, dockviewLayout, uiConfiguration } from '@app/lib/globals'
import ResourceImage from './components/ResourceImage'
import widgetsImport from './widgets'
import { h } from '@pounce/lib'

// Create local copy to avoid import reassignment issues
const widgets = { ...widgetsImport }

const timeControls = [
	{ value: 'pause', label: 'Pause', icon: 'mdi:pause' },
	{ value: 'play', label: 'Play', icon: 'mdi:play' },
	{ value: 'fast-forward', label: 'Fast Forward', icon: 'mdi:fast-forward' },
	{ value: 'gonzales', label: 'Gonzales', icon: 'mdi:fast-forward-outline' },
] as const

const zoneActions = [
	{ value: 'zone:residential', label: 'Residential', icon: 'mdi:home-group' },
	{ value: 'zone:harvest', label: 'Harvest', icon: 'mdi:tree' },
	{ value: 'zone:none', label: 'Unzone', icon: 'mdi:eraser' },
] as const

const buildableAlveoli = Object.entries(gameContent.alveoli).filter(
	([, alveolus]) => 'construction' in alveolus,
)

const App = (_props: {}) => {
	trackEffect((obj, evolution, prop) => {
	});
	const state = reactive({
		api: undefined as any,
		theme: undefined as 'light' | 'dark' | undefined,
	})

	const game = untracked(() => games.game('GameX'))

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

	const openSelectionPanel = () => ensurePanel('selection-info', 'selection-info')

	effect(() => {
		const shouldOpen = interactionMode.selectedAction === ''
		if (shouldOpen) {
			untracked(openSelectionPanel)
		}
	})

	effect(() => {
		if (state.api && !getDockviewLayout()) {
			// If no layout is saved, open a game by default
			untracked(openGamePanel)
		}
	})

	return (
		<div class="app-shell">
			<Toolbar>
				<ButtonGroup>
					<Button icon="mdi:settings" aria-label="Open configuration" onClick={openConfigurationPanel} />
					<Button icon="mdi:plus" aria-label="Open game view" onClick={openGamePanel} />
					<Button icon="mdi:information-outline" aria-label="Focus selection info" onClick={openSelectionPanel} />
				</ButtonGroup>
				<Toolbar.Spacer visible />
				<ButtonGroup>
					{timeControls.map((option) => (
						<RadioButton
							icon={option.icon}
							value={option.value}
							group={configuration.timeControl}
							aria-label={option.label}
						/>
					))}
				</ButtonGroup>
				<Toolbar.Spacer visible />
				<ButtonGroup>
					<RadioButton
						icon="mdi:cursor-default-outline"
						value=""
						group={interactionMode.selectedAction}
						aria-label="Select"
					/>
				</ButtonGroup>
				<Toolbar.Spacer visible />
				<ButtonGroup>
					{buildableAlveoli.map(([name]) => {
						const action = `build:${name}`
						return (
							<RadioButton
								value={action}
								group={interactionMode.selectedAction}
								aria-label={`Build ${name}`}
							>
								<ResourceImage
									game={game}
									sprite={visualAlveoli[name]?.sprites?.[0]}
									width={24}
									height={24}
									alt={name}
								/>
							</RadioButton>
						)
					})}
				</ButtonGroup>
				<Toolbar.Spacer visible />
				<ButtonGroup>
					{zoneActions.map((zone) => (
						<RadioButton
							icon={zone.icon}
							value={zone.value}
							group={interactionMode.selectedAction}
							aria-label={zone.label}
						/>
					))}
				</ButtonGroup>
				<Toolbar.Spacer />
				<DarkModeButton
					theme={uiConfiguration.darkMode ? 'dark' : 'light'}
					update:theme={(theme) => {
						uiConfiguration.darkMode = theme === 'dark'
					}}
				/>
			</Toolbar>

			<main class="app-main">
				<Dockview
					el:class="dockview-container"
					api={state.api}
					widgets={widgets}
					layout={untracked(getDockviewLayout)}
					update:layout={(layout: any) => {
						dockviewLayout.sshLayout = layout
					}}
					theme={uiConfiguration.darkMode ? 'dracula' : 'light'}
				/>
			</main>
		</div>
	)
}

export default App
