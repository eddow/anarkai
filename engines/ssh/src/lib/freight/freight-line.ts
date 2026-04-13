import type { AlveolusType, GoodType } from 'ssh/types'
import type { Positioned } from 'ssh/utils'
import { toAxialCoord } from 'ssh/utils/position'
import type { Tile } from 'ssh/board/tile'
import type { Game } from 'ssh/game'
import type { InspectorSelectableObject } from 'ssh/game/object'

export type FreightLineMode = 'gather' | 'distribute'
export type FreightLineStopAlveolusType = AlveolusType | 'gather'

export interface FreightLineStop {
	readonly hiveName: string
	readonly alveolusType: FreightLineStopAlveolusType
	readonly coord: readonly [number, number]
}

export interface FreightLineDefinition {
	readonly id: string
	readonly name: string
	readonly mode: FreightLineMode
	readonly stops: ReadonlyArray<FreightLineStop>
	readonly radius?: number
	readonly filters?: ReadonlyArray<GoodType>
}

export const DEFAULT_GATHER_FREIGHT_RADIUS = 9
export const FREIGHT_LINE_UID_PREFIX = 'freight-line:'

export function freightLineStopHiveName(hiveName?: string): string {
	return hiveName ?? ''
}

export function freightLineDisplayHiveName(hiveName?: string): string {
	const trimmed = hiveName?.trim()
	return trimmed ? trimmed : 'Hive'
}

export function freightLineStationLabel(stop: Pick<FreightLineStop, 'hiveName' | 'coord'>): string {
	return `${freightLineDisplayHiveName(stop.hiveName)} (${stop.coord[0]}, ${stop.coord[1]})`
}

export function canonicalFreightLineStopAlveolusType(
	alveolusType: FreightLineStopAlveolusType
): AlveolusType {
	return alveolusType === 'gather' ? 'freight_bay' : alveolusType
}

export interface SyntheticFreightLineObject extends InspectorSelectableObject {
	readonly kind: 'freight-line'
	readonly line: FreightLineDefinition
	readonly lineId: string
	readonly tile?: Tile
}

export function freightLineUid(id: string): string {
	return `${FREIGHT_LINE_UID_PREFIX}${encodeURIComponent(id)}`
}

export function isFreightLineUid(uid: string): boolean {
	return uid.startsWith(FREIGHT_LINE_UID_PREFIX)
}

export function freightLineIdFromUid(uid: string): string | undefined {
	if (!isFreightLineUid(uid)) return undefined
	const encoded = uid.slice(FREIGHT_LINE_UID_PREFIX.length)
	return encoded ? decodeURIComponent(encoded) : undefined
}

export function freightLineMatchesStop(
	line: FreightLineDefinition,
	args: { hiveName: string; alveolusType: FreightLineStopAlveolusType; q: number; r: number }
): boolean {
	return line.stops.some(
		(s) =>
			s.hiveName === args.hiveName &&
			canonicalFreightLineStopAlveolusType(s.alveolusType) ===
				canonicalFreightLineStopAlveolusType(args.alveolusType) &&
			s.coord[0] === args.q &&
			s.coord[1] === args.r
	)
}

export function findFreightLineById(
	lines: Iterable<FreightLineDefinition>,
	id: string
): FreightLineDefinition | undefined {
	for (const line of lines) {
		if (line.id === id) return line
	}
	return undefined
}

export function findFreightLineByUid(
	lines: Iterable<FreightLineDefinition>,
	uid: string
): FreightLineDefinition | undefined {
	const id = freightLineIdFromUid(uid)
	return id ? findFreightLineById(lines, id) : undefined
}

export function normalizeFreightLineDefinition(
	line: FreightLineDefinition
): FreightLineDefinition {
	const firstStop = line.stops[0]
	const filters = line.filters?.length ? [...new Set(line.filters)] : undefined
	return {
		...line,
		stops: firstStop
			? [
					{
						...firstStop,
						alveolusType: canonicalFreightLineStopAlveolusType(firstStop.alveolusType),
					},
				]
			: [],
		filters,
		radius: line.mode === 'gather' ? line.radius : undefined,
	}
}

export function findFreightLineForStop(
	lines: Iterable<FreightLineDefinition>,
	alveolus: { hive: { name?: string }; name: string; tile: { position: Positioned } }
): FreightLineDefinition | undefined {
	return findFreightLinesForStop(lines, alveolus)[0]
}

