import { reactive } from 'mutts'
import { Tile } from 'ssh/board/tile'
import { type FreightStopAnchorAlveolus, freightLineStopHiveName } from 'ssh/freight/freight-line'
import type { Game } from 'ssh/game'
import type { InteractiveGameObject } from 'ssh/game/object'
import { StorageAlveolus } from 'ssh/hive/storage'
import { isRoadFretAction } from 'ssh/hive/storage-action'
import { toAxialCoord } from 'ssh/utils/position'

export type FreightMapPickApplyResult =
	| { kind: 'bay'; anchor: FreightStopAnchorAlveolus }
	| { kind: 'center'; coord: readonly [number, number] }

export type FreightMapPickPending = {
	readonly lineId: string
	readonly pickKind: 'bay' | 'center'
	readonly apply: (result: FreightMapPickApplyResult) => void
}

export const freightMapPick = reactive({
	pending: undefined as FreightMapPickPending | undefined,
})

export function cancelFreightMapPick(): void {
	freightMapPick.pending = undefined
}

export function clearFreightMapPickForLine(lineId: string): void {
	if (freightMapPick.pending?.lineId === lineId) freightMapPick.pending = undefined
}

export function tryConsumeFreightMapPick(_game: Game, object: InteractiveGameObject): boolean {
	const pending = freightMapPick.pending
	if (!pending) return false
	if (!(object instanceof Tile)) return false

	if (pending.pickKind === 'center') {
		const coord = toAxialCoord(object.position)
		if (!coord) return false
		pending.apply({ kind: 'center', coord: [coord.q, coord.r] as const })
		freightMapPick.pending = undefined
		return true
	}

	const content = object.content
	if (!(content instanceof StorageAlveolus)) return false
	if (content.name !== 'freight_bay') return false
	if (!isRoadFretAction(content.action)) return false

	const coord = toAxialCoord(object.position)
	if (!coord) return false

	const anchor: FreightStopAnchorAlveolus = {
		kind: 'alveolus',
		hiveName: freightLineStopHiveName(content.hive.name),
		alveolusType: 'freight_bay',
		coord: [coord.q, coord.r] as const,
	}
	pending.apply({ kind: 'bay', anchor })
	freightMapPick.pending = undefined
	return true
}
