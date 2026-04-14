import type { DockviewWidgetScope } from '@sursaut/ui/dockview'
import type { InspectorSelectableObject } from 'ssh/game/object'
import { game, selectionState, unreactiveInfo, validateStoredSelectionState } from './globals'

type DockviewApiLike = DockviewWidgetScope['dockviewApi']

type SelectableObject = Pick<InspectorSelectableObject, 'uid' | 'title'>
const pinnedInspectorPanelIdsByUid = new Map<string, string>()

function getGlobalDockviewApi(): DockviewApiLike | undefined {
	if (typeof window === 'undefined') return undefined
	return (window as any).dockviewApi as DockviewApiLike | undefined
}

function focusPanel(panel: any) {
	panel?.focus?.()
	panel?.api?.focus?.()
	panel?.api?.setActive?.()
}

function getRegisteredInspectorPanel(uid: string, dockviewApi: DockviewApiLike | undefined) {
	if (!dockviewApi) return undefined
	const panelId = pinnedInspectorPanelIdsByUid.get(uid)
	if (!panelId) return undefined
	const panel = dockviewApi.getPanel?.(panelId)
	if (panel) return panel
	pinnedInspectorPanelIdsByUid.delete(uid)
	return undefined
}

export function clearFollowSelectionPanel(panelId?: string) {
	if (panelId && selectionState.panelId && selectionState.panelId !== panelId) return
	selectionState.panelId = undefined
	unreactiveInfo.hasLastSelectedInfoPanel = false
}

export function registerPinnedInspectorPanel(panelId: string, uid?: string) {
	if (!uid) return
	for (const [mappedUid, mappedPanelId] of pinnedInspectorPanelIdsByUid) {
		if (mappedPanelId === panelId && mappedUid !== uid) {
			pinnedInspectorPanelIdsByUid.delete(mappedUid)
		}
	}
	pinnedInspectorPanelIdsByUid.set(uid, panelId)
}

export function unregisterPinnedInspectorPanel(panelId: string, uid?: string) {
	if (uid) {
		if (pinnedInspectorPanelIdsByUid.get(uid) === panelId) {
			pinnedInspectorPanelIdsByUid.delete(uid)
		}
		return
	}
	for (const [mappedUid, mappedPanelId] of pinnedInspectorPanelIdsByUid) {
		if (mappedPanelId === panelId) {
			pinnedInspectorPanelIdsByUid.delete(mappedUid)
		}
	}
}

function resolveSelectionPanelTitle(initialTitle?: string) {
	if (initialTitle) return initialTitle

	const selectedUid = selectionState.selectedUid
	if (!selectedUid) return 'Selection'

	return game.getObject(selectedUid)?.title ?? 'Selection'
}

export function ensureFollowSelectionPanel(preferredApi?: DockviewApiLike, initialTitle?: string) {
	const dockviewApi = preferredApi ?? getGlobalDockviewApi()
	if (!dockviewApi) return undefined

	validateStoredSelectionState(dockviewApi)

	let panel =
		selectionState.panelId !== undefined
			? dockviewApi.getPanel?.(selectionState.panelId)
			: undefined

	if (!panel) {
		clearFollowSelectionPanel()
		const id = `selection-info-${Date.now()}`
		panel = dockviewApi.addPanel?.({
			id,
			component: 'selection-info',
			title: resolveSelectionPanelTitle(initialTitle),
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

export function showProps(object: SelectableObject, preferredApi?: DockviewApiLike) {
	const dockviewApi = preferredApi ?? getGlobalDockviewApi()
	if (dockviewApi) {
		validateStoredSelectionState(dockviewApi)

		const pinnedPanel = getRegisteredInspectorPanel(object.uid, dockviewApi)
		if (pinnedPanel) {
			focusPanel(pinnedPanel)
			return pinnedPanel
		}
	}

	selectionState.selectedUid = object.uid
	if (!dockviewApi) return undefined
	return ensureFollowSelectionPanel(dockviewApi, object.title)
}

export function selectInspectorObject(object: SelectableObject, preferredApi?: DockviewApiLike) {
	return showProps(object, preferredApi)
}
