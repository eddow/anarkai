/**
 * Integration tests for board generation
 *
 * Tests verify that the board generation system produces correct results for:
 * - Determinism (same seed produces same output)
 * - Basic functionality (valid deposit and goods generation)
 * - Edge cases (empty tiles, single tile, large regions, coordinate preservation)
 */

import { ensureWasmLoaded } from 'engine-terrain'
import type { TerrainType } from 'ssh/types'
import type { AxialCoord } from 'ssh/utils'
import { beforeAll, describe, expect, it } from 'vitest'
import type { GeneratedTileData } from './board'
import { GameGenerator } from './index'

describe('Board Generation Integration Tests', () => {
	let generator: GameGenerator

	beforeAll(async () => {
		await ensureWasmLoaded()
		generator = new GameGenerator()
	})

	// Helper function to create test coordinates
	function createTestCoords(coords: Array<{ q: number; r: number }>): AxialCoord[] {
		return coords.map((c) => ({ q: c.q, r: c.r }))
	}

	// Helper function to check if two tiles are equal
	function tilesEqual(a: GeneratedTileData, b: GeneratedTileData): boolean {
		return (
			a.coord.q === b.coord.q &&
			a.coord.r === b.coord.r &&
			a.terrain === b.terrain &&
			a.height === b.height &&
			a.walkTime === b.walkTime &&
			JSON.stringify(a.deposit) === JSON.stringify(b.deposit) &&
			JSON.stringify(a.goods) === JSON.stringify(b.goods)
		)
	}

	// Helper function to check if two tile arrays are equal
	function tileArraysEqual(a: GeneratedTileData[], b: GeneratedTileData[]): boolean {
		if (a.length !== b.length) return false
		for (let i = 0; i < a.length; i++) {
			if (!tilesEqual(a[i]!, b[i]!)) return false
		}
		return true
	}

	// Helper function to get tiles by terrain type
	function getTilesByTerrain(
		tiles: GeneratedTileData[],
		terrainType: TerrainType
	): GeneratedTileData[] {
		return tiles.filter((t) => t.terrain === terrainType)
	}

	describe('Determinism Test', () => {
		it('should produce identical results for the same seed', async () => {
			const seed = 12345
			const coords = createTestCoords([
				{ q: 0, r: 0 },
				{ q: 1, r: 0 },
				{ q: 2, r: 0 },
				{ q: 0, r: 1 },
				{ q: 1, r: 1 },
				{ q: 2, r: 1 },
			])

			// Generate board twice with same seed
			const result1 = await generator.generateRegionAsync(
				{ terrainSeed: seed, characterCount: 0 },
				coords
			)
			const result2 = await generator.generateRegionAsync(
				{ terrainSeed: seed, characterCount: 0 },
				coords
			)

			// Results should be identical
			expect(result1.length).toBe(result2.length)
			expect(tileArraysEqual(result1, result2)).toBe(true)
		})

		it('should produce different results for different seeds', async () => {
			const seed1 = 12345
			const seed2 = 54321
			const coords = createTestCoords([
				{ q: 0, r: 0 },
				{ q: 1, r: 0 },
				{ q: 2, r: 0 },
				{ q: 0, r: 1 },
				{ q: 1, r: 1 },
				{ q: 2, r: 1 },
			])

			const result1 = await generator.generateRegionAsync(
				{ terrainSeed: seed1, characterCount: 0 },
				coords
			)
			const result2 = await generator.generateRegionAsync(
				{ terrainSeed: seed2, characterCount: 0 },
				coords
			)

			// Results should be different
			expect(tileArraysEqual(result1, result2)).toBe(false)
		})
	})

	describe('Basic Functionality Test', () => {
		it('should generate deposits and goods for a region', async () => {
			const seed = 98765
			const coords = createTestCoords([
				{ q: 0, r: 0 },
				{ q: 1, r: 0 },
				{ q: 2, r: 0 },
				{ q: 0, r: 1 },
				{ q: 1, r: 1 },
				{ q: 2, r: 1 },
				{ q: 0, r: 2 },
				{ q: 1, r: 2 },
				{ q: 2, r: 2 },
			])

			const result = await generator.generateRegionAsync(
				{ terrainSeed: seed, characterCount: 0 },
				coords
			)

			// Verify all tiles are generated
			expect(result.length).toBe(coords.length)

			// Verify coordinates are preserved
			for (let i = 0; i < result.length; i++) {
				expect(result[i]!.coord.q).toBe(coords[i]!.q)
				expect(result[i]!.coord.r).toBe(coords[i]!.r)
			}

			// Verify each tile has valid terrain type
			const validTerrainTypes: TerrainType[] = [
				'water',
				'sand',
				'grass',
				'forest',
				'rocky',
				'snow',
				'concrete',
			]
			for (const tile of result) {
				expect(validTerrainTypes).toContain(tile.terrain)
			}

			// Verify deposit amounts are valid (if any deposits exist)
			for (const tile of result) {
				if (tile.deposit) {
					expect(tile.deposit.amount).toBeGreaterThan(0)
					expect(tile.deposit.amount).toBeLessThanOrEqual(18) // maxAmount for deposits
					if (tile.deposit.type === 'tree') {
						expect(tile.deposit.amount).toBeLessThanOrEqual(2)
					}
				}
			}

			// Verify goods amounts are valid (if any goods exist)
			for (const tile of result) {
				for (const [, amount] of Object.entries(tile.goods)) {
					expect(amount).toBeGreaterThan(0)
				}
			}
		})

		it('should generate consistent terrain types', async () => {
			const seed = 87654
			const coords = createTestCoords([
				{ q: 0, r: 0 },
				{ q: 1, r: 0 },
				{ q: 2, r: 0 },
				{ q: 0, r: 1 },
				{ q: 1, r: 1 },
				{ q: 2, r: 1 },
			])

			const result = await generator.generateRegionAsync(
				{ terrainSeed: seed, characterCount: 0 },
				coords
			)

			// Verify terrain types are consistent
			const terrainTypes = result.map((t) => t.terrain)
			const uniqueTerrainTypes = [...new Set(terrainTypes)]

			// Should have at least one terrain type
			expect(uniqueTerrainTypes.length).toBeGreaterThan(0)
		})
	})

	describe('Deposit Generation Test', () => {
		it('uses game terrain deposit rules through the WASM board generator', async () => {
			const seed = 13579
			const coords: AxialCoord[] = []
			for (let q = -5; q <= 5; q++) {
				for (let r = -5; r <= 5; r++) {
					coords.push({ q, r })
				}
			}

			const forcedForest = coords.map((coord) => ({
				coord: [coord.q, coord.r] as [number, number],
				terrain: 'forest' as TerrainType,
			}))
			const forest = await generator.generateRegionAsync(
				{ terrainSeed: seed, characterCount: 0 },
				coords,
				forcedForest
			)
			const forestDeposits = forest
				.filter((tile) => tile.terrain === 'forest')
				.flatMap((tile) => tile.deposit?.type ?? [])
			expect(forestDeposits).toContain('tree')
			expect(forestDeposits).not.toContain('rock')

			const forcedGrass = coords.map((coord) => ({
				coord: [coord.q, coord.r] as [number, number],
				terrain: 'grass' as TerrainType,
			}))
			const grass = await generator.generateRegionAsync(
				{ terrainSeed: seed, characterCount: 0 },
				coords,
				forcedGrass
			)
			expect(
				grass.filter((tile) => tile.terrain === 'grass').flatMap((tile) => tile.deposit?.type ?? [])
			).toContain('berry_bush')
		})

		it('should not generate deposits on water terrain', async () => {
			// Test with multiple seeds to find water terrain
			let foundWater = false

			for (let testSeed = 44444; testSeed < 44700; testSeed++) {
				// Use a larger region to increase chances of finding water
				const coords: AxialCoord[] = []
				for (let q = -3; q <= 3; q++) {
					for (let r = -3; r <= 3; r++) {
						coords.push({ q, r })
					}
				}

				const result = await generator.generateRegionAsync(
					{ terrainSeed: testSeed, characterCount: 0 },
					coords
				)

				// Filter for water terrain tiles
				const waterTiles = getTilesByTerrain(result, 'water')

				if (waterTiles.length > 0) {
					foundWater = true

					// Water terrain should not generate deposits
					const waterDeposits = waterTiles.filter((t) => t.deposit !== undefined)
					expect(waterDeposits.length).toBe(0)

					break
				}
			}

			// We should have found at least some water tiles
			expect(foundWater).toBe(true)
		})
	})

	describe('Goods Generation Test', () => {
		it('should not generate goods on water terrain', async () => {
			// Test with multiple seeds to find water terrain
			let foundWater = false

			for (let testSeed = 30303; testSeed < 30600; testSeed++) {
				// Use a larger region to increase chances of finding water
				const coords: AxialCoord[] = []
				for (let q = -3; q <= 3; q++) {
					for (let r = -3; r <= 3; r++) {
						coords.push({ q, r })
					}
				}

				const result = await generator.generateRegionAsync(
					{ terrainSeed: testSeed, characterCount: 0 },
					coords
				)

				// Filter for water terrain tiles
				const waterTiles = getTilesByTerrain(result, 'water')

				if (waterTiles.length > 0) {
					foundWater = true

					// Water terrain should not generate goods
					const waterGoods = waterTiles.filter((t) => Object.keys(t.goods).length > 0)
					expect(waterGoods.length).toBe(0)

					break
				}
			}

			// We should have found at least some water tiles
			expect(foundWater).toBe(true)
		})
	})

	describe('Edge Cases', () => {
		it('should handle empty coordinate array', async () => {
			const seed = 80808
			const result = await generator.generateRegionAsync(
				{ terrainSeed: seed, characterCount: 0 },
				[]
			)

			// Should return empty array
			expect(result.length).toBe(0)
		})

		it('should handle single tile', async () => {
			const seed = 90909
			const coords = createTestCoords([{ q: 0, r: 0 }])

			const result = await generator.generateRegionAsync(
				{ terrainSeed: seed, characterCount: 0 },
				coords
			)

			// Should return single tile
			expect(result.length).toBe(1)
			expect(result[0]!.coord.q).toBe(0)
			expect(result[0]!.coord.r).toBe(0)
			expect(result[0]!.walkTime).toBeGreaterThan(0)
		})

		it('should handle large region', async () => {
			const seed = 10111
			const coords: AxialCoord[] = []
			for (let q = -5; q <= 5; q++) {
				for (let r = -5; r <= 5; r++) {
					coords.push({ q, r })
				}
			}

			const result = await generator.generateRegionAsync(
				{ terrainSeed: seed, characterCount: 0 },
				coords
			)

			// Should return all tiles
			expect(result.length).toBe(coords.length)

			// All coordinates should be preserved
			for (let i = 0; i < result.length; i++) {
				expect(result[i]!.coord.q).toBe(coords[i]!.q)
				expect(result[i]!.coord.r).toBe(coords[i]!.r)
			}

			// Verify deposit amounts are valid (if any deposits exist)
			for (const tile of result) {
				if (tile.deposit) {
					expect(tile.deposit.amount).toBeGreaterThan(0)
					expect(tile.deposit.amount).toBeLessThanOrEqual(18)
				}
			}

			// Verify goods amounts are valid (if any goods exist)
			for (const tile of result) {
				for (const [, amount] of Object.entries(tile.goods)) {
					expect(amount).toBeGreaterThan(0)
				}
			}
		})

		it('should preserve coordinates for negative coordinates', async () => {
			const seed = 11222
			const coords = createTestCoords([
				{ q: -5, r: -3 },
				{ q: -2, r: 1 },
				{ q: 0, r: 0 },
				{ q: 3, r: -2 },
				{ q: 7, r: 4 },
			])

			const result = await generator.generateRegionAsync(
				{ terrainSeed: seed, characterCount: 0 },
				coords
			)

			// Coordinates should be preserved
			expect(result.length).toBe(coords.length)
			for (let i = 0; i < result.length; i++) {
				expect(result[i]!.coord.q).toBe(coords[i]!.q)
				expect(result[i]!.coord.r).toBe(coords[i]!.r)
			}
		})

		it('should generate consistent walkTime values', async () => {
			const seed = 12333
			const coords = createTestCoords([
				{ q: 0, r: 0 },
				{ q: 1, r: 0 },
				{ q: 2, r: 0 },
				{ q: 0, r: 1 },
				{ q: 1, r: 1 },
				{ q: 2, r: 1 },
			])

			const result = await generator.generateRegionAsync(
				{ terrainSeed: seed, characterCount: 0 },
				coords
			)

			// All tiles should have walkTime
			for (const tile of result) {
				expect(tile.walkTime).toBeGreaterThan(0)
				expect(typeof tile.walkTime).toBe('number')
			}

			// All tiles should have the same walkTime (default value)
			const walkTimes = result.map((t) => t.walkTime)
			expect(new Set(walkTimes).size).toBe(1)
		})

		it('should handle mixed terrain types naturally', async () => {
			const seed = 13444
			const coords = createTestCoords([
				{ q: 0, r: 0 },
				{ q: 1, r: 0 },
				{ q: 2, r: 0 },
				{ q: 0, r: 1 },
				{ q: 1, r: 1 },
				{ q: 2, r: 1 },
				{ q: 0, r: 2 },
				{ q: 1, r: 2 },
				{ q: 2, r: 2 },
			])

			const result = await generator.generateRegionAsync(
				{ terrainSeed: seed, characterCount: 0 },
				coords
			)

			// All tiles should be generated
			expect(result.length).toBe(coords.length)

			// Should have at least one terrain type
			const terrainTypes = result.map((t) => t.terrain)
			const uniqueTerrainTypes = [...new Set(terrainTypes)]
			expect(uniqueTerrainTypes.length).toBeGreaterThan(0)

			// Verify deposit amounts are valid (if any deposits exist)
			for (const tile of result) {
				if (tile.deposit) {
					expect(tile.deposit.amount).toBeGreaterThan(0)
					expect(tile.deposit.amount).toBeLessThanOrEqual(18)
				}
			}

			// Verify goods amounts are valid (if any goods exist)
			for (const tile of result) {
				for (const [, amount] of Object.entries(tile.goods)) {
					expect(amount).toBeGreaterThan(0)
				}
			}
		})
	})
})
