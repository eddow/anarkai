// Re-export all game-related globals from ssh engine
export {
	configuration,
	debugInfo,
	dockviewLayout,
	games,
	getDockviewLayout,
	getObjectInfoPanelId,
	interactionMode,
	mrg,
	registerObjectInfoPanel,
	selectionState,
	unregisterObjectInfoPanel,
	validateStoredSelectionState,
} from 'ssh/src/lib/globals'

export const unreactiveInfo = {
	hasLastSelectedInfoPanel: false,
}
// Re-export types
export type { Configuration } from 'ssh/src/lib/globals'

// UI-specific configuration (darkMode is UI-specific, not game engine concern)
import { stored } from 'pounce-ui/src'

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
