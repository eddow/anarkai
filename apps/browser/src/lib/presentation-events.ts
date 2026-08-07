import { reactive } from 'mutts'
import type { GameObject, GamePresentationEvent } from 'ssh/game'

// TODO: `tick` is a hack, let's have something standardized, perhaps even in sursaut
const presentationRevisions = reactive({
	byOwner: new Map<GameObject, number>(),
	tick: 0,
	workPlanning: 0,
})

export function presentationRevisionFor(owner: GameObject | undefined): number {
	if (!owner) return 0
	void presentationRevisions.tick
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
	presentationRevisions.tick++
}

export function resetPresentationRevisionsForTests(): void {
	presentationRevisions.byOwner = new Map()
	presentationRevisions.tick = 0
	presentationRevisions.workPlanning = 0
}
