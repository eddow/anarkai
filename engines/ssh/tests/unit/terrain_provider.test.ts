import { TerrainProvider, type TerrainSample } from 'ssh/game/terrain-provider'
import type { GameGenerationConfig, TerrainTerraformPatch } from 'ssh/generation'
import { describe, expect, it, vi } from 'vitest'

describe('terrain provider', () => {
	it('resolves terrain samples deterministically and honors overrides', async () => {
		const generationConfig: GameGenerationConfig = {
			terrainSeed: 42,
			characterCount: 0,
		}
		const overrides: TerrainTerraformPatch[] = [{ coord: [1, 1], terrain: 'sand', height: 0.7 }]
		const generateRegionAsync = vi.fn(
			async (
				_config: GameGenerationConfig,
				coords: Iterable<{ q: number; r: number }>,
				patches = []
			) =>
				[...coords].map((coord) => {
					const patch = patches.find(
						(entry: TerrainTerraformPatch) =>
							entry.coord[0] === coord.q && entry.coord[1] === coord.r
					)
					return {
						coord,
						terrain: patch?.terrain ?? ('grass' as const),
						height: patch?.height ?? 0.1,
						goods: {},
						walkTime: 3,
					}
				})
		)

		const provider = new TerrainProvider({
			generator: { generateRegionAsync } as any,
			getGenerationConfig: () => generationConfig,
			getTerraformingPatches: () => overrides,
			getGameplayTerrainSample: () => undefined,
		})

		await provider.ensureTerrainSamples([{ q: 1, r: 1 }])
		const sample = provider.getTerrainSample({ q: 1, r: 1 })

		expect(sample).toEqual({ terrain: 'sand', height: 0.7 })
		await provider.ensureTerrainSamples([{ q: 1, r: 1 }])
		expect(generateRegionAsync).toHaveBeenCalledTimes(1)
	})

	it('publishes generated terrain batches to the owner', async () => {
		const onGeneratedTiles = vi.fn()
		const generateRegionAsync = vi.fn(async (_config, coords: Iterable<{ q: number; r: number }>) =>
			[...coords].map((coord) => ({
				coord,
				terrain: 'grass' as const,
				height: 0,
				goods: {},
				walkTime: 3,
			}))
		)
		const provider = new TerrainProvider({
			generator: { generateRegionAsync } as any,
			getGenerationConfig: () => ({ terrainSeed: 7, characterCount: 0 }),
			getTerraformingPatches: () => [],
			getGameplayTerrainSample: () => undefined,
			onGeneratedTiles,
		})

		await provider.ensureTerrainSamples([{ q: 2, r: -1 }])

		expect(onGeneratedTiles).toHaveBeenCalledWith([
			expect.objectContaining({
				coord: expect.objectContaining({ q: 2, r: -1 }),
				terrain: 'grass',
				height: 0,
				goods: {},
				walkTime: 3,
			}),
		])
	})

	it('prefers gameplay terrain sample over render-prefill generation', async () => {
		const gameplaySample: TerrainSample = { terrain: 'concrete', height: 0.4 }
		const generateRegionAsync = vi.fn(async () => [])
		const provider = new TerrainProvider({
			generator: { generateRegionAsync } as any,
			getGenerationConfig: () => ({ terrainSeed: 1, characterCount: 0 }),
			getTerraformingPatches: () => [],
			getGameplayTerrainSample: (coord) =>
				coord.q === 0 && coord.r === 0 ? gameplaySample : undefined,
		})

		await provider.ensureTerrainSamples([{ q: 0, r: 0 }])
		expect(provider.getTerrainSample({ q: 0, r: 0 })).toEqual(gameplaySample)
		expect(generateRegionAsync).not.toHaveBeenCalled()
	})

	it('coalesces overlapping in-flight sample requests', async () => {
		let resolveBatch: (() => void) | undefined
		const started = new Promise<void>((resolve) => {
			resolveBatch = resolve
		})
		const generateRegionAsync = vi.fn(
			async (_config, coords: Iterable<{ q: number; r: number }>) => {
				await started
				return [...coords].map((coord) => ({
					coord,
					terrain: 'grass' as const,
					height: 0,
					goods: {},
					walkTime: 3,
				}))
			}
		)
		const provider = new TerrainProvider({
			generator: { generateRegionAsync } as any,
			getGenerationConfig: () => ({ terrainSeed: 9, characterCount: 0 }),
			getTerraformingPatches: () => [],
			getGameplayTerrainSample: () => undefined,
		})

		const first = provider.ensureTerrainSamples([{ q: 3, r: -2 }])
		const second = provider.ensureTerrainSamples([{ q: 3, r: -2 }])
		await Promise.resolve()
		expect(generateRegionAsync).toHaveBeenCalledTimes(1)
		resolveBatch?.()
		await Promise.all([first, second])

		expect(provider.getTerrainSample({ q: 3, r: -2 })).toEqual({ terrain: 'grass', height: 0 })
		expect(generateRegionAsync).toHaveBeenCalledTimes(1)
	})

	it('requests sector generation with one sector list and caches returned tiles', async () => {
		const generateSectorsAsync = vi.fn(
			async (_config, sectors: Iterable<{ q: number; r: number }>) => {
				return [...sectors].map((sector) => ({
					coord: { q: sector.q * 17, r: sector.r * 17 },
					terrain: 'grass' as const,
					height: sector.q + sector.r,
					goods: {},
					walkTime: 3,
				}))
			}
		)
		const provider = new TerrainProvider({
			generator: { generateSectorsAsync } as any,
			getGenerationConfig: () => ({ terrainSeed: 9, characterCount: 0 }),
			getTerraformingPatches: () => [],
			getGameplayTerrainSample: () => undefined,
		})

		await provider.ensureTerrainSectors(['0,0', '1,-1'])

		expect(generateSectorsAsync).toHaveBeenCalledTimes(1)
		expect([
			...(generateSectorsAsync.mock.calls[0]![1] as Iterable<{ q: number; r: number }>),
		]).toEqual([
			{ q: 0, r: 0 },
			{ q: 1, r: -1 },
		])
		expect(provider.getTerrainSample({ q: 0, r: 0 })).toEqual({ terrain: 'grass', height: 0 })
		expect(provider.getTerrainSample({ q: 17, r: -17 })).toEqual({
			terrain: 'grass',
			height: 0,
		})

		await provider.ensureTerrainSectors(['0,0', '1,-1'])
		expect(generateSectorsAsync).toHaveBeenCalledTimes(1)
	})

	it('tracks viewport demand and evicts non-demanded cache entries', async () => {
		const generateRegionAsync = vi.fn(
			async (_config, coords: Iterable<{ q: number; r: number }>) => {
				return [...coords].map((coord) => ({
					coord,
					terrain: 'grass' as const,
					height: 0,
					goods: {},
					walkTime: 3,
				}))
			}
		)
		const provider = new TerrainProvider({
			generator: { generateRegionAsync } as any,
			getGenerationConfig: () => ({ terrainSeed: 5, characterCount: 0 }),
			getTerraformingPatches: () => [],
			getGameplayTerrainSample: () => undefined,
			maxCacheEntries: 2,
			idleEvictMs: 0,
		})

		provider.updateViewportDemand('view-a', [{ q: 1, r: 1 }])
		await provider.ensureTerrainSamples([
			{ q: 1, r: 1 },
			{ q: 2, r: 2 },
			{ q: 3, r: 3 },
		])

		const diagnostics = provider.getDiagnostics()
		expect(diagnostics.viewportCount).toBe(1)
		expect(diagnostics.demandedCoords).toBe(1)
		expect(diagnostics.cacheSize).toBeLessThanOrEqual(2)
		expect(diagnostics.evictions).toBeGreaterThan(0)
		expect(provider.getTerrainSample({ q: 1, r: 1 })).toEqual({ terrain: 'grass', height: 0 })
	})

	it('preserves deposit metadata in generated render samples', async () => {
		const generateRegionAsync = vi.fn(
			async (_config, coords: Iterable<{ q: number; r: number }>) => {
				return [...coords].map((coord) => ({
					coord,
					terrain: 'forest' as const,
					height: 0.3,
					hydrology: {
						isChannel: true,
						channelInfluence: 1.5,
						edges: {
							0: { flux: 12, width: 4, depth: 2 },
						},
					},
					deposit: { type: 'tree' as const, amount: 3, maxAmount: 100, name: 'tree' },
					goods: {},
					walkTime: 3,
				}))
			}
		)
		const provider = new TerrainProvider({
			generator: { generateRegionAsync } as any,
			getGenerationConfig: () => ({ terrainSeed: 5, characterCount: 0 }),
			getTerraformingPatches: () => [],
			getGameplayTerrainSample: () => undefined,
		})

		await provider.ensureTerrainSamples([{ q: 4, r: -2 }])
		expect(provider.getTerrainSample({ q: 4, r: -2 })).toEqual({
			terrain: 'forest',
			height: 0.3,
			hydrology: {
				isChannel: true,
				channelInfluence: 1.5,
				edges: {
					0: { flux: 12, width: 4, depth: 2 },
				},
			},
				deposit: {
					type: 'tree',
					amount: 3,
					maxAmount: 12,
					name: 'tree',
				},
			})
	})

	it('caches macro hydrology by snapped macro center', async () => {
		const generateMacroHydrologyAsync = vi.fn(async (_config, centerSector, options) => ({
			seed: 9,
			centerSector,
			sectorRadius: 12,
			sectorStep: 17,
			macroStep: options?.macroStep ?? 8,
			macroTileCount: 100,
			riverSegmentCount: 1,
			maxAccumulation: 12,
			tiles: [{ q: 0, r: 0, height: 0.1, biome: 'grass' as const }],
			segments: [{ fromQ: 0, fromR: 0, toQ: 4, toR: 0, flux: 12, width: 2, order: 1 }],
			timings: { wasmMs: 1, unpackMs: 0, totalMs: 1 },
		}))
		const provider = new TerrainProvider({
			generator: { generateMacroHydrologyAsync } as any,
			getGenerationConfig: () => ({ terrainSeed: 9, characterCount: 0 }),
			getTerraformingPatches: () => [],
			getGameplayTerrainSample: () => undefined,
		})

		await provider.ensureMacroHydrology('3,3')
		await provider.ensureMacroHydrology('-3,-3')
		expect(generateMacroHydrologyAsync).toHaveBeenCalledTimes(1)
		expect(generateMacroHydrologyAsync.mock.calls[0]![1]).toEqual({ q: 0, r: 0 })
		expect(generateMacroHydrologyAsync.mock.calls[0]![2]).toEqual({
			macroStep: 8,
			sectorRadius: 12,
		})
		expect(provider.getTerrainMacroHydrology()?.segments).toHaveLength(1)

		await provider.ensureMacroHydrology('8,0')
		expect(generateMacroHydrologyAsync).toHaveBeenCalledTimes(2)
		expect(generateMacroHydrologyAsync.mock.calls[1]![1]).toEqual({ q: 8, r: 0 })
		await provider.ensureMacroHydrology('8,0', { macroStep: 4 })
		expect(generateMacroHydrologyAsync).toHaveBeenCalledTimes(3)
		expect(generateMacroHydrologyAsync.mock.calls[2]![1]).toEqual({ q: 8, r: 0 })
		expect(generateMacroHydrologyAsync.mock.calls[2]![2]).toEqual({
			macroStep: 4,
			sectorRadius: 12,
		})
		expect(provider.getDiagnostics().macroCacheSize).toBe(3)
	})
})
