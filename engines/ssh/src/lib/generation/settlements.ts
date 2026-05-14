import { type RoadPatches, straightRoadCoords } from 'ssh/board/roads'
import type { NamedZonePatch } from 'ssh/game/game'
import type { AxialCoord } from 'ssh/utils'
import { axial } from 'ssh/utils'
import type { GeneratedTileData } from './board'

export type SettlementKind = 'village' | 'town' | 'city'

export interface SettlementCandidate {
	coord: AxialCoord
	score: number
}

export interface GeneratedSettlement {
	id: string
	name: string
	kind: SettlementKind
	center: AxialCoord
	score: number
	radius: number
}

export interface SettlementGenerationOptions {
	seed: number
	maxSettlements?: number
	minSpacing?: number
}

export interface SettlementZonePlan {
	settlements: GeneratedSettlement[]
	zones: {
		harvest: Array<[number, number]>
		residential: Array<[number, number]>
		named: NamedZonePatch[]
	}
	roads: RoadPatches
}

type ZoneBucket = 'residential' | 'harvest' | 'civic' | 'market' | 'industrial'

const ZONE_DEFINITIONS: Record<
	Exclude<ZoneBucket, 'residential' | 'harvest'>,
	Omit<NamedZonePatch, 'coords'>
> = {
	civic: { id: 'civic', name: 'Civic', color: '#6f8fd6' },
	market: { id: 'market', name: 'Market', color: '#d6a34c' },
	industrial: { id: 'industrial', name: 'Industrial', color: '#8f7a66' },
}

const LAND_TERRAINS = new Set(['grass', 'forest', 'sand', 'rocky', 'concrete'])
const INDUSTRIAL_TERRAINS = new Set(['rocky', 'forest'])

function hashString(str: string): number {
	let hash = 2166136261
	for (let i = 0; i < str.length; i++) {
		hash ^= str.charCodeAt(i)
		hash = Math.imul(hash, 16777619)
	}
	return hash >>> 0
}

function random01(seed: number, coord: AxialCoord, salt: string): number {
	return hashString(`${seed}:${coord.q},${coord.r}:${salt}`) / 4294967295
}

function coordTuple(coord: AxialCoord): [number, number] {
	return [coord.q, coord.r]
}

function tileKey(coord: AxialCoord): string {
	return axial.key(coord)
}

function isLand(tile: GeneratedTileData | undefined): tile is GeneratedTileData {
	return !!tile && LAND_TERRAINS.has(tile.terrain)
}

function isRiverConflictTile(tile: GeneratedTileData): boolean {
	const hydrology = tile.hydrology
	return (
		!!hydrology?.isChannel ||
		(hydrology?.bankInfluence ?? 0) > 0 ||
		Object.keys(hydrology?.edges ?? {}).length > 0
	)
}

function hasWaterAccess(tile: GeneratedTileData, tiles: Map<string, GeneratedTileData>): boolean {
	if (tile.terrain === 'sand') return true
	for (const neighbor of axial.neighbors(tile.coord)) {
		const neighborTile = tiles.get(tileKey(neighbor))
		if (!neighborTile) continue
		if (neighborTile.terrain === 'water' || isRiverConflictTile(neighborTile)) return true
	}
	return false
}

function scoreSettlementTile(
	tile: GeneratedTileData,
	tiles: Map<string, GeneratedTileData>,
	seed: number
): number {
	if (!isLand(tile)) return Number.NEGATIVE_INFINITY
	if (tile.terrain === 'snow') return Number.NEGATIVE_INFINITY
	if (isRiverConflictTile(tile)) return Number.NEGATIVE_INFINITY

	let score = 0
	if (tile.terrain === 'grass') score += 3
	if (tile.terrain === 'forest') score += 2
	if (tile.terrain === 'sand') score += 1
	if (tile.terrain === 'rocky') score -= 1

	score += Math.max(0, 1 - Math.abs(tile.height) * 2)
	if (hasWaterAccess(tile, tiles)) score += 2.5
	if (tile.deposit) score += 1.5

	let landNeighbors = 0
	let waterNeighbors = 0
	for (const neighbor of axial.neighbors(tile.coord)) {
		const neighborTile = tiles.get(tileKey(neighbor))
		const terrain = neighborTile?.terrain
		if (isLand(neighborTile)) landNeighbors++
		else if (terrain === 'water') waterNeighbors++
	}
	score += landNeighbors * 0.35
	score += Math.min(1.5, waterNeighbors * 0.5)
	score += random01(seed, tile.coord, 'settlement-candidate') * 0.75
	return score
}

function settlementKind(index: number, score: number): SettlementKind {
	if (index === 0 && score >= 7) return 'city'
	if (score >= 6) return 'town'
	return 'village'
}

function settlementRadius(kind: SettlementKind): number {
	if (kind === 'city') return 4
	if (kind === 'town') return 3
	return 2
}

function settlementName(kind: SettlementKind, coord: AxialCoord): string {
	const prefix = kind === 'city' ? 'City' : kind === 'town' ? 'Town' : 'Village'
	return `${prefix} ${coord.q},${coord.r}`
}

function roadBorderCoordsForTrace(trace: readonly AxialCoord[]): Array<[number, number]> {
	const borders: Array<[number, number]> = []
	for (let i = 1; i < trace.length; i++) {
		const a = trace[i - 1]!
		const b = trace[i]!
		borders.push([(a.q + b.q) / 2, (a.r + b.r) / 2])
	}
	return borders
}

function riverDirectionBetween(from: AxialCoord, to: AxialCoord): number | undefined {
	const direction = axial.neighborIndex(axial.linear(to, [-1, from]))
	return typeof direction === 'number' ? direction : undefined
}

