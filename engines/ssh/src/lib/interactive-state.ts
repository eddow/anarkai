import { reactive, unwrap } from 'mutts'
import type { InteractiveGameObject } from './game/object'

export const mrg = reactive({
	hoveredObject: undefined as InteractiveGameObject | undefined,
})

export const interactionMode = reactive({
	selectedAction: '' as string,
})

export function getHoveredUid(): string | undefined {
	const hoveredObject = mrg.hoveredObject
	return hoveredObject ? unwrap(hoveredObject).uid : undefined
}

export function isHoveredObject(object: InteractiveGameObject | undefined): boolean {
	if (!object) return false
	const hoveredObject = mrg.hoveredObject
	return hoveredObject !== undefined && unwrap(hoveredObject) === unwrap(object)
}

export function setHoveredObject(object: InteractiveGameObject | undefined): void {
	mrg.hoveredObject = object ? (unwrap(object) as InteractiveGameObject) : undefined
}
