import type { DockviewWidgetScope } from '@sursaut/ui/dockview'
import { unwrap } from 'mutts'
import { Tile } from 'ssh/board/tile'
import type { InspectorSelectableObject } from 'ssh/game/object'
import { toAxialCoord } from 'ssh/utils/position'
import { game, selectionState, unreactiveInfo, validateSelectionPanelId } from './globals'

const GAMEPLAY_SECTOR_STEP = 17

type DockviewApiLike = DockviewWidgetScope['dockviewApi']
type DockviewApi = NonNullable<DockviewApiLike>
type InspectorPanel = NonNullable<ReturnType<DockviewApi['getPanel']>>
type DockviewWindow = Window & { dockviewApi?: DockviewApiLike }

type SelectableObject = Pick<InspectorSelectableObject, 'title'>
const pinnedInspectorPanelIdsByObject = new Map<object, string>()
const pinnedInspectorObjectsByPanelId = new Map<string, object>()

function ensureGeneratedTileContent(object: SelectableObject): void {
	if (!(object instanceof Tile)) return
	const position = (object as Tile).position
	const coord = position ? toAxialCoord(position) : undefined
	if (!coord) return
	const sectorKey = `${Math.floor(coord.q / GAMEPLAY_SECTOR_STEP)},${Math.floor(coord.r / GAMEPLAY_SECTOR_STEP)}`
	if (game.ensureGameplaySectors) {
		void game.ensureGameplaySectors([sectorKey])
		return
	}
	game.ensureGeneratedTiles?.([{ q: coord.q, r: coord.r }])
}

function getGlobalDockviewApi(): DockviewApiLike | undefined {
	if (typeof window === 'undefined') return undefined
	return (window as DockviewWindow).dockviewApi
}

function focusPanel(panel: InspectorPanel | undefined) {
	panel?.focus()
	panel?.api?.setActive()
}

function getRegisteredInspectorPanel(object: object, dockviewApi: DockviewApiLike | undefined) {
	if (!dockviewApi) return undefined
	const raw = unwrap(object)
	const panelId = pinnedInspectorPanelIdsByObject.get(raw)
	if (!panelId) return undefined
	const panel = dockviewApi.getPanel?.(panelId)
	if (panel) return panel
	pinnedInspectorPanelIdsByObject.delete(raw)
	pinnedInspectorObjectsByPanelId.delete(panelId)
	return undefined
}

export function getPinnedInspectorObject(panelId: string): object | undefined {
	return pinnedInspectorObjectsByPanelId.get(panelId)
}

function isRegisteredPinnedInspectorPanelId(panelId: string) {
	for (const registeredPanelId of pinnedInspectorPanelIdsByObject.values()) {
		if (registeredPanelId === panelId) return true
	}
	return false
}

function getActivePinnedInspectorPanel(dockviewApi: DockviewApi) {
	const panel = dockviewApi.activePanel
	if (!panel || !isRegisteredPinnedInspectorPanelId(panel.id)) return undefined
	return panel
}

export function clearFollowSelectionPanel(panelId?: string) {
	if (panelId && selectionState.panelId && selectionState.panelId !== panelId) return
	selectionState.panelId = undefined
	unreactiveInfo.hasLastSelectedInfoPanel = false
}

export function registerPinnedInspectorPanel(panelId: string, object?: object) {
	if (!object) return
	const raw = unwrap(object)
	const existing = pinnedInspectorObjectsByPanelId.get(panelId)
	if (existing && existing !== raw) {
		pinnedInspectorPanelIdsByObject.delete(existing)
	}
	pinnedInspectorPanelIdsByObject.set(raw, panelId)
	pinnedInspectorObjectsByPanelId.set(panelId, raw)
}

export function unregisterPinnedInspectorPanel(panelId: string, object?: object) {
	if (object) {
		if (pinnedInspectorPanelIdsByObject.get(object) === panelId) {
			pinnedInspectorPanelIdsByObject.delete(object)
			pinnedInspectorObjectsByPanelId.delete(panelId)
		}
		return
	}
	const mappedObject = pinnedInspectorObjectsByPanelId.get(panelId)
	if (mappedObject) {
		pinnedInspectorPanelIdsByObject.delete(mappedObject)
		pinnedInspectorObjectsByPanelId.delete(panelId)
	}
}

function resolveSelectionPanelTitle(initialTitle?: string) {
	if (initialTitle) return initialTitle

	// Direct object reference — preferred path
	const direct = selectionState.selectedObject as { title?: string } | undefined
	return direct?.title ?? 'Selection'
}

function addFollowSelectionPanel(
	dockviewApi: DockviewApi,
	id: string,
	initialTitle?: string,
	sourcePanel?: InspectorPanel
) {
	const commonOptions = {
		id,
		component: 'selection-info',
		title: resolveSelectionPanelTitle(initialTitle),
		params: {},
		tabComponent: 'selection-info-tab',
	}

	if (!sourcePanel) {
		return dockviewApi.addPanel({
			...commonOptions,
			floating: {
				width: 400,
				height: 600,
			},
		})
	}

	const sourceIndex = sourcePanel.group.panels.findIndex((panel) => panel.id === sourcePanel.id)
	return dockviewApi.addPanel({
		...commonOptions,
		floating: false,
		position: {
			referencePanel: sourcePanel,
			direction: 'within',
			...(sourceIndex >= 0 ? { index: sourceIndex + 1 } : {}),
		},
	})
}

export function ensureFollowSelectionPanel(
	preferredApi?: DockviewApiLike,
	initialTitle?: string,
	sourcePanel?: InspectorPanel
): InspectorPanel | undefined {
	const dockviewApi = preferredApi ?? getGlobalDockviewApi()
	if (!dockviewApi) return undefined

	validateSelectionPanelId(dockviewApi)

	let panel =
		selectionState.panelId !== undefined
			? dockviewApi.getPanel?.(selectionState.panelId)
			: undefined

	if (!panel) {
		clearFollowSelectionPanel()
		const id = `selection-info-${Date.now()}`
		panel = addFollowSelectionPanel(dockviewApi, id, initialTitle, sourcePanel)
		selectionState.panelId = panel?.id ?? id
		unreactiveInfo.hasLastSelectedInfoPanel = true
	}

	focusPanel(panel)
	return panel
}

export function showProps(
	object: SelectableObject,
	preferredApi?: DockviewApiLike
): InspectorPanel | undefined {
	const raw = unwrap(object) as SelectableObject
	ensureGeneratedTileContent(raw)
	const dockviewApi = preferredApi ?? getGlobalDockviewApi()
	if (dockviewApi) {
		validateSelectionPanelId(dockviewApi)

		const pinnedPanel = getRegisteredInspectorPanel(raw as object, dockviewApi)
		if (pinnedPanel) {
			focusPanel(pinnedPanel)
			return pinnedPanel
		}
	}

	selectionState.selectedObject = raw as object
	if (!dockviewApi) return undefined
	return ensureFollowSelectionPanel(
		dockviewApi,
		raw.title,
		getActivePinnedInspectorPanel(dockviewApi)
	)
}

export function selectInspectorObject(
	object: SelectableObject,
	preferredApi?: DockviewApiLike
): InspectorPanel | undefined {
	return showProps(object, preferredApi)
}
