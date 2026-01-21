import { DockviewApi } from 'dockview-core'
import { reactive, Eventful, untracked, effect, root } from 'mutts'
import { Game, type GameEvents, type InteractiveGameObject } from './game'
import { chopSaw as patches } from './game/exampleGames'

export interface Configuration {
	timeControl: 'pause' | 'play' | 'fast-forward' | 'gonzales'
}



function getDefaultConfiguration(): Configuration {
	return {
		timeControl: 'play',
	}
}

export const configuration = reactive<Configuration>(getDefaultConfiguration())
export const debugInfo = reactive<Record<string, unknown>>({})

// Rename key to avoid conflicts
// Helper for stored reactive state (simplified from pounce-ui)
function stored<T extends object>(key: string, initialValue: T): T {
	if (typeof window === 'undefined') return reactive(initialValue)
	
	let value = initialValue
	try {
		const item = localStorage.getItem(key)
		if (item) {
			value = JSON.parse(item)
		}
	} catch (e) {
		console.warn(`Failed to load stored key "${key}":`, e)
	}
	
	const state = reactive(value)
	
	// Persist on change
	effect(() => {
		const json = JSON.stringify(state)
		untracked(() => {
			try {
				localStorage.setItem(key, json)
			} catch (e) {
				// Ignore quota exceeded etc
			}
		})
	})
	
	return state
}

export const dockviewLayout = stored<{ sshLayout: any }>('dockviewLayout', { sshLayout: undefined })

// Validate and fix dockview layout data
// This function MUST NOT trigger reactive updates while validating,
// otherwise it causes infinite loops when called during component render.
function validateDockviewLayout(layout: any): any {
	//return untracked(() => {
		if (!layout || typeof layout !== 'object') {
			return undefined
		}

		try {
			// Deep clone to avoid mutating the input if it's immutable/stored state
			const cleanLayout = JSON.parse(JSON.stringify(layout))
			
			// Check basic structure - the stored object is a DockviewSnapshot, so grid is inside .layout
			if (!cleanLayout.layout || !cleanLayout.layout.grid || !cleanLayout.layout.grid.root) {
				console.warn('Dockview layout missing grid/root, clearing.')
				dockviewLayout.sshLayout = undefined
				return undefined
			}
			
			// Guard against truly empty layouts that cause dockview-core to crash
			const root = cleanLayout.layout.grid.root
			const hasChildren = Array.isArray(root.children) && root.children.length > 0
			const hasData = root.data && typeof root.data === 'object' && Object.keys(root.data).length > 0
			const hasFloating = cleanLayout.layout.floatingGroups && Object.values(cleanLayout.layout.floatingGroups).some(fg => fg !== null)
			const hasPanels = cleanLayout.panels && Object.keys(cleanLayout.panels).length > 0
			

			// dockview-core fromJSON throws "root must be of type branch" if we give it a branch with no children
			// dockview-core fromJSON throws "root must be of type branch" if we give it a branch with no children
			// dockview-core fromJSON throws "root must be of type branch" if we give it a branch with no children
			// BUT: if we have floating panels, we might have an empty grid root.
			// dockview-core fromJSON throws "root must be of type branch" if we give it a branch with no children
			// If we have orphaned panels (validation failure), try to REPAIR instead of clearing to avoid loop.
			// If we have orphaned panels or corrupted root (not a branch), RESET to a valid default layout.
			if (root.type !== 'branch' || (!hasChildren && !hasFloating)) {
				console.warn('Dockview layout has invalid branch root. Clearing layout.')
				dockviewLayout.sshLayout = undefined
				return undefined
			}
			
			if (root.type === 'branch' && !hasChildren && !hasData && !hasFloating && !hasPanels) {
				console.warn('Dockview layout is completely empty, clearing.')
				dockviewLayout.sshLayout = undefined
				return undefined
			}
			
			return cleanLayout
		} catch (e) {
			console.warn('Error validating dockview layout:', e)
			dockviewLayout.sshLayout = undefined
			return undefined
		}
	//})
}

// Safe getter for dockview layout with validation
export function getDockviewLayout(): any {
	// Use untracked to read the layout without creating reactive dependency
	// The validation may modify dockviewLayout.sshLayout, which would cause a loop
	const layout = untracked(() => dockviewLayout.sshLayout)
	return validateDockviewLayout(layout)
}

type GamedEvents = {
	[key in keyof GameEvents]: (game: Game, ...args: Parameters<GameEvents[key]>) => void
}
// TODO: find a way to make the whole file root() ?
class Games extends Eventful<GamedEvents> {
	private games = new Map<string, Game>()

	game(name: string) {
		const existing = this.games.get(name)
		if (existing) return existing

		const instance = root(()=> new Game(
			{
				boardSize: 12,
				terrainSeed: 23,
				characterCount: 3,
				characterRadius: 5,
			},
			patches,
		))
		this.games.set(name, instance)
		return instance
	}
}

export const games = new Games()

export * from './interactive-state'

interface SelectionState {
	panelId?: string
	selectedUid?: string
}

function loadSelectionState(): SelectionState {
	if (typeof window === 'undefined') return {}

	const stored = localStorage.getItem('selectionState')
	if (!stored) return {}

	try {
		return JSON.parse(stored) as SelectionState
	} catch {
		return {}
	}
}

const selectionStateInternal = reactive<SelectionState>(loadSelectionState())

function persistSelectionState() {
	if (typeof window === 'undefined') return
	try {
		const data = untracked(() => JSON.stringify(selectionStateInternal))
		localStorage.setItem('selectionState', data)
	} catch {
		// Ignore persistence failures (e.g. quota issues)
	}
}

export const selectionState = {
	get panelId() {
		return selectionStateInternal.panelId
	},
	set panelId(value: string | undefined) {
		selectionStateInternal.panelId = value
		persistSelectionState()
	},
	get selectedUid() {
		return selectionStateInternal.selectedUid
	},
	set selectedUid(value: string | undefined) {
		selectionStateInternal.selectedUid = value
		persistSelectionState()
	},
}

const objectInfoPanels = reactive(new Map<string, string>())

export function registerObjectInfoPanel(uid: string, panelId: string) {
	objectInfoPanels.set(uid, panelId)
}

export function unregisterObjectInfoPanel(uid: string) {
	objectInfoPanels.delete(uid)
}

export function getObjectInfoPanelId(uid: string): string | undefined {
	return objectInfoPanels.get(uid)
}

export function validateStoredSelectionState(api?: DockviewApi) {
	if (!selectionState.panelId || !api) return
	const panel = api.getPanel(selectionState.panelId)
	if (!panel) {
		selectionState.panelId = undefined
	}
}
