/**
 * Board generation logic
 * Extracted from board/index.ts for better organization
 */

import { deposits, goods as goodsCatalog, terrain as terrainDetails } from '$assets/game-content'
import type { DepositType, TerrainType } from '$lib/types'
import type { AxialCoord } from '$lib/utils'
import { axial } from '$lib/utils'
import { Deposit } from '../board/content/unbuilt-land'
import { TerrainGenerator } from './terrain'

export interface BoardGenerationConfig {
	boardSize: number
	terrainSeed: number
}

export interface GeneratedTileData {
	coord: AxialCoord
	terrain: TerrainType
	deposit?: GeneratedDepositData
	goods: Record<string, number>
	walkTime: number
}

export interface GeneratedDepositData {
	type: DepositType
	amount: number
}

export class BoardGenerator {
	private terrainGenerator: TerrainGenerator

	constructor(private config: BoardGenerationConfig) {
		this.terrainGenerator = new TerrainGenerator({
			seed: config.terrainSeed,
		})
	}

	generateBoard(): GeneratedTileData[] {
		const tiles: GeneratedTileData[] = []

		for (const coord of axial.enum(this.config.boardSize - 1)) {
			const seed = this.coordSeed(coord)
			const terrain = this.terrainGenerator.generateTerrain(coord)
			const deposit = this.generateRandomDeposit(seed, terrain)
			const goods = this.generateRandomGoods(seed, terrain, deposit)

			tiles.push({
				coord,
				terrain,
				deposit,
				goods,
				walkTime: 3, // Default walk time for UnBuiltLand
			})
		}

		return tiles
	}

	private generateRandomGoods(
		seed: number,
		terrain: TerrainType,
		deposit: GeneratedDepositData | undefined,
	): Record<string, number> {
		const goods: Record<string, number> = {}

		// Create a simple RNG for this generation
		const rnd = this.createRNG(`goods-${seed}`)

		if (deposit) {
			// Generate equilibrium goods based on deposit type and amount
			const depositDef = deposits[deposit.type]
			if ('generation' in depositDef && depositDef.generation) {
				for (const [goodType, generationRate] of Object.entries(depositDef.generation)) {
					// Calculate equilibrium amount based on decay and generation rates
					const goodDef = goodsCatalog[goodType as keyof typeof goodsCatalog]
					if (!goodDef) continue

					// Total generation rate for this deposit: generationRate * depositAmount
					const totalGenerationRate = generationRate * deposit.amount

					let equilibriumAmount: number

					if (goodDef.halfLife === Infinity) {
						// For infinite half-life goods, use a reasonable base amount
						// Since they don't decay, we generate a moderate amount
						equilibriumAmount = totalGenerationRate * 10 // 10x the generation rate as base amount
					} else {
						// Calculate decay rate per second: 1 - 2^(-1/halfLife)
						const decayRate = 1 - 2 ** (-1 / goodDef.halfLife)

						// At equilibrium: totalGenerationRate = decayRate * equilibriumAmount
						// So: equilibriumAmount = totalGenerationRate / decayRate
						equilibriumAmount = totalGenerationRate / decayRate
					}

					// Add some randomness (±30%) to make it feel natural
					const variance = 0.3
					const randomFactor = 1 + (rnd() - 0.5) * variance
					const finalAmount = Math.max(0, Math.floor(equilibriumAmount * randomFactor))

					if (finalAmount > 0) {
						goods[goodType] = finalAmount
					}
				}
			}
		}

		// Also generate ambient goods from terrain (like mushrooms in forest)
		const terrainDef = terrainDetails[terrain]
		if ('generation' in terrainDef && terrainDef.generation && 'goods' in terrainDef.generation) {
			for (const [goodType, _chance] of Object.entries(terrainDef.generation.goods)) {
				// Generate a small amount of ambient goods
				const ambientAmount = Math.floor(rnd() * 3) // 0-2 goods
				if (ambientAmount > 0) {
					goods[goodType] = (goods[goodType] || 0) + ambientAmount
				}
			}
		}

		return goods
	}

	private generateRandomDeposit(
		seed: number,
		terrain: TerrainType,
	): GeneratedDepositData | undefined {
		const rnd = this.createRNG(`deposit+${seed}`)
		const details: Ssh.TerrainDefinition = terrainDetails[terrain]
		const table = details.generation?.deposits ?? {}

		for (const [depKey, chance] of Object.entries(table)) {
			if (rnd() < (chance as number)) {
				// Create deposit data instead of actual deposit object
				const Kind = Deposit.class[depKey as DepositType]
				const amount = Math.floor(((1 + rnd() * 2) * Kind.prototype.maxAmount) / 3)
				return {
					type: depKey as DepositType,
					amount,
				}
			}
		}
		return undefined
	}

	private createRNG(seed: string): () => number {
		// Simple LCG implementation for generation
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
			hash = hash & hash // Convert to 32-bit integer
		}
		return Math.abs(hash)
	}
}
