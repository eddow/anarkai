import type { GameGenerationConfig, GameGenerator, TerrainTerraformPatch } from 'ssh/generation'
import type { AxialDirection } from 'ssh/utils'
import { axial, type AxialCoord } from 'ssh/utils'
import type { TerrainType } from 'ssh/types'

export type TerrainHydrologyDirection = Exclude<AxialDirection, null>

export interface TerrainHydrologyEdgeSample {
	flux: number
	width: number
	depth: number
}

export interface TerrainHydrologySample {
	isChannel: boolean
	channelInfluence?: number
	bankInfluence?: number
	edges: Partial<Record<TerrainHydrologyDirection, TerrainHydrologyEdgeSample>>
}

export interface TerrainSample {
	terrain: TerrainType
	height?: number
	hydrology?: TerrainHydrologySample
	deposit?: {
		type: string
		amount: number
		name?: string
	}
}

export interface TerrainProviderDiagnostics {
	cacheSize: number
	inFlightSize: number
	viewportCount: number
	demandedCoords: number
	hits: number
	misses: number
	ensures: number
	generatedTiles: number
	evictions: number
	lastEnsureMs: number
	maxEnsureMs: number
}

interface CacheEntry {
	sample: TerrainSample
	lastAccessMs: number
}

interface TerrainProviderOptions {
	generator: GameGenerator
	getGenerationConfig(): GameGenerationConfig
	getTerraformingPatches(): TerrainTerraformPatch[]
	getGameplayTerrainSample(coord: AxialCoord): TerrainSample | undefined
	maxCacheEntries?: number
	idleEvictMs?: number
}

const DEFAULT_MAX_CACHE_ENTRIES = 60000
const DEFAULT_IDLE_EVICT_MS = 90_000

export class TerrainProvider {
	private readonly cache = new Map<string, CacheEntry>()
	private readonly inFlightByCoord = new Map<string, Promise<TerrainSample | undefined>>()
	private readonly viewportDemands = new Map<string, Set<string>>()
	private readonly maxCacheEntries: number
	private readonly idleEvictMs: number
	private diagnostics: TerrainProviderDiagnostics = {
		cacheSize: 0,
		inFlightSize: 0,
		viewportCount: 0,
		demandedCoords: 0,
		hits: 0,
		misses: 0,
		ensures: 0,
		generatedTiles: 0,
		evictions: 0,
		lastEnsureMs: 0,
		maxEnsureMs: 0,
	}

	constructor(private readonly options: TerrainProviderOptions) {
		this.maxCacheEntries = options.maxCacheEntries ?? DEFAULT_MAX_CACHE_ENTRIES
		this.idleEvictMs = options.idleEvictMs ?? DEFAULT_IDLE_EVICT_MS
	}

	public getDiagnostics(): TerrainProviderDiagnostics {
		return { ...this.diagnostics }
	}

	public getTerrainSample(coord: AxialCoord): TerrainSample | undefined {
		const gameplaySample = this.options.getGameplayTerrainSample(coord)
		if (gameplaySample) {
			this.upsert(coord, gameplaySample)
			return gameplaySample
		}
		const key = axial.key(coord)
		const cached = this.cache.get(key)
		if (!cached) {
			this.diagnostics.misses++
			return undefined
		}
		cached.lastAccessMs = nowMs()
		this.diagnostics.hits++
		return cached.sample
	}

