/**
 * Board generation logic — consumes a TerrainSnapshot from engine-terrain
 * and produces ssh-native GeneratedTileData with deposits and goods.
 */

import type { BiomeHint, TerrainSnapshot } from 'engine-terrain'
import { Deposit } from 'ssh/board/content/unbuilt-land'
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

export class BoardGenerator {
	generateBoard(snapshot: TerrainSnapshot): GeneratedTileData[] {
		const tiles: GeneratedTileData[] = []

		for (const [key, tileField] of snapshot.tiles) {
			const coord = axial.coord(key)
			const biome = snapshot.biomes.get(key)!
			const terrain = biomeToTerrain[biome]

			const seed = this.coordSeed(coord)
			const deposit = this.generateRandomDeposit(seed, terrain)
			const goods = this.generateRandomGoods(seed, terrain, deposit)

			tiles.push({
				coord,
				terrain,
				height: tileField.height,
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
