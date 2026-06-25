import { reactive } from 'mutts'
import type { GameObject, GamePresentationEvent } from 'ssh/game'

const presentationRevisions = reactive({
	byOwner: new Map<GameObject, number>(),
	workPlanning: 0,
})

export function presentationRevisionFor(owner: GameObject | undefined): number {
	if (!owner) return 0
	return presentationRevisions.byOwner.get(owner) ?? 0
}

export function workPlanningPresentationRevision(): number {
	return presentationRevisions.workPlanning
}

export function consumePresentationEvents(events: readonly GamePresentationEvent[]): void {
	for (const event of events) {
		switch (event.type) {
			case 'storage.changed':
			case 'vehicle.dock.changed':
				presentationRevisions.byOwner.set(
					event.owner,
					(presentationRevisions.byOwner.get(event.owner) ?? 0) + 1
				)
				break
			case 'work-planning.changed':
				presentationRevisions.workPlanning = Math.max(
					presentationRevisions.workPlanning + 1,
					event.revision
				)
				break
		}
	}
}

export function resetPresentationRevisionsForTests(): void {
	presentationRevisions.byOwner = new Map()
	presentationRevisions.workPlanning = 0
}
