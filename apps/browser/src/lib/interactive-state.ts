import { reactive, unwrap } from 'mutts'
import type { InteractiveGameObject } from 'ssh/game/object'
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
