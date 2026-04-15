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
				maxAmount: 100,
				name: 'tree',
			},
		})
	})
})