function hydrologyHasEdge(tile: GeneratedTileData | undefined, direction: number | undefined): boolean {
	if (!tile || direction === undefined) return false
	return tile.hydrology?.edges?.[direction as keyof typeof tile.hydrology.edges] !== undefined
}

function borderHasRiver(
	from: AxialCoord,
	to: AxialCoord,
	tiles: Map<string, GeneratedTileData>
): boolean {
	const fromTile = tiles.get(tileKey(from))
	const toTile = tiles.get(tileKey(to))
	return (
		hydrologyHasEdge(fromTile, riverDirectionBetween(from, to)) ||
		hydrologyHasEdge(toTile, riverDirectionBetween(to, from))
	)
}

function chooseZoneForTile(
	tile: GeneratedTileData,
	settlement: GeneratedSettlement,
	distance: number
): ZoneBucket | undefined {
	if (!isLand(tile)) return undefined
	if (isRiverConflictTile(tile)) return undefined
	if (distance === 0) return settlement.kind === 'village' ? 'market' : 'civic'
	if (distance === 1 && settlement.kind !== 'village') return 'market'
	if (
		tile.deposit ||
		(distance >= settlement.radius - 1 && INDUSTRIAL_TERRAINS.has(tile.terrain))
	) {
		return 'industrial'
	}
	if (distance >= settlement.radius)
		return tile.terrain === 'grass' || tile.terrain === 'forest' ? 'harvest' : undefined
	return 'residential'
}

export function generateSettlementZonePlan(
	tileData: readonly GeneratedTileData[],
	options: SettlementGenerationOptions
): SettlementZonePlan {
	const tiles = new Map(tileData.map((tile) => [tileKey(tile.coord), tile]))
	const candidates = tileData
		.map((tile) => ({ coord: tile.coord, score: scoreSettlementTile(tile, tiles, options.seed) }))
		.filter((candidate) => Number.isFinite(candidate.score))
		.sort((a, b) => b.score - a.score || a.coord.q - b.coord.q || a.coord.r - b.coord.r)

	const targetCount = Math.max(
		0,
		Math.min(options.maxSettlements ?? 5, Math.floor(tileData.length / 45))
	)
	const minSpacing = options.minSpacing ?? 7
	const settlements: GeneratedSettlement[] = []
	for (const candidate of candidates) {
		if (settlements.length >= targetCount) break
		if (candidate.score < 3.5) break
		if (
			settlements.some(
				(settlement) => axial.distance(settlement.center, candidate.coord) < minSpacing
			)
		) {
			continue
		}
		const kind = settlementKind(settlements.length, candidate.score)
		settlements.push({
			id: `settlement-${settlements.length + 1}`,
			name: settlementName(kind, candidate.coord),
			kind,
			center: { ...candidate.coord },
			score: candidate.score,
			radius: settlementRadius(kind),
		})
	}

	const assigned = new Map<string, ZoneBucket>()
	const priority: Record<ZoneBucket, number> = {
		civic: 5,
		market: 4,
		industrial: 3,
		residential: 2,
		harvest: 1,
	}

	for (const settlement of settlements) {
		for (const coord of axial.allTiles(settlement.center, settlement.radius)) {
			const tile = tiles.get(tileKey(coord))
			if (!tile) continue
			const distance = axial.distance(settlement.center, coord)
			const zone = chooseZoneForTile(tile, settlement, distance)
			if (!zone) continue
			const key = tileKey(coord)
			const current = assigned.get(key)
			if (!current || priority[zone] > priority[current]) assigned.set(key, zone)
		}
	}

	const roadSet = new Set<string>()
	const roadTileKeys = new Set<string>()
	const addRoadTrace = (from: AxialCoord, to: AxialCoord) => {
		const trace = straightRoadCoords(from, to).filter((coord) => tiles.has(tileKey(coord)))
		for (const coord of trace) roadTileKeys.add(tileKey(coord))
		for (let i = 1; i < trace.length; i++) {
			const a = trace[i - 1]!
			const b = trace[i]!
			if (borderHasRiver(a, b, tiles)) continue
			const [q, r] = roadBorderCoordsForTrace([a, b])[0]!
			roadSet.add(`${q},${r}`)
		}
	}
	for (const settlement of settlements) {
		for (const coord of axial.neighbors(settlement.center)) {
			if (tiles.has(tileKey(coord))) addRoadTrace(settlement.center, coord)
		}
	}
	for (let i = 1; i < settlements.length; i++) {
		const settlement = settlements[i]!
		const previous = settlements
			.slice(0, i)
			.sort(
				(a, b) =>
					axial.distance(a.center, settlement.center) - axial.distance(b.center, settlement.center)
			)[0]
		if (previous) addRoadTrace(previous.center, settlement.center)
	}
	for (const key of roadTileKeys) assigned.delete(key)

	const zoneCoords: Record<ZoneBucket, Array<[number, number]>> = {
		residential: [],
		harvest: [],
		civic: [],
		market: [],
		industrial: [],
	}
	for (const [key, zone] of assigned) zoneCoords[zone].push(coordTuple(axial.coord(key)))
	for (const coords of Object.values(zoneCoords)) coords.sort((a, b) => a[0] - b[0] || a[1] - b[1])

	return {
		settlements,
		zones: {
			harvest: zoneCoords.harvest,
			residential: zoneCoords.residential,
			named: Object.entries(ZONE_DEFINITIONS).map(([zone, definition]) => ({
				...definition,
				coords: zoneCoords[zone as keyof typeof ZONE_DEFINITIONS],
			})),
		},
		roads: {
			path: [...roadSet]
				.map((key) => key.split(',').map(Number) as [number, number])
				.sort((a, b) => a[0] - b[0] || a[1] - b[1]),
		},
	}
}
