/**
 * Board generation logic — consumes a TerrainSnapshot from engine-terrain
 * and produces ssh-native GeneratedTileData with deposits and goods.
 */

import {
	boardAmbientGoodsMaxPerType,
	boardDefaultTileWalkTime,
	boardDepositFillDivisor,
	boardDepositFillRandomSpread,
	boardGoodsEquilibriumVariance,
	boardInfiniteHalfLifeEquilibriumMultiplier,
	deposits,
	goods as goodsCatalog,
	terrain as terrainDetails,
} from 'engine-rules'
import {
	type BiomeHint,
	classifyTile,
	DEFAULT_TERRAIN_CONFIG,
	type EdgeField,
	edgeKey,
	type TerrainSnapshot,
	type TileRiverFlow,
} from 'engine-terrain'
import { Deposit } from 'ssh/board/content/unbuilt-land'
import type {
	HydrologyTileRole,
	TerrainHydrologyDirection,
	TerrainHydrologySample,
	TerrainRiverFlowSample,
} from 'ssh/game/terrain-provider'
import type { DepositType, TerrainType } from 'ssh/types'
import type { AxialCoord } from 'ssh/utils'
import { axial, hexSides } from 'ssh/utils'

const HEX_SIDES = hexSides as readonly AxialCoord[]

export interface GeneratedTileData {
	coord: AxialCoord
	terrain: TerrainType
	height: number
	hydrology?: TerrainHydrologySample
	deposit?: GeneratedDepositData
	goods: Record<string, number>
	walkTime: number
}

export interface GeneratedDepositData {
	type: DepositType
	amount: number
}

const biomeToTerrain: Record<BiomeHint, TerrainType> = {
	ocean: 'water',
	lake: 'water',
	'river-bank': 'grass',
	wetland: 'grass',
	sand: 'sand',
	grass: 'grass',
	forest: 'forest',
	rocky: 'rocky',
	snow: 'snow',
}

function resolveTerrainForTile(
	biome: BiomeHint,
	tileField: TerrainSnapshot['tiles'] extends Map<any, infer T> ? T : never
): TerrainType {
	if (biome !== 'river-bank' && biome !== 'wetland') {
		return biomeToTerrain[biome]
	}

	// Hydrology is rendered separately now, so keep the underlying landform terrain
	// instead of flattening river-influenced mountains into grass.
	const baseBiome = classifyTile(tileField, [], DEFAULT_TERRAIN_CONFIG)
	return biomeToTerrain[baseBiome]
}

function directionsFromHydrologyEdges(edges: TerrainHydrologySample['edges']): readonly number[] {
	return Object.keys(edges)
		.map(Number)
		.filter(
			(d) =>
				Number.isInteger(d) &&
				d >= 0 &&
				d <= 5 &&
				edges[d as TerrainHydrologyDirection] !== undefined
		)
		.sort((a, b) => a - b)
}

function maxEdgeWidthFromHydrologyEdges(edges: TerrainHydrologySample['edges']): number {
	let maxW = 0
	for (const e of Object.values(edges)) {
		if (e) maxW = Math.max(maxW, e.width)
	}
	return maxW
}

function terrainTypeAtSnapshotKey(
	snapshot: TerrainSnapshot,
	tileKey: string
): TerrainType | undefined {
	const biome = snapshot.biomes.get(tileKey)
	const tileField = snapshot.tiles.get(tileKey)
	if (biome === undefined || tileField === undefined) return undefined
	return resolveTerrainForTile(biome, tileField)
}

function neighborTerrainAtDirection(
	snapshot: TerrainSnapshot,
	coord: AxialCoord,
	direction: number
): TerrainType | undefined {
	const side = HEX_SIDES[direction]
	if (!side) return undefined
	const nk = axial.key({ q: coord.q + side.q, r: coord.r + side.r })
	return terrainTypeAtSnapshotKey(snapshot, nk)
}

function toTerrainHydrologyDirection(direction: number): TerrainHydrologyDirection {
	if (!Number.isInteger(direction) || direction < 0 || direction > 5) {
		throw new Error(`Invalid hydrology direction: ${direction}`)
	}
	return direction as TerrainHydrologyDirection
}

