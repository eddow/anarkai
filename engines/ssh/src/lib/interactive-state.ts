import { reactive } from 'mutts'
import type { InteractiveGameObject } from './game/object'

export const mrg = reactive({
	hoveredObject: undefined as InteractiveGameObject | undefined,
})

export const interactionMode = reactive({
	selectedAction: '' as string,
})
