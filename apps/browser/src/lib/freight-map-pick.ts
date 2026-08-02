import { reactive } from 'mutts'
import { Tile } from 'ssh/board/tile'
import { SettlementTradeObject } from 'ssh/commerce/settlement-trade'
import { traces } from 'ssh/dev/debug'
import {
	type FreightStop,
	type FreightStopAnchorAlveolus,
	type FreightLineDefinition,
	freightLineStopHiveName,
} from 'ssh/freight/freight-line'
import type { Game } from 'ssh/game'
import type { InteractiveGameObject } from 'ssh/game/object'
import { FreightBayAlveolus } from 'ssh/hive/freight-bay'
import { axial } from 'ssh/utils'
import { toAxialCoord } from 'ssh/utils/position'
import { interactionMode } from './interactive-state'

export type FreightMapPickApplyResult =
	| { kind: 'bay'; anchor: FreightStopAnchorAlveolus }
	| { kind: 'center'; coord: readonly [number, number] }

export type FreightMapPickPending =
	| {
			readonly line: FreightLineDefinition
			readonly pickKind: 'bay' | 'center'
			readonly apply: (result: FreightMapPickApplyResult) => void
	  }
	| {
			readonly line: FreightLineDefinition
			readonly pickKind: 'add-stop'
			readonly apply: (stop: FreightStop) => void
	  }

export const freightMapPick = reactive({
	pending: undefined as FreightMapPickPending | undefined,
})

export const FREIGHT_ADD_STOP_ACTION = 'freight:add-stop'

export function isFreightAddStopAction(action = interactionMode.selectedAction): boolean {
	return action === FREIGHT_ADD_STOP_ACTION
}

function clearFreightToolAction(): void {
	if (isFreightAddStopAction()) interactionMode.selectedAction = ''
}

export function activateFreightAddStopPick(args: {
	readonly line: FreightLineDefinition
	readonly apply: (stop: FreightStop) => void
}): void {
	traces.ui.assert?.(
		args.line !== undefined,
		'freight.add-stop.activate: line is required',
		args
	)
	traces.ui.assert?.(
		typeof args.apply === 'function',
		'freight.add-stop.activate: apply callback is required',
		args
	)
	freightMapPick.pending = {
		line: args.line,
		pickKind: 'add-stop',
		apply: args.apply,
	}
	interactionMode.selectedAction = FREIGHT_ADD_STOP_ACTION
	traces.ui.assert?.(
		isFreightAddStopAction(),
		'freight.add-stop.activate: selectedAction did not enter freight add-stop mode',
		{ selectedAction: interactionMode.selectedAction, line: args.line }
	)
}

export function cancelFreightMapPick(): void {
	freightMapPick.pending = undefined
	clearFreightToolAction()
}

export function clearFreightMapPickForLine(line: FreightLineDefinition): void {
	if (freightMapPick.pending?.line !== line) return
	freightMapPick.pending = undefined
	clearFreightToolAction()
}

function shouldKeepPicking(event: unknown): boolean {
	return (
		event !== null &&
		typeof event === 'object' &&
		'shiftKey' in event &&
		Boolean((event as { shiftKey?: boolean }).shiftKey)
	)
}

function maybeClearPending(keep: boolean): void {
	if (keep) return
	freightMapPick.pending = undefined
	clearFreightToolAction()
}

function freightBayAnchorForTile(tile: Tile): FreightStopAnchorAlveolus | undefined {
	const content = tile.content
	if (!(content instanceof FreightBayAlveolus)) return undefined
	const coord = toAxialCoord(tile.position)
	if (!coord) return undefined
	return {
		kind: 'alveolus',
		hiveName: freightLineStopHiveName(content.hive.name),
		alveolusType: 'freight_bay',
		coord: [coord.q, coord.r] as const,
	}
}

function customZoneIdForTile(game: Game, tile: Tile): string | undefined {
	const coord = toAxialCoord(tile.position)
	if (!coord) return undefined
	const zone = game.hex.zoneManager.getZone(coord)
	if (!zone || zone.generated || zone.readonly) return undefined
	return zone.name ?? zone.type
}