export function findFreightLinesForStop(
	lines: Iterable<FreightLineDefinition>,
	alveolus: { hive: { name?: string }; name: string; tile: { position: Positioned } }
): FreightLineDefinition[] {
	const coord = toAxialCoord(alveolus.tile.position)
	if (!coord) return []
	const hiveName = freightLineStopHiveName(alveolus.hive.name)
	const matches: FreightLineDefinition[] = []
	for (const line of lines) {
		if (
			freightLineMatchesStop(line, {
				hiveName,
				alveolusType: alveolus.name as FreightLineStopAlveolusType,
				q: coord.q,
				r: coord.r,
			})
		) {
			matches.push(line)
		}
	}
	return matches
}

function findFreightLineForStopAndMode(
	lines: Iterable<FreightLineDefinition>,
	alveolus: { hive: { name?: string }; name: string; tile: { position: Positioned } },
	mode: FreightLineMode
): FreightLineDefinition | undefined {
	return findFreightLinesForStop(lines, alveolus).find((line) => line.mode === mode)
}

export function findGatherFreightLine(
	lines: Iterable<FreightLineDefinition>,
	alveolus: { hive: { name?: string }; name: string; tile: { position: Positioned } }
): FreightLineDefinition | undefined {
	return findFreightLineForStopAndMode(lines, alveolus, 'gather')
}

export function findDistributeFreightLine(
	lines: Iterable<FreightLineDefinition>,
	alveolus: { hive: { name?: string }; name: string; tile: { position: Positioned } }
): FreightLineDefinition | undefined {
	return findFreightLineForStopAndMode(lines, alveolus, 'distribute')
}

/** When a gather line lists filters, only those goods are gathered; otherwise hive needs drive selection. */
export function gatherSelectableGoodTypes(
	line: FreightLineDefinition | undefined,
	hiveNeedTypes: readonly GoodType[]
): GoodType[] {
	if (line?.filters?.length) return [...line.filters]
	return [...hiveNeedTypes]
}

export function gatherLineAcceptsProducedGood(
	line: FreightLineDefinition | undefined,
	hiveNeeds: Partial<Record<GoodType, unknown>>,
	good: GoodType
): boolean {
	if (!(good in hiveNeeds)) return false
	if (!line?.filters?.length) return true
	return line.filters.includes(good)
}

export function implicitGatherFreightLinesFromHivePatches(
	hives: ReadonlyArray<{
		name?: string
		alveoli: ReadonlyArray<{ coord: readonly [number, number]; alveolus: string }>
	}>
): FreightLineDefinition[] {
	const out: FreightLineDefinition[] = []
	for (const hive of hives) {
		const hiveName = freightLineStopHiveName(hive.name)
		const displayHiveName = freightLineDisplayHiveName(hive.name)
		for (const a of hive.alveoli) {
			if (a.alveolus !== 'gather' && a.alveolus !== 'freight_bay') continue
			const id = `${displayHiveName}:implicit-gather:${a.coord[0]},${a.coord[1]}`
			out.push({
				id,
				name: `${displayHiveName} (${a.coord[0]}, ${a.coord[1]}) gather`,
				mode: 'gather',
				stops: [
					{
						hiveName,
						alveolusType: 'freight_bay',
						coord: [a.coord[0], a.coord[1]] as const,
					},
				],
				radius: DEFAULT_GATHER_FREIGHT_RADIUS,
			})
		}
	}
	return out
}

export function getFreightLinePrimaryTile(
	game: Game,
	line: FreightLineDefinition
): Tile | undefined {
	const stop = line.stops[0]
	if (!stop) return undefined
	return game.hex.getTile({ q: stop.coord[0], r: stop.coord[1] })
}

export function createSyntheticFreightLineObject(
	game: Game,
	line: FreightLineDefinition
): SyntheticFreightLineObject {
	const tile = getFreightLinePrimaryTile(game, line)
	const modeLabel = line.mode[0].toUpperCase() + line.mode.slice(1)
	return {
		kind: 'freight-line',
		uid: freightLineUid(line.id),
		title: `${line.name} (${modeLabel})`,
		game,
		line,
		lineId: line.id,
		tile,
		position: tile?.position,
		logs: [],
		hoverObject: tile,
	}
}
