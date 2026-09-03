import { reactive, unwrap } from 'mutts'
import type { InteractiveGameObject } from 'ssh/game/object'
import type { HivePlan } from 'ssh/hive-plan'
import type { Project } from 'ssh/project'
import type { AxialCoord } from 'ssh/utils'

export const mrg = reactive({
	hoveredObject: undefined as InteractiveGameObject | undefined,
})

export const interactionMode = reactive({
	selectedAction: '' as string,
})

export const hivePlanPlacementState = reactive({
	rotation: 0,
	lastMessage: '',
	plan: undefined as HivePlan | undefined,
})

/**
 * Active project being edited on the board. The **tool** lives in
 * `interactionMode.selectedAction` (the single active-tool slot); this state
 * holds only non-serializable context: which project is being edited, the hive
 * template when the `'hive'` tool is active, and the rotate/mirror transforms.
 */
export const projectEditingState = reactive({
	project: undefined as Project | undefined,
	/** Set when `selectedAction === 'hive'`: the template to stamp onto the board. */
	hivePlan: undefined as HivePlan | undefined,
	rotation: 0,
	mirror: false,
})

/** Tool values that belong to project authoring (gated on {@link projectEditingState.project}). */
export const PROJECT_TOOLS = ['hive', 'bulldoze'] as const
export function isProjectTool(action: string): boolean {
	return action === 'hive' || action === 'bulldoze' || action.startsWith('build:') || action.startsWith('road:')
}

/**
 * Board preview ghost: the currently previewed project (one radio per project in
 * the project-manager sidebar). When `active`, the project's placed buildings
 * and roads are drawn as a board overlay.
 */
export const projectPreviewState = reactive({
	project: undefined as Project | undefined,
	active: false,
})

export interface ActiveWorldViewPov {
	readonly viewId: string
	readonly center: AxialCoord
}

export const activeWorldViewPov = reactive<{
	viewId: string
	center: AxialCoord | undefined
}>({
	viewId: 'primary',
	center: undefined,
})

export function setActiveWorldViewPov(pov: ActiveWorldViewPov): void {
	// V1 has one game widget POV. Keep the view id in the state so multiple world views can
	// publish independent centers without changing picker call sites later.
	activeWorldViewPov.viewId = pov.viewId
	activeWorldViewPov.center = pov.center
}

export function getHoveredObject(): InteractiveGameObject | undefined {
	// `mrg.hoveredObject` holds the reactive proxy instance, which is the same
	// identity stored in `game.objects` and used to key `renderer.visuals`.
	// Unwrapping here would break that identity (raw !== proxy), so the hover
	// highlight lookup in `VisualFactory.syncHoveredVisual` would never match.
	return mrg.hoveredObject
}

export function isHoveredObject(object: InteractiveGameObject | undefined): boolean {
	if (!object) return false
	const hoveredObject = mrg.hoveredObject
	return hoveredObject !== undefined && unwrap(hoveredObject) === unwrap(object)
}

export function setHoveredObject(object: InteractiveGameObject | undefined): void {
	mrg.hoveredObject = object ? (unwrap(object) as InteractiveGameObject) : undefined
}
