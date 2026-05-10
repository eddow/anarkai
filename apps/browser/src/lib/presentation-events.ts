import { reactive } from 'mutts'
import type { GamePresentationEvent } from 'ssh/game'

const presentationRevisions = reactive({
	byOwnerUid: {} as Record<string, number | undefined>,
	workPlanning: 0,
})

export function presentationRevisionFor(ownerUid: string | undefined): number {
	if (!ownerUid) return 0
	return presentationRevisions.byOwnerUid[ownerUid] ?? 0
}

export function workPlanningPresentationRevision(): number {
	return presentationRevisions.workPlanning
}

export function consumePresentationEvents(events: readonly GamePresentationEvent[]): void {
	for (const event of events) {
		switch (event.type) {
			case 'storage.changed':
			case 'vehicle.dock.changed':
				presentationRevisions.byOwnerUid[event.ownerUid] =
					(presentationRevisions.byOwnerUid[event.ownerUid] ?? 0) + 1
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
	presentationRevisions.byOwnerUid = {}
	presentationRevisions.workPlanning = 0
}
