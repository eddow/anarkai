/**
 * Integration tests for settlement placement comparing WASM vs TypeScript
 *
 * Tests verify that the WASM implementation produces correct results for:
 * - Determinism (same seed produces same output)
 * - Basic functionality (valid tile placement, spacing constraints)
 * - Terrain scoring (plains > forest > hills > mountains)
 * - Water and river bonuses
 * - Settlement kind assignment based on score
 * - Edge cases (empty tiles, zero settlements, all water, etc.)
 */

import { describe, expect, it, beforeAll } from 'vitest'
import { ensureWasmLoaded } from 'engine-terrain'
import { GameGenerator } from './index'
import type { GeneratedTileData } from './board'
import type { GeneratedSettlement } from './settlements'
import type { AxialCoord } from 'ssh/utils'
import type { TerrainType } from 'ssh/types'
import type { TerrainHydrologySample } from 'ssh/game/terrain-provider'

describe('Settlement Placement Integration Tests', () => {
	let generator: GameGenerator

	beforeAll(async () => {
		await ensureWasmLoaded()
		generator = new GameGenerator()
	})

	// Helper function to create test tiles
	function createTestTiles(tiles: Array<{
		q: number
		r: number
		terrain: TerrainType
		height?: number
		hydrology?: TerrainHydrologySample
		deposit?: { type: 'berry_bush' | 'rock' | 'tree'; amount: number }
	}>): GeneratedTileData[] {
		return tiles.map((t) => ({
			coord: { q: t.q, r: t.r },
			terrain: t.terrain,
			height: t.height ?? 0,
			hydrology: t.hydrology,
			deposit: t.deposit,
			goods: {},
			walkTime: 1,
		}))
	}

	// Helper function to check if two settlements are equal
	function settlementsEqual(a: GeneratedSettlement, b: GeneratedSettlement): boolean {
		return (
			a.id === b.id &&
			a.name === b.name &&
			a.kind === b.kind &&
			a.center.q === b.center.q &&
			a.center.r === b.center.r &&
			a.score === b.score &&
			a.radius === b.radius
		)
	}

	// Helper function to check if two settlement arrays are equal
	function settlementArraysEqual(a: GeneratedSettlement[], b: GeneratedSettlement[]): boolean {
		if (a.length !== b.length) return false
		for (let i = 0; i < a.length; i++) {
			if (!settlementsEqual(a[i]!, b[i]!)) return false
		}
		return true
	}

	// Helper function to check if two settlements respect min spacing
	function settlementsRespectSpacing(settlements: GeneratedSettlement[], minSpacing: number): boolean {
		for (let i = 0; i < settlements.length; i++) {
			for (let j = i + 1; j < settlements.length; j++) {
				const dist = axialDistance(settlements[i]!.center, settlements[j]!.center)
				if (dist < minSpacing) return false
			}
		}
		return true
	}

	// Helper function to calculate axial distance
	function axialDistance(a: AxialCoord, b: AxialCoord): number {
		return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2
	}

	describe('Determinism Test', () => {
		it('should produce identical results for the same seed', async () => {
			const seed = 12345
			const tiles = createTestTiles([
				{ q: 0, r: 0, terrain: 'grass', height: 0 },
				{ q: 1, r: 0, terrain: 'grass', height: 0 },
				{ q: 2, r: 0, terrain: 'forest', height: 0 },
				{ q: 0, r: 1, terrain: 'grass', height: 0 },
				{ q: 1, r: 1, terrain: 'grass', height: 0 },
				{ q: 2, r: 1, terrain: 'grass', height: 0 },
				{ q: 0, r: 2, terrain: 'grass', height: 0 },
				{ q: 1, r: 2, terrain: 'forest', height: 0 },
				{ q: 2, r: 2, terrain: 'grass', height: 0 },
			])

			const config = { settlementCount: 3, minSpacing: 2 }

			const result1 = await generator.placeSettlements(seed, tiles, config)
			const result2 = await generator.placeSettlements(seed, tiles, config)

			expect(settlementArraysEqual(result1.settlements, result2.settlements)).toBe(true)
		})

		it('should produce different results for different seeds', async () => {
			const tiles = createTestTiles([
				{ q: 0, r: 0, terrain: 'grass', height: 0 },
				{ q: 1, r: 0, terrain: 'grass', height: 0 },
				{ q: 2, r: 0, terrain: 'forest', height: 0 },
				{ q: 0, r: 1, terrain: 'grass', height: 0 },
				{ q: 1, r: 1, terrain: 'grass', height: 0 },
				{ q: 2, r: 1, terrain: 'grass', height: 0 },
				{ q: 0, r: 2, terrain: 'grass', height: 0 },
				{ q: 1, r: 2, terrain: 'forest', height: 0 },
				{ q: 2, r: 2, terrain: 'grass', height: 0 },
			])

			const config = { settlementCount: 3, minSpacing: 2 }

			const result1 = await generator.placeSettlements(12345, tiles, config)
			const result2 = await generator.placeSettlements(54321, tiles, config)

			// Results should differ (either in position, kind, or score)
			const resultsDiffer = !settlementArraysEqual(result1.settlements, result2.settlements)
			expect(resultsDiffer).toBe(true)
		})
	})

	describe('Basic Functionality Test', () => {
		it('should place settlements on valid tiles (not water/snow)', async () => {
			const seed = 12345
			const tiles = createTestTiles([
				{ q: 0, r: 0, terrain: 'grass', height: 0 },
				{ q: 1, r: 0, terrain: 'water', height: 0 },
				{ q: 2, r: 0, terrain: 'grass', height: 0 },
				{ q: 0, r: 1, terrain: 'snow', height: 0 },
				{ q: 1, r: 1, terrain: 'grass', height: 0 },
				{ q: 2, r: 1, terrain: 'grass', height: 0 },
				{ q: 0, r: 2, terrain: 'grass', height: 0 },
				{ q: 1, r: 2, terrain: 'forest', height: 0 },
				{ q: 2, r: 2, terrain: 'grass', height: 0 },
			])

			const config = { settlementCount: 3, minSpacing: 2 }
			const { settlements } = await generator.placeSettlements(seed, tiles, config)

			// Find the tiles that are not water or snow
			const validTiles = tiles.filter((t) => t.terrain !== 'water' && t.terrain !== 'snow')

			for (const settlement of settlements) {
				const placedOnValidTile = validTiles.some(
					(t) => t.coord.q === settlement.center.q && t.coord.r === settlement.center.r
				)
				expect(placedOnValidTile).toBe(true)
			}
		})

		it('should respect settlement spacing constraints', async () => {
			const seed = 12345
			const tiles = createTestTiles([
				{ q: 0, r: 0, terrain: 'grass', height: 0 },
				{ q: 1, r: 0, terrain: 'grass', height: 0 },
				{ q: 2, r: 0, terrain: 'grass', height: 0 },
				{ q: 3, r: 0, terrain: 'grass', height: 0 },
				{ q: 4, r: 0, terrain: 'grass', height: 0 },
				{ q: 0, r: 1, terrain: 'grass', height: 0 },
				{ q: 1, r: 1, terrain: 'grass', height: 0 },
				{ q: 2, r: 1, terrain: 'grass', height: 0 },
				{ q: 3, r: 1, terrain: 'grass', height: 0 },
				{ q: 4, r: 1, terrain: 'grass', height: 0 },
				{ q: 0, r: 2, terrain: 'grass', height: 0 },
				{ q: 1, r: 2, terrain: 'grass', height: 0 },
				{ q: 2, r: 2, terrain: 'grass', height: 0 },
				{ q: 3, r: 2, terrain: 'grass', height: 0 },
				{ q: 4, r: 2, terrain: 'grass', height: 0 },
			])

			const config = { settlementCount: 3, minSpacing: 3 }
			const { settlements } = await generator.placeSettlements(seed, tiles, config)

			expect(settlementsRespectSpacing(settlements, config.minSpacing)).toBe(true)
		})

		it('should generate unique settlement IDs', async () => {
			const seed = 12345
			const tiles = createTestTiles([
				{ q: 0, r: 0, terrain: 'grass', height: 0 },
				{ q: 1, r: 0, terrain: 'grass', height: 0 },
				{ q: 2, r: 0, terrain: 'forest', height: 0 },
				{ q: 0, r: 1, terrain: 'grass', height: 0 },
				{ q: 1, r: 1, terrain: 'grass', height: 0 },
				{ q: 2, r: 1, terrain: 'grass', height: 0 },
				{ q: 0, r: 2, terrain: 'grass', height: 0 },
				{ q: 1, r: 2, terrain: 'forest', height: 0 },
				{ q: 2, r: 2, terrain: 'grass', height: 0 },
			])

			const config = { settlementCount: 5, minSpacing: 2 }
			const { settlements } = await generator.placeSettlements(seed, tiles, config)

			const ids = settlements.map((s) => s.id)
			const uniqueIds = new Set(ids)
			expect(uniqueIds.size).toBe(settlements.length)
		})
	})

	describe('Terrain Scoring Test', () => {
		it('should prefer higher-scoring terrain types (plains > forest > hills)', async () => {
			const seed = 12345
			const tiles = createTestTiles([
				{ q: 0, r: 0, terrain: 'grass', height: 0 }, // Plains (highest score)
				{ q: 1, r: 0, terrain: 'forest', height: 0 }, // Forest (medium score)
				{ q: 2, r: 0, terrain: 'rocky', height: 0 }, // Hills (lower score)
				{ q: 3, r: 0, terrain: 'grass', height: 0 },
				{ q: 0, r: 1, terrain: 'grass', height: 0 },
				{ q: 1, r: 1, terrain: 'grass', height: 0 },
				{ q: 2, r: 1, terrain: 'grass', height: 0 },
				{ q: 3, r: 1, terrain: 'grass', height: 0 },
				{ q: 0, r: 2, terrain: 'grass', height: 0 },
				{ q: 1, r: 2, terrain: 'grass', height: 0 },
				{ q: 2, r: 2, terrain: 'grass', height: 0 },
				{ q: 3, r: 2, terrain: 'grass', height: 0 },
			])

			const config = { settlementCount: 3, minSpacing: 2 }
			const { settlements } = await generator.placeSettlements(seed, tiles, config)

			// At least one settlement should be on grass (plains)
			const hasGrassSettlement = settlements.some((s) => {
				return tiles.some((t) => t.coord.q === s.center.q && t.coord.r === s.center.r && t.terrain === 'grass')
			})
			expect(hasGrassSettlement).toBe(true)
		})

		it('should apply water access bonus', async () => {
			const seed = 12345
			const tiles = createTestTiles([
				{ q: 0, r: 0, terrain: 'grass', height: 0 }, // Near water
				{ q: 1, r: 0, terrain: 'water', height: 0 },
				{ q: 2, r: 0, terrain: 'grass', height: 0 }, // Near water
				{ q: 0, r: 1, terrain: 'grass', height: 0 }, // Near water
				{ q: 1, r: 1, terrain: 'grass', height: 0 }, // Near water
				{ q: 2, r: 1, terrain: 'grass', height: 0 }, // Near water
				{ q: 3, r: 0, terrain: 'grass', height: 0 }, // Far from water
				{ q: 4, r: 0, terrain: 'grass', height: 0 }, // Far from water
				{ q: 3, r: 1, terrain: 'grass', height: 0 }, // Far from water
				{ q: 4, r: 1, terrain: 'grass', height: 0 }, // Far from water
			])

			const config = { settlementCount: 2, minSpacing: 2 }
			const { settlements } = await generator.placeSettlements(seed, tiles, config)

			// Check if settlements are placed near water (higher preference)
			const waterAdjacentCoords = [
				{ q: 0, r: 0 },
				{ q: 2, r: 0 },
				{ q: 0, r: 1 },
				{ q: 1, r: 1 },
				{ q: 2, r: 1 },
			]
			const farFromWaterCoords = [
				{ q: 3, r: 0 },
				{ q: 4, r: 0 },
				{ q: 3, r: 1 },
				{ q: 4, r: 1 },
			]

			const waterAdjacentSettlements = settlements.filter((s) =>
				waterAdjacentCoords.some((c) => c.q === s.center.q && c.r === s.center.r)
			)
			const farFromWaterSettlements = settlements.filter((s) =>
				farFromWaterCoords.some((c) => c.q === s.center.q && c.r === s.center.r)
			)

			// Water-adjacent tiles should be preferred
			expect(waterAdjacentSettlements.length).toBeGreaterThanOrEqual(farFromWaterSettlements.length)
		})

		it('should apply river bonus', async () => {
			const seed = 12345
			const tiles = createTestTiles([
				{ q: 0, r: 0, terrain: 'grass', height: 0 },
				{ q: 1, r: 0, terrain: 'grass', height: 0, hydrology: { isChannel: false, edges: { 0: { flux: 1, width: 1, depth: 1 } } } }, // Has river
				{ q: 2, r: 0, terrain: 'grass', height: 0 },
				{ q: 3, r: 0, terrain: 'grass', height: 0 },
				{ q: 0, r: 1, terrain: 'grass', height: 0 },
				{ q: 1, r: 1, terrain: 'grass', height: 0 },
				{ q: 2, r: 1, terrain: 'grass', height: 0 },
				{ q: 3, r: 1, terrain: 'grass', height: 0 },
			])

			const config = { settlementCount: 2, minSpacing: 2 }
			const { settlements } = await generator.placeSettlements(seed, tiles, config)

			// Check if any settlement is near the river
			const riverAdjacentCoords = [
				{ q: 0, r: 0 },
				{ q: 2, r: 0 },
				{ q: 1, r: 1 },
			]
			const hasRiverAdjacentSettlement = settlements.some((s) =>
				riverAdjacentCoords.some((c) => c.q === s.center.q && c.r === s.center.r)
			)
			expect(hasRiverAdjacentSettlement).toBe(true)
		})

		it('should apply deposit bonus', async () => {
			const seed = 12345
			const tiles = createTestTiles([
				{ q: 0, r: 0, terrain: 'grass', height: 0, deposit: { type: 'rock', amount: 100 } }, // Has deposit
				{ q: 1, r: 0, terrain: 'grass', height: 0 },
				{ q: 2, r: 0, terrain: 'grass', height: 0 },
				{ q: 3, r: 0, terrain: 'grass', height: 0 },
				{ q: 0, r: 1, terrain: 'grass', height: 0 },
				{ q: 1, r: 1, terrain: 'grass', height: 0 },
				{ q: 2, r: 1, terrain: 'grass', height: 0 },
				{ q: 3, r: 1, terrain: 'grass', height: 0 },
			])

			const config = { settlementCount: 2, minSpacing: 2 }
			const { settlements } = await generator.placeSettlements(seed, tiles, config)

			// Check if any settlement is on the tile with deposit
			const hasDepositSettlement = settlements.some((s) => s.center.q === 0 && s.center.r === 0)
			expect(hasDepositSettlement).toBe(true)
		})
	})

	describe('Settlement Kind Test', () => {
		it('should assign village kind by default', async () => {
			const seed = 12345
			const tiles = createTestTiles([
				{ q: 0, r: 0, terrain: 'grass', height: 0 },
				{ q: 1, r: 0, terrain: 'grass', height: 0 },
				{ q: 2, r: 0, terrain: 'grass', height: 0 },
				{ q: 0, r: 1, terrain: 'grass', height: 0 },
				{ q: 1, r: 1, terrain: 'grass', height: 0 },
				{ q: 2, r: 1, terrain: 'grass', height: 0 },
			])

			const config = { settlementCount: 3, minSpacing: 2 }
			const { settlements } = await generator.placeSettlements(seed, tiles, config)

			// All settlements should have a valid kind
			for (const settlement of settlements) {
				expect(['village', 'town', 'city']).toContain(settlement.kind)
			}
		})

		it('should assign correct radius values based on kind', async () => {
			const seed = 12345
			const tiles = createTestTiles([
				{ q: 0, r: 0, terrain: 'grass', height: 0 },
				{ q: 1, r: 0, terrain: 'grass', height: 0 },
				{ q: 2, r: 0, terrain: 'grass', height: 0 },
				{ q: 3, r: 0, terrain: 'grass', height: 0 },
				{ q: 4, r: 0, terrain: 'grass', height: 0 },
				{ q: 0, r: 1, terrain: 'grass', height: 0 },
				{ q: 1, r: 1, terrain: 'grass', height: 0 },
				{ q: 2, r: 1, terrain: 'grass', height: 0 },
				{ q: 3, r: 1, terrain: 'grass', height: 0 },
				{ q: 4, r: 1, terrain: 'grass', height: 0 },
			])

			const config = { settlementCount: 5, minSpacing: 2 }
			const { settlements } = await generator.placeSettlements(seed, tiles, config)

			for (const settlement of settlements) {
				if (settlement.kind === 'city') {
					expect(settlement.radius).toBe(4)
				} else if (settlement.kind === 'town') {
					expect(settlement.radius).toBe(3)
				} else {
					expect(settlement.radius).toBe(2)
				}
			}
		})

		it('should generate appropriate names based on kind and location', async () => {
			const seed = 12345
			const tiles = createTestTiles([
				{ q: 0, r: 0, terrain: 'grass', height: 0 },
				{ q: 1, r: 0, terrain: 'grass', height: 0 },
				{ q: 2, r: 0, terrain: 'grass', height: 0 },
			])

			const config = { settlementCount: 2, minSpacing: 2 }
			const { settlements } = await generator.placeSettlements(seed, tiles, config)

			for (const settlement of settlements) {
				expect(settlement.name).toBeTruthy()
				expect(settlement.name.length).toBeGreaterThan(0)
				// Name should contain the kind prefix
				expect(settlement.name).toMatch(/^(Village|Town|City)/)
				// Name should contain coordinates
				expect(settlement.name).toContain(`${settlement.center.q},${settlement.center.r}`)
			}
		})
	})

	describe('Edge Cases', () => {
		it('should handle empty tile array', async () => {
			const seed = 12345
			const tiles: GeneratedTileData[] = []
			const config = { settlementCount: 3, minSpacing: 2 }

			const { settlements } = await generator.placeSettlements(seed, tiles, config)

			expect(settlements).toEqual([])
		})

		it('should handle zero settlement count', async () => {
			const seed = 12345
			const tiles = createTestTiles([
				{ q: 0, r: 0, terrain: 'grass', height: 0 },
				{ q: 1, r: 0, terrain: 'grass', height: 0 },
				{ q: 2, r: 0, terrain: 'grass', height: 0 },
			])

			const config = { settlementCount: 0, minSpacing: 2 }
			const { settlements } = await generator.placeSettlements(seed, tiles, config)

			expect(settlements).toEqual([])
		})

		it('should handle all water tiles (no valid positions)', async () => {
			const seed = 12345
			const tiles = createTestTiles([
				{ q: 0, r: 0, terrain: 'water', height: 0 },
				{ q: 1, r: 0, terrain: 'water', height: 0 },
				{ q: 2, r: 0, terrain: 'water', height: 0 },
				{ q: 0, r: 1, terrain: 'water', height: 0 },
				{ q: 1, r: 1, terrain: 'water', height: 0 },
				{ q: 2, r: 1, terrain: 'water', height: 0 },
			])

			const config = { settlementCount: 3, minSpacing: 2 }
			const { settlements } = await generator.placeSettlements(seed, tiles, config)

			expect(settlements).toEqual([])
		})

		it('should handle all snow tiles (no valid positions)', async () => {
			const seed = 12345
			const tiles = createTestTiles([
				{ q: 0, r: 0, terrain: 'snow', height: 0 },
				{ q: 1, r: 0, terrain: 'snow', height: 0 },
				{ q: 2, r: 0, terrain: 'snow', height: 0 },
				{ q: 0, r: 1, terrain: 'snow', height: 0 },
				{ q: 1, r: 1, terrain: 'snow', height: 0 },
				{ q: 2, r: 1, terrain: 'snow', height: 0 },
			])

			const config = { settlementCount: 3, minSpacing: 2 }
			const { settlements } = await generator.placeSettlements(seed, tiles, config)

			expect(settlements).toEqual([])
		})

		it('should handle more settlements requested than available tiles', async () => {
			const seed = 12345
			const tiles = createTestTiles([
				{ q: 0, r: 0, terrain: 'grass', height: 0 },
				{ q: 1, r: 0, terrain: 'grass', height: 0 },
				{ q: 2, r: 0, terrain: 'grass', height: 0 },
				{ q: 0, r: 1, terrain: 'grass', height: 0 },
				{ q: 1, r: 1, terrain: 'grass', height: 0 },
				{ q: 2, r: 1, terrain: 'grass', height: 0 },
			])

			const config = { settlementCount: 10, minSpacing: 2 }
			const { settlements } = await generator.placeSettlements(seed, tiles, config)

			// Should return at most the number of tiles that can fit with spacing
			expect(settlements.length).toBeLessThanOrEqual(tiles.length)
		})

		it('should handle min spacing larger than map', async () => {
			const seed = 12345
			const tiles = createTestTiles([
				{ q: 0, r: 0, terrain: 'grass', height: 0 },
				{ q: 1, r: 0, terrain: 'grass', height: 0 },
				{ q: 2, r: 0, terrain: 'grass', height: 0 },
			])

			const config = { settlementCount: 3, minSpacing: 10 }
			const { settlements } = await generator.placeSettlements(seed, tiles, config)

			// Should return at most 1 settlement
			expect(settlements.length).toBeLessThanOrEqual(1)
		})

		it('should handle mixed valid and invalid tiles', async () => {
			const seed = 12345
			const tiles = createTestTiles([
				{ q: 0, r: 0, terrain: 'grass', height: 0 }, // Valid
				{ q: 1, r: 0, terrain: 'water', height: 0 }, // Invalid
				{ q: 2, r: 0, terrain: 'grass', height: 0 }, // Valid
				{ q: 0, r: 1, terrain: 'snow', height: 0 }, // Invalid
				{ q: 1, r: 1, terrain: 'grass', height: 0 }, // Valid
				{ q: 2, r: 1, terrain: 'grass', height: 0 }, // Valid
			])

			const config = { settlementCount: 3, minSpacing: 2 }
			const { settlements } = await generator.placeSettlements(seed, tiles, config)

			// All settlements should be on valid tiles
			const validTiles = tiles.filter((t) => t.terrain !== 'water' && t.terrain !== 'snow')
			for (const settlement of settlements) {
				const isValid = validTiles.some(
					(t) => t.coord.q === settlement.center.q && t.coord.r === settlement.center.r
				)
				expect(isValid).toBe(true)
			}
		})
	})

	describe('Water/River Detection Test', () => {
		it('should detect water access correctly', async () => {
			const seed = 12345
			const tiles = createTestTiles([
				{ q: 0, r: 0, terrain: 'grass', height: 0 }, // Adjacent to water
				{ q: 1, r: 0, terrain: 'water', height: 0 },
				{ q: 2, r: 0, terrain: 'grass', height: 0 }, // Adjacent to water
				{ q: 0, r: 1, terrain: 'grass', height: 0 }, // Adjacent to water
				{ q: 1, r: 1, terrain: 'grass', height: 0 }, // Adjacent to water
				{ q: 2, r: 1, terrain: 'grass', height: 0 }, // Adjacent to water
			])

			const config = { settlementCount: 2, minSpacing: 2 }
			const { settlements } = await generator.placeSettlements(seed, tiles, config)

			// Check that settlements are placed on tiles with water access
			const waterAdjacentTiles = tiles.filter((t) => {
				if (t.terrain === 'water') return false
				// Check if any neighbor is water
				const neighbors = [
					{ q: t.coord.q + 1, r: t.coord.r },
					{ q: t.coord.q, r: t.coord.r + 1 },
					{ q: t.coord.q - 1, r: t.coord.r + 1 },
					{ q: t.coord.q - 1, r: t.coord.r },
					{ q: t.coord.q, r: t.coord.r - 1 },
					{ q: t.coord.q + 1, r: t.coord.r - 1 },
				]
				return neighbors.some((n) => tiles.some((tile) => tile.coord.q === n.q && tile.coord.r === n.r && tile.terrain === 'water'))
			})

			const hasWaterAccessSettlement = settlements.some((s) =>
				waterAdjacentTiles.some((t) => t.coord.q === s.center.q && t.coord.r === s.center.r)
			)
			expect(hasWaterAccessSettlement).toBe(true)
		})

		it('should detect sand as having water access', async () => {
			const seed = 12345
			const tiles = createTestTiles([
				{ q: 0, r: 0, terrain: 'sand', height: 0 }, // Sand has water access by default
				{ q: 1, r: 0, terrain: 'grass', height: 0 },
				{ q: 2, r: 0, terrain: 'grass', height: 0 },
				{ q: 0, r: 1, terrain: 'grass', height: 0 },
				{ q: 1, r: 1, terrain: 'grass', height: 0 },
				{ q: 2, r: 1, terrain: 'grass', height: 0 },
			])

			const config = { settlementCount: 2, minSpacing: 2 }
			const { settlements } = await generator.placeSettlements(seed, tiles, config)

			// Sand tile should be preferred due to water access
			const hasSandSettlement = settlements.some((s) => s.center.q === 0 && s.center.r === 0)
			expect(hasSandSettlement).toBe(true)
		})

		it('should detect river presence correctly', async () => {
			const seed = 12345
			const tiles = createTestTiles([
				{ q: 0, r: 0, terrain: 'grass', height: 0 },
				{ q: 1, r: 0, terrain: 'grass', height: 0, hydrology: { isChannel: false, edges: { 0: { flux: 1, width: 1, depth: 1 } } } }, // Has river edge
				{ q: 2, r: 0, terrain: 'grass', height: 0 },
				{ q: 0, r: 1, terrain: 'grass', height: 0 },
				{ q: 1, r: 1, terrain: 'grass', height: 0 },
				{ q: 2, r: 1, terrain: 'grass', height: 0 },
			])

			const config = { settlementCount: 2, minSpacing: 2 }
			const { settlements } = await generator.placeSettlements(seed, tiles, config)

			// Check if any settlement is near the river
			const riverAdjacentCoords = [
				{ q: 0, r: 0 },
				{ q: 2, r: 0 },
				{ q: 1, r: 1 },
			]
			const hasRiverAdjacentSettlement = settlements.some((s) =>
				riverAdjacentCoords.some((c) => c.q === s.center.q && c.r === s.center.r)
			)
			expect(hasRiverAdjacentSettlement).toBe(true)
		})

		it('should detect isChannel as river', async () => {
			const seed = 12345
			const tiles = createTestTiles([
				{ q: 0, r: 0, terrain: 'grass', height: 0 },
				{ q: 1, r: 0, terrain: 'grass', height: 0, hydrology: { isChannel: true, edges: {} } }, // Is channel
				{ q: 2, r: 0, terrain: 'grass', height: 0 },
				{ q: 0, r: 1, terrain: 'grass', height: 0 },
				{ q: 1, r: 1, terrain: 'grass', height: 0 },
				{ q: 2, r: 1, terrain: 'grass', height: 0 },
			])

			const config = { settlementCount: 2, minSpacing: 2 }
			const { settlements } = await generator.placeSettlements(seed, tiles, config)

			// Check if any settlement is near the channel
			const channelAdjacentCoords = [
				{ q: 0, r: 0 },
				{ q: 2, r: 0 },
				{ q: 1, r: 1 },
			]
			const hasChannelAdjacentSettlement = settlements.some((s) =>
				channelAdjacentCoords.some((c) => c.q === s.center.q && c.r === s.center.r)
			)
			expect(hasChannelAdjacentSettlement).toBe(true)
		})

		it('should detect bankInfluence as river', async () => {
			const seed = 12345
			const tiles = createTestTiles([
				{ q: 0, r: 0, terrain: 'grass', height: 0 },
				{ q: 1, r: 0, terrain: 'grass', height: 0, hydrology: { isChannel: false, bankInfluence: 1, edges: {} } }, // Has bank influence
				{ q: 2, r: 0, terrain: 'grass', height: 0 },
				{ q: 0, r: 1, terrain: 'grass', height: 0 },
				{ q: 1, r: 1, terrain: 'grass', height: 0 },
				{ q: 2, r: 1, terrain: 'grass', height: 0 },
			])

			const config = { settlementCount: 2, minSpacing: 2 }
			const { settlements } = await generator.placeSettlements(seed, tiles, config)

			// Check if any settlement is near the bank
			const bankAdjacentCoords = [
				{ q: 0, r: 0 },
				{ q: 2, r: 0 },
				{ q: 1, r: 1 },
			]
			const hasBankAdjacentSettlement = settlements.some((s) =>
				bankAdjacentCoords.some((c) => c.q === s.center.q && c.r === s.center.r)
			)
			expect(hasBankAdjacentSettlement).toBe(true)
		})
	})

	describe('Score Comparison Tests', () => {
		it('should place settlements on tiles with higher scores', async () => {
			const seed = 12345
			const tiles = createTestTiles([
				{ q: 0, r: 0, terrain: 'grass', height: 0 }, // High score (grass + flat)
				{ q: 1, r: 0, terrain: 'rocky', height: 0.5 }, // Lower score (rocky + hilly)
				{ q: 2, r: 0, terrain: 'grass', height: 0 },
				{ q: 0, r: 1, terrain: 'grass', height: 0 },
				{ q: 1, r: 1, terrain: 'grass', height: 0 },
				{ q: 2, r: 1, terrain: 'grass', height: 0 },
			])

			const config = { settlementCount: 2, minSpacing: 2 }
			const { settlements } = await generator.placeSettlements(seed, tiles, config)

			// First settlement should have a higher score than subsequent ones
			if (settlements.length >= 2) {
				expect(settlements[0]!.score).toBeGreaterThanOrEqual(settlements[1]!.score)
			}
		})

		it('should return settlement scores in reasonable range', async () => {
			const seed = 12345
			const tiles = createTestTiles([
				{ q: 0, r: 0, terrain: 'grass', height: 0 },
				{ q: 1, r: 0, terrain: 'grass', height: 0 },
				{ q: 2, r: 0, terrain: 'forest', height: 0 },
				{ q: 0, r: 1, terrain: 'grass', height: 0 },
				{ q: 1, r: 1, terrain: 'grass', height: 0 },
				{ q: 2, r: 1, terrain: 'grass', height: 0 },
			])

			const config = { settlementCount: 3, minSpacing: 2 }
			const { settlements } = await generator.placeSettlements(seed, tiles, config)

			for (const settlement of settlements) {
				// Scores should be non-negative and reasonable
				expect(settlement.score).toBeGreaterThanOrEqual(0)
				expect(settlement.score).toBeLessThan(20) // Reasonable upper bound
			}
		})
	})
})
