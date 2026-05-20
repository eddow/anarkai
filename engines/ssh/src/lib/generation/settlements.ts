import type { RoadPatches } from 'ssh/board/roads'
import type { NamedZonePatch } from 'ssh/game/game'
import type { AxialCoord } from 'ssh/utils'
import { axial } from 'ssh/utils'
import type { GeneratedTileData } from './board'
import { defaultNameTheme, generateName, type NameThemeId } from './names'

export type SettlementKind = 'village' | 'town' | 'city'

export interface GeneratedSettlement {
	id: string
	name: string
	kind: SettlementKind
	center: AxialCoord
	score: number
	radius: number
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

export interface SettlementRegion {
	type: 'region'
	id: string
	key: string
	name: string
	center: AxialCoord
	radius: number
	settlementId: string
}

export interface SettlementRegionSet {
	type: 'region-set'
	id: string
	key: string
	name: string
	children: SettlementRegionNode[]
}

export type SettlementRegionNode = SettlementRegion | SettlementRegionSet

export interface SettlementRegionSetPlan extends SettlementZonePlan {
	regionSet: SettlementRegionSet
}

type ZoneBucket = 'residential' | 'civic' | 'market' | 'industrial'

const ZONE_DEFINITIONS: Record<
	Exclude<ZoneBucket, 'residential'>,
	Omit<NamedZonePatch, 'coords'>
> = {
	civic: { id: 'civic', name: 'Civic', color: '#6f8fd6' },
	market: { id: 'market', name: 'Market', color: '#d6a34c' },
	industrial: { id: 'industrial', name: 'Industrial', color: '#8f7a66' },
}

const LAND_TERRAINS = new Set(['grass', 'forest', 'sand', 'rocky', 'concrete'])
const INDUSTRIAL_TERRAINS = new Set(['rocky', 'forest'])
const INDUSTRIAL_RING_INNER_OFFSET = 1
const INDUSTRIAL_RING_OUTER_OFFSET = 3

function isLand(tile: GeneratedTileData): boolean {
	return LAND_TERRAINS.has(tile.terrain)
}

function coordTuple(coord: AxialCoord): [number, number] {
	return [coord.q, coord.r]
}

function tileKey(coord: AxialCoord): string {
	return axial.key(coord)
}

function isRiverConflictTile(tile: GeneratedTileData): boolean {
	const hydrology = tile.hydrology
	return (
		!!hydrology?.isChannel ||
		(hydrology?.bankInfluence ?? 0) > 0 ||
		Object.keys(hydrology?.edges ?? {}).length > 0
	)
}

function isZoneableLandTile(tile: GeneratedTileData): boolean {
	return isLand(tile) && !isRiverConflictTile(tile)
}

export function selectSettlementCityHallPosition(
	settlement: GeneratedSettlement,
	_tileData: readonly GeneratedTileData[]
): AxialCoord {
	return { ...settlement.center }
}

function chooseSettlementCoreZoneForTile(
	tile: GeneratedTileData,
	settlement: GeneratedSettlement,
	distance: number
): ZoneBucket | undefined {
	if (!isZoneableLandTile(tile)) return undefined
	if (distance === 0) return 'civic'
	if (distance === 1 && settlement.kind !== 'village') return 'market'
	if (distance >= settlement.radius) return undefined
	return 'residential'
}

function chooseIndustrialZoneForTile(
	tile: GeneratedTileData,
	settlement: GeneratedSettlement,
	distance: number
): ZoneBucket | undefined {
	if (!isZoneableLandTile(tile)) return undefined
	if (distance < settlement.radius + INDUSTRIAL_RING_INNER_OFFSET) return undefined
	if (distance > settlement.radius + INDUSTRIAL_RING_OUTER_OFFSET) return undefined
	return tile.deposit || INDUSTRIAL_TERRAINS.has(tile.terrain) ? 'industrial' : undefined
}

export async function generateZonePlanForSettlements(
	tileData: readonly GeneratedTileData[],
	settlements: GeneratedSettlement[],
	seed: number,
	coords: Int32Array,
	terrainKinds: Uint8Array,
	hasRiver: Uint8Array
): Promise<SettlementZonePlan> {
	const tiles = new Map(tileData.map((tile) => [tileKey(tile.coord), tile]))

	const assigned = new Map<string, ZoneBucket>()
	const priority: Record<ZoneBucket, number> = {
		civic: 5,
		market: 4,
		industrial: 3,
		residential: 2,
	}

	for (const settlement of settlements) {
		for (const coord of axial.allTiles(settlement.center, settlement.radius)) {
			const tile = tiles.get(tileKey(coord))
			if (!tile) continue
			const distance = axial.distance(settlement.center, coord)
			const zone = chooseSettlementCoreZoneForTile(tile, settlement, distance)
			if (!zone) continue
			const key = tileKey(coord)
			const current = assigned.get(key)
			if (!current || priority[zone] > priority[current]) assigned.set(key, zone)
		}
	}

	for (const settlement of settlements) {
		const outerRadius = settlement.radius + INDUSTRIAL_RING_OUTER_OFFSET
		for (const coord of axial.allTiles(settlement.center, outerRadius)) {
			const tile = tiles.get(tileKey(coord))
			if (!tile) continue
			const distance = axial.distance(settlement.center, coord)
			const zone = chooseIndustrialZoneForTile(tile, settlement, distance)
			if (!zone) continue
			const key = tileKey(coord)
			if (assigned.has(key)) continue
			assigned.set(key, zone)
		}
	}

	// Build settlement coords for WASM
	const settlementCoords = new Int32Array(settlements.length * 2)
	for (let i = 0; i < settlements.length; i++) {
		settlementCoords[i * 2] = settlements[i]!.center.q
		settlementCoords[i * 2 + 1] = settlements[i]!.center.r
	}

	// Call WASM for road generation
	const { wasm_generate_settlement_roads } = await import('anarkai-core')
	const packed = wasm_generate_settlement_roads(
		seed,
		coords,
		terrainKinds,
		hasRiver,
		settlementCoords
	)

	// Parse: doubled borders → midpoint format
	const roadSet = new Set<string>()
	for (let i = 0; i < packed.length; i += 2) {
		const dq = packed[i]!
		const dr = packed[i + 1]!
		roadSet.add(`${dq / 2},${dr / 2}`)
	}

	// Remove zones from road tiles (tiles adjacent to road borders)
	// For each road border, the two adjacent tiles are at floor/ceil coordinates
	const roadTileKeys = new Set<string>()
	for (const borderKey of roadSet) {
		const [bq, br] = borderKey.split(',').map(Number)
		const floorKey = `${Math.floor(bq)},${Math.floor(br)}`
		const ceilKey = `${Math.ceil(bq)},${Math.ceil(br)}`
		roadTileKeys.add(floorKey)
		roadTileKeys.add(ceilKey)
	}
	for (const key of roadTileKeys) assigned.delete(key)

	for (const settlement of settlements) {
		const cityHall = selectSettlementCityHallPosition(settlement, tileData)
		const cityHallTile = tiles.get(tileKey(cityHall))
		if (!cityHallTile) continue
		assigned.set(tileKey(cityHall), 'civic')
	}

	const zoneCoords: Record<ZoneBucket, Array<[number, number]>> = {
		residential: [],
		civic: [],
		market: [],
		industrial: [],
	}
	for (const [key, zone] of assigned) zoneCoords[zone].push(coordTuple(axial.coord(key)))
	for (const coords of Object.values(zoneCoords)) coords.sort((a, b) => a[0] - b[0] || a[1] - b[1])

	return {
		settlements,
		zones: {
			harvest: [],
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

export async function generateSettlementRegionSetPlan(
	tileData: readonly GeneratedTileData[],
	settlements: GeneratedSettlement[],
	regionSetKey: string,
	seed: number,
	coords: Int32Array,
	terrainKinds: Uint8Array,
	hasRiver: Uint8Array,
	nameTheme: NameThemeId = defaultNameTheme
): Promise<SettlementRegionSetPlan> {
	const plan = await generateZonePlanForSettlements(
		tileData,
		settlements,
		seed,
		coords,
		terrainKinds,
		hasRiver
	)
	const children: SettlementRegion[] = plan.settlements.map((settlement) => ({
		type: 'region',
		id: `region-${settlement.id}`,
		key: `${regionSetKey}:${settlement.center.q},${settlement.center.r}`,
		name: generateName({
			seed,
			theme: nameTheme,
			kind: 'region',
			key: `${regionSetKey}:${settlement.id}`,
			level: settlement.kind,
		}),
		center: { ...settlement.center },
		radius: settlement.radius,
		settlementId: settlement.id,
	}))
	return {
		...plan,
		regionSet: {
			type: 'region-set',
			id: `region-set-${regionSetKey.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
			key: regionSetKey,
			name: generateName({
				seed,
				theme: nameTheme,
				kind: 'regionSet',
				key: regionSetKey,
			}),
			children,
		},
	}
}
