import { reactive } from 'mutts'
import type { GamePresentationEvent } from 'ssh/game'

const presentationRevisions = reactive({
	byOwnerUid: {} as Record<string, number | undefined>,
})

export function presentationRevisionFor(ownerUid: string | undefined): number {
	if (!ownerUid) return 0
	return presentationRevisions.byOwnerUid[ownerUid] ?? 0
}

export function consumePresentationEvents(events: readonly GamePresentationEvent[]): void {
	for (const event of events) {
		if (event.type !== 'storage.changed') continue
		presentationRevisions.byOwnerUid[event.ownerUid] =
			(presentationRevisions.byOwnerUid[event.ownerUid] ?? 0) + 1
	}
}

export function resetPresentationRevisionsForTests(): void {
	presentationRevisions.byOwnerUid = {}
}
