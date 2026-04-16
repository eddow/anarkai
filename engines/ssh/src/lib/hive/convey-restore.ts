import type { Game } from 'ssh/game/game'
import type { SerializedConveyMovement } from 'ssh/hive/convey-serialize'
import { serializeFreightParty } from 'ssh/hive/convey-serialize'
import type { Hive, TrackedMovement } from 'ssh/hive/hive'
import { type MovementRef, movementRefId } from 'ssh/hive/movement-ref'

export function resolveSerializedFreightParty(
	game: Game,
	ref: SerializedConveyMovement['provider']
): FreightMovementParty | undefined {
	if (ref.kind === 'alveolus') {
		const tile = game.hex.getTile({ q: ref.coord[0], r: ref.coord[1] })
		const c = tile?.content
		return c instanceof Alveolus ? c : undefined
	}
	const bayTile = game.hex.getTile({ q: ref.bayCoord[0], r: ref.bayCoord[1] })
	const bay = bayTile?.content
	if (!(bay instanceof Alveolus)) return undefined
	return bay.hive.freightVehicleDockFor(ref.vehicleUid)
}

function collectDistinctHives(game: Game): Hive[] {
	const hives = new Set<Hive>()
	for (const tile of game.hex.tiles) {
		const c = tile.content
		if (c && 'hive' in c && c.hive) hives.add(c.hive)
	}
	return [...hives]
}

export function collectSerializedConveyMovementsWithIndex(game: Game): {
	rows: SerializedConveyMovement[]
	indexByRef: Map<MovementRef, number>
} {
	const movements: TrackedMovement[] = []
	for (const hive of collectDistinctHives(game)) {
		movements.push(...hive.collectActiveMovements())
	}
	movements.sort((a, b) => movementRefId(a.ref) - movementRefId(b.ref))
	const indexByRef = new Map(movements.map((m, i) => [m.ref, i]))
	const rows = movements.map((movement) => ({
		goodType: movement.goodType,
		path: [...movement.path],
		from: { ...movement.from },
		provider: serializeFreightParty(movement.provider),
		demander: serializeFreightParty(movement.demander),
		claimed: movement.claimed,
		claimedByUid: movement.claimedBy?.uid,
		claimedAtMs: movement.claimedAtMs,
	}))
	return { rows, indexByRef }
}

export function collectSerializedConveyMovements(game: Game): SerializedConveyMovement[] {
	return collectSerializedConveyMovementsWithIndex(game).rows
}

export function restoreSerializedConveyMovements(
	game: Game,
	rows: readonly SerializedConveyMovement[] | undefined
): TrackedMovement[] {
	if (!rows?.length) return []
	const restored: TrackedMovement[] = []
	for (const row of rows) {
		const provider = resolveSerializedFreightParty(game, row.provider)
		const demander = resolveSerializedFreightParty(game, row.demander)
		if (!provider || !demander) continue
		const hive = demander.hive
		const movement = hive.restoreSerializedConveyRow(row, provider, demander)
		if (movement) restored.push(movement)
	}
	return restored
}
