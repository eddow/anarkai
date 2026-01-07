import { Eventful, reactive } from 'mutts'
import { Game, type GameEvents, type InteractiveGameObject } from './game'
import { chopSaw as patches } from './game/exampleGames'

const storedConfig = localStorage.getItem('configuration')
interface Configuration {
	darkMode: boolean
	timeControl: 'pause' | 'play' | 'fast-forward' | 'gonzales'
}
export const configuration = $state(
	storedConfig
		? JSON.parse(storedConfig)
		: {
				darkMode: window.matchMedia('(prefers-color-scheme: dark)').matches,
				timeControl: 'play',
			},
) as Configuration
export const debugInfo = $state({} as Record<string, any>)

type GamedEvents = {
	[key in keyof GameEvents]: (game: Game, ...args: Parameters<GameEvents[key]>) => void
}

class Games extends Eventful<GamedEvents> {
	private games = new Map<string, Game>()

	game(name: string) {
		const game = this.games.get(name)
		if (!game) {
			const game = new Game(
				{
					boardSize: 12,
					terrainSeed: 23,
					characterCount: 3,
					characterRadius: 5,
				},
				patches,
			)
			// Load game here
			this.games.set(name, game)
			return game
		}
		return game
	}
}
export const games = new Games()

/**
 * Mutts Reactive Globals
 */
export const mrg = reactive({
	hoveredObject: undefined as InteractiveGameObject | undefined,
})

export const interactionMode = $state({
	selectedAction: '' as string,
})

/**
 * Selection state stored in localStorage
 * Contains both panel ID and selected object UID
 */
interface SelectionState {
	panelId?: string
	selectedUid?: string
}

// Load from localStorage on alveolus initialization
let storedState: SelectionState = {}
try {
	const stored = localStorage.getItem('selectionState')
	if (stored) storedState = JSON.parse(stored)
} catch {
	// Invalid JSON, use empty state
}

// Internal state
const _state = $state<SelectionState>(storedState)

// Save to localStorage (no reactive effects, just manual calls)
function save() {
	localStorage.setItem('selectionState', JSON.stringify(_state))
}

// Exported selection state object with get/set properties
export const selectionState = {
	get panelId() {
		return _state.panelId
	},
	set panelId(value: string | undefined) {
		_state.panelId = value
		save()
	},
	get selectedUid() {
		return _state.selectedUid
	},
	set selectedUid(value: string | undefined) {
		_state.selectedUid = value
		save()
	},
}

/**
 * Centralized dictionary to track object-info panels by UID
 * Maps UID to panel ID for efficient lookup
 */
const objectInfoPanels = $state(new Map<string, string>())

/**
 * Register an object-info panel
 */
export function registerObjectInfoPanel(uid: string, panelId: string) {
	objectInfoPanels.set(uid, panelId)
}

/**
 * Unregister an object-info panel
 */
export function unregisterObjectInfoPanel(uid: string) {
	objectInfoPanels.delete(uid)
}

/**
 * Get panel ID for an object-info panel by UID
 */
export function getObjectInfoPanelId(uid: string): string | undefined {
	return objectInfoPanels.get(uid)
}

/**
 * Validate and clean up stored selection state if panel no longer exists
 * Should be called when dockview API is available
 */
export function validateStoredSelectionState(api: any) {
	if (selectionState.panelId && api) {
		const panel = api.getPanel(selectionState.panelId)
		if (!panel) {
			// Panel no longer exists, clear the stored state
			selectionState.panelId = undefined
		}
	}
}
