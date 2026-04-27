import './app.css'
import {
	browserPaletteIdeConfig,
	disposeBrowserPalette,
	getBrowserPalette,
	palettePanelBridge,
} from '@app/palette/browser-palette'
import { PALETTE_INSPECTOR_DOCK_PANEL_ID } from '@app/palette/palette-inspector'
import { initConsoleTrap } from '../../../engines/ssh/src/lib/dev/debug.ts'

initConsoleTrap()

import {
	configuration,
	dockviewLayout,
	game,
	getDockviewLayout,
	selectionState,
	uiConfiguration,
} from '@app/lib/globals'
import { DisplayProvider } from '@sursaut/kit'
import { Dockview } from '@sursaut/ui/dockview'
import type { DockviewApi } from 'dockview-core'
import { effect, reactive, untracked } from 'mutts'
import {
	type BuildGameDebugDumpOptions,
	buildGameDebugDump,
	stringifyDebugValue,
} from '../../../engines/ssh/src/lib/dev/debug-game-state.ts'
import widgetsImport from './widgets'
import SelectionInfoTab from './widgets/selection-info-tab'

// Create local copy to avoid import reassignment issues
const widgets = { ...widgetsImport }
const tabs = {
	'selection-info-tab': SelectionInfoTab,
}

// Expose globals for Playwright testing
if (typeof window !== 'undefined') {
	type BrowserDebugWindow = Window &
		typeof globalThis & {
			configuration?: typeof configuration
			game?: typeof game
			selectionState?: typeof selectionState
			dumpSshDebugState?: (
				options?: BuildGameDebugDumpOptions
			) => ReturnType<typeof buildGameDebugDump>
			dumpSshDebugStateJson?: (options?: BuildGameDebugDumpOptions) => string
		}
	const debugWindow = window as BrowserDebugWindow
	debugWindow.configuration = configuration
	debugWindow.game = game
	debugWindow.selectionState = selectionState
	debugWindow.dumpSshDebugState = (options = {}) =>
		buildGameDebugDump(game, {
			...options,
			selectedUid: options.selectedUid ?? selectionState.selectedUid,
		})
	debugWindow.dumpSshDebugStateJson = (options = {}) =>
		stringifyDebugValue(debugWindow.dumpSshDebugState?.(options) ?? {})
}

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
		if (typeof window !== 'undefined') {
			;(window as any).dockviewApi = api
		}
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

	effect`app:palette-inspector-dock`(() => {
		const api = state.api as DockviewApi | undefined
		if (!api?.getPanel || !api.addPanel || !api.removePanel) return
		const { palette } = getBrowserPalette()
		if (!palette.editing) {
			const panel = api.getPanel(PALETTE_INSPECTOR_DOCK_PANEL_ID)
			if (panel) api.removePanel(panel)
			return
		}
		if (api.getPanel(PALETTE_INSPECTOR_DOCK_PANEL_ID)) return
		api.addPanel({
			id: PALETTE_INSPECTOR_DOCK_PANEL_ID,
			component: 'paletteInspector',
			title: 'Toolbar item',
			floating: { width: 400, height: 520 },
		})
	})

	return (
		<DisplayProvider theme={themeSettings.theme}>
			<div class="app-shell">
				<div class="app-palette-wrap">
					<env clockGame={gameInstance}>
						<PaletteIde
							config={browserPaletteIdeConfig}
							el={{ class: 'app-palette-ide' }}
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
