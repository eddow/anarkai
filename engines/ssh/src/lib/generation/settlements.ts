import { settlementZones } from 'engine-rules'
import type { RoadPatches } from 'ssh/board/roads'
import type { NamedZonePatch } from 'ssh/game/game'
import type { AxialCoord } from 'ssh/utils'
import { axial, hexSides } from 'ssh/utils'
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
		commercial: Array<[number, number]>
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

type ZoneBucket = 'residential' | 'commercial' | 'civic' | 'industrial'

const ZONE_DEFINITIONS: Record<
	Exclude<ZoneBucket, 'residential' | 'commercial'>,
	Omit<NamedZonePatch, 'coords'>
> = {
	civic: { id: 'civic', name: 'Civic', color: '#6f8fd6' },
	industrial: { id: 'industrial', name: 'Industrial', color: '#8f7a66' },
}

const LAND_TERRAINS = new Set(['grass', 'forest', 'sand', 'rocky', 'concrete'])
const INDUSTRIAL_TERRAINS = new Set(['rocky', 'forest'])
const INDUSTRIAL_RING_INNER_OFFSET = 1
const INDUSTRIAL_RING_OUTER_OFFSET = 3
const FALLBACK_LOCAL_STREET_DIRECTIONS = [0, 2, 4] as const

function isLand(tile: GeneratedTileData): boolean {
	return LAND_TERRAINS.has(tile.terrain)
}

function coordTuple(coord: AxialCoord): [number, number] {
	return [coord.q, coord.r]
}

function tileKey(coord: AxialCoord): string {
	return axial.key(coord)
}

function doubledBorderKey(a: AxialCoord, b: AxialCoord): string {
	return `${a.q + b.q},${a.r + b.r}`
}

function coordFromDoubledBorderKey(key: string): [number, number] {
	const [q, r] = key.split(',').map(Number)
	return [q! / 2, r! / 2]
}

function sortedCoordTuples(coords: Array<[number, number]>): Array<[number, number]> {
	return coords.sort((a, b) => a[0] - b[0] || a[1] - b[1])
}

