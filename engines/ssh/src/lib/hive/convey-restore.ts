import type { Alveolus } from 'ssh/board/content/alveolus'
import type { FreightMovementParty } from 'ssh/freight/vehicle-freight-dock'
import type { Game } from 'ssh/game/game'
import type { SerializedConveyMovement } from 'ssh/hive/convey-serialize'
import { serializeFreightParty } from 'ssh/hive/convey-serialize'
import type { Hive, TrackedMovement } from 'ssh/hive/hive'
import { type MovementRef, movementRefId } from 'ssh/hive/movement-ref'
import type { Vehicle } from 'ssh/population/vehicle/entity'
import type { SaveIndexes } from 'ssh/serialization'

function isAlveolusLike(value: unknown): value is Alveolus {
	return (
		!!value && typeof value === 'object' && 'hive' in value && !!(value as { hive?: unknown }).hive
	)
}

export function resolveSerializedFreightParty(
	game: Game,
	ref: SerializedConveyMovement['provider']
): FreightMovementParty | undefined {
	if (ref.kind === 'alveolus') {
		const tile = game.hex.getTile({ q: ref.coord[0], r: ref.coord[1] })
		const c = tile?.content
		return isAlveolusLike(c) ? (c as Alveolus) : undefined
	}
	const bayTile = game.hex.getTile({ q: ref.bayCoord[0], r: ref.bayCoord[1] })
	const bay = bayTile?.content
	if (!isAlveolusLike(bay)) return undefined
	if (ref.vehicleIndex < 0) return undefined
	const vehicles = [...(game.vehicles as Iterable<Vehicle>)]
	const vehicle = vehicles[ref.vehicleIndex]
	if (!vehicle) return undefined
	return bay.hive.freightVehicleDockFor(vehicle)
}

function collectDistinctHives(game: Game): Hive[] {
	const hives = new Set<Hive>()
	for (const tile of game.hex.tiles) {
		const c = tile.content
		if (c && 'hive' in c && c.hive) hives.add(c.hive)
	}
	return [...hives]
}

export function collectSerializedConveyMovementsWithIndex(
	game: Game,
	indexes: SaveIndexes
): {
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
		provider: serializeFreightParty(movement.provider, indexes.vehicles),
		demander: serializeFreightParty(movement.demander, indexes.vehicles),
		claimed: movement.claimed,
		/** Save/load uses an array index because serialized data cannot carry a live object reference. */
		claimedByCharacterIndex: movement.claimedBy
			? indexes.characters.toIndex(movement.claimedBy)
			: undefined,
		claimedAtMs: movement.claimedAtMs,
	}))
	return { rows, indexByRef }
}

export function collectSerializedConveyMovements(
	game: Game,
	indexes: SaveIndexes
): SerializedConveyMovement[] {
	return collectSerializedConveyMovementsWithIndex(game, indexes).rows
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
