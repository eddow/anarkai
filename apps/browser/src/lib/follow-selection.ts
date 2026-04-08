import type { DockviewWidgetScope } from '@sursaut/ui/dockview'
import { selectionState, unreactiveInfo, validateStoredSelectionState } from './globals'

type DockviewApiLike = DockviewWidgetScope['dockviewApi']

type SelectableObject = {
	uid: string
}

function getGlobalDockviewApi(): DockviewApiLike | undefined {
	if (typeof window === 'undefined') return undefined
	return (window as any).dockviewApi as DockviewApiLike | undefined
}

function focusPanel(panel: any) {
	panel?.focus?.()
	panel?.api?.focus?.()
	panel?.api?.setActive?.()
}

export function clearFollowSelectionPanel(panelId?: string) {
	if (panelId && selectionState.panelId && selectionState.panelId !== panelId) return
	selectionState.panelId = undefined
	unreactiveInfo.hasLastSelectedInfoPanel = false
}

export function ensureFollowSelectionPanel(preferredApi?: DockviewApiLike) {
	const dockviewApi = preferredApi ?? getGlobalDockviewApi()
	if (!dockviewApi) return undefined

	validateStoredSelectionState(dockviewApi)

	let panel =
		selectionState.panelId !== undefined ? dockviewApi.getPanel?.(selectionState.panelId) : undefined

	if (!panel) {
		clearFollowSelectionPanel()
		const id = `selection-info-${Date.now()}`
		panel = dockviewApi.addPanel?.({
			id,
			component: 'selection-info',
			params: {},
			tabComponent: 'selection-info-tab',
			floating: {
				width: 400,
				height: 600,
			},
		})
		selectionState.panelId = panel?.id ?? id
		unreactiveInfo.hasLastSelectedInfoPanel = true
	}

	focusPanel(panel)
	return panel
}

export function selectInspectorObject(object: SelectableObject, preferredApi?: DockviewApiLike) {
	selectionState.selectedUid = object.uid
	return ensureFollowSelectionPanel(preferredApi)
}
