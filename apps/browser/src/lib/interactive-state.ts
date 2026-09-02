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
 * Active project being edited on the board, plus the currently selected
 * authoring tool (`'build:<alveolusType>'`, `'road:<roadType>'`, `'hive'`
 * with a `hivePlan`, or `'bulldoze'`). Board clicks route here (Phase 5) to
 * add/remove project entries and roads, or stamp a hive-plan template.
 */
export const projectEditingState = reactive({
	project: undefined as Project | undefined,
	tool: '' as string,
	/** Set when `tool === 'hive'`: the template to stamp onto the board. */
	hivePlan: undefined as HivePlan | undefined,
	rotation: 0,
	mirror: false,
})

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
