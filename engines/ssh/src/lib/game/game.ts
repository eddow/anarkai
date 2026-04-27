import {
	bootstrapCharacterRadiusFallback,
	defaultNewGameCharacterCount,
	defaultNewGameCharacterRadius,
	gameMaxTickDeltaSeconds,
	gameplayBootstrapMinRadius,
	gameRootSpeed,
	gameTimeSpeedFactors,
} from 'engine-rules'
import { atomic, defer, Eventful, reactive, unreactive } from 'mutts'
import { Alveolus } from 'ssh/board'
import { HexBoard } from 'ssh/board/board'
import { BasicDwelling } from 'ssh/board/content/basic-dwelling'
import { BuildDwelling } from 'ssh/board/content/build-dwelling'
import { Deposit, UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import { Tile, type TileTerrainState } from 'ssh/board/tile'
import type { Zone } from 'ssh/board/zone'
import {
	type ConstructionPhase,
	createConstructionSiteState,
	type DwellingTier,
} from 'ssh/construction-state'
import type { FreightLineDefinition, SyntheticFreightLineObject } from 'ssh/freight/freight-line'
import {
	collectFreightLineBootstrapCoords,
	createSyntheticFreightLineObject,
	findFreightLineByUid,
	implicitGatherFreightLinesFromHivePatches,
	isFreightLineUid,
	isImplicitGatherFreightLineId,
	normalizeFreightLineDefinition,
} from 'ssh/freight/freight-line'
import {
	GameGenerator,
	type GeneratedCharacterData,
	type GeneratedTileData,
	PopulationGenerator,
	type TerrainTerraformPatch,
} from 'ssh/generation'
import { configuration } from 'ssh/globals'
import {
	AlveolusConfigurationManager,
	alveolusClass,
	anchorTileUidFromHiveUid,
	createSyntheticHiveObject,
	Hive,
	isHiveUid,
	type SyntheticHiveObject,
} from 'ssh/hive'
import { BuildAlveolus } from 'ssh/hive/build'
import {
	collectSerializedConveyMovementsWithIndex,
	restoreSerializedConveyMovements,
} from 'ssh/hive/convey-restore'
import type { SerializedConveyMovement } from 'ssh/hive/convey-serialize'
import type { TrackedMovement } from 'ssh/hive/hive'
import type { MovementRef } from 'ssh/hive/movement-ref'
import { StorageAlveolus } from 'ssh/hive/storage'
import { readSlottedStorageParams, usesSlottedStorageLayout } from 'ssh/hive/storage-action'
import { mrg, setHoveredObject } from 'ssh/interactive-state'
import { Population } from 'ssh/population/population'
import { type VehicleSerializedState, Vehicles } from 'ssh/population/vehicle'
import { ResidentialDemandTicker } from 'ssh/residential/demand'
import type { AlveolusType, DepositType, GoodType, TerrainType } from 'ssh/types'
import type { GameRenderer, InputAdapter } from 'ssh/types/engine'
import type { AxialCoord } from 'ssh/utils'
import { axial } from 'ssh/utils/axial'
import { SimulationLoop } from 'ssh/utils/loop'
import { LCG } from 'ssh/utils/numbers'
import { toAxialCoord } from 'ssh/utils/position'
import * as gameContent from '../../../assets/game-content'
import { assert } from '../dev/debug.ts'
import { GameplayFrontierController } from './gameplay-frontier'
import type { HittableGameObject, InteractiveGameObject } from './object'
import {
	TerrainProvider,
	type TerrainProviderDiagnostics,
	type TerrainSample,
} from './terrain-provider'

try {
	unreactive(gameContent)
} catch {
	// Ignore errors in test environment where gameContent might be a mock namespace
}
/** Save/new-game must replace with a persisted random seed; not authored rules data. */
const UNSAVED_DEFAULT_TERRAIN_SEED = 1234

export type GameEvents = {
	gameStart(): void
	objectsAdded(objects: InteractiveGameObject[]): void
	objectsChanged(objects: InteractiveGameObject[]): void
	objectsRemoved(objects: InteractiveGameObject[]): void
	objectOver(pointer: any, object: InteractiveGameObject, stopPropagation?: () => void): void
	objectOut(pointer: any, object: InteractiveGameObject): void
	objectDown(pointer: any, object: InteractiveGameObject, stopPropagation?: () => void): void
	objectUp(pointer: any, object: InteractiveGameObject): void
	objectClick(pointer: any, object: InteractiveGameObject): void
	objectDrag(tiles: Tile[], event: MouseEvent): void
	dragPreview(tiles: Tile[], zoneType: string): void
	dragPreviewClear(): void
}
unreactive(Eventful)
export type GameGenerationOptions = {
	terrainSeed: number
	characterCount: number
	characterRadius?: number
}

export type RenderableTerrainTile = TerrainSample

function hasTerrainProperty(value: unknown): value is { terrain: TerrainType } {
	return (
		!!value &&
		typeof value === 'object' &&
		typeof (value as { terrain?: unknown }).terrain === 'string'
	)
}

export interface AlveolusPatch {
	coord: readonly [number, number]
	goods?: Partial<Record<GoodType, number>>
	alveolus: AlveolusType | 'gather'
	/** When true, tile hosts a build shell for `alveolus` target, not the finished building. */
	underConstruction?: boolean
	/** Persisted construction work seconds on the build shell. */
	constructionWorkSecondsApplied?: number
	constructionPhase?: ConstructionPhase
	/** Configuration reference and individual config for this alveolus */
	configuration?: {
		ref: Ssh.ConfigurationReference
		individual?: Ssh.AlveolusConfiguration
	}
}

export interface DwellingPatch {
	coord: readonly [number, number]
	tier: DwellingTier
	/** When true, tile hosts an in-progress `BuildDwelling` shell. */
	underConstruction?: boolean
	constructionWorkSecondsApplied?: number
	constructionPhase?: ConstructionPhase
	goods?: Partial<Record<GoodType, number>>
}

export interface TilePatch {
	coord: readonly [number, number]
	deposit?: {
		type: DepositType
		name?: string
		amount: number
	}
	terrain?: TerrainType
	height?: number
	temperature?: number
	humidity?: number
	sediment?: number
	waterTable?: number
}

export interface VehiclePatch extends VehicleSerializedState {}

export interface GamePatches {
	tiles?: ReadonlyArray<TilePatch>
	hives?: ReadonlyArray<{
		name?: string
		working?: boolean
		alveoli: ReadonlyArray<AlveolusPatch>
	}>
	/** Explicit freight lines; implicit gather routes are merged from hive patches unless overridden by id. */
	freightLines?: ReadonlyArray<FreightLineDefinition>
	looseGoods?: ReadonlyArray<{
		goodType: GoodType
		position: { q: number; r: number }
	}>
	zones?: {
		harvest?: ReadonlyArray<readonly [number, number]>
		residential?: ReadonlyArray<readonly [number, number]>
	}
	projects?: Record<string, ReadonlyArray<readonly [number, number]>>
	dwellings?: ReadonlyArray<DwellingPatch>
	vehicles?: ReadonlyArray<VehiclePatch>
}

export interface SaveState extends GamePatches {
	/** In-flight convey movements; array index is the serialization identity for resume. */
	conveyMovements?: ReadonlyArray<SerializedConveyMovement>
	population: any[]
	generationOptions: GameGenerationOptions
	streamedFrontier?: Array<[number, number]>
	/** Global named configurations */
	namedConfigurations?: Record<AlveolusType, Record<string, Ssh.AlveolusConfiguration>>
	/** Per-hive configurations by alveolus type */
	hiveConfigurations?: Record<string, Record<string, Ssh.AlveolusConfiguration>>
}

function canonicalPatchedAlveolusType(alveolus: AlveolusPatch['alveolus']): AlveolusType {
	return alveolus === 'gather' ? 'freight_bay' : alveolus
}

export class Game extends Eventful<GameEvents> {
	public get name() {
		return 'GameX'
	}
	public get terrainSeed() {
		return this.generationOptions.terrainSeed
	}
	public get terrainOverrides(): ReadonlyArray<TerrainTerraformPatch> {
		return this.terrainTerraforming
	}
	public upsertTerrainOverride(
		coord: AxialCoord,
		override: Omit<TerrainTerraformPatch, 'coord'>
	): void {
		const next = [...this.terrainTerraforming]
		const index = next.findIndex(
			(entry) => entry.coord[0] === coord.q && entry.coord[1] === coord.r
		)
		const merged: TerrainTerraformPatch = {
			...(index >= 0 ? next[index] : { coord: [coord.q, coord.r] as [number, number] }),
			coord: [coord.q, coord.r],
			...override,
		}
		if (index >= 0) next[index] = merged
		else next.push(merged)
		this.terrainTerraforming = next
		// Overrides can affect hydrology neighborhood, so invalidate prefill cache conservatively.
		this.terrainProvider.invalidateAll()
		this.renderer?.invalidateTerrainHard?.(coord) ?? this.renderer?.invalidateTerrain?.(coord)
	}
	readonly random: ReturnType<typeof LCG> = LCG('gameSeed', 0)
	public lcg(seed: string | number) {
		return LCG('gameSeed', seed)
	}
	public renderer?: GameRenderer
	public input?: InputAdapter
	public readonly population: Population
	public readonly vehicles: Vehicles
	public readonly configurationManager = new AlveolusConfigurationManager()
	/** Registered freight lines (gather/distribute); merged at bootstrap from hive patches and explicit saves. */
	public freightLines: FreightLineDefinition[] = []
	// Dynamically loaded usage of Hive class
	private HiveClass?: typeof Hive

	public readonly objects = reactive(new Map<string, InteractiveGameObject>())
	public readonly hittableObjects = new Set<HittableGameObject>()
	public readonly hex: HexBoard
	public readonly generator: GameGenerator
	public readonly ticker: SimulationLoop
	private tickedObjects = new Set<{ update(deltaSeconds: number): void }>()
	private readonly pendingInteractiveRegistrations = new Map<string, InteractiveGameObject>()
	private readonly pendingInteractiveChanges = new Map<string, InteractiveGameObject>()
	private readonly pendingInteractiveUnregistrations = new Map<string, InteractiveGameObject>()
	private interactiveRegistrationBatchDepth = 0
	private interactiveLifecycleFlushScheduled = false
	private terrainTerraforming: TerrainTerraformPatch[] = []
	private readonly bootstrapGameplayCoords = new Set<string>()
	private readonly materializedGameplayCoords = new Map<string, AxialCoord>()
	private readonly terrainProvider: TerrainProvider
	private readonly gameplayFrontier = new GameplayFrontierController({
		hasMaterializedTile: (coord) => this.hasMaterializedGameplayTile(coord),
		materialize: async (coords) => {
			await this.materializeGameplayTilesAsync(coords)
		},
	})
	private residentialDemandTicker?: ResidentialDemandTicker
	private conveyRestoredAtLoad: TrackedMovement[] = []
	private conveySaveIndexByRef: Map<MovementRef, number> | undefined
	/** Active convey movements last restored from save (indexed by save order). */
	get conveyRestoredMovements(): readonly TrackedMovement[] {
		return this.conveyRestoredAtLoad
	}

	conveyMovementSaveIndex(ref: MovementRef): number | undefined {
		return this.conveySaveIndexByRef?.get(ref)
	}

	public readonly clock = reactive({
		virtualTime: 0,
	})
	public loaded: Promise<void>
	public rendererReady: Promise<void>
	public rendererReadyResolver?: () => void
	private async load() {
		// Headless load - just start ticker?
		this.ticker.start()
	}

	getObject(uid: string) {
		return (
			this.objects.get(uid) ??
			this.getSyntheticFreightLineObject(uid) ??
			this.getSyntheticHiveObject(uid)
		)
	}

	getSyntheticFreightLineObject(uid: string): SyntheticFreightLineObject | undefined {
		if (!isFreightLineUid(uid)) return undefined
		const line = findFreightLineByUid(this.freightLines, uid)
		return line ? createSyntheticFreightLineObject(this, line) : undefined
	}

	getSyntheticHiveObject(uid: string): SyntheticHiveObject | undefined {
		if (!isHiveUid(uid)) return undefined
		const anchorTileUid = anchorTileUidFromHiveUid(uid)
		if (!anchorTileUid) return undefined
		const tile = this.objects.get(anchorTileUid)
		if (!(tile instanceof Tile)) return undefined
		return createSyntheticHiveObject(this, tile)
	}

	replaceFreightLine(line: FreightLineDefinition): void {
		const normalized = normalizeFreightLineDefinition(line)
		const index = this.freightLines.findIndex((entry) => entry.id === line.id)
		if (index < 0) {
			this.freightLines = [...this.freightLines, normalized]
			return
		}
		const next = [...this.freightLines]
		next[index] = normalized
		this.freightLines = next
	}

	/**
	 * Removes an explicit freight line by id. Implicit hive gather lines cannot be removed
	 * (they are re-derived from hive patches on bootstrap).
	 */
	removeFreightLineById(lineId: string): boolean {
		if (isImplicitGatherFreightLineId(lineId)) return false
		const next = this.freightLines.filter((entry) => entry.id !== lineId)
		if (next.length === this.freightLines.length) return false
		this.freightLines = next
		return true
	}

	registerHittable(object: HittableGameObject) {
		this.hittableObjects.add(object)
	}
	unregisterHittable(object: HittableGameObject) {
		this.hittableObjects.delete(object)
	}

	public getTexture(spec: string) {
		return this.renderer?.getTexture(spec)
	}

	register(object: InteractiveGameObject, uid?: string) {
		this.objects.set(uid ?? crypto.randomUUID(), object)
	}

	unregister(object: InteractiveGameObject) {
		this.objects.delete(object.uid)
	}

	public enqueueInteractiveRegistration(object: InteractiveGameObject, uid?: string) {
		const key = uid ?? object.uid
		this.pendingInteractiveUnregistrations.delete(key)
		this.pendingInteractiveChanges.delete(key)
		this.pendingInteractiveRegistrations.set(key, object)
		this.scheduleInteractiveLifecycleFlush()
	}

	public enqueueInteractiveChange(object: InteractiveGameObject) {
		const key = object.uid
		if (
			this.pendingInteractiveRegistrations.has(key) ||
			this.pendingInteractiveUnregistrations.has(key)
		) {
			return
		}
		if (!this.objects.has(key)) return
		this.pendingInteractiveChanges.set(key, object)
		this.scheduleInteractiveLifecycleFlush()
	}

	/**
	 * After mutating `UnBuiltLand.deposit` or its `amount`, notify tile observers and refresh
	 * sector-baked resource visuals when a renderer implements `invalidateTerrain`.
	 */
	public notifyTerrainDepositsChanged(tile: Tile): void {
		this.enqueueInteractiveChange(tile)
		const coord = toAxialCoord(tile.position)
		if (!coord) return
		this.renderer?.invalidateTerrain?.(coord)
	}

	public enqueueInteractiveUnregistration(object: InteractiveGameObject) {
		const key = object.uid
		if (this.pendingInteractiveRegistrations.get(key) === object) {
			this.pendingInteractiveRegistrations.delete(key)
			return
		}
		this.pendingInteractiveRegistrations.delete(key)
		this.pendingInteractiveChanges.delete(key)
		if (this.objects.has(key)) {
			this.pendingInteractiveUnregistrations.set(key, object)
		}
		this.scheduleInteractiveLifecycleFlush()
	}

	public flushInteractiveChanges(): InteractiveGameObject[] {
		if (this.pendingInteractiveChanges.size === 0) return []
		const changed = [...this.pendingInteractiveChanges.values()]
		this.pendingInteractiveChanges.clear()
		return changed.filter((object) => this.objects.get(object.uid) === object)
	}

	public flushInteractiveUnregistrations(): InteractiveGameObject[] {
		if (this.pendingInteractiveUnregistrations.size === 0) return []
		const pending = [...this.pendingInteractiveUnregistrations.entries()]
		this.pendingInteractiveUnregistrations.clear()
		const removed: InteractiveGameObject[] = []
		atomic(() => {
			for (const [key, object] of pending) {
				const existing = this.objects.get(key)
				if (!existing || existing !== object) continue
				this.objects.delete(key)
				removed.push(existing)
			}
		})()
		return removed
	}

	public flushInteractiveRegistrations(): InteractiveGameObject[] {
		if (this.pendingInteractiveRegistrations.size === 0) return []
		const pending = [...this.pendingInteractiveRegistrations.entries()]
		this.pendingInteractiveRegistrations.clear()
		const added: InteractiveGameObject[] = []
		atomic(() => {
			for (const [key, object] of pending) {
				if (this.objects.get(key) === object) continue
				this.objects.set(key, object)
				added.push(object)
			}
		})()
		return added
	}

	private flushInteractiveLifecycleQueues() {
		this.interactiveLifecycleFlushScheduled = false
		const removed = this.flushInteractiveUnregistrations()
		const added = this.flushInteractiveRegistrations()
		const changed = this.flushInteractiveChanges()
		if (removed.length > 0) this.emit('objectsRemoved', removed)
		if (added.length > 0) this.emit('objectsAdded', added)
		if (changed.length > 0) this.emit('objectsChanged', changed)
	}

	private scheduleInteractiveLifecycleFlush() {
		if (this.interactiveRegistrationBatchDepth > 0 || this.interactiveLifecycleFlushScheduled)
			return
		this.interactiveLifecycleFlushScheduled = true
		defer(() => {
			this.flushInteractiveLifecycleQueues()
		})
	}

	public withObjectRegistrationBatch<T>(fn: () => T): T {
		this.interactiveRegistrationBatchDepth++
		try {
			return fn()
		} finally {
			this.interactiveRegistrationBatchDepth--
			if (this.interactiveRegistrationBatchDepth === 0) {
				this.flushInteractiveLifecycleQueues()
			}
		}
	}

	registerTickedObject(object: { update(deltaSeconds: number): void }) {
		this.tickedObjects.add(object)
	}

	unregisterTickedObject(object: { update(deltaSeconds: number): void }) {
		this.tickedObjects.delete(object)
	}

	public tickerCallback = (timer: SimulationLoop) => {
		const controlIndex = Math.max(
			0,
			Math.min(gameTimeSpeedFactors.length - 1, configuration.timeControl)
		)
		const speedFactor = gameTimeSpeedFactors[controlIndex] ?? gameTimeSpeedFactors[1]
		const deltaSeconds = ((gameRootSpeed * timer.elapsedMS) / 1000) * speedFactor
		if (deltaSeconds > gameMaxTickDeltaSeconds) return // debugger / tab-freeze guard

		this.clock.virtualTime += deltaSeconds

		for (const object of this.tickedObjects) {
			if ('destroyed' in object && object.destroyed) continue
			object.update(deltaSeconds)
		}
	}

	constructor(
		readonly generationOptions: GameGenerationOptions = {
			terrainSeed: UNSAVED_DEFAULT_TERRAIN_SEED,
			characterCount: defaultNewGameCharacterCount,
			characterRadius: defaultNewGameCharacterRadius,
		},
		private readonly patches: GamePatches = {}
	) {
		super()
		this.ticker = new SimulationLoop()
		this.loaded = this.load()
		// Create rendererReady promise that will be resolved when renderer is initialized
		this.rendererReady = new Promise((resolve) => {
			this.rendererReadyResolver = resolve
		})

		this.hex = new HexBoard(this)

		// Create population singleton
		this.population = new Population(this)
		this.vehicles = new Vehicles(this)

		this.generator = new GameGenerator()
		this.terrainProvider = new TerrainProvider({
			generator: this.generator,
			getGenerationConfig: () => this.generationOptions,
			getTerraformingPatches: () => this.terrainTerraforming,
			getGameplayTerrainSample: (coord) => this.getGameplayTerrainSample(coord),
		})

		this.loaded = this.loaded.then(async () => {
			this.HiveClass = Hive
			// Initialize base RNG with terrainSeed so everything is reproducible
			;(this as any).rng = LCG('gameSeed', this.generationOptions.terrainSeed)
			// Expose RNG to global for script helpers
			;(globalThis as any).__GAME_RANDOM__ = (max?: number, min?: number) => this.random(max, min)
			await this.generateAsync(this.generationOptions, this.patches)
			try {
				this.emit('gameStart')
			} catch (e) {
				console.error('Error during gameStart emission:', e)
			}

			this.residentialDemandTicker?.destroy()
			this.residentialDemandTicker = new ResidentialDemandTicker(this)
			// Register the main ticker callback and start the game ticker after everything is built
			this.ticker.add(this.tickerCallback)

			// Expose for testing
			;(globalThis as any).mrg = mrg
			;(globalThis as any).testHover = (uid?: string) => {
				const obj = uid ? this.getObject(uid) : undefined
				if (obj && 'canInteract' in obj) setHoveredObject(obj)
				console.log(`[testHover] set to ${uid} (${obj?.constructor.name})`)
			}
		})
	}

	public simulateObjectClick(object: InteractiveGameObject, event: MouseEvent = {} as any) {
		this.emit('objectClick', event, object)
	}

	private addBootstrapStateCoords(coords: AxialCoord[], patches: GamePatches | SaveState) {
		const streamedFrontier = 'streamedFrontier' in patches ? patches.streamedFrontier : undefined
		for (const coord of streamedFrontier ?? []) {
			coords.push({ q: coord[0], r: coord[1] })
		}
		const population = 'population' in patches ? patches.population : undefined
		for (const character of population ?? []) {
			const coord = toAxialCoord(character.position)
			if (coord) coords.push(axial.round(coord))
		}
		for (const vehicle of patches.vehicles ?? []) {
			coords.push({ q: vehicle.position.q, r: vehicle.position.r })
		}
		for (const line of patches.freightLines ?? []) {
			for (const coord of collectFreightLineBootstrapCoords(line)) {
				coords.push(coord)
			}
		}
	}

	private bootstrapAnchor(patches: GamePatches | SaveState): AxialCoord {
		const coords: AxialCoord[] = []
		for (const tile of patches.tiles ?? []) coords.push({ q: tile.coord[0], r: tile.coord[1] })
		for (const hive of patches.hives ?? []) {
			for (const alveolus of hive.alveoli)
				coords.push({ q: alveolus.coord[0], r: alveolus.coord[1] })
		}
		for (const coord of patches.zones?.harvest ?? []) coords.push({ q: coord[0], r: coord[1] })
		for (const coord of patches.zones?.residential ?? []) coords.push({ q: coord[0], r: coord[1] })
		for (const coordsForProject of Object.values(patches.projects ?? {})) {
			for (const coord of coordsForProject) coords.push({ q: coord[0], r: coord[1] })
		}
		for (const dwelling of patches.dwellings ?? []) {
			coords.push({ q: dwelling.coord[0], r: dwelling.coord[1] })
		}
		for (const good of patches.looseGoods ?? []) coords.push(axial.round(good.position))
		for (const vehicle of patches.vehicles ?? []) {
			coords.push({ q: vehicle.position.q, r: vehicle.position.r })
		}
		for (const line of patches.freightLines ?? []) {
			for (const coord of collectFreightLineBootstrapCoords(line)) {
				coords.push(coord)
			}
		}
		this.addBootstrapStateCoords(coords, patches)
		if (coords.length === 0) return { q: 0, r: 0 }

		const q = Math.round(coords.reduce((sum, coord) => sum + coord.q, 0) / coords.length)
		const r = Math.round(coords.reduce((sum, coord) => sum + coord.r, 0) / coords.length)
		return { q, r }
	}

	private collectBootstrapCoords(
		config: GameGenerationOptions,
		patches: GamePatches | SaveState
	): { coords: AxialCoord[]; anchor: AxialCoord } {
		const anchor = this.bootstrapAnchor(patches)
		const coords = new Map<string, AxialCoord>()
		const addCoord = (coord: AxialCoord) => {
			coords.set(`${coord.q},${coord.r}`, coord)
		}
		const addPatchCoord = (coord: readonly [number, number]) => {
			addCoord({ q: coord[0], r: coord[1] })
		}

		for (const tile of patches.tiles ?? []) addPatchCoord(tile.coord)
		for (const hive of patches.hives ?? []) {
			for (const alveolus of hive.alveoli) addPatchCoord(alveolus.coord)
		}
		for (const coord of patches.zones?.harvest ?? []) addPatchCoord(coord)
		for (const coord of patches.zones?.residential ?? []) addPatchCoord(coord)
		for (const coordsForProject of Object.values(patches.projects ?? {})) {
			for (const coord of coordsForProject) addPatchCoord(coord)
		}
		for (const dwelling of patches.dwellings ?? []) addPatchCoord(dwelling.coord)
		for (const good of patches.looseGoods ?? []) addCoord(axial.round(good.position))
		for (const vehicle of patches.vehicles ?? []) {
			addCoord({ q: vehicle.position.q, r: vehicle.position.r })
		}
		for (const line of patches.freightLines ?? []) {
			for (const coord of collectFreightLineBootstrapCoords(line)) {
				addCoord(coord)
			}
		}
		const streamedFrontier = 'streamedFrontier' in patches ? patches.streamedFrontier : undefined
		for (const coord of streamedFrontier ?? []) addPatchCoord(coord)
		const population = 'population' in patches ? patches.population : undefined
		for (const character of population ?? []) {
			const coord = toAxialCoord(character.position)
			if (coord) addCoord(axial.round(coord))
		}

		const spawnRadius = Math.max(
			gameplayBootstrapMinRadius,
			config.characterRadius ?? bootstrapCharacterRadiusFallback
		)
		if (config.characterCount > 0 || coords.size > 0) {
			for (const coord of axial.allTiles(anchor, spawnRadius)) addCoord(coord)
		}

		return { coords: [...coords.values()], anchor }
	}

	private collectCoreBootstrapCoords(
		config: GameGenerationOptions,
		patches: GamePatches
	): AxialCoord[] {
		return this.collectBootstrapCoords(config, patches).coords
	}

	private generateInitialWorld(config: GameGenerationOptions, patches: GamePatches) {
		this.bootstrapGameplayCoords.clear()
		for (const coord of this.collectCoreBootstrapCoords(config, patches)) {
			this.bootstrapGameplayCoords.add(axial.key(coord))
		}
		const { coords, anchor } = this.collectBootstrapCoords(config, patches)
		if (coords.length > 0) {
			const boardData = this.generator.generateRegion(config, coords, this.terrainTerraforming)
			this.loadGeneratedBoard(boardData)
			if (config.characterCount > 0) {
				const populationData = new PopulationGenerator().generateCharacters(
					{
						characterCount: config.characterCount,
						radius: config.characterRadius,
						origin: anchor,
					},
					boardData
				)
				this.loadGeneratedPopulation(populationData)
			}
		}
	}

	private async generateInitialWorldAsync(config: GameGenerationOptions, patches: GamePatches) {
		this.bootstrapGameplayCoords.clear()
		for (const coord of this.collectCoreBootstrapCoords(config, patches)) {
			this.bootstrapGameplayCoords.add(axial.key(coord))
		}
		const { coords, anchor } = this.collectBootstrapCoords(config, patches)
		if (coords.length > 0) {
			const boardData = await this.generator.generateRegionAsync(
				config,
				coords,
				this.terrainTerraforming
			)
			this.loadGeneratedBoard(boardData)
			if (config.characterCount > 0) {
				const populationData = new PopulationGenerator().generateCharacters(
					{
						characterCount: config.characterCount,
						radius: config.characterRadius,
						origin: anchor,
					},
					boardData
				)
				this.loadGeneratedPopulation(populationData)
			}
		}
	}

	private hasMaterializedGameplayTile(coord: AxialCoord) {
		return this.hex.getTileContent(coord) !== undefined
	}

	public hasRenderableTerrainAt(coord: AxialCoord): boolean {
		return this.getRenderableTerrainAt(coord) !== undefined
	}

	public getRenderableTerrainAt(coord: AxialCoord): RenderableTerrainTile | undefined {
		const gameplay = this.getGameplayTerrainSample(coord)
		if (gameplay) return gameplay
		return this.terrainProvider.getTerrainSample(coord)
	}

	private getGameplayTerrainSample(coord: AxialCoord): TerrainSample | undefined {
		if (!this.hasMaterializedGameplayTile(coord)) return undefined
		const content = this.hex.getTileContent(coord)
		const tile = content?.tile ?? this.hex.getTile(coord)
		const terrain =
			tile?.terrainState?.terrain ??
			tile?.baseTerrain ??
			(content instanceof UnBuiltLand ? content.terrain : undefined) ??
			(hasTerrainProperty(content) ? content.terrain : undefined) ??
			(content ? 'concrete' : undefined)

		if (!terrain) return undefined

		const deposit =
			content instanceof UnBuiltLand && content.deposit && content.deposit.amount > 0
				? {
						type:
							content.deposit.name ||
							(content.deposit.constructor as { resourceName?: string; key?: string })
								.resourceName ||
							(content.deposit.constructor as { resourceName?: string; key?: string }).key ||
							(content.deposit.constructor as { name?: string }).name ||
							'rock',
						amount: content.deposit.amount,
						name: content.deposit.name,
						maxAmount: content.deposit.maxAmount,
					}
				: undefined

		const sample: TerrainSample = {
			terrain,
			height: tile?.terrainState?.height ?? tile?.terrainHeight,
			deposit,
		}
		const hydrology = tile?.terrainHydrology ?? tile?.terrainState?.hydrology
		if (hydrology) sample.hydrology = hydrology
		return sample
	}

	public getTerrainSample(coord: AxialCoord): TerrainSample | undefined {
		return this.terrainProvider.getTerrainSample(coord)
	}

	public async ensureTerrainSamples(coords: Iterable<AxialCoord>): Promise<void> {
		await this.terrainProvider.ensureTerrainSamples(coords)
	}

	public getTerrainProviderDiagnostics(): TerrainProviderDiagnostics {
		return this.terrainProvider.getDiagnostics()
	}

	public updateTerrainViewportDemand(viewportId: string, coords: Iterable<AxialCoord>) {
		this.terrainProvider.updateViewportDemand(viewportId, coords)
	}

	public clearTerrainViewportDemand(viewportId: string) {
		this.terrainProvider.clearViewportDemand(viewportId)
	}

	private materializeGameplayTiles(coords: Iterable<AxialCoord>) {
		const missingCoords: AxialCoord[] = []
		for (const coord of coords) {
			if (this.hasMaterializedGameplayTile(coord)) continue
			missingCoords.push(coord)
		}
		if (missingCoords.length === 0) return

		const boardData = this.generator.generateRegion(
			this.generationOptions,
			missingCoords,
			this.terrainTerraforming
		)
		this.loadGeneratedBoard(boardData, { populateInitialGoods: false })
	}

	private async materializeGameplayTilesAsync(coords: Iterable<AxialCoord>) {
		const missingCoords: AxialCoord[] = []
		for (const coord of coords) {
			if (this.hasMaterializedGameplayTile(coord)) continue
			missingCoords.push(coord)
		}
		if (missingCoords.length === 0) return

		const boardData = await this.generator.generateRegionAsync(
			this.generationOptions,
			missingCoords,
			this.terrainTerraforming
		)
		this.loadGeneratedBoard(boardData, { populateInitialGoods: false })
	}

	public requestGameplayFrontier(
		center: AxialCoord,
		radius: number,
		options: { maxBatchSize?: number } = {}
	): Promise<boolean> {
		return this.gameplayFrontier.request({
			center,
			radius,
			maxBatchSize: options.maxBatchSize,
		})
	}

	public ensureGeneratedTiles(coords: Iterable<AxialCoord>) {
		this.materializeGameplayTiles(coords)
	}
	async ensureGeneratedTilesAsync(coords: Iterable<AxialCoord>) {
		await this.materializeGameplayTilesAsync(coords)
	}
	generate(config: GameGenerationOptions, patches: GamePatches = {}, saveState?: SaveState) {
		try {
			const terraforming: TerrainTerraformPatch[] = (patches.tiles ?? [])
				.filter(
					(p) =>
						p.height !== undefined ||
						p.temperature !== undefined ||
						p.humidity !== undefined ||
						p.sediment !== undefined ||
						p.waterTable !== undefined ||
						p.terrain !== undefined
				)
				.map((patch) => ({
					...patch,
					coord: [patch.coord[0], patch.coord[1]] as [number, number],
				}))
			this.terrainTerraforming = terraforming
			this.terrainProvider.invalidateAll()
			this.bootstrapGameplayCoords.clear()
			this.materializedGameplayCoords.clear()
			this.vehicles.deserialize([])

			this.generateInitialWorld(config, patches)
			// Apply patches if any
			if (patches.tiles?.length) this.applyTilePatches(patches.tiles)
			if (patches.hives?.length)
				this.applyHivesPatches(patches.hives, saveState?.hiveConfigurations)
			if (patches.looseGoods?.length) this.applyLooseGoodsPatches(patches.looseGoods)
			if (patches.zones) this.applyZonePatches(patches.zones)
			if (patches.projects) this.applyProjectPatches(patches.projects)
			if (patches.dwellings?.length) this.applyDwellingPatches(patches.dwellings)
			this.bootstrapFreightLines(patches)
			if (patches.vehicles?.length) this.applyVehiclePatches(patches.vehicles)
		} catch (error) {
			console.error('Generation failed:', error)
		}
	}
	async generateAsync(
		config: GameGenerationOptions,
		patches: GamePatches = {},
		saveState?: SaveState
	) {
		try {
			const terraforming: TerrainTerraformPatch[] = (patches.tiles ?? [])
				.filter(
					(p) =>
						p.height !== undefined ||
						p.temperature !== undefined ||
						p.humidity !== undefined ||
						p.sediment !== undefined ||
						p.waterTable !== undefined ||
						p.terrain !== undefined
				)
				.map((patch) => ({
					...patch,
					coord: [patch.coord[0], patch.coord[1]] as [number, number],
				}))
			this.terrainTerraforming = terraforming
			this.terrainProvider.invalidateAll()
			this.bootstrapGameplayCoords.clear()
			this.materializedGameplayCoords.clear()
			this.vehicles.deserialize([])

			await this.generateInitialWorldAsync(config, patches)
			if (patches.tiles?.length) this.applyTilePatches(patches.tiles)
			if (patches.hives?.length)
				this.applyHivesPatches(patches.hives, saveState?.hiveConfigurations)
			if (patches.looseGoods?.length) this.applyLooseGoodsPatches(patches.looseGoods)
			if (patches.zones) this.applyZonePatches(patches.zones)
			if (patches.projects) this.applyProjectPatches(patches.projects)
			if (patches.dwellings?.length) this.applyDwellingPatches(patches.dwellings)
			this.bootstrapFreightLines(patches)
			if (patches.vehicles?.length) this.applyVehiclePatches(patches.vehicles)
		} catch (error) {
			console.error('Async generation failed:', error)
		}
	}
	clickObject(event: any, object: InteractiveGameObject) {
		this.emit('objectClick', event, object)
	}

	/**
	 * Load generated board data into the game
	 */
	private loadGeneratedBoard(
		tileData: GeneratedTileData[],
		options: { populateInitialGoods?: boolean } = {}
	): void {
		const populateInitialGoods = options.populateInitialGoods ?? true
		this.withObjectRegistrationBatch(() => {
			for (const tileInfo of tileData) {
				this.materializedGameplayCoords.set(axial.key(tileInfo.coord), {
					q: tileInfo.coord.q,
					r: tileInfo.coord.r,
				})
				if (this.hex.getTileContent(tileInfo.coord)) continue
				const tile =
					this.hex.getTile(tileInfo.coord) ??
					this.withObjectRegistrationBatch(() => new Tile(this.hex, tileInfo.coord))
				tile.baseTerrain = tileInfo.terrain
				tile.terrainHeight = tileInfo.height
				tile.terrainHydrology = tileInfo.hydrology

				// Create deposit if present
				let deposit: Deposit | undefined
				if (tileInfo.deposit) {
					const DepositClass = Deposit.class[tileInfo.deposit.type as keyof typeof Deposit.class]
					if (DepositClass) {
						deposit = new DepositClass(tileInfo.deposit.amount)
					}
				}

				const land = new UnBuiltLand(tile, tileInfo.terrain, deposit)
				this.hex.setTileContent(tile, land)
				// Mark as generated after the content attach path, which otherwise dirties the tile.
				tile.asGenerated = true

				if (!populateInitialGoods) continue

				for (const [goodType, amount] of Object.entries(tileInfo.goods)) {
					for (let i = 0; i < amount; i++) {
						const u = this.random()
						const v = this.random()
						const q = (u - v) * 0.5
						const r = v - 0.5

						const randomPos = {
							q: tileInfo.coord.q + q,
							r: tileInfo.coord.r + r,
						}

						this.hex.looseGoods.add(tile, goodType as any, {
							position: randomPos,
						})
					}
				}
			}
		})
	}

	private bootstrapFreightLines(patches: GamePatches | SaveState): void {
		const merged = new Map<string, FreightLineDefinition>()
		const implicit = patches.hives?.length
			? implicitGatherFreightLinesFromHivePatches(patches.hives)
			: []
		for (const line of implicit) merged.set(line.id, normalizeFreightLineDefinition(line))
		for (const line of patches.freightLines ?? [])
			merged.set(line.id, normalizeFreightLineDefinition(line))
		this.freightLines = [...merged.values()]
	}

	private applyTilePatches(patches: NonNullable<GamePatches['tiles']>) {
		for (const p of patches) {
			const coord = { q: p.coord[0], r: p.coord[1] }
			const tile = this.hex.getTile(coord)
			if (!tile) continue
			const terrainState: TileTerrainState = { ...(tile.terrainState ?? {}) }
			let hasTerrainState = false
			if (p.terrain !== undefined) {
				tile.baseTerrain = p.terrain
				terrainState.terrain = p.terrain
				hasTerrainState = true
				this.terrainProvider.invalidateCoord(coord)
			}
			if (p.height !== undefined) {
				tile.terrainHeight = p.height
				terrainState.height = p.height
				hasTerrainState = true
				this.terrainProvider.invalidateCoord(coord)
			}
			if (p.temperature !== undefined) {
				terrainState.temperature = p.temperature
				hasTerrainState = true
			}
			if (p.humidity !== undefined) {
				terrainState.humidity = p.humidity
				hasTerrainState = true
			}
			if (p.sediment !== undefined) {
				terrainState.sediment = p.sediment
				hasTerrainState = true
			}
			if (p.waterTable !== undefined) {
				terrainState.waterTable = p.waterTable
				hasTerrainState = true
			}
			if (hasTerrainState) {
				terrainState.hydrology = tile.terrainHydrology
				tile.terrainState = terrainState
				this.upsertTerrainOverride(coord, {
					terrain: terrainState.terrain,
					height: terrainState.height,
					temperature: terrainState.temperature,
					humidity: terrainState.humidity,
					sediment: terrainState.sediment,
					waterTable: terrainState.waterTable,
				})
			}

			// If missing content and patch defines terrain, create UnBuiltLand
			if (!tile.content && p.terrain) {
				// Stub deposit if needed, will be refined below
				this.hex.setTileContent(tile, new UnBuiltLand(tile, p.terrain, undefined))
			}

			const content = tile.content
			if (content instanceof UnBuiltLand) {
				if (p.terrain) {
					// Hack: update terrain property if possible, or recreate?
					// UnBuiltLand.terrain might be readonly.
					// Checking UnBuiltLand definition is needed.
					// Assuming we can recreate if needed, or cast.
					// For now let's assume if we just created it, it's fine.
					// If it existed, we might need to replace.
					if ((content as any).terrain !== p.terrain) {
						// Recreate UnBuiltLand with new terrain
						const deposit = content.deposit
						this.hex.setTileContent(tile, new UnBuiltLand(tile, p.terrain, deposit))
					}
				}

				if (p.deposit) {
					const DepositClass = Deposit.class[p.deposit.type as keyof typeof Deposit.class]
					if (DepositClass) {
						// Re-fetch content in case it was replaced
						const currentContent = tile.content as UnBuiltLand
						currentContent.deposit = new DepositClass(p.deposit.amount)
						// Ensure name is set
						if (!currentContent.deposit.name) (currentContent.deposit as any).name = p.deposit.type
						this.notifyTerrainDepositsChanged(tile)
					}
				}
				if (
					p.terrain !== undefined ||
					p.deposit !== undefined ||
					p.height !== undefined ||
					p.temperature !== undefined ||
					p.humidity !== undefined ||
					p.sediment !== undefined ||
					p.waterTable !== undefined
				) {
					tile.asGenerated = false
				}
			}
		}
	}

	private applyLooseGoodsPatches(patches: NonNullable<GamePatches['looseGoods']>) {
		const patchedCoords = new Map<string, AxialCoord>()
		for (const fg of patches) {
			const coord = axial.round(fg.position)
			patchedCoords.set(axial.key(coord), coord)
		}
		for (const coord of patchedCoords.values()) {
			const existingGoods = [...this.hex.looseGoods.getGoodsAt(coord)]
			for (const good of existingGoods) {
				if (!good.isRemoved) good.remove()
			}
		}
		for (const fg of patches) {
			const tile = this.hex.getTile(axial.round(fg.position))
			if (!tile) continue
			this.hex.looseGoods.add(tile, fg.goodType, { position: fg.position })
		}
	}

	private applyHivesPatches(
		hives: NonNullable<GamePatches['hives']>,
		hiveConfigurations?: SaveState['hiveConfigurations']
	) {
		for (const hive of hives) {
			let hiveInstance: Hive | undefined
			for (const a of hive.alveoli) {
				const coord = { q: a.coord[0], r: a.coord[1] }
				const tile = this.hex.getTile(coord)
				if (!tile) continue
				tile.baseTerrain = 'concrete'
				tile.terrainState = {
					...(tile.terrainState ?? {}),
					terrain: 'concrete',
				}
				this.upsertTerrainOverride(coord, { terrain: 'concrete' })
				const alveolusType = canonicalPatchedAlveolusType(a.alveolus)
				if (a.underConstruction) {
					const constructionSite = createConstructionSiteState({
						kind: 'alveolus',
						alveolusType,
					})
					constructionSite.phase = a.constructionPhase ?? 'waiting_materials'
					constructionSite.workSecondsApplied = a.constructionWorkSecondsApplied ?? 0
					const build = new BuildAlveolus(tile, alveolusType, constructionSite)
					build.constructionWorkSecondsApplied = a.constructionWorkSecondsApplied ?? 0
					this.hex.setTileContent(tile, build)
					if (!build.hive) {
						if (this.HiveClass) {
							const h = this.HiveClass.for(tile)
							h.attach(build)
						}
					}
					hiveInstance = build.hive
					hiveInstance.name = hive.name
					hiveInstance.working = hive.working ?? true
					if (a.goods)
						for (const [good, qty] of Object.entries(a.goods))
							build.storage?.addGood(good as GoodType, qty)
					if (a.configuration) {
						build.configurationRef = a.configuration.ref
						if (a.configuration.individual) {
							build.individualConfiguration = reactive({ ...a.configuration.individual })
						}
					}
					tile.asGenerated = false
					continue
				}
				const AlveolusCtor = alveolusClass[alveolusType as keyof typeof alveolusClass]
				if (!AlveolusCtor) continue
				const alv = new AlveolusCtor(tile)
				this.hex.setTileContent(tile, alv)
				if (!alv.hive) {
					if (this.HiveClass) {
						const h = this.HiveClass.for(tile)
						h.attach(alv)
					}
				}
				hiveInstance = alv.hive
				alv.hive.name = hive.name
				alv.hive.working = hive.working ?? true
				if (a.goods)
					for (const [good, qty] of Object.entries(a.goods))
						alv.storage?.addGood(good as GoodType, qty)
				// Restore configuration if present
				if (a.configuration) {
					alv.configurationRef = a.configuration.ref
					if (a.configuration.individual) {
						const individual = reactive({ ...a.configuration.individual })
						if (
							alv instanceof StorageAlveolus &&
							usesSlottedStorageLayout(alv.action) &&
							'buffers' in individual &&
							individual.buffers
						) {
							const slotCount = readSlottedStorageParams(alv.action).slots
							const goods = Object.fromEntries(
								Object.entries(individual.buffers).map(([goodType, minSlots]) => [
									goodType,
									{
										minSlots: Math.max(0, Math.min(slotCount, Math.floor(minSlots))),
										maxSlots: 0,
									},
								])
							)
							const usedSlots = Object.values(goods).reduce(
								(total, rule) => total + rule.minSlots,
								0
							)
							alv.individualConfiguration = reactive({
								working: individual.working ?? true,
								generalSlots: Math.max(0, slotCount - usedSlots),
								goods,
							})
						} else {
							alv.individualConfiguration = individual
						}
					}
				}
				tile.asGenerated = false
			}
			assert(hiveInstance, 'Alveolus building on load')
			// Restore hive-level configurations
			if (hive.name && hiveConfigurations?.[hive.name] && hiveInstance) {
				for (const [alvType, config] of Object.entries(hiveConfigurations[hive.name])) {
					hiveInstance.configurations.set(alvType, config)
				}
			}
		}
	}

	private applyZonePatches(zones: NonNullable<GamePatches['zones']>) {
		for (const [zone, coords] of Object.entries(zones)) {
			for (const coord of coords) {
				const coordObj = { q: coord[0], r: coord[1] }
				const tile = this.hex.getTile(coordObj)
				if (!tile) continue
				tile.zone = zone as Zone
			}
		}
	}

	private applyProjectPatches(projects: NonNullable<GamePatches['projects']>) {
		for (const [projectType, coords] of Object.entries(projects)) {
			for (const coord of coords) {
				const coordObj = { q: coord[0], r: coord[1] }
				const tile = this.hex.getTile(coordObj)
				if (!tile) continue
				const content = tile.content
				if (content instanceof UnBuiltLand) {
					content.setProject(projectType)
					tile.asGenerated = false
				}
			}
		}
	}

	private applyDwellingPatches(dwellings: NonNullable<GamePatches['dwellings']>) {
		for (const entry of dwellings) {
			const coordObj = { q: entry.coord[0], r: entry.coord[1] }
			const tile = this.hex.getTile(coordObj)
			if (!tile) continue
			tile.baseTerrain = 'concrete'
			tile.terrainState = {
				...(tile.terrainState ?? {}),
				terrain: 'concrete',
			}
			this.upsertTerrainOverride(coordObj, { terrain: 'concrete' })
			if (entry.underConstruction) {
				const constructionSite = createConstructionSiteState({
					kind: 'dwelling',
					tier: entry.tier,
				})
				constructionSite.phase = entry.constructionPhase ?? 'waiting_materials'
				constructionSite.workSecondsApplied = entry.constructionWorkSecondsApplied ?? 0
				const build = new BuildDwelling(tile, entry.tier, constructionSite)
				build.constructionWorkSecondsApplied = entry.constructionWorkSecondsApplied ?? 0
				this.hex.setTileContent(tile, build)
				if (entry.goods) {
					for (const [good, qty] of Object.entries(entry.goods))
						build.storage?.addGood(good as GoodType, qty as number)
				}
			} else {
				this.hex.setTileContent(tile, new BasicDwelling(tile))
			}
			tile.asGenerated = false
		}
	}

	private applyVehiclePatches(vehicles: NonNullable<GamePatches['vehicles']>) {
		this.vehicles.deserialize(vehicles.map((entry) => ({ ...entry })))
	}

	public saveGameData(): SaveState {
		const tiles: Array<TilePatch> = []
		const hives = new Map<Hive, Array<AlveolusPatch>>()
		const looseGoodsPatches: Array<{ goodType: GoodType; position: { q: number; r: number } }> = []
		const streamedFrontier = [...this.materializedGameplayCoords.values()]
			.filter((coord) => !this.bootstrapGameplayCoords.has(axial.key(coord)))
			.filter((coord) => this.hex.getTile(coord)?.asGenerated)
			.map((coord) => [coord.q, coord.r] as [number, number])
		const zones: { harvest: Array<[number, number]>; residential: Array<[number, number]> } = {
			harvest: [],
			residential: [],
		}
		const projects: Record<string, Array<[number, number]>> = {}
		const dwellings: DwellingPatch[] = []

		// Enumerate using hex board contents map by sampling existing tiles
		for (const tile of this.hex.tiles) {
			const coord = toAxialCoord(tile.position)
			if (!coord) continue
			const { q, r } = coord
			const zone = this.hex.zoneManager.getZone(coord)
			if (zone === 'harvest') {
				zones.harvest!.push([q, r])
			} else if (zone === 'residential') {
				zones.residential!.push([q, r])
			}
			if (tile.asGenerated) continue
			const terrainState = tile.terrainState
			const content = tile.content
			if (!content && !terrainState) continue
			// Serialize minimal content state
			if (content instanceof UnBuiltLand) {
				tiles.push({
					coord: [q, r],
					terrain: terrainState?.terrain ?? content.terrain,
					height: terrainState?.height ?? tile.terrainHeight,
					temperature: terrainState?.temperature,
					humidity: terrainState?.humidity,
					sediment: terrainState?.sediment,
					waterTable: terrainState?.waterTable,
					deposit: content.deposit
						? {
								type:
									(content.deposit.constructor as any).key ??
									(content.deposit.constructor as any).name,
								amount: content.deposit.amount,
							}
						: undefined,
				})

				// Save project information
				if (content.project) {
					if (!projects[content.project]) {
						projects[content.project] = []
					}
					projects[content.project].push([q, r])
				}
			}

			if (terrainState && !(content instanceof UnBuiltLand)) {
				tiles.push({
					coord: [q, r],
					terrain: terrainState.terrain,
					height: terrainState.height ?? tile.terrainHeight,
					temperature: terrainState.temperature,
					humidity: terrainState.humidity,
					sediment: terrainState.sediment,
					waterTable: terrainState.waterTable,
				})
			}

			if (content instanceof Alveolus) {
				// Assume alveolus-like content decorated by GcClassed with resourceName accessible via .name
				const alveolusName = content.name
				if (!hives.has(content.hive)) hives.set(content.hive, [])
				const patch: AlveolusPatch =
					content instanceof BuildAlveolus
						? {
								coord: [q, r],
								alveolus: content.target,
								underConstruction: true,
								constructionWorkSecondsApplied: content.constructionWorkSecondsApplied,
								constructionPhase: content.constructionSite.phase,
								goods: content.storage?.stock || {},
							}
						: {
								coord: [q, r],
								alveolus: alveolusName as AlveolusType,
								goods: content.storage?.stock || {},
							}
				// Include configuration if not default hive scope
				if (content.configurationRef.scope !== 'hive' || content.individualConfiguration) {
					patch.configuration = {
						ref: content.configurationRef,
						individual: content.individualConfiguration,
					}
				}
				hives.get(content.hive)!.push(patch)
			}

			if (content instanceof BuildDwelling) {
				dwellings.push({
					coord: [q, r],
					tier: content.targetTier,
					underConstruction: true,
					constructionWorkSecondsApplied: content.constructionWorkSecondsApplied,
					constructionPhase: content.constructionSite.phase,
					goods: content.storage?.stock || {},
				})
			} else if (content instanceof BasicDwelling) {
				dwellings.push({
					coord: [q, r],
					tier: 'basic_dwelling',
				})
			}
		}

		// Save all looseGoods with their exact positions
		const looseGoodsMap = (this.hex.looseGoods as any).goods as Map<
			string,
			Array<{ goodType: GoodType; position: { q: number; r: number } }>
		>
		for (const [, goodsList] of looseGoodsMap.entries()) {
			for (const fg of goodsList) {
				looseGoodsPatches!.push({
					goodType: fg.goodType,
					position: fg.position,
				})
			}
		}

		// Serialize hive configurations
		const hiveConfigurations: Record<string, Record<string, Ssh.AlveolusConfiguration>> = {}
		for (const [hive, _alveoli] of hives.entries()) {
			if (hive.name && hive.configurations.size > 0) {
				hiveConfigurations[hive.name] = Object.fromEntries(hive.configurations)
			}
		}

		const { rows: conveyMovements, indexByRef } = collectSerializedConveyMovementsWithIndex(this)
		this.conveySaveIndexByRef = indexByRef
		try {
			return {
				tiles,
				hives: Array.from(hives.entries()).map(([hive, alveoli]) => ({
					name: hive.name,
					working: hive.working,
					alveoli,
				})),
				freightLines: [...this.freightLines],
				looseGoods: looseGoodsPatches,
				streamedFrontier,
				zones,
				projects,
				dwellings,
				vehicles: this.vehicles.serialize(),
				conveyMovements,
				population: this.population.serialize(),
				generationOptions: this.generationOptions,
				namedConfigurations: this.configurationManager.serialize(),
				hiveConfigurations,
			}
		} finally {
			this.conveySaveIndexByRef = undefined
		}
	}

	public async loadGameData(state: SaveState) {
		this.conveyRestoredAtLoad = []
		// 1. Restore named configurations first (before alveoli are created)
		if (state.namedConfigurations) {
			this.configurationManager.deserialize(state.namedConfigurations)
		}

		// 2. Re-generate the base world (terrain)
		// We assume state.generationOptions has the original seed
		// TODO: Restore RNG state if necessary, or just rely on seed

		this.residentialDemandTicker?.destroy()
		this.residentialDemandTicker = undefined

		this.hex.reset()
		this.bootstrapGameplayCoords.clear()
		this.materializedGameplayCoords.clear()
		this.vehicles.deserialize([])
		this.population.deserialize([])

		// 3. Generate and apply patches (passes hive configs for restoration)
		await this.generateAsync(state.generationOptions, state, state)

		this.residentialDemandTicker = new ResidentialDemandTicker(this)

		this.conveyRestoredAtLoad = restoreSerializedConveyMovements(this, state.conveyMovements)

		// 4. Load Population (after board is ready)
		if (state.population) {
			this.population.deserialize(state.population)
		}
	}

	/**
	 * Load generated population data into the game
	 */
	private loadGeneratedPopulation(characterData: GeneratedCharacterData[]): void {
		for (const charInfo of characterData) {
			this.population.createCharacter(charInfo.name, charInfo.coord)
		}
	}

	public destroy() {
		// Stop clock-driven work first so teardown does not race with pending simulation ticks.
		this.ticker.remove(this.tickerCallback)
		this.ticker.stop()
		this.residentialDemandTicker?.destroy()
		this.residentialDemandTicker = undefined
		try {
			this.vehicles.deserialize([])
		} catch {}
		try {
			this.population.deserialize([])
		} catch {}
		try {
			this.hex.reset()
		} catch {}
		this.tickedObjects.clear()
		this.hittableObjects.clear()
		this.pendingInteractiveRegistrations.clear()
		this.pendingInteractiveChanges.clear()
		this.pendingInteractiveUnregistrations.clear()
		this.objects.clear()
		this.interactiveLifecycleFlushScheduled = false
	}
}