	public async ensureTerrainSamples(coords: Iterable<AxialCoord>): Promise<void> {
		const startedAt = nowMs()
		this.diagnostics.ensures++
		const unique = new Map<string, AxialCoord>()
		for (const coord of coords) unique.set(axial.key(coord), coord)
		if (unique.size === 0) return

		const waiting: Promise<unknown>[] = []
		const missing: AxialCoord[] = []
		for (const [key, coord] of unique) {
			const gameplaySample = this.options.getGameplayTerrainSample(coord)
			if (gameplaySample) {
				this.upsert(coord, gameplaySample)
				continue
			}
			if (this.cache.has(key)) {
				this.cache.get(key)!.lastAccessMs = nowMs()
				continue
			}
			const inFlight = this.inFlightByCoord.get(key)
			if (inFlight) {
				waiting.push(inFlight)
				continue
			}
			missing.push(coord)
		}

		if (missing.length > 0) {
			const generation = this.generateAndCache(missing)
			for (const coord of missing) {
				const key = axial.key(coord)
				const perCoord = generation.then(() => this.cache.get(key)?.sample)
				this.inFlightByCoord.set(key, perCoord)
				waiting.push(
					perCoord.finally(() => {
						this.inFlightByCoord.delete(key)
					})
				)
			}
		}

		if (waiting.length > 0) await Promise.all(waiting)

		this.evictIfNeeded()
		const tookMs = nowMs() - startedAt
		this.diagnostics.lastEnsureMs = tookMs
		this.diagnostics.maxEnsureMs = Math.max(this.diagnostics.maxEnsureMs, tookMs)
		this.syncSizes()
	}

	public updateViewportDemand(viewportId: string, coords: Iterable<AxialCoord>) {
		const demanded = new Set<string>()
		for (const coord of coords) demanded.add(axial.key(coord))
		this.viewportDemands.set(viewportId, demanded)
		this.syncSizes()
	}

	public clearViewportDemand(viewportId: string) {
		this.viewportDemands.delete(viewportId)
		this.syncSizes()
	}

	public invalidateCoord(coord: AxialCoord) {
		this.cache.delete(axial.key(coord))
		this.syncSizes()
	}

	public invalidateAll() {
		this.cache.clear()
		this.syncSizes()
	}

	private async generateAndCache(coords: AxialCoord[]) {
		const tiles = await this.options.generator.generateRegionAsync(
			this.options.getGenerationConfig(),
			coords,
			this.options.getTerraformingPatches()
		)
		for (const tile of tiles) {
			const deposit = tile.deposit
			const sample: TerrainSample = {
				terrain: tile.terrain,
				height: tile.height,
				deposit: deposit
					? {
							type: deposit.type,
							amount: deposit.amount,
							name: deposit.type,
						}
					: undefined,
			}
			if (tile.hydrology) sample.hydrology = tile.hydrology
			this.upsert(tile.coord, sample)
		}
		this.diagnostics.generatedTiles += tiles.length
	}

	private upsert(coord: AxialCoord, sample: TerrainSample) {
		this.cache.set(axial.key(coord), {
			sample,
			lastAccessMs: nowMs(),
		})
	}

	private evictIfNeeded() {
		const demanded = this.collectDemandedKeys()
		const cutoff = nowMs() - this.idleEvictMs
		const candidates: Array<{ key: string; lastAccessMs: number }> = []
		for (const [key, entry] of this.cache) {
			if (demanded.has(key)) continue
			if (entry.lastAccessMs < cutoff) candidates.push({ key, lastAccessMs: entry.lastAccessMs })
		}
		candidates.sort((a, b) => a.lastAccessMs - b.lastAccessMs)
		for (const candidate of candidates) {
			if (this.cache.size <= this.maxCacheEntries) break
			if (!this.cache.delete(candidate.key)) continue
			this.diagnostics.evictions++
		}
		if (this.cache.size <= this.maxCacheEntries) return

		const sorted = [...this.cache.entries()]
			.filter(([key]) => !demanded.has(key))
			.sort((a, b) => a[1].lastAccessMs - b[1].lastAccessMs)
		for (const [key] of sorted) {
			if (this.cache.size <= this.maxCacheEntries) break
			if (!this.cache.delete(key)) continue
			this.diagnostics.evictions++
		}
	}

	private collectDemandedKeys(): Set<string> {
		const keys = new Set<string>()
		for (const demanded of this.viewportDemands.values()) {
			for (const key of demanded) keys.add(key)
		}
		return keys
	}

	private syncSizes() {
		this.diagnostics.cacheSize = this.cache.size
		this.diagnostics.inFlightSize = this.inFlightByCoord.size
		this.diagnostics.viewportCount = this.viewportDemands.size
		this.diagnostics.demandedCoords = this.collectDemandedKeys().size
	}
}

function nowMs(): number {
	return globalThis.performance?.now() ?? Date.now()
}
