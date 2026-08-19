import { stored } from '@sursaut/kit/dom'
import type { DockviewWidgetScope } from '@sursaut/ui/dockview'
import { shallowReactive } from 'mutts'

export type { Configuration } from 'ssh/globals'
// Re-export all game-related globals from ssh engine
export { configuration, game } from 'ssh/globals'
export {
	activeWorldViewPov,
	getHoveredObject,
	hivePlanPlacementState,
	interactionMode,
	isHoveredObject,
	mrg,
	setActiveWorldViewPov,
	setHoveredObject,
} from './interactive-state'

export const unreactiveInfo = {
	hasLastSelectedInfoPanel: false,
}
export interface SelectionState {
	panelId?: string
	/** Object reference (set by showProps, read by selection-info). Not persisted — computed at runtime. */
	selectedObject?: object
}

export const selectionState = shallowReactive<SelectionState>({
	panelId: undefined,
	selectedObject: undefined,
})

/**
 * Ensure `selectionState.panelId` still refers to a live panel in the given
 * dockview API. Selection is in-memory only (no layout serialization yet); if
 * the tracked panel no longer exists, clear the id so selection can re-open it.
 */
export function validateSelectionPanelId(api?: DockviewWidgetScope['dockviewApi']) {
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
