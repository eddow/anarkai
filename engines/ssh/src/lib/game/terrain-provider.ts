import { deposits as depositDefinitions } from 'engine-rules'
import type { HydrologyPathTerminalKind, TerrainMacroHydrologySnapshot } from 'engine-terrain'
import type {
	GameGenerationConfig,
	GameGenerator,
	GeneratedTileData,
	TerrainTerraformPatch,
} from 'ssh/generation'
import type { TerrainType } from 'ssh/types'
import type { AxialDirection } from 'ssh/utils'
import { type AxialCoord, axial } from 'ssh/utils'
import { profile } from '../dev/debug.ts'

export type TerrainHydrologyDirection = Exclude<AxialDirection, null>

export type HydrologyTileRole =
	| 'none'
	| 'source'
	| 'through'
	| 'junction'
	| 'mouth'
	| 'inlandTerminal'
	| 'delta'

export interface TerrainHydrologyEdgeSample {
	flux: number
	width: number
	depth: number
}

/** Authoritative river path metadata projected from terrain generation. */
export interface TerrainRiverFlowSample {
	readonly upstreamDirections: readonly TerrainHydrologyDirection[]
	readonly downstreamDirections: readonly TerrainHydrologyDirection[]
	readonly rankFromSource: number
	readonly rankToSea: number
	readonly tileRole: HydrologyTileRole
	/** Present when terrain traced this tile as a path endpoint. */
	readonly pathTerminalKind?: HydrologyPathTerminalKind
}

export interface TerrainHydrologySample {
	isChannel: boolean
	channelInfluence?: number
	bankInfluence?: number
	edges: Partial<Record<TerrainHydrologyDirection, TerrainHydrologyEdgeSample>>
	riverFlow?: TerrainRiverFlowSample
}

export interface TerrainSample {
	terrain: TerrainType
	height?: number
	hydrology?: TerrainHydrologySample
	zone?: {
		id: string
		name: string
		color?: string
		generated: boolean
	}
	deposit?: {
		type: string
		amount: number
		name?: string
		maxAmount?: number
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
	macroCacheSize: number
	macroInFlightSize: number
	macroHits: number
	macroMisses: number
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
	onGeneratedTiles?(tiles: readonly GeneratedTileData[]): void
	maxCacheEntries?: number
	idleEvictMs?: number
}

export interface EnsureTerrainSectorsOptions {
	includeHydrology?: boolean
}

export interface EnsureMacroHydrologyOptions {
	macroStep?: number
	sectorRadius?: number
}

const DEFAULT_MAX_CACHE_ENTRIES = 60000
const DEFAULT_IDLE_EVICT_MS = 90_000
const MACRO_REGION_SNAP = 8
const MACRO_CACHE_SIZE = 4
const TERRAIN_PROVIDER_PROFILE_CHANNEL = 'terrainProvider'

function beginTerrainProviderProfile(
	label: string,
	payload?: unknown
): (payload?: unknown) => void {
	return profile[TERRAIN_PROVIDER_PROFILE_CHANNEL].begin?.(label, payload) ?? (() => {})
}

export class TerrainProvider {
	private readonly cache = new Map<string, CacheEntry>()
	private readonly inFlightByCoord = new Map<string, Promise<TerrainSample | undefined>>()
	private readonly inFlightBySector = new Map<string, Promise<void>>()
	private readonly macroCache = new Map<
		string,
		{ snapshot: TerrainMacroHydrologySnapshot; lastAccessMs: number }
	>()
	private readonly inFlightByMacro = new Map<string, Promise<TerrainMacroHydrologySnapshot>>()
	private activeMacroKey: string | undefined
	private readonly completedSectors = new Set<string>()
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
		macroCacheSize: 0,
		macroInFlightSize: 0,
		macroHits: 0,
		macroMisses: 0,
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

