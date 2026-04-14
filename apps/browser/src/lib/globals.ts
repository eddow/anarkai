import { stored } from '@sursaut/kit/dom'
import type { DockviewWidgetScope } from '@sursaut/ui/dockview'

export type { Configuration } from 'ssh/globals'
// Re-export all game-related globals from ssh engine
export { configuration, debugInfo, game, games, interactionMode, mrg } from 'ssh/globals'

export const unreactiveInfo = {
	hasLastSelectedInfoPanel: false,
}
export interface SelectionState {
	panelId?: string
	selectedUid?: string
	titleVersion: number
}

export const selectionState = stored<SelectionState>({
	panelId: undefined,
	selectedUid: undefined,
	titleVersion: 0,
})

export function bumpSelectionTitleVersion(): void {
	selectionState.titleVersion++
}

export const dockviewLayout = stored<{ sshLayout: any }>({
	sshLayout: undefined,
})

function validateDockviewLayout(layout: any): any {
	if (!layout || typeof layout !== 'object') {
		return undefined
	}

	try {
		const cleanLayout = JSON.parse(JSON.stringify(layout))

		if (!cleanLayout.layout || !cleanLayout.layout.grid || !cleanLayout.layout.grid.root) {
			console.warn('Dockview layout missing grid/root, clearing.')
			dockviewLayout.sshLayout = undefined
			return undefined
		}

		const root = cleanLayout.layout.grid.root
		const hasChildren = Array.isArray(root.children) && root.children.length > 0
		const hasData = root.data && typeof root.data === 'object' && Object.keys(root.data).length > 0
		const hasFloating =
			cleanLayout.layout.floatingGroups &&
			Object.values(cleanLayout.layout.floatingGroups).some((fg) => fg !== null)
		const hasPanels = cleanLayout.panels && Object.keys(cleanLayout.panels).length > 0

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
}

export function getDockviewLayout(): any {
	return validateDockviewLayout(dockviewLayout.sshLayout)
}

export function validateStoredSelectionState(api?: DockviewWidgetScope['dockviewApi']) {
	if (!selectionState.panelId || !api) return
	const panel = api.getPanel(selectionState.panelId)
	if (!panel) {
		selectionState.panelId = undefined
	}
}

export interface UIConfiguration {
	darkMode: boolean
}

function getDefaultUIConfiguration(): UIConfiguration {
	if (typeof window === 'undefined') {
		return { darkMode: false }
	}

	const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
	return {
		darkMode: prefersDark,
	}
}

export const uiConfiguration = stored<UIConfiguration>(getDefaultUIConfiguration())