function isLocalStreetSpokeCoord(settlement: GeneratedSettlement, coord: AxialCoord): boolean {
	if (coord.q === settlement.center.q && coord.r === settlement.center.r) return true
	for (const side of hexSides) {
		for (let step = 1; step <= settlement.radius + INDUSTRIAL_RING_OUTER_OFFSET; step++) {
			if (
				coord.q === settlement.center.q + side.q * step &&
				coord.r === settlement.center.r + side.r * step
			) {
				return true
			}
		}
	}
	return false
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

function directionBetween(from: AxialCoord, to: AxialCoord): number | undefined {
	const dq = to.q - from.q
	const dr = to.r - from.r
	const index = hexSides.findIndex((side) => side.q === dq && side.r === dr)
	return index >= 0 ? index : undefined
}

function isRiverEdgeBorder(
	from: AxialCoord,
	to: AxialCoord,
	tiles: ReadonlyMap<string, GeneratedTileData>
): boolean {
	const fromTile = tiles.get(tileKey(from))
	const toTile = tiles.get(tileKey(to))
	const fromDirection = directionBetween(from, to)
	if (
		fromTile &&
		fromDirection !== undefined &&
		fromTile.hydrology?.edges?.[fromDirection as keyof typeof fromTile.hydrology.edges]
	) {
		return true
	}
	const toDirection = directionBetween(to, from)
	return !!(
		toTile &&
		toDirection !== undefined &&
		toTile.hydrology?.edges?.[toDirection as keyof typeof toTile.hydrology.edges]
	)
}

function collectRiverEdgeBorderKeys(tileData: readonly GeneratedTileData[]): Set<string> {
	const tiles = new Map(tileData.map((tile) => [tileKey(tile.coord), tile]))
	const out = new Set<string>()
	for (const tile of tileData) {
		const edges = tile.hydrology?.edges
		if (!edges) continue
		for (const directionText of Object.keys(edges)) {
			const direction = Number(directionText)
			const side = hexSides[direction]
			if (!side || !edges[direction as keyof typeof edges]) continue
			const neighbor = { q: tile.coord.q + side.q, r: tile.coord.r + side.r }
			if (!tiles.has(tileKey(neighbor))) continue
			out.add(doubledBorderKey(tile.coord, neighbor))
		}
	}
	return out
}

function packDoubledBorderKeys(keys: Iterable<string>): Int32Array {
	const sorted = [...keys].sort((a, b) => {
		const [aq, ar] = a.split(',').map(Number)
		const [bq, br] = b.split(',').map(Number)
		return aq! - bq! || ar! - br!
	})
	const packed = new Int32Array(sorted.length * 2)
	for (let i = 0; i < sorted.length; i++) {
		const [q, r] = sorted[i]!.split(',').map(Number)
		packed[i * 2] = q!
		packed[i * 2 + 1] = r!
	}
	return packed
}

export function selectSettlementCityHallPosition(
	settlement: GeneratedSettlement,
	tileData: readonly GeneratedTileData[]
): AxialCoord {
	const zoneable = tileData.filter((tile) => isZoneableLandTile(tile))
	const nearby = zoneable.filter(
		(tile) => axial.distance(settlement.center, tile.coord) <= settlement.radius
	)
	const candidates = (nearby.length > 0 ? nearby : zoneable).sort((a, b) => {
		const byStreet =
			Number(isLocalStreetSpokeCoord(settlement, a.coord)) -
			Number(isLocalStreetSpokeCoord(settlement, b.coord))
		if (byStreet !== 0) return byStreet
		const byDistance =
			axial.distance(settlement.center, a.coord) - axial.distance(settlement.center, b.coord)
		return byDistance || a.coord.q - b.coord.q || a.coord.r - b.coord.r
	})
	const first = candidates[0]
	if (first) return { ...first.coord }
	return { ...settlement.center }
}

function isIndustrialCandidate(tile: GeneratedTileData, settlement: GeneratedSettlement): boolean {
	const distance = axial.distance(settlement.center, tile.coord)
	if (distance < settlement.radius + INDUSTRIAL_RING_INNER_OFFSET) return false
	if (distance > settlement.radius + INDUSTRIAL_RING_OUTER_OFFSET) return false
	return !!tile.deposit || INDUSTRIAL_TERRAINS.has(tile.terrain)
}

function isResidentialFringeCandidate(
	tile: GeneratedTileData,
	settlement: GeneratedSettlement
): boolean {
	const distance = axial.distance(settlement.center, tile.coord)
	const mix = settlementZones[settlement.kind]
	if (distance <= settlement.radius) return true
	if (distance > settlement.radius + mix.fringeResidentialRings) return false
	return !tile.deposit && !INDUSTRIAL_TERRAINS.has(tile.terrain)
}

function roadAdjacent(coord: AxialCoord, roadKeys: ReadonlySet<string>): boolean {
	return hexSides.some((side) => {
		const neighbor = { q: coord.q + side.q, r: coord.r + side.r }
		return roadKeys.has(doubledBorderKey(coord, neighbor))
	})
}

function isRoadCarrierTile(coord: AxialCoord, roadKeys: ReadonlySet<string>): boolean {
	return roadAdjacent(coord, roadKeys)
}

function hasNeighboringRoadCarrier(coord: AxialCoord, roadKeys: ReadonlySet<string>): boolean {
	return hexSides.some((side) => {
		const neighbor = { q: coord.q + side.q, r: coord.r + side.r }
		return isRoadCarrierTile(neighbor, roadKeys)
	})
}

function hasRoadAccessBeside(coord: AxialCoord, roadKeys: ReadonlySet<string>): boolean {
	return !isRoadCarrierTile(coord, roadKeys) && hasNeighboringRoadCarrier(coord, roadKeys)
}

function roadDegree(coord: AxialCoord, roadKeys: ReadonlySet<string>): number {
	return hexSides.filter((side) => {
		const neighbor = { q: coord.q + side.q, r: coord.r + side.r }
		return roadKeys.has(doubledBorderKey(coord, neighbor))
	}).length
}

function hasAdjacentAsphalt(coord: AxialCoord, asphaltKeys: ReadonlySet<string>): boolean {
	return hexSides.some((side) => {
		const neighbor = { q: coord.q + side.q, r: coord.r + side.r }
		return isRoadCarrierTile(neighbor, asphaltKeys)
	})
}

function canUseLocalStreetBorder(args: {
	from: AxialCoord
	to: AxialCoord
	tiles: ReadonlyMap<string, GeneratedTileData>
	riverEdgeKeys: ReadonlySet<string>
}): boolean {
	const fromTile = args.tiles.get(tileKey(args.from))
	const toTile = args.tiles.get(tileKey(args.to))
	if (!fromTile || !toTile) return false
	if (!isLand(fromTile) || !isLand(toTile)) return false
	if (args.riverEdgeKeys.has(doubledBorderKey(args.from, args.to))) return false
	if (isRiverEdgeBorder(args.from, args.to, args.tiles)) return false
	return true
}

function roadCarrierCoords(
	tiles: ReadonlyMap<string, GeneratedTileData>,
	roadKeys: ReadonlySet<string>
): AxialCoord[] {
	return [...tiles.values()]
		.map((tile) => tile.coord)
		.filter((coord) => isRoadCarrierTile(coord, roadKeys))
}

function connectedRoadCarriers(args: {
	starts: readonly AxialCoord[]
	tiles: ReadonlyMap<string, GeneratedTileData>
	roadKeys: ReadonlySet<string>
}): Set<string> {
	const connected = new Set<string>()
	const queue = args.starts.filter(
		(coord) => args.tiles.has(tileKey(coord)) && isRoadCarrierTile(coord, args.roadKeys)
	)
	for (const start of queue) connected.add(tileKey(start))
	for (let i = 0; i < queue.length; i++) {
		const current = queue[i]!
		for (const side of hexSides) {
			const next = { q: current.q + side.q, r: current.r + side.r }
			const nextKey = tileKey(next)
			if (connected.has(nextKey)) continue
			if (!args.tiles.has(nextKey)) continue
			if (!args.roadKeys.has(doubledBorderKey(current, next))) continue
			connected.add(nextKey)
			queue.push(next)
		}
	}
	return connected
}

function allRoadCarriersConnectedTo(args: {
	starts: readonly AxialCoord[]
	tiles: ReadonlyMap<string, GeneratedTileData>
	roadKeys: ReadonlySet<string>
}): boolean {
	const carriers = roadCarrierCoords(args.tiles, args.roadKeys)
	if (carriers.length === 0) return true
	const connected = connectedRoadCarriers(args)
	return carriers.every((coord) => connected.has(tileKey(coord)))
}

function wouldCreateSolidRoadBlock(args: {
	from: AxialCoord
	to: AxialCoord
	tiles: ReadonlyMap<string, GeneratedTileData>
	roadKeys: ReadonlySet<string>
}): boolean {
	const nextRoadKeys = new Set(args.roadKeys)
	nextRoadKeys.add(doubledBorderKey(args.from, args.to))
	for (const origin of args.tiles.values()) {
		for (let direction = 0; direction < hexSides.length; direction++) {
			const a = hexSides[direction]!
			const b = hexSides[(direction + 1) % hexSides.length]!
			const corners = [
				origin.coord,
				{ q: origin.coord.q + a.q, r: origin.coord.r + a.r },
				{ q: origin.coord.q + b.q, r: origin.coord.r + b.r },
				{ q: origin.coord.q + a.q + b.q, r: origin.coord.r + a.r + b.r },
			]
			if (!corners.every((coord) => args.tiles.has(tileKey(coord)))) continue
			if (corners.every((coord) => isRoadCarrierTile(coord, nextRoadKeys))) return true
		}
	}
	return false
}

function tryAddLocalStreetBorder(args: {
	from: AxialCoord
	to: AxialCoord
	tiles: ReadonlyMap<string, GeneratedTileData>
	asphaltKeys: ReadonlySet<string>
	pathKeys: Set<string>
	riverEdgeKeys: ReadonlySet<string>
}): boolean {
	const key = doubledBorderKey(args.from, args.to)
	if (args.asphaltKeys.has(key) || args.pathKeys.has(key)) return true
	if (
		!canUseLocalStreetBorder({
			from: args.from,
			to: args.to,
			tiles: args.tiles,
			riverEdgeKeys: args.riverEdgeKeys,
		})
	) {
		return false
	}
	const allRoadKeys = new Set([...args.asphaltKeys, ...args.pathKeys])
	if (
		wouldCreateSolidRoadBlock({
			from: args.from,
			to: args.to,
			tiles: args.tiles,
			roadKeys: allRoadKeys,
		})
	) {
		return false
	}
	args.pathKeys.add(key)
	return true
}

function shortestRoadablePath(args: {
	from: AxialCoord
	goals: ReadonlySet<string>
	tiles: ReadonlyMap<string, GeneratedTileData>
	riverEdgeKeys: ReadonlySet<string>
	blocked?: AxialCoord
	maxDistance: number
}): AxialCoord[] | undefined {
	const blockedKey = args.blocked ? tileKey(args.blocked) : undefined
	const startKey = tileKey(args.from)
	if (blockedKey === startKey) return undefined
	const queue = [args.from]
	const seen = new Set([startKey])
	const parent = new Map<string, string>()
	for (let i = 0; i < queue.length; i++) {
		const current = queue[i]!
		const currentKey = tileKey(current)
		if (args.goals.has(currentKey)) {
			const path = [current]
			let cursor = currentKey
			while (parent.has(cursor)) {
				const previous = parent.get(cursor)!
				path.push(axial.coord(previous))
				cursor = previous
			}
			path.reverse()
			return path
		}
		if (axial.distance(args.from, current) >= args.maxDistance) continue
		for (const side of hexSides) {
			const next = { q: current.q + side.q, r: current.r + side.r }
			const nextKey = tileKey(next)
			if (seen.has(nextKey) || nextKey === blockedKey) continue
			if (
				!canUseLocalStreetBorder({
					from: current,
					to: next,
					tiles: args.tiles,
					riverEdgeKeys: args.riverEdgeKeys,
				})
			) {
				continue
			}
			seen.add(nextKey)
			parent.set(nextKey, currentKey)
			queue.push(next)
		}
	}
	return undefined
}

function connectLocalStreetToNetwork(args: {
	start: AxialCoord
	networkStarts: readonly AxialCoord[]
	tiles: ReadonlyMap<string, GeneratedTileData>
	asphaltKeys: ReadonlySet<string>
	pathKeys: Set<string>
	riverEdgeKeys: ReadonlySet<string>
	blocked?: AxialCoord
	maxDistance: number
}): boolean {
	const allRoadKeys = new Set([...args.asphaltKeys, ...args.pathKeys])
	const connected = connectedRoadCarriers({
		starts: args.networkStarts,
		tiles: args.tiles,
		roadKeys: allRoadKeys,
	})
	if (connected.has(tileKey(args.start))) return true
	const path = shortestRoadablePath({
		from: args.start,
		goals: connected.size > 0 ? connected : new Set(args.networkStarts.map(tileKey)),
		tiles: args.tiles,
		riverEdgeKeys: args.riverEdgeKeys,
		blocked: args.blocked,
		maxDistance: args.maxDistance,
	})
	if (!path || path.length < 2) return false
	for (let i = 1; i < path.length; i++) {
		if (
			!tryAddLocalStreetBorder({
				from: path[i - 1]!,
				to: path[i]!,
				tiles: args.tiles,
				asphaltKeys: args.asphaltKeys,
				pathKeys: args.pathKeys,
				riverEdgeKeys: args.riverEdgeKeys,
			})
		) {
			return false
		}
	}
	return allRoadCarriersConnectedTo({
		starts: args.networkStarts,
		tiles: args.tiles,
		roadKeys: new Set([...args.asphaltKeys, ...args.pathKeys]),
	})
}

function localStreetDirections(
	settlement: GeneratedSettlement,
	asphaltKeys: ReadonlySet<string>
): number[] {
	const asphaltDirections = hexSides
		.map((side, direction) => ({
			direction,
			key: doubledBorderKey(settlement.center, {
				q: settlement.center.q + side.q,
				r: settlement.center.r + side.r,
			}),
		}))
		.filter(({ key }) => asphaltKeys.has(key))
		.map(({ direction }) => direction)
	if (asphaltDirections.length === 0) return [...FALLBACK_LOCAL_STREET_DIRECTIONS]
	const blocked = new Set(
		asphaltDirections.flatMap((direction) => [direction, (direction + 3) % hexSides.length])
	)
	return hexSides.map((_, direction) => direction).filter((direction) => !blocked.has(direction))
}

function generateLocalStreetKeys(args: {
	tileData: readonly GeneratedTileData[]
	settlements: readonly GeneratedSettlement[]
	asphaltKeys: ReadonlySet<string>
	riverEdgeKeys: ReadonlySet<string>
}): Set<string> {
	const tiles = new Map(args.tileData.map((tile) => [tileKey(tile.coord), tile]))
	const pathKeys = new Set<string>()
	for (const settlement of args.settlements) {
		const cityHall = selectSettlementCityHallPosition(settlement, args.tileData)
		const outerRadius = settlement.radius + INDUSTRIAL_RING_OUTER_OFFSET
		const networkStarts = [settlement.center]
		for (const direction of localStreetDirections(settlement, args.asphaltKeys)) {
			const side = hexSides[direction]!
			let previous = { ...settlement.center }
			for (let step = 1; step <= outerRadius; step++) {
				const current = {
					q: settlement.center.q + side.q * step,
					r: settlement.center.r + side.r * step,
				}
				if (!tiles.has(tileKey(current))) break
				if (
					!tryAddLocalStreetBorder({
						from: previous,
						to: current,
						tiles,
						asphaltKeys: args.asphaltKeys,
						pathKeys,
						riverEdgeKeys: args.riverEdgeKeys,
					})
				)
					break
				previous = current
			}
		}
		const serviceTiles = hexSides
			.map((side) => ({ q: cityHall.q + side.q, r: cityHall.r + side.r }))
			.filter((service) => {
				const serviceTile = tiles.get(tileKey(service))
				return !!serviceTile && isLand(serviceTile)
			})
			.sort((a, b) => {
				const roads = new Set([...args.asphaltKeys, ...pathKeys])
				const byExistingAccess =
					Number(!isRoadCarrierTile(a, roads)) - Number(!isRoadCarrierTile(b, roads))
				return (
					byExistingAccess ||
					axial.distance(a, settlement.center) - axial.distance(b, settlement.center) ||
					a.q - b.q ||
					a.r - b.r
				)
			})
		for (const service of serviceTiles) {
			if (
				connectLocalStreetToNetwork({
					start: service,
					networkStarts,
					tiles,
					asphaltKeys: args.asphaltKeys,
					pathKeys,
					riverEdgeKeys: args.riverEdgeKeys,
					blocked: cityHall,
					maxDistance: outerRadius + 2,
				})
			)
				break
		}
	}
	return pathKeys
}

interface ParcelCandidate {
	readonly settlement: GeneratedSettlement
	readonly tile: GeneratedTileData
	readonly distance: number
	readonly industrialEligible: boolean
	readonly residentialEligible: boolean
	readonly commercialScore: number
	readonly industrialScore: number
}

function assignZone(
	assigned: Map<string, ZoneBucket>,
	coord: AxialCoord,
	zone: ZoneBucket,
	priority: Record<ZoneBucket, number>
): void {
	const key = tileKey(coord)
	const current = assigned.get(key)
	if (!current || priority[zone] > priority[current]) assigned.set(key, zone)
}

export async function generateZonePlanForSettlements(
	tileData: readonly GeneratedTileData[],
	settlements: GeneratedSettlement[],
	seed: number,
	coords: Int32Array,
	terrainKinds: Uint8Array,
	_hasRiver: Uint8Array
): Promise<SettlementZonePlan> {
	const tiles = new Map(tileData.map((tile) => [tileKey(tile.coord), tile]))
	const riverEdgeKeys = collectRiverEdgeBorderKeys(tileData)
	const packedRiverEdges = packDoubledBorderKeys(riverEdgeKeys)

	const assigned = new Map<string, ZoneBucket>()
	const priority: Record<ZoneBucket, number> = {
		civic: 5,
		commercial: 4,
		industrial: 3,
		residential: 2,
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
		packedRiverEdges,
		settlementCoords
	)

	// Parse: doubled borders → midpoint format
	const asphaltKeys = new Set<string>()
	for (let i = 0; i < packed.length; i += 2) {
		const dq = packed[i]!
		const dr = packed[i + 1]!
		asphaltKeys.add(`${dq},${dr}`)
	}
	const pathKeys = generateLocalStreetKeys({
		tileData,
		settlements,
		asphaltKeys,
		riverEdgeKeys,
	})
	const allRoadKeys = new Set([...asphaltKeys, ...pathKeys])

	const occupiedCandidates = new Map<string, ParcelCandidate>()
	for (const settlement of settlements) {
		const cityHall = selectSettlementCityHallPosition(settlement, tileData)
		const cityHallTile = tiles.get(tileKey(cityHall))
		if (
			cityHallTile &&
			isZoneableLandTile(cityHallTile) &&
			hasRoadAccessBeside(cityHall, allRoadKeys)
		) {
			assignZone(assigned, cityHall, 'civic', priority)
		}

		const outerRadius = settlement.radius + INDUSTRIAL_RING_OUTER_OFFSET
		for (const coord of axial.allTiles(settlement.center, outerRadius)) {
			const tile = tiles.get(tileKey(coord))
			if (!tile || !isZoneableLandTile(tile)) continue
			if (!hasRoadAccessBeside(coord, allRoadKeys)) continue
			const distance = axial.distance(settlement.center, coord)
			const industrialEligible = isIndustrialCandidate(tile, settlement)
			const residentialEligible = isResidentialFringeCandidate(tile, settlement)
			if (!residentialEligible && !industrialEligible) continue
			const key = tileKey(coord)
			const candidate: ParcelCandidate = {
				settlement,
				tile,
				distance,
				industrialEligible,
				residentialEligible,
				commercialScore:
					(settlement.radius + 1 - Math.min(distance, settlement.radius)) * 3 +
					(hasAdjacentAsphalt(coord, asphaltKeys) ? 5 : 0) +
					roadDegree(coord, allRoadKeys),
				industrialScore:
					(tile.deposit ? 8 : 0) +
					(INDUSTRIAL_TERRAINS.has(tile.terrain) ? 4 : 0) +
					Math.max(0, distance - settlement.radius + 1),
			}
			const current = occupiedCandidates.get(key)
			if (!current || distance < current.distance) occupiedCandidates.set(key, candidate)
		}
	}

	for (const settlement of settlements) {
		const candidates = [...occupiedCandidates.values()].filter(
			(candidate) => candidate.settlement.id === settlement.id
		)
		const candidateKeys = new Set(candidates.map((candidate) => tileKey(candidate.tile.coord)))
		const mix = settlementZones[settlement.kind]
		const total = candidates.length
		const occupiedTarget = Math.max(
			Math.min(candidates.length, 1),
			Math.ceil(total * mix.parcelDensity)
		)
		const industrialTarget = Math.ceil(total * mix.target.industrial)
		const commercialTarget = Math.max(1, Math.ceil(total * mix.target.commercial))
		const remainingSlots = () =>
			Math.max(
				0,
				occupiedTarget - [...assigned.keys()].filter((key) => candidateKeys.has(key)).length
			)

		for (const candidate of candidates
			.filter((candidate) => candidate.industrialEligible)
			.sort(
				(a, b) =>
					b.industrialScore - a.industrialScore ||
					b.distance - a.distance ||
					a.tile.coord.q - b.tile.coord.q ||
					a.tile.coord.r - b.tile.coord.r
			)
			.slice(0, industrialTarget)) {
			if (remainingSlots() <= 0) break
			if (assigned.has(tileKey(candidate.tile.coord))) continue
			assignZone(assigned, candidate.tile.coord, 'industrial', priority)
		}

		for (const candidate of candidates
			.filter((candidate) => candidate.residentialEligible)
			.sort(
				(a, b) =>
					b.commercialScore - a.commercialScore ||
					a.distance - b.distance ||
					a.tile.coord.q - b.tile.coord.q ||
					a.tile.coord.r - b.tile.coord.r
			)
			.slice(0, commercialTarget)) {
			if (remainingSlots() <= 0) break
			if (assigned.has(tileKey(candidate.tile.coord))) continue
			assignZone(assigned, candidate.tile.coord, 'commercial', priority)
		}

		for (const candidate of candidates
			.filter((candidate) => candidate.residentialEligible)
			.sort(
				(a, b) =>
					a.distance - b.distance ||
					a.tile.coord.q - b.tile.coord.q ||
					a.tile.coord.r - b.tile.coord.r
			)) {
			if (remainingSlots() <= 0) break
			if (assigned.has(tileKey(candidate.tile.coord))) continue
			assignZone(assigned, candidate.tile.coord, 'residential', priority)
		}
	}

	const zoneCoords: Record<ZoneBucket, Array<[number, number]>> = {
		residential: [],
		commercial: [],
		civic: [],
		industrial: [],
	}
	for (const [key, zone] of assigned) zoneCoords[zone].push(coordTuple(axial.coord(key)))
	for (const coords of Object.values(zoneCoords)) sortedCoordTuples(coords)

	return {
		settlements,
		zones: {
			harvest: [],
			residential: zoneCoords.residential,
			commercial: zoneCoords.commercial,
			named: Object.entries(ZONE_DEFINITIONS).map(([zone, definition]) => ({
				...definition,
				coords: zoneCoords[zone as keyof typeof ZONE_DEFINITIONS],
			})),
		},
		roads: {
			asphalt: sortedCoordTuples([...asphaltKeys].map(coordFromDoubledBorderKey)),
			path: sortedCoordTuples([...pathKeys].map(coordFromDoubledBorderKey)),
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