function inferHydrologyTileRole(
	snapshot: TerrainSnapshot,
	coord: AxialCoord,
	flow: TileRiverFlow,
	edges: TerrainHydrologySample['edges']
): HydrologyTileRole {
	const selfKey = axial.key(coord)
	const selfTerrain = terrainTypeAtSnapshotKey(snapshot, selfKey)
	if (selfTerrain === undefined || selfTerrain === 'water') return 'none'

	const directions = directionsFromHydrologyEdges(edges)
	const maxW = maxEdgeWidthFromHydrologyEdges(edges)
	const neighbor = (d: number) => neighborTerrainAtDirection(snapshot, coord, d)
	const term = flow.pathTerminalKind

	if (directions.length >= 3) {
		const waterArms = directions.filter((d) => neighbor(d) === 'water').length
		if (waterArms >= 2 && maxW >= 4.25) return 'delta'
		return 'junction'
	}

	if (directions.length === 2) {
		const waterDirs = directions.filter((d) => neighbor(d) === 'water')
		if (waterDirs.length === 1) return 'mouth'
		return 'through'
	}

	if (term === 'inland') {
		if (directions.length === 1) return 'inlandTerminal'
		if (
			directions.length === 0 &&
			flow.upstreamDirections.length > 0 &&
			flow.downstreamDirections.length === 0
		) {
			return 'inlandTerminal'
		}
	}
	if (term === 'coast' || term === 'sea') {
		if (directions.length === 1) return 'mouth'
	}

	if (directions.length === 1) {
		const d0 = directions[0]!
		if (neighbor(d0) === 'water') return 'mouth'
		const downstreamToWater = flow.downstreamDirections.some(
			(d) => neighborTerrainAtDirection(snapshot, coord, Number(d)) === 'water'
		)
		if (downstreamToWater) return 'mouth'
		if (flow.upstreamDirections.length > 0 && flow.downstreamDirections.length > 0) return 'through'
		if (flow.upstreamDirections.length > 0 && flow.downstreamDirections.length === 0) {
			return 'inlandTerminal'
		}
		if (flow.upstreamDirections.length === 0 && flow.downstreamDirections.length > 0) {
			return 'source'
		}
		return 'none'
	}

	return 'none'
}

function projectRiverFlowSample(
	snapshot: TerrainSnapshot,
	coord: AxialCoord,
	flow: TileRiverFlow,
	edges: TerrainHydrologySample['edges']
): TerrainRiverFlowSample {
	const tileRole = inferHydrologyTileRole(snapshot, coord, flow, edges)
	const base: TerrainRiverFlowSample = {
		upstreamDirections: flow.upstreamDirections.map(toTerrainHydrologyDirection),
		downstreamDirections: flow.downstreamDirections.map(toTerrainHydrologyDirection),
		rankFromSource: flow.rankFromSource,
		rankToSea: flow.rankToSea,
		tileRole,
	}
	return flow.pathTerminalKind !== undefined
		? { ...base, pathTerminalKind: flow.pathTerminalKind }
		: base
}

function resolveHydrologyForTile(
	snapshot: TerrainSnapshot,
	key: string,
	coord: AxialCoord
): TerrainHydrologySample | undefined {
	const bankInfluence = snapshot.hydrology.banks.get(key)
	const channelInfluence = snapshot.hydrology.channelInfluence.get(key)
	const isChannel = snapshot.hydrology.channels.has(key)
	const edges: TerrainHydrologySample['edges'] = {}

	for (const neighbor of axial.neighbors(coord)) {
		const direction = axial.neighborIndex(axial.linear(neighbor, [-1, coord]))
		if (direction === undefined || direction === null) continue
		const edge = snapshot.edges.get(edgeKey(key, axial.key(neighbor)))
		if (!edge) continue
		edges[direction] = toHydrologyEdge(edge)
	}

	if (
		!isChannel &&
		bankInfluence === undefined &&
		channelInfluence === undefined &&
		Object.keys(edges).length === 0
	) {
		return undefined
	}

	const rawFlow = snapshot.hydrology.riverFlow?.get(key)
	const riverFlow =
		rawFlow !== undefined ? projectRiverFlowSample(snapshot, coord, rawFlow, edges) : undefined

	return {
		isChannel,
		bankInfluence,
		channelInfluence,
		edges,
		...(riverFlow ? { riverFlow } : {}),
	}
}

