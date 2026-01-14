// Re-export all game-related globals from ssh engine
export {
	configuration,
	debugInfo,
	dockviewLayout,
	getDockviewLayout,
	games,
	interactionMode,
	selectionState,
	registerObjectInfoPanel,
	unregisterObjectInfoPanel,
	getObjectInfoPanelId,
	validateStoredSelectionState,
	mrg,
} from '@ssh/lib/globals'

// Re-export types
export type { Configuration } from '@ssh/lib/globals'

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