	public cacheGeneratedTiles(tiles: readonly GeneratedTileData[]): void {
		for (const tile of tiles) this.cacheGeneratedTile(tile)
		this.diagnostics.generatedTiles += tiles.length
		this.syncSizes()
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

	public async ensureTerrainSectors(
		sectorKeys: Iterable<string>,
		options: EnsureTerrainSectorsOptions = {}
	): Promise<void> {
		const startedAt = nowMs()
		this.diagnostics.ensures++
		const unique = new Set<string>()
		for (const key of sectorKeys) unique.add(key)
		if (unique.size === 0) return
		const endProfile = beginTerrainProviderProfile('ensureTerrainSectors', {
			sectors: unique.size,
			includeHydrology: options.includeHydrology ?? true,
		})

		const waiting: Promise<void>[] = []
		const missing: string[] = []
		for (const key of unique) {
			if (this.completedSectors.has(key)) continue
			const inFlight = this.inFlightBySector.get(key)
			if (inFlight) {
				waiting.push(inFlight)
				continue
			}
			missing.push(key)
		}

		if (missing.length > 0) {
			const generation = this.generateSectorsAndCache(missing, options)
			for (const key of missing) {
				const perSector = generation.finally(() => {
					this.inFlightBySector.delete(key)
				})
				this.inFlightBySector.set(key, perSector)
				waiting.push(perSector)
			}
		}

		if (waiting.length > 0) await Promise.all(waiting)

		this.evictIfNeeded()
		const tookMs = nowMs() - startedAt
		this.diagnostics.lastEnsureMs = tookMs
		this.diagnostics.maxEnsureMs = Math.max(this.diagnostics.maxEnsureMs, tookMs)
		this.syncSizes()
		endProfile({
			ms: tookMs,
			requestedSectors: unique.size,
			missingSectors: missing.length,
			waiting: waiting.length,
			cacheSize: this.cache.size,
			inFlight: this.inFlightBySector.size,
		})
	}

	public async ensureMacroHydrology(
		centerSectorKey: string,
		options: EnsureMacroHydrologyOptions = {}
	): Promise<void> {
		const [rawQ, rawR] = centerSectorKey.split(',').map(Number)
		const center = { q: rawQ ?? 0, r: rawR ?? 0 }
		const config = this.options.getGenerationConfig()
		const macroStep = options.macroStep ?? 8
		const sectorRadius = options.sectorRadius ?? 12
		const endProfile = beginTerrainProviderProfile('ensureMacroHydrology', {
			centerSectorKey,
			macroStep,
			sectorRadius,
		})
		const snapped = {
			q: Math.floor(center.q / MACRO_REGION_SNAP) * MACRO_REGION_SNAP,
			r: Math.floor(center.r / MACRO_REGION_SNAP) * MACRO_REGION_SNAP,
		}
		const key = `${config.terrainSeed}:${snapped.q},${snapped.r}:r${sectorRadius}:m${macroStep}`
		const cached = this.macroCache.get(key)
		if (cached) {
			cached.lastAccessMs = nowMs()
			this.activeMacroKey = key
			this.diagnostics.macroHits++
			this.syncSizes()
			endProfile({ cache: 'hit', key, macroCacheSize: this.macroCache.size })
			return
		}
		this.diagnostics.macroMisses++
		let inFlight = this.inFlightByMacro.get(key)
		if (!inFlight) {
			inFlight = (async () => {
				try {
					const snapshot = await this.options.generator.generateMacroHydrologyAsync(
						config,
						snapped,
						{
							macroStep,
							sectorRadius,
						}
					)
					this.macroCache.set(key, { snapshot, lastAccessMs: nowMs() })
					this.activeMacroKey = key
					this.evictMacroIfNeeded()
					return snapshot
				} finally {
					this.inFlightByMacro.delete(key)
					this.syncSizes()
				}
			})()
			this.inFlightByMacro.set(key, inFlight)
			this.syncSizes()
		}
		const snapshot = await inFlight
		this.macroCache.set(key, { snapshot, lastAccessMs: nowMs() })
		this.activeMacroKey = key
		this.evictMacroIfNeeded()
		this.syncSizes()
		endProfile({
			cache: inFlight === this.inFlightByMacro.get(key) ? 'wait' : 'miss',
			key,
			macroCacheSize: this.macroCache.size,
			macroTiles: snapshot.macroTileCount,
			riverSegments: snapshot.riverSegmentCount,
			wasmMs: snapshot.timings.wasmMs,
			unpackMs: snapshot.timings.unpackMs,
			totalMs: snapshot.timings.totalMs,
		})
	}

	public getTerrainMacroHydrology(): TerrainMacroHydrologySnapshot | undefined {
		if (!this.activeMacroKey) return undefined
		const cached = this.macroCache.get(this.activeMacroKey)
		if (!cached) return undefined
		cached.lastAccessMs = nowMs()
		return cached.snapshot
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
		this.completedSectors.clear()
		this.syncSizes()
	}

	public invalidateAll() {
		this.cache.clear()
		this.completedSectors.clear()
		this.syncSizes()
	}

	private async generateAndCache(coords: AxialCoord[]) {
		const tiles = await this.options.generator.generateRegionAsync(
			this.options.getGenerationConfig(),
			coords,
			this.options.getTerraformingPatches()
		)
		for (const tile of tiles) this.cacheGeneratedTile(tile)
		this.options.onGeneratedTiles?.(tiles)
		this.diagnostics.generatedTiles += tiles.length
	}

	private async generateSectorsAndCache(
		sectorKeys: string[],
		options: EnsureTerrainSectorsOptions = {}
	) {
		const sectors = sectorKeys.map((key) => {
			const [q, r] = key.split(',').map(Number)
			return { q: q ?? 0, r: r ?? 0 }
		})
		const tiles = await this.options.generator.generateSectorsAsync(
			this.options.getGenerationConfig(),
			sectors,
			this.options.getTerraformingPatches(),
			{ includeHydrology: options.includeHydrology ?? true }
		)
		for (const tile of tiles) this.cacheGeneratedTile(tile)
		this.options.onGeneratedTiles?.(tiles)
		for (const key of sectorKeys) this.completedSectors.add(key)
		this.diagnostics.generatedTiles += tiles.length
	}

	private cacheGeneratedTile(tile: GeneratedTileData): void {
		const deposit = tile.deposit
		const sample: TerrainSample = {
			terrain: tile.terrain,
			height: tile.height,
			deposit: deposit
				? {
						type: deposit.type,
						amount: deposit.amount,
						name: deposit.type,
						maxAmount:
							depositDefinitions[deposit.type as keyof typeof depositDefinitions]?.maxAmount,
					}
				: undefined,
		}
		if (tile.hydrology) sample.hydrology = tile.hydrology
		this.upsert(tile.coord, sample)
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
			this.completedSectors.clear()
			this.diagnostics.evictions++
		}
		if (this.cache.size <= this.maxCacheEntries) return

		const sorted = [...this.cache.entries()]
			.filter(([key]) => !demanded.has(key))
			.sort((a, b) => a[1].lastAccessMs - b[1].lastAccessMs)
		for (const [key] of sorted) {
			if (this.cache.size <= this.maxCacheEntries) break
			if (!this.cache.delete(key)) continue
			this.completedSectors.clear()
			this.diagnostics.evictions++
		}
	}

	private evictMacroIfNeeded() {
		if (this.macroCache.size <= MACRO_CACHE_SIZE) return
		const entries = [...this.macroCache.entries()].sort(
			(a, b) => a[1].lastAccessMs - b[1].lastAccessMs
		)
		for (const [key] of entries) {
			if (this.macroCache.size <= MACRO_CACHE_SIZE) break
			if (key === this.activeMacroKey) continue
			this.macroCache.delete(key)
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
		this.diagnostics.inFlightSize = this.inFlightByCoord.size + this.inFlightBySector.size
		this.diagnostics.macroCacheSize = this.macroCache.size
		this.diagnostics.macroInFlightSize = this.inFlightByMacro.size
		this.diagnostics.viewportCount = this.viewportDemands.size
		this.diagnostics.demandedCoords = this.collectDemandedKeys().size
	}
}

function nowMs(): number {
	return globalThis.performance?.now() ?? Date.now()
}