function settlementTradeStopForTile(game: Game, tile: Tile): FreightStop | undefined {
	const coord = toAxialCoord(tile.position)
	if (!coord) return undefined
	const profile = game.getSettlementTradeProfileAtCityHall?.(coord)
	if (!profile) return undefined
	return {
		trade: {
			kind: 'settlement',
			settlementId: profile.id,
			profile,
		},
	}
}

function stopForPickedObject(game: Game, object: InteractiveGameObject): FreightStop | undefined {
	if (object instanceof SettlementTradeObject) {
		return {
			trade: {
				kind: 'settlement',
				settlementId: object.profile.id,
				profile: object.profile,
			},
		}
	}
	if (!(object instanceof Tile)) return undefined
	const settlementStop = settlementTradeStopForTile(game, object)
	if (settlementStop) return settlementStop
	const anchor = freightBayAnchorForTile(object)
	if (anchor) {
		return {
			anchor,
		}
	}
	const zoneId = customZoneIdForTile(game, object)
	if (zoneId) {
		return {
			zone: {
				kind: 'named',
				zoneId,
			},
		}
	}
	return undefined
}

export function tryConsumeFreightMapPick(
	game: Game,
	object: InteractiveGameObject,
	event?: unknown
): boolean {
	const pending = freightMapPick.pending
	if (!pending) return false

	if (pending.pickKind === 'add-stop') {
		if (!isFreightAddStopAction()) {
			traces.ui.assert?.(
				false,
				'freight.add-stop.consume: pending picker without matching selectedAction',
				{ selectedAction: interactionMode.selectedAction, line: pending.line }
			)
			freightMapPick.pending = undefined
			return false
		}
		const stop = stopForPickedObject(game, object)
		if (stop) {
			pending.apply(stop)
			maybeClearPending(shouldKeepPicking(event))
			return true
		}
		return object instanceof Tile
	}

	if (!(object instanceof Tile)) return false

	if (pending.pickKind === 'center') {
		const coord = toAxialCoord(object.position)
		if (!coord) return false
		pending.apply({ kind: 'center', coord: [coord.q, coord.r] as const })
		maybeClearPending(shouldKeepPicking(event))
		return true
	}

	const anchor = freightBayAnchorForTile(object)
	if (!anchor) return false
	pending.apply({ kind: 'bay', anchor })
	maybeClearPending(shouldKeepPicking(event))
	return true
}

export function freightMapPickCanConsumeObject(game: Game, object: InteractiveGameObject): boolean {
	const pending = freightMapPick.pending
	if (!pending) return false
	if (pending.pickKind !== 'add-stop') return true
	if (!isFreightAddStopAction()) {
		traces.ui.assert?.(
			false,
			'freight.add-stop.can-consume: pending picker without matching selectedAction',
			{ selectedAction: interactionMode.selectedAction, line: pending.line }
		)
		freightMapPick.pending = undefined
		return false
	}
	return !!stopForPickedObject(game, object) || object instanceof Tile
}

export function freightRadiusPreviewTiles(game: Game, startTile: Tile, endTile: Tile): Tile[] {
	const start = toAxialCoord(startTile.position)
	const end = toAxialCoord(endTile.position)
	if (!start || !end) return []
	const radius = axial.distance(start, end)
	return [...axial.allTiles(start, radius)]
		.map((coord) => game.hex.getTile(coord))
		.filter((tile): tile is Tile => !!tile)
}

export function tryConsumeFreightMapPickRadiusDrag(args: {
	readonly game: Game
	readonly startTile: Tile
	readonly endTile: Tile
	readonly event?: unknown
}): boolean {
	const pending = freightMapPick.pending
	if (!pending || pending.pickKind !== 'add-stop') return false
	if (!isFreightAddStopAction()) {
		traces.ui.assert?.(
			false,
			'freight.add-stop.radius-drag: pending picker without matching selectedAction',
			{ selectedAction: interactionMode.selectedAction, line: pending.line }
		)
		freightMapPick.pending = undefined
		return false
	}
	const start = toAxialCoord(args.startTile.position)
	const end = toAxialCoord(args.endTile.position)
	if (!start || !end) return true
	const radius = axial.distance(start, end)
	pending.apply({
		zone: {
			kind: 'radius',
			center: [start.q, start.r] as const,
			radius,
		},
	})
	maybeClearPending(shouldKeepPicking(args.event))
	return true
}
