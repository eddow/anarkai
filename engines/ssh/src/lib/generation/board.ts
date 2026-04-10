/**
 * Board generation logic — consumes a TerrainSnapshot from engine-terrain
 * and produces ssh-native GeneratedTileData with deposits and goods.
 */

import {
	classifyTile,
	DEFAULT_TERRAIN_CONFIG,
	edgeKey,
	type BiomeHint,
	type EdgeField,
	type TerrainSnapshot,
} from 'engine-terrain'
import { Deposit } from 'ssh/board/content/unbuilt-land'
import type { TerrainHydrologySample } from 'ssh/game/terrain-provider'
import type { DepositType, TerrainType } from 'ssh/types'
import type { AxialCoord } from 'ssh/utils'
import { axial } from 'ssh/utils'
import {
	deposits,
	goods as goodsCatalog,
	terrain as terrainDetails,
} from '../../../assets/game-content'

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

function resolveTerrainForTile(biome: BiomeHint, tileField: TerrainSnapshot['tiles'] extends Map<any, infer T> ? T : never): TerrainType {
	if (biome !== 'river-bank' && biome !== 'wetland') {
		return biomeToTerrain[biome]
	}

	// Hydrology is rendered separately now, so keep the underlying landform terrain
	// instead of flattening river-influenced mountains into grass.
	const baseBiome = classifyTile(tileField, [], DEFAULT_TERRAIN_CONFIG)
	return biomeToTerrain[baseBiome]
}

function resolveHydrologyForTile(snapshot: TerrainSnapshot, key: string, coord: AxialCoord): TerrainHydrologySample | undefined {
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

	if (!isChannel && bankInfluence === undefined && channelInfluence === undefined && Object.keys(edges).length === 0) {
		return undefined
	}

	return {
		isChannel,
		bankInfluence,
		channelInfluence,
		edges,
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
				walkTime: 3,
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
						equilibriumAmount = totalGenerationRate * 10
					} else {
						const decayRate = 1 - 2 ** (-1 / goodDef.halfLife)
						equilibriumAmount = totalGenerationRate / decayRate
					}

					const variance = 0.3
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
				const ambientAmount = Math.floor(rnd() * 3)
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
				const amount = Math.floor(((1 + rnd() * 2) * Kind.prototype.maxAmount) / 3)
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