function toHydrologyEdge(edge: EdgeField): NonNullable<TerrainHydrologySample['edges'][0]> {
	return {
		flux: edge.flux,
		width: edge.width,
		depth: edge.depth,
	}
}

export class BoardGenerator {
	generateBoard(snapshot: TerrainSnapshot): GeneratedTileData[] {
		const tiles: GeneratedTileData[] = []

		for (const [key, tileField] of snapshot.tiles) {
			const coord = axial.coord(key)
			const biome = snapshot.biomes.get(key)!
			const terrain = resolveTerrainForTile(biome, tileField)
			const hydrology = resolveHydrologyForTile(snapshot, key, coord)

			const seed = this.coordSeed(coord)
			const deposit = this.generateRandomDeposit(seed, terrain)
			const goods = this.generateRandomGoods(seed, terrain, deposit)

			tiles.push({
				coord,
				terrain,
				height: tileField.height,
				hydrology,
				deposit,
				goods,
				walkTime: boardDefaultTileWalkTime,
			})
		}

		return tiles
	}

	private generateRandomGoods(
		seed: number,
		terrain: TerrainType,
		deposit: GeneratedDepositData | undefined
	): Record<string, number> {
		const goods: Record<string, number> = {}
		const rnd = this.createRNG(`goods-${seed}`)

		if (deposit) {
			const depositDef = deposits[deposit.type]
			if ('generation' in depositDef && depositDef.generation) {
				for (const [goodType, generationRate] of Object.entries(depositDef.generation)) {
					const goodDef = goodsCatalog[goodType as keyof typeof goodsCatalog]
					if (!goodDef) continue

					const totalGenerationRate = generationRate * deposit.amount
					let equilibriumAmount: number

					if (goodDef.halfLife === Infinity) {
						equilibriumAmount = totalGenerationRate * boardInfiniteHalfLifeEquilibriumMultiplier
					} else {
						const decayRate = 1 - 2 ** (-1 / goodDef.halfLife)
						equilibriumAmount = totalGenerationRate / decayRate
					}

					const variance = boardGoodsEquilibriumVariance
					const randomFactor = 1 + (rnd() - 0.5) * variance
					const finalAmount = Math.max(0, Math.floor(equilibriumAmount * randomFactor))

					if (finalAmount > 0) {
						goods[goodType] = finalAmount
					}
				}
			}
		}

		const terrainDef = terrainDetails[terrain]
		if ('generation' in terrainDef && terrainDef.generation && 'goods' in terrainDef.generation) {
			for (const [goodType, _chance] of Object.entries(terrainDef.generation.goods)) {
				const ambientAmount = Math.floor(rnd() * boardAmbientGoodsMaxPerType)
				if (ambientAmount > 0) {
					goods[goodType] = (goods[goodType] || 0) + ambientAmount
				}
			}
		}

		return goods
	}

	private generateRandomDeposit(
		seed: number,
		terrain: TerrainType
	): GeneratedDepositData | undefined {
		const rnd = this.createRNG(`deposit+${seed}`)
		const details: Ssh.TerrainDefinition = terrainDetails[terrain]
		const table = details.generation?.deposits ?? {}

		for (const [depKey, chance] of Object.entries(table)) {
			if (rnd() < (chance as number)) {
				const Kind = Deposit.class[depKey as DepositType]
				const amount = Math.floor(
					((1 + rnd() * boardDepositFillRandomSpread) * Kind.prototype.maxAmount) /
						boardDepositFillDivisor
				)
				return { type: depKey as DepositType, amount }
			}
		}
		return undefined
	}

	private createRNG(seed: string): () => number {
		let state = this.hashString(seed)
		return () => {
			state = (state * 1664525 + 1013904223) % 4294967296
			return state / 4294967296
		}
	}

	public coordSeed(coord: AxialCoord): number {
		return this.createRNG(`${coord.q},${coord.r}-${coord.q + coord.r}`)()
	}

	private hashString(str: string): number {
		let hash = 0
		for (let i = 0; i < str.length; i++) {
			const char = str.charCodeAt(i)
			hash = (hash << 5) - hash + char
			hash = hash & hash
		}
		return Math.abs(hash)
	}
}
