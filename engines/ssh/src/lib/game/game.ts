import {
	bootstrapCharacterRadiusFallback,
	commerce,
	defaultNewGameCharacterCount,
	defaultNewGameCharacterRadius,
	gameMaxTickDeltaSeconds,
	gameplayBootstrapMinRadius,
	gameRootSpeed,
	gameTimeSpeedFactors,
} from 'engine-rules'
import type { TerrainMacroHydrologySnapshot, TerrainSectorCoord } from 'engine-terrain'
import { atomic, Eventful, reactive, unreactive } from 'mutts'
import { Alveolus } from 'ssh/board'
import { HexBoard } from 'ssh/board/board'
import { BasicDwelling } from 'ssh/board/content/basic-dwelling'
import { Deposit, normalizePlantedTrees, UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import {
	canBuildRoadOnTrace,
	type RoadPatches,
	type RoadPatchInput,
	type RoadType,
	roadBordersForTrace,
} from 'ssh/board/roads'
import { Tile, type TileTerrainState } from 'ssh/board/tile'
import type { NamedZoneDefinition, Zone } from 'ssh/board/zone'
import { createZoneObjectForUid } from 'ssh/board/zone-object'
import { isConstructionSiteShell } from 'ssh/build-site'
import {
	createNpcSettlementTradeProfile,
	createSettlementTradeObjectForUid,
	type NpcSettlementTradeProfile,
} from 'ssh/commerce/settlement-trade'
import { applyConstructionConcreteTerrain, createConstructionShell } from 'ssh/construction-shell'
import {
	type ConstructionPhase,
	constructionTargetFromProject,
	createConstructionSiteState,
	type DwellingTier,
	resolveAlveolusVariant,
	VARIANT_DELIMITER,
} from 'ssh/construction-state'
import { BayQueueRegistry } from 'ssh/freight/bay-queue-registry'
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
import { maybeAdvanceVehicleFromCompletedAnchorStop } from 'ssh/freight/vehicle-run'
import {
	GameGenerator,
	type GeneratedCharacterData,
	type GeneratedTileData,
	generateSettlementRegionSetPlan,
	type NameThemeId,
	type TerrainTerraformPatch,
} from 'ssh/generation'
import { configuration } from 'ssh/globals'
import { AlveolusConfigurationManager, createAlveolus, Hive } from 'ssh/hive'
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
import { TransformAlveolus } from 'ssh/hive/transform'
import {
	createConstructionSiteForHivePlanEntry,
	HivePlanCollection,
	type HivePlanPlacementPreview,
	previewHivePlanPlacement,
	type SerializedHivePlan,
} from 'ssh/hive-plan'
import { Population } from 'ssh/population/population'
import { type VehicleSerializedState, Vehicles } from 'ssh/population/vehicle'
import { ResidentialDemandTicker } from 'ssh/residential/demand'
import type { AlveolusType, DepositType, GoodType, TerrainType } from 'ssh/types'
import type { GameRenderer, InputAdapter } from 'ssh/types/engine'
import type { AxialCoord } from 'ssh/utils'
import { axial } from 'ssh/utils/axial'
import { Clock } from 'ssh/utils/clock'
import { SimulationLoop } from 'ssh/utils/loop'
import { LCG } from 'ssh/utils/numbers'
import { toAxialCoord } from 'ssh/utils/position'
import * as gameContent from '../../../assets/game-content'
import { assert, setTraceTimeSource } from '../dev/debug.ts'
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
const GAMEPLAY_SECTOR_STEP = 17
const SETTLEMENT_REGION_SET_SECTOR_SPAN = 4

export type GameEvents = {
	gameStart(): void
	presentationEvents(events: readonly GamePresentationEvent[]): void
	conveyEvents(events: readonly GameConveyEvent[]): void
	objectsAdded(objects: InteractiveGameObject[]): void
	objectsChanged(objects: InteractiveGameObject[]): void
	objectsRemoved(objects: InteractiveGameObject[]): void
	objectOver(pointer: any, object: InteractiveGameObject, stopPropagation?: () => void): void
	objectOut(pointer: any, object: InteractiveGameObject): void
	objectDown(pointer: any, object: InteractiveGameObject, stopPropagation?: () => void): void
	objectUp(pointer: any, object: InteractiveGameObject): void
	objectClick(pointer: any, object: InteractiveGameObject): void
	objectDrag(tiles: Tile[], event: unknown): void
	roadDrag(tiles: Tile[], roadType: RoadType, event: unknown): void
	dragPreview(tiles: Tile[], zoneType: string): void
	roadPreview(tiles: Tile[], roadType: RoadType, valid: boolean): void
	dragPreviewClear(): void
	roadsChanged(coords: AxialCoord[]): void
}
export type GamePresentationEvent =
	| { type: 'storage.changed'; ownerUid: string }
	| { type: 'vehicle.dock.changed'; ownerUid: string; vehicleUid: string }
	| { type: 'work-planning.changed'; revision: number }
	| {
			type: 'npc-trade.transferred'
			lineId: string
			stopId: string
			settlementId: string
			vehicleUid: string
			exported: Partial<Record<GoodType, number>>
			imported: Partial<Record<GoodType, number>>
			creditedVp: number
			spentVp: number
	  }

/**
 * Gameplay-facing notification that a convey hop has committed.
 *
 * This is intentionally a dirty event, not duplicated state. Consumers that need
 * current storage, vehicle, or tile details should use `ownerUid` to find the live
 * object and pull a fresh snapshot after the batch flush.
 */
export type GameConveyEvent = {
	type: 'conveyed'
	/** UID of the tile-like object affected by this endpoint. Borders are omitted in v1. */
	ownerUid: string
	/** Which end of the completed hop this event describes. */
	endpoint: 'source' | 'target'
	goodType: GoodType
	movementRef: number
	characterUid?: string
	/** Hop origin captured before the movement mutates its `from` coordinate. */
	from: AxialCoord
	/** Hop destination reached by the completed step. */
	to: AxialCoord
}

/** Accumulated trade transfer log entry, keyed by line-stop-vehicle. */
export interface TradeTransferLogEntry {
	readonly lineId: string
	readonly stopId: string
	readonly settlementId: string
	readonly vehicleUid: string
	readonly exported: Partial<Record<GoodType, number>>
	readonly imported: Partial<Record<GoodType, number>>
	readonly creditedVp: number
	readonly spentVp: number
	readonly tick: number
}

unreactive(Eventful)
export type GameGenerationOptions = {
	terrainSeed: number
	characterCount: number
	characterRadius?: number
	nameTheme?: NameThemeId
	settlementGeneration?: boolean | { settlementCount?: number; minSpacing?: number }
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
	processBuffers?: Partial<Record<GoodType, number>>
	alveolus: AlveolusType
	/** Dot-separated variant path (e.g., "wood.extra"). Persisted for save/load round-trip. */
	variant?: string
	/** When true, tile hosts a build shell for `alveolus` target, not the finished building. */
	underConstruction?: boolean
	/** Persisted construction work seconds on the build shell. */
	constructionWorkSecondsApplied?: number
	constructionPhase?: ConstructionPhase
	hivePlanId?: string
	hivePlanVersion?: number
	planRoleId?: string
	/** Configuration reference and individual config for this alveolus */
	configuration?: {
		ref: Ssh.ConfigurationReference
		individual?: Ssh.AlveolusConfiguration
	}
	assignedZoneIds?: readonly string[]
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

export interface ProjectSitePatch {
	coord: readonly [number, number]
	project: string
	/** Dot-separated variant path for variant-capable alveolus projects. */
	variant?: string
	constructionPhase?: ConstructionPhase
	foundationGoods?: Partial<Record<GoodType, number>>
	foundationConsumedGoods?: Partial<Record<GoodType, number>>
	constructionGoods?: Partial<Record<GoodType, number>>
	constructionWorkSecondsApplied?: number
	hivePlanId?: string
	hivePlanVersion?: number
	planRoleId?: string
}

export interface PlayerAccountPatch {
	balanceVp: number
}

export interface TilePatch {
	coord: readonly [number, number]
	deposit?: {
		type: DepositType
		name?: string
		amount: number
	}
	plantedTrees?: {
		ages: readonly number[]
	}
	terrain?: TerrainType
	height?: number
	temperature?: number
	humidity?: number
	sediment?: number
	waterTable?: number
}

export interface VehiclePatch extends VehicleSerializedState {}

type CoordPatchMap<T extends string> = Partial<Record<T, ReadonlyArray<readonly [number, number]>>>
type TerrainPatches = CoordPatchMap<TerrainType>
type LooseGoodsPatches = CoordPatchMap<GoodType>

export interface NamedZonePatch extends Omit<NamedZoneDefinition, 'builtIn'> {
	readonly coords: ReadonlyArray<readonly [number, number]>
}

export interface GamePatches {
	seed?: number
	terrains?: TerrainPatches
	tiles?: ReadonlyArray<TilePatch>
	hives?: ReadonlyArray<{
		name?: string
		working?: boolean
		alveoli: ReadonlyArray<AlveolusPatch>
	}>
	/** Explicit freight lines; implicit gather routes are merged from hive patches unless overridden by id. */
	freightLines?: ReadonlyArray<FreightLineDefinition>
	looseGoods?: LooseGoodsPatches
	zones?: {
		harvest?: ReadonlyArray<readonly [number, number]>
		residential?: ReadonlyArray<readonly [number, number]>
		commercial?: ReadonlyArray<readonly [number, number]>
		named?: ReadonlyArray<NamedZonePatch>
	}
	projects?: Record<string, ReadonlyArray<readonly [number, number]>>
	projectSites?: ReadonlyArray<ProjectSitePatch>
	dwellings?: ReadonlyArray<DwellingPatch>
	playerAccount?: PlayerAccountPatch
	vehicles?: ReadonlyArray<VehiclePatch>
	roads?: RoadPatchInput
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
	hivePlans?: ReadonlyArray<SerializedHivePlan>
}

function terrainPatchesAsTiles(terrains: TerrainPatches | undefined): TilePatch[] {
	const tiles: TilePatch[] = []
	for (const [terrain, coords] of Object.entries(terrains ?? {}) as Array<
		[TerrainType, ReadonlyArray<readonly [number, number]>]
	>) {
		for (const coord of coords) {
			tiles.push({ coord, terrain })
		}
	}
	return tiles
}

function looseGoodsPatchEntries(
	looseGoods: LooseGoodsPatches | undefined
): Array<[GoodType, ReadonlyArray<readonly [number, number]>]> {
	return Object.entries(looseGoods || {}).filter(
		(entry): entry is [GoodType, ReadonlyArray<readonly [number, number]>] => {
			const [, coords] = entry
			return coords !== undefined && coords !== null
		}
	)
}

function terrainOverrideNeedsBroadSampleInvalidation(
	override: Omit<TerrainTerraformPatch, 'coord'>
): boolean {
	return (
		'height' in override ||
		'temperature' in override ||
		'humidity' in override ||
		'sediment' in override ||
		'waterTable' in override
	)
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
	private readonly pendingCoordTerrainInvalidations = new Set<string>()
	private terrainInvalidationFlushScheduled = false

	private scheduleTerrainInvalidationCoalescingFlush(): void {
		if (this.terrainInvalidationFlushScheduled) return
		this.terrainInvalidationFlushScheduled = true
		queueMicrotask(() => {
			this.terrainInvalidationFlushScheduled = false
			this.pendingCoordTerrainInvalidations.clear()
		})
	}

	private invalidateTerrainPresentation(coord?: AxialCoord, hard = false): void {
		if (coord) {
			const key = axial.key(coord)
			if (this.pendingCoordTerrainInvalidations.has(key)) return
			this.pendingCoordTerrainInvalidations.add(key)
			this.scheduleTerrainInvalidationCoalescingFlush()
		}
		const renderer = this.renderer
		if (hard) renderer?.invalidateTerrainHard?.(coord) ?? renderer?.invalidateTerrain?.(coord)
		else renderer?.invalidateTerrain?.(coord)
	}

	public notifyGroundSemanticsChanged(coord?: AxialCoord): void {
		this.invalidateTerrainPresentation(coord, true)
	}

	public notifyRoadsChanged(coords: AxialCoord[] = []): void {
		this.emit('roadsChanged', coords)
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
		if (terrainOverrideNeedsBroadSampleInvalidation(override)) {
			// Field overrides can affect hydrology neighborhoods, so invalidate cached samples broadly.
			this.terrainProvider.invalidateAll()
		} else {
			// Terrain/biome-only overrides are visual; keep cached terrain samples outside this tile.
			this.terrainProvider.invalidateCoord(coord)
		}
		this.invalidateTerrainPresentation(coord, true)
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
	public readonly hivePlans = new HivePlanCollection(this)
	public readonly procurementDefaults = commerce.procurement
	public readonly playerAccount = reactive<PlayerAccountPatch>({
		balanceVp: commerce.startingAccountBalanceVp,
	})
	/** Registered freight lines (gather/distribute); merged at bootstrap from hive patches and explicit saves. */
	public freightLines: FreightLineDefinition[] = []
	// Dynamically loaded usage of Hive class
	private HiveClass?: typeof Hive

	public readonly objects = reactive(new Map<string, InteractiveGameObject>())
	public readonly hittableObjects = new Set<HittableGameObject>()
	public readonly hex: HexBoard
	public readonly generator: GameGenerator
	public readonly ticker: SimulationLoop
	/** Pure-dt event scheduler for timed simulation steps (characters, transforms, etc.). */
	public readonly clock: Clock
	/** Bay queue registry — created at bootstrap, integrated into the ticker. */
	public readonly bayQueueRegistry: BayQueueRegistry
	private tickedObjects = new Set<{ update(deltaSeconds: number): void }>()
	private readonly pendingInteractiveRegistrations = new Map<string, InteractiveGameObject>()
	private readonly pendingInteractiveChanges = new Map<string, InteractiveGameObject>()
	private readonly pendingInteractiveUnregistrations = new Map<string, InteractiveGameObject>()
	private readonly pendingPresentationEvents = new Map<string, GamePresentationEvent>()
	private readonly pendingConveyEvents: GameConveyEvent[] = []
	private interactiveRegistrationBatchDepth = 0
	private interactiveLifecycleFlushScheduled = false
	private presentationEventsFlushScheduled = false
	private conveyEventsFlushScheduled = false
	private _workPlanningRevision = 0
	private terrainTerraforming: TerrainTerraformPatch[] = []
	private readonly bootstrapGameplayCoords = new Set<string>()
	private readonly materializedGameplayCoords = new Map<string, AxialCoord>()
	private readonly inFlightGameplaySectors = new Map<string, Promise<boolean>>()
	private readonly appliedSettlementRegionSets = new Set<string>()
	private readonly inFlightSettlementRegionSets = new Map<string, Promise<void>>()
	private readonly settlementTradeProfiles = new Map<string, NpcSettlementTradeProfile>()
	private readonly settlementTradeProfilesByCityHallCoord = new Map<
		string,
		NpcSettlementTradeProfile
	>()
	/** Accumulated trade transfer events keyed by `lineId:stopId:vehicleUid` for inspector display. */
	private readonly tradeTransferLog = new Map<string, TradeTransferLogEntry[]>()
	private readonly terrainProvider: TerrainProvider
	private readonly gameplayFrontier = new GameplayFrontierController({
		hasMaterializedTile: (coord) => this.hasMaterializedGameplayTile(coord),
		materialize: async (coords) => {
			return this.materializeGameplayTilesAsync(coords)
		},
		materializedCount: () => this.materializedGameplayCoords.size,
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

	public setPlayerAccountBalance(balanceVp: number): void {
		const next = Math.max(0, Math.floor(balanceVp))
		if (this.playerAccount.balanceVp === next) return
		this.playerAccount.balanceVp = next
		this.invalidateWorkPlanning('player-account.balance.set')
	}

	public canAffordVp(amountVp: number): boolean {
		return this.playerAccount.balanceVp >= Math.max(0, Math.ceil(amountVp))
	}

	public spendVp(amountVp: number): boolean {
		const amount = Math.max(0, Math.ceil(amountVp))
		if (!this.canAffordVp(amount)) return false
		this.playerAccount.balanceVp -= amount
		this.invalidateWorkPlanning('player-account.balance.spend')
		return true
	}

	public creditVp(amountVp: number): void {
		const amount = Math.max(0, Math.floor(amountVp))
		if (amount <= 0) return
		this.playerAccount.balanceVp += amount
		this.invalidateWorkPlanning('player-account.balance.credit')
	}

	private readonly traceTimeSource = () => this.clock.virtualTime
	private clearTraceTimeSource: (() => void) | undefined
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
			createSettlementTradeObjectForUid(this, uid) ??
			createZoneObjectForUid(this, uid)
		)
	}

	public applyBuildAction(tile: Tile, alveolusType: AlveolusType, variant?: string): boolean {
		return tile.build(alveolusType, variant)
	}

	/**
	 * Change the variant of an existing alveolus or construction shell.
	 * Finds the nearest common ancestor between current and target variants,
	 * preserves that ancestor, and starts construction only for the remaining steps.
	 *
	 * E.g. changing "planks" → "stone" on a pile keeps the root pile and only
	 * constructs the stone variant recipe (no foundation/root rebuild).
	 */
	public changeAlveolusVariant(tile: Tile, alveolusType: AlveolusType, variant?: string): boolean {
		const content = tile.content
		if (!(content instanceof Alveolus || isConstructionSiteShell(content))) return false

		const resolved = resolveAlveolusVariant(alveolusType, variant || undefined)
		if (!resolved) return false

		// Find nearest common ancestor between current and target variant paths
		const currentSegments = ((content as { variant?: string }).variant ?? '')
			.split('.')
			.filter(Boolean)
		const targetSegments = (variant ?? '').split('.').filter(Boolean)

		let commonCount = 0
		while (
			commonCount < currentSegments.length &&
			commonCount < targetSegments.length &&
			currentSegments[commonCount] === targetSegments[commonCount]
		) {
			commonCount++
		}

		const chain = resolved.ancestorChain
		// Start construction at the step immediately after the common ancestor.
		// If commonCount = 0, step 0 is the root recipe → we're at root, start at step 1 (variant recipe).
		// If commonCount = 1 (e.g. both variants share "wood"), start at step 2.
		const stepIndex = commonCount + 1

		if (stepIndex >= chain.length) {
			// Target is the common ancestor itself (or we're clearing back to root).
			// Just create the finished alveolus at that ancestor.
			const ancestorVariantId = targetSegments.slice(0, commonCount).join('.') || undefined
			const alv = createAlveolus(alveolusType, tile, ancestorVariantId)
			if (!alv) return false
			applyConstructionConcreteTerrain(tile)
			this.hex.setTileContent(tile, alv)
			tile.asGenerated = false
			this.invalidateWorkPlanning('variant-change')
			return true
		}

		// Create BuildAlveolus starting from the step after common ancestor
		const site = createConstructionSiteState(
			{ kind: 'alveolus', alveolusType, variant: variant || undefined },
			stepIndex
		)
		const build = new BuildAlveolus(
			tile,
			alveolusType,
			site,
			variant || undefined,
			chain,
			stepIndex
		)

		applyConstructionConcreteTerrain(tile)
		this.hex.setTileContent(tile, build)
		tile.asGenerated = false
		this.invalidateWorkPlanning('variant-change')
		return true
	}

	public previewHivePlanPlacement(
		planId: string,
		anchor: AxialCoord,
		rotation: number
	): HivePlanPlacementPreview | undefined {
		const plan = this.hivePlans.find(planId)
		if (!plan || plan.stage !== 'working') return undefined
		return previewHivePlanPlacement(this, plan, anchor, rotation)
	}

	public applyHivePlanPlacement(planId: string, anchor: AxialCoord, rotation: number): boolean {
		const plan = this.hivePlans.find(planId)
		if (!plan || plan.stage !== 'working') return false
		const preview = previewHivePlanPlacement(this, plan, anchor, rotation)
		if (!preview.valid) return false
		for (const cell of preview.cells) {
			if (!cell.tile) return false
		}
		for (const cell of preview.cells) {
			const tile = cell.tile!
			tile.baseTerrain = 'concrete'
			tile.terrainState = {
				...(tile.terrainState ?? {}),
				terrain: 'concrete',
			}
			this.upsertTerrainOverride(cell.coord, { terrain: 'concrete' })
			const shell = createConstructionSiteForHivePlanEntry(tile, plan, cell.entry)
			this.hex.setTileContent(tile, shell)
			tile.asGenerated = false
		}
		this.invalidateWorkPlanning('hive-plan.place')
		return true
	}

	public applyZoneAction(tile: Tile, zoneType: string): boolean {
		if (!tile.canInteract(`zone:${zoneType}`)) return false
		if (zoneType === 'none') tile.zone = undefined
		else {
			if (!this.hex.zoneManager.getZoneDefinition(zoneType)) {
				this.hex.zoneManager.defineZone({ id: zoneType, name: zoneType })
			}
			tile.zone = zoneType as Zone
		}
		return true
	}

	public applyRoadTrace(tiles: readonly Tile[], roadType: RoadType): boolean {
		if (!canBuildRoadOnTrace(tiles)) return false
		for (const border of roadBordersForTrace(tiles)) {
			this.hex.setRoadType(border.position, roadType)
		}
		return true
	}

	public getSettlementTradeProfile(id: string): NpcSettlementTradeProfile | undefined {
		return this.settlementTradeProfiles.get(id)
	}

	public getSettlementTradeProfileAtCityHall(
		coord: AxialCoord
	): NpcSettlementTradeProfile | undefined {
		return this.settlementTradeProfilesByCityHallCoord.get(axial.key(coord))
	}

	public listSettlementTradeProfiles(): NpcSettlementTradeProfile[] {
		return [...this.settlementTradeProfiles.values()].sort((left, right) =>
			left.id.localeCompare(right.id)
		)
	}

	/**
	 * Ensure at least `minCount` settlement trade profiles exist near `center`.
	 *
	 * Scans expanding sector rings until enough settlements are found or a max ring
	 * radius is exhausted. Calls {@link ensureGameplaySectors} under the hood — this
	 * generates terrain, gameplay tiles, and settlement data as needed.
	 *
	 * @returns the current list of trade profiles (may be fewer than minCount if
	 *          generation did not produce enough).
	 */
	public async ensureNearbySettlements(
		center: AxialCoord,
		minCount: number
	): Promise<NpcSettlementTradeProfile[]> {
		const SETTLEMENT_SECTOR_RING = 4 as const
		const MAX_RINGS = 5 as const
		const current = () => this.listSettlementTradeProfiles()

		for (let ring = 0; ring < MAX_RINGS && current().length < minCount; ring++) {
			const sectorKeys: string[] = []
			const centerSectorQ = Math.floor(center.q / GAMEPLAY_SECTOR_STEP)
			const centerSectorR = Math.floor(center.r / GAMEPLAY_SECTOR_STEP)
			const radius = ring * SETTLEMENT_SECTOR_RING

			for (let dq = -radius; dq <= radius; dq++) {
				for (let dr = -radius; dr <= radius; dr++) {
					if (Math.abs(dq) < radius - 1 && Math.abs(dr) < radius - 1) continue
					sectorKeys.push(`${centerSectorQ + dq},${centerSectorR + dr}`)
				}
			}
			if (sectorKeys.length > 0) {
				await this.ensureGameplaySectors(sectorKeys)
			}
		}
		return current()
	}

	getSyntheticFreightLineObject(uid: string): SyntheticFreightLineObject | undefined {
		if (!isFreightLineUid(uid)) return undefined
		const line = findFreightLineByUid(this.freightLines, uid)
		return line ? createSyntheticFreightLineObject(this, line) : undefined
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
		for (const vehicle of this.vehicles) vehicle.refreshFreightLineReference(normalized)
	}

	assignVehicleToFreightLine(vehicleUid: string, lineId: string): boolean {
		const vehicle = this.vehicles.vehicle(vehicleUid)
		const line = this.freightLines.find((entry) => entry.id === lineId)
		if (!vehicle || !line) return false
		return vehicle.assignFreightLine(line)
	}

	unassignVehicleFromFreightLine(vehicleUid: string, lineId: string): boolean {
		const vehicle = this.vehicles.vehicle(vehicleUid)
		if (!vehicle) return false
		return vehicle.unassignFreightLine(lineId)
	}

	setVehicleFreightLineIds(vehicleUid: string, lineIds: readonly string[]): boolean {
		const vehicle = this.vehicles.vehicle(vehicleUid)
		if (!vehicle) return false
		vehicle.setServedLineIds(lineIds, 'vehicle.set-lines')
		return true
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
		for (const vehicle of this.vehicles) vehicle.unassignFreightLine(lineId)
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

	public enqueueStoragePresentationChange(owner: { uid: string }): void {
		const event: GamePresentationEvent = { type: 'storage.changed', ownerUid: owner.uid }
		this.pendingPresentationEvents.set(`${event.type}:${event.ownerUid}`, event)
		this.schedulePresentationEventsFlush()
	}

	public enqueueVehicleDockPresentationChange(
		owner: { uid: string },
		vehicle: { uid: string }
	): void {
		const event: GamePresentationEvent = {
			type: 'vehicle.dock.changed',
			ownerUid: owner.uid,
			vehicleUid: vehicle.uid,
		}
		this.pendingPresentationEvents.set(`${event.type}:${event.ownerUid}:${event.vehicleUid}`, event)
		this.schedulePresentationEventsFlush()
	}

	public enqueueNpcTradePresentationChange(
		event: Omit<Extract<GamePresentationEvent, { type: 'npc-trade.transferred' }>, 'type'>
	): void {
		this.pendingPresentationEvents.set(
			`npc-trade.transferred:${event.lineId}:${event.stopId}:${event.vehicleUid}`,
			{ type: 'npc-trade.transferred', ...event }
		)
		this.schedulePresentationEventsFlush()
		this.accumulateTradeTransferLog(event)
	}

	private accumulateTradeTransferLog(
		event: Omit<Extract<GamePresentationEvent, { type: 'npc-trade.transferred' }>, 'type'>
	): void {
		const key = `${event.lineId}:${event.stopId}:${event.vehicleUid}`
		const entries = this.tradeTransferLog.get(key) ?? []
		const entry: TradeTransferLogEntry = {
			...event,
			tick: this.ticker.elapsedMS,
		}
		entries.push(entry)
		// Keep at most 10 recent entries per key
		if (entries.length > 10) entries.splice(0, entries.length - 10)
		this.tradeTransferLog.set(key, entries)
	}

	/** Returns trade transfer history for a freight line, most recent first. */
	public getFreightLineTradeHistory(lineId: string): TradeTransferLogEntry[] {
		const out: TradeTransferLogEntry[] = []
		for (const [key, entries] of this.tradeTransferLog) {
			if (key.startsWith(`${lineId}:`)) out.push(...entries)
		}
		return out.sort((a, b) => b.tick - a.tick)
	}

	/**
	 * Queue a convey completion event for the current mutation turn.
	 *
	 * Unlike storage presentation events, convey endpoint events are not deduped:
	 * a batch may legitimately contain source and target events for the same
	 * movement, or multiple movements landing on the same owner.
	 */
	public enqueueConveyEvent(event: Omit<GameConveyEvent, 'type'>): void {
		this.pendingConveyEvents.push({ type: 'conveyed', ...event })
		this.scheduleConveyEventsFlush()
	}

	get workPlanningRevision(): number {
		return this._workPlanningRevision
	}

	public invalidateWorkPlanning(_reason: string): void {
		this._workPlanningRevision++
		const event: GamePresentationEvent = {
			type: 'work-planning.changed',
			revision: this._workPlanningRevision,
		}
		this.pendingPresentationEvents.set(event.type, event)
		this.schedulePresentationEventsFlush()
	}

	/**
	 * After mutating `UnBuiltLand.deposit` or its `amount`, notify tile observers and refresh
	 * sector-baked resource visuals when a renderer implements `invalidateTerrain`.
	 */
	public notifyTerrainDepositsChanged(tile: Tile): void {
		tile.asGenerated = false
		this.enqueueInteractiveChange(tile)
		// Any deposit mutation affects work/job planning (harvest targets, planted-tree state, etc.)
		this.invalidateWorkPlanning('terrain.deposit-changed')
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
		this.interactiveLifecycleFlushScheduled = true /*
		defer(() => {
			this.flushInteractiveLifecycleQueues()
		})*/
	}

	private flushPresentationEvents() {
		this.presentationEventsFlushScheduled = false
		if (this.pendingPresentationEvents.size === 0) return
		const events = [...this.pendingPresentationEvents.values()]
		this.pendingPresentationEvents.clear()
		this.emit('presentationEvents', events)
	}

	private schedulePresentationEventsFlush() {
		if (this.presentationEventsFlushScheduled) return
		this.presentationEventsFlushScheduled = true
		queueMicrotask(() => {
			this.flushPresentationEvents()
		})
	}

	private flushConveyEvents() {
		this.conveyEventsFlushScheduled = false
		if (this.pendingConveyEvents.length === 0) return
		const events = this.pendingConveyEvents.splice(0)
		this.emit('conveyEvents', events)
		for (const vehicle of this.vehicles) {
			maybeAdvanceVehicleFromCompletedAnchorStop(this, vehicle)
		}
	}

	private scheduleConveyEventsFlush() {
		if (this.conveyEventsFlushScheduled) return
		this.conveyEventsFlushScheduled = true
		queueMicrotask(() => {
			this.flushConveyEvents()
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

	public tickerCallback = atomic((timer: SimulationLoop) => {
		const controlIndex = Math.max(
			0,
			Math.min(gameTimeSpeedFactors.length - 1, configuration.timeControl)
		)
		const speedFactor = gameTimeSpeedFactors[controlIndex] ?? gameTimeSpeedFactors[1]
		const deltaSeconds = ((gameRootSpeed * timer.elapsedMS) / 1000) * speedFactor
		if (deltaSeconds > gameMaxTickDeltaSeconds) return // debugger / tab-freeze guard

		// Character steps & future off-clock periodic entries via clock
		this.clock.advance(deltaSeconds)

		// Constant evolutions (growth + decay) and legacy ticked objects (ResidentialDemandTicker)
		// — to be migrated to clock.setInterval later
		for (const object of this.tickedObjects) {
			if ('destroyed' in object && object.destroyed) continue
			object.update(deltaSeconds)
		}
	})

	public readonly generationOptions: GameGenerationOptions

	constructor(
		generationOptions: GameGenerationOptions = {
			terrainSeed: UNSAVED_DEFAULT_TERRAIN_SEED,
			characterCount: defaultNewGameCharacterCount,
			characterRadius: defaultNewGameCharacterRadius,
		},
		private readonly patches: GamePatches = {}
	) {
		super()
		this.generationOptions = {
			...generationOptions,
			terrainSeed: patches.seed ?? generationOptions.terrainSeed,
		}
		this.clearTraceTimeSource = setTraceTimeSource(this.traceTimeSource)
		this.ticker = new SimulationLoop()
		this.clock = new Clock()
		this.loaded = this.load()
		// Create rendererReady promise that will be resolved when renderer is initialized
		this.rendererReady = new Promise((resolve) => {
			this.rendererReadyResolver = resolve
		})

		this.hex = new HexBoard(this)

		// Create population singleton
		this.population = new Population(this)
		this.vehicles = new Vehicles(this)

		// Create bay queue registry (admission is event-driven — no per-frame polling needed)
		this.bayQueueRegistry = new BayQueueRegistry(this)
		const self = this

		// ── Constant evolutions: growth (tree aging + deposit generation) ──
		// NOTE: if the number of tiles/trees grows too large, split into
		// roughly-balanced groups with dephasing so each group still fires ~1×/s.
		// The only purpose is that all these constant evolutions are called each second.
		let growthAccumulator = 0
		const GROWTH_INTERVAL_S = 1
		this.registerTickedObject({
			update(deltaSeconds: number) {
				growthAccumulator += deltaSeconds
				if (growthAccumulator < GROWTH_INTERVAL_S) return
				const dt = growthAccumulator
				growthAccumulator = 0
				for (const tile of self.hex.tiles) {
					const land = tile.content
					if (land instanceof UnBuiltLand) {
						land.advanceGrowth(dt)
						land.generateDepositGoods(dt)
					}
				}
			},
		})

		// ── Constant evolutions: decay (loose-good perishability) ──
		// NOTE: same grouping note as growth if goods count becomes large.
		let decayAccumulator = 0
		const DECAY_INTERVAL_S = 1
		this.registerTickedObject({
			update(deltaSeconds: number) {
				decayAccumulator += deltaSeconds
				if (decayAccumulator < DECAY_INTERVAL_S) return
				const dt = decayAccumulator
				decayAccumulator = 0
				self.hex.looseGoods.applyDecay(dt)
			},
		})

		this.generator = new GameGenerator()
		this.terrainProvider = new TerrainProvider({
			generator: this.generator,
			getGenerationConfig: () => this.generationOptions,
			getTerraformingPatches: () => this.terrainTerraforming,
			getGameplayTerrainSample: (coord) => this.getGameplayTerrainSample(coord),
		})

		this.loaded = this.loaded.then(async () => {
			this.HiveClass = Hive
			// Await WASM module so terrain generation uses Rust/WASM
			try {
				const { wasmLoadReady } = await import('engine-terrain')
				await wasmLoadReady
			} catch {}
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
		})
	}

	public simulateObjectClick(object: InteractiveGameObject, event: unknown = {}) {
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
		for (const tile of terrainPatchesAsTiles(patches.terrains)) {
			coords.push({ q: tile.coord[0], r: tile.coord[1] })
		}
		for (const tile of patches.tiles ?? []) coords.push({ q: tile.coord[0], r: tile.coord[1] })
		for (const hive of patches.hives ?? []) {
			for (const alveolus of hive.alveoli)
				coords.push({ q: alveolus.coord[0], r: alveolus.coord[1] })
		}
		for (const coord of patches.zones?.harvest ?? []) coords.push({ q: coord[0], r: coord[1] })
		for (const coord of patches.zones?.residential ?? []) coords.push({ q: coord[0], r: coord[1] })
		for (const zone of patches.zones?.named ?? []) {
			for (const coord of zone.coords) coords.push({ q: coord[0], r: coord[1] })
		}
		for (const coordsForProject of Object.values(patches.projects ?? {})) {
			for (const coord of coordsForProject) coords.push({ q: coord[0], r: coord[1] })
		}
		for (const site of patches.projectSites ?? []) {
			coords.push({ q: site.coord[0], r: site.coord[1] })
		}
		for (const dwelling of patches.dwellings ?? []) {
			coords.push({ q: dwelling.coord[0], r: dwelling.coord[1] })
		}
		for (const [, goodCoords] of looseGoodsPatchEntries(patches.looseGoods)) {
			for (const coord of goodCoords) coords.push({ q: coord[0], r: coord[1] })
		}
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

		for (const tile of terrainPatchesAsTiles(patches.terrains)) addPatchCoord(tile.coord)
		for (const tile of patches.tiles ?? []) addPatchCoord(tile.coord)
		for (const hive of patches.hives ?? []) {
			for (const alveolus of hive.alveoli) addPatchCoord(alveolus.coord)
		}
		for (const coord of patches.zones?.harvest ?? []) addPatchCoord(coord)
		for (const coord of patches.zones?.residential ?? []) addPatchCoord(coord)
		for (const zone of patches.zones?.named ?? []) {
			for (const coord of zone.coords) addPatchCoord(coord)
		}
		for (const coordsForProject of Object.values(patches.projects ?? {})) {
			for (const coord of coordsForProject) addPatchCoord(coord)
		}
		for (const site of patches.projectSites ?? []) addPatchCoord(site.coord)
		for (const dwelling of patches.dwellings ?? []) addPatchCoord(dwelling.coord)
		for (const [, goodCoords] of looseGoodsPatchEntries(patches.looseGoods)) {
			for (const coord of goodCoords) addPatchCoord(coord)
		}
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

	private materializeRestoreBaselineTiles(config: GameGenerationOptions, patches: SaveState): void {
		this.bootstrapGameplayCoords.clear()
		for (const coord of this.collectCoreBootstrapCoords(config, patches)) {
			this.bootstrapGameplayCoords.add(axial.key(coord))
		}
		const { coords } = this.collectBootstrapCoords(config, patches)
		this.withObjectRegistrationBatch(() => {
			for (const coord of coords) {
				this.materializedGameplayCoords.set(axial.key(coord), { q: coord.q, r: coord.r })
				if (this.hex.getTileContent(coord)) continue
				const tile =
					this.hex.getTile(coord) ??
					this.withObjectRegistrationBatch(() => new Tile(this.hex, { q: coord.q, r: coord.r }))
				const sample = this.terrainProvider.getTerrainSample(coord)
				tile.baseTerrain = sample?.terrain ?? 'grass'
				tile.terrainHeight = sample?.height
				tile.terrainHydrology = sample?.hydrology
				const terrain = sample?.terrain ?? 'grass'
				const land = new UnBuiltLand(tile, terrain, undefined)
				this.hex.setTileContent(tile, land)
				tile.asGenerated = true
			}
		})
		console.info('[save-load][restore-baseline] materialized', {
			coords: coords.length,
			materializedGameplayTiles: this.materializedGameplayCoords.size,
		})
	}

	private generateInitialWorld(
		config: GameGenerationOptions,
		patches: GamePatches
	): Promise<void> | undefined {
		this.bootstrapGameplayCoords.clear()
		for (const coord of this.collectCoreBootstrapCoords(config, patches)) {
			this.bootstrapGameplayCoords.add(axial.key(coord))
		}
		const { coords, anchor } = this.collectBootstrapCoords(config, patches)
		if (coords.length > 0) {
			const boardData = this.generator.generateRegion(config, coords, this.terrainTerraforming)
			this.loadGeneratedBoard(boardData)
			this.applyGeneratedTerrainMetadata(boardData)
			if (config.characterCount > 0) {
				return this.generator
					.generateCharacters(config.terrainSeed, boardData, {
						characterCount: config.characterCount,
						radius: config.characterRadius,
						origin: anchor,
						nameTheme: config.nameTheme,
					})
					.then((populationData) => this.loadGeneratedPopulation(populationData))
			}
		}
		return undefined
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
			await this.ensureSettlementRegionSetsForTiles(boardData)
			if (config.characterCount > 0) {
				const populationData = await this.generator.generateCharacters(
					config.terrainSeed,
					boardData,
					{
						characterCount: config.characterCount,
						radius: config.characterRadius,
						origin: anchor,
						nameTheme: config.nameTheme,
					}
				)
				this.loadGeneratedPopulation(populationData)
			}
		}
	}

	private settlementRegionSetKeyForCoord(coord: AxialCoord): string {
		const sectorQ = Math.floor(coord.q / GAMEPLAY_SECTOR_STEP)
		const sectorR = Math.floor(coord.r / GAMEPLAY_SECTOR_STEP)
		const originQ =
			Math.floor(sectorQ / SETTLEMENT_REGION_SET_SECTOR_SPAN) * SETTLEMENT_REGION_SET_SECTOR_SPAN
		const originR =
			Math.floor(sectorR / SETTLEMENT_REGION_SET_SECTOR_SPAN) * SETTLEMENT_REGION_SET_SECTOR_SPAN
		return `${originQ},${originR}`
	}

	private parseSettlementRegionSetKey(key: string): TerrainSectorCoord {
		const [q, r] = key.split(',').map(Number)
		return { q: q ?? 0, r: r ?? 0 }
	}

	private sectorsForSettlementRegionSet(key: string): TerrainSectorCoord[] {
		const origin = this.parseSettlementRegionSetKey(key)
		const sectors: TerrainSectorCoord[] = []
		for (let q = origin.q; q < origin.q + SETTLEMENT_REGION_SET_SECTOR_SPAN; q++) {
			for (let r = origin.r; r < origin.r + SETTLEMENT_REGION_SET_SECTOR_SPAN; r++) {
				sectors.push({ q, r })
			}
		}
		return sectors
	}

	private coordsForSettlementRegionSetInterior(key: string): AxialCoord[] {
		return this.sectorsForSettlementRegionSet(key).flatMap((sector) =>
			this.coordsForGameplaySectorInterior(`${sector.q},${sector.r}`)
		)
	}

	private settlementRegionSetKeysForTiles(tileData: readonly GeneratedTileData[]): string[] {
		return [
			...new Set(tileData.map((tileInfo) => this.settlementRegionSetKeyForCoord(tileInfo.coord))),
		].sort()
	}

	private settlementRegionSetKeysForSectorKeys(sectorKeys: readonly string[]): string[] {
		const keys = new Set<string>()
		for (const sectorKey of sectorKeys) {
			for (const coord of this.coordsForGameplaySectorInterior(sectorKey)) {
				keys.add(this.settlementRegionSetKeyForCoord(coord))
			}
		}
		return [...keys].sort()
	}

	private async applySettlementRegionSetPlan(
		regionSetKey: string,
		boardData: readonly GeneratedTileData[]
	): Promise<void> {
		if (this.generationOptions.settlementGeneration === false) return
		const options =
			typeof this.generationOptions.settlementGeneration === 'object'
				? this.generationOptions.settlementGeneration
				: {}

		// Use WASM-based settlement placement
		const { settlements, coords, terrainKinds, hasRiver } = await this.generator.placeSettlements(
			this.generationOptions.terrainSeed,
			boardData as GeneratedTileData[],
			{
				settlementCount: options.settlementCount ?? 5,
				minSpacing: options.minSpacing ?? 7,
				nameTheme: this.generationOptions.nameTheme,
			}
		)

		const plan = await generateSettlementRegionSetPlan(
			boardData,
			settlements,
			regionSetKey,
			this.generationOptions.terrainSeed,
			coords,
			terrainKinds,
			hasRiver,
			this.generationOptions.nameTheme
		)
		for (const settlement of plan.settlements) {
			const profile = createNpcSettlementTradeProfile({
				seed: this.generationOptions.terrainSeed,
				regionSetKey,
				settlement,
				tileData: boardData,
				zones: plan.zones,
			})
			this.settlementTradeProfiles.set(profile.id, profile)
			this.settlementTradeProfilesByCityHallCoord.set(axial.key(profile.cityHall.position), profile)
		}
		this.applyGeneratedZonePatches(plan.zones)
		this.applyRoadPatches(plan.roads)
		this.clearGeneratedInfrastructureBurden(boardData.map((tile) => tile.coord))
		this.appliedSettlementRegionSets.add(regionSetKey)
	}

	private applyGeneratedTerrainMetadata(tileData: readonly GeneratedTileData[]): void {
		if (this.generationOptions.settlementGeneration === false) return
		const keys = this.settlementRegionSetKeysForTiles(tileData).filter(
			(key) => !this.appliedSettlementRegionSets.has(key)
		)
		for (const key of keys) {
			if (this.inFlightSettlementRegionSets.has(key)) continue
			const generation = this.generateSettlementRegionSet(key).finally(() => {
				this.inFlightSettlementRegionSets.delete(key)
			})
			this.inFlightSettlementRegionSets.set(key, generation)
		}
	}

	private async ensureSettlementRegionSetsForTiles(
		tileData: readonly GeneratedTileData[]
	): Promise<void> {
		if (this.generationOptions.settlementGeneration === false) return
		const keys = this.settlementRegionSetKeysForTiles(tileData)
		if (keys.length === 0) return

		const waiting: Promise<void>[] = []
		const keysToGenerate: string[] = []
		for (const key of keys) {
			if (this.appliedSettlementRegionSets.has(key)) continue
			const inFlight = this.inFlightSettlementRegionSets.get(key)
			if (inFlight) {
				waiting.push(inFlight)
				continue
			}
			keysToGenerate.push(key)
		}

		if (keysToGenerate.length > 0) {
			const generation = this.generateSettlementRegionSets(keysToGenerate)
			for (const key of keysToGenerate) {
				const perSet = generation.finally(() => {
					this.inFlightSettlementRegionSets.delete(key)
				})
				this.inFlightSettlementRegionSets.set(key, perSet)
				waiting.push(perSet)
			}
		}

		await Promise.all(waiting)
	}

	private async generateSettlementRegionSet(regionSetKey: string): Promise<void> {
		const boardData = this.generator.generateRegion(
			this.generationOptions,
			this.coordsForSettlementRegionSetInterior(regionSetKey),
			this.terrainTerraforming
		)
		this.terrainProvider.cacheGeneratedTiles(boardData)
		await this.applySettlementRegionSetPlan(regionSetKey, boardData)
	}

	private async generateSettlementRegionSets(regionSetKeys: readonly string[]): Promise<void> {
		const sectorKeys = new Set<string>()
		for (const key of regionSetKeys) {
			for (const sector of this.sectorsForSettlementRegionSet(key)) {
				sectorKeys.add(`${sector.q},${sector.r}`)
			}
		}
		const sectors = [...sectorKeys].map((key) => this.parseGameplaySectorKey(key))
		const boardData = await this.generator.generateSectorsAsync(
			this.generationOptions,
			sectors,
			this.terrainTerraforming,
			{ includeHydrology: true }
		)
		this.terrainProvider.cacheGeneratedTiles(boardData)

		const grouped = new Map<string, GeneratedTileData[]>()
		const expectedKeys = new Set(regionSetKeys)
		for (const tileInfo of boardData) {
			const key = this.settlementRegionSetKeyForCoord(tileInfo.coord)
			if (!expectedKeys.has(key)) continue
			let tiles = grouped.get(key)
			if (!tiles) {
				tiles = []
				grouped.set(key, tiles)
			}
			tiles.push(tileInfo)
		}
		for (const key of regionSetKeys) {
			if (this.appliedSettlementRegionSets.has(key)) continue
			await this.applySettlementRegionSetPlan(key, grouped.get(key) ?? [])
		}
	}

	private hasMaterializedGameplayTile(coord: AxialCoord) {
		return this.hex.getTileContent(coord) !== undefined
	}

	public hasGameplayContentAt(coord: AxialCoord): boolean {
		return this.hasMaterializedGameplayTile(coord)
	}

	public hasRenderableTerrainAt(coord: AxialCoord): boolean {
		return this.getRenderableTerrainAt(coord) !== undefined
	}

	public getRenderableTerrainAt(coord: AxialCoord): RenderableTerrainTile | undefined {
		const gameplay = this.getGameplayTerrainSample(coord)
		if (gameplay) return this.withRenderableZone(coord, gameplay)
		const sample = this.terrainProvider.getTerrainSample(coord)
		return sample ? this.withRenderableZone(coord, sample) : undefined
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

	private withRenderableZone(coord: AxialCoord, sample: TerrainSample): TerrainSample {
		const explicitZone = this.hex.zoneManager.getZone(coord)
		const generatedZone = this.hex.zoneManager.getGeneratedZone(coord)
		const zone = explicitZone ?? generatedZone
		if (!zone) return sample
		const definition = this.hex.zoneManager.getZoneDefinition(zone)
		return {
			...sample,
			zone: {
				id: String(zone),
				name: definition?.name ?? String(zone),
				color: definition?.color,
				generated: explicitZone === undefined && generatedZone !== undefined,
			},
		}
	}

	public getTerrainSample(coord: AxialCoord): TerrainSample | undefined {
		const sample = this.terrainProvider.getTerrainSample(coord)
		return sample ? this.withRenderableZone(coord, sample) : undefined
	}

	public async ensureTerrainSamples(coords: Iterable<AxialCoord>): Promise<void> {
		await this.terrainProvider.ensureTerrainSamples(coords)
	}

	public async ensureTerrainSectors(
		sectorKeys: Iterable<string>,
		options?: { includeHydrology?: boolean }
	): Promise<void> {
		await this.terrainProvider.ensureTerrainSectors(sectorKeys, options)
	}

	public async ensureGameplaySectors(
		sectorKeys: Iterable<string>,
		options: { includeHydrology?: boolean; populateInitialGoods?: boolean } = {}
	): Promise<boolean> {
		const unique = [...new Set(sectorKeys)]
		if (unique.length === 0) return false

		const missingSectorKeys = unique.filter((key) =>
			this.coordsForGameplaySectorInterior(key).some(
				(coord) => !this.hasMaterializedGameplayTile(coord)
			)
		)
		if (missingSectorKeys.length === 0) return false

		const waiting: Promise<boolean>[] = []
		const sectorsToGenerate: string[] = []
		for (const key of missingSectorKeys) {
			const inFlight = this.inFlightGameplaySectors.get(key)
			if (inFlight) {
				waiting.push(inFlight)
				continue
			}
			sectorsToGenerate.push(key)
		}

		if (sectorsToGenerate.length > 0) {
			const generation = this.generateGameplaySectors(sectorsToGenerate, options)
			for (const key of sectorsToGenerate) {
				const perSector = generation.finally(() => {
					this.inFlightGameplaySectors.delete(key)
				})
				this.inFlightGameplaySectors.set(key, perSector)
				waiting.push(perSector)
			}
		}

		if (waiting.length === 0) return false
		const results = await Promise.all(waiting)
		return results.some(Boolean)
	}

	public async ensureMacroHydrology(
		centerSectorKey: string,
		options?: { macroStep?: number; sectorRadius?: number }
	): Promise<void> {
		await this.terrainProvider.ensureMacroHydrology(centerSectorKey, options)
	}

	public getTerrainMacroHydrology(): TerrainMacroHydrologySnapshot | undefined {
		return this.terrainProvider.getTerrainMacroHydrology()
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

	private materializeGameplayTiles(coords: Iterable<AxialCoord>): boolean {
		const missingCoords: AxialCoord[] = []
		for (const coord of coords) {
			if (this.hasMaterializedGameplayTile(coord)) continue
			missingCoords.push(coord)
		}
		if (missingCoords.length === 0) return false

		const boardData = this.generator.generateRegion(
			this.generationOptions,
			missingCoords,
			this.terrainTerraforming
		)
		const mergedBoardData = this.mergeRenderableTerrainSamples(boardData)
		this.loadGeneratedBoard(mergedBoardData, {
			populateInitialGoods: false,
		})
		this.applyGeneratedTerrainMetadata(mergedBoardData)
		return boardData.length > 0
	}

	private async materializeGameplayTilesAsync(coords: Iterable<AxialCoord>): Promise<boolean> {
		const missingCoords: AxialCoord[] = []
		for (const coord of coords) {
			if (this.hasMaterializedGameplayTile(coord)) continue
			missingCoords.push(coord)
		}
		if (missingCoords.length === 0) return false

		const boardData = await this.generator.generateRegionAsync(
			this.generationOptions,
			missingCoords,
			this.terrainTerraforming
		)
		const mergedBoardData = this.mergeRenderableTerrainSamples(boardData)
		this.loadGeneratedBoard(mergedBoardData, {
			populateInitialGoods: false,
		})
		await this.ensureSettlementRegionSetsForTiles(mergedBoardData)
		return boardData.length > 0
	}

	private mergeRenderableTerrainSamples(boardData: GeneratedTileData[]): GeneratedTileData[] {
		return boardData.map((tileInfo) => {
			const sample = this.terrainProvider.getTerrainSample(tileInfo.coord)
			if (!sample) return tileInfo
			return {
				...tileInfo,
				terrain: sample.terrain,
				height: sample.height ?? tileInfo.height,
				hydrology: sample.hydrology ?? tileInfo.hydrology,
				deposit: sample.deposit
					? {
							type: sample.deposit.type as DepositType,
							amount: sample.deposit.amount,
						}
					: tileInfo.deposit,
			}
		})
	}

	private tileTouchesRoad(coord: AxialCoord): boolean {
		for (const neighbor of axial.neighbors(coord)) {
			const borderCoord = axial.linear([0.5, coord], [0.5, neighbor])
			if (this.hex.getRoadType(borderCoord)) return true
		}
		return false
	}

	private isGeneratedInfrastructureZone(coord: AxialCoord): boolean {
		const zone = this.hex.zoneManager.getGeneratedZone(coord)
		return zone !== undefined && zone !== 'harvest'
	}

	private shouldSuppressGeneratedBurden(tileInfo: GeneratedTileData): boolean {
		return (
			this.tileTouchesRoad(tileInfo.coord) || this.isGeneratedInfrastructureZone(tileInfo.coord)
		)
	}

	private clearGeneratedInfrastructureBurden(coords: Iterable<AxialCoord>): void {
		for (const coord of coords) {
			if (!this.tileTouchesRoad(coord) && !this.isGeneratedInfrastructureZone(coord)) continue
			const tile = this.hex.getTile(coord)
			if (!tile) continue
			const content = tile.content
			if (content instanceof UnBuiltLand && content.deposit) {
				content.deposit = undefined
				this.enqueueInteractiveChange(tile)
				this.renderer?.invalidateTerrain?.(coord)
			}
			for (const good of [...this.hex.looseGoods.getGoodsAt(coord)]) {
				if (!good.isRemoved) good.remove()
			}
			tile.asGenerated = true
		}
	}

	private async generateGameplaySectors(
		sectorKeys: readonly string[],
		options: { includeHydrology?: boolean; populateInitialGoods?: boolean }
	): Promise<boolean> {
		const allSectorKeys = new Set(sectorKeys)
		const regionSetKeys =
			this.generationOptions.settlementGeneration === false
				? []
				: this.settlementRegionSetKeysForSectorKeys(sectorKeys)
		for (const regionSetKey of regionSetKeys) {
			if (this.appliedSettlementRegionSets.has(regionSetKey)) continue
			if (this.inFlightSettlementRegionSets.has(regionSetKey)) continue
			for (const sector of this.sectorsForSettlementRegionSet(regionSetKey)) {
				allSectorKeys.add(`${sector.q},${sector.r}`)
			}
		}
		const sectors = [...allSectorKeys].map((key) => this.parseGameplaySectorKey(key))
		const boardData = await this.generator.generateSectorsAsync(
			this.generationOptions,
			sectors,
			this.terrainTerraforming,
			{ includeHydrology: options.includeHydrology ?? true }
		)
		this.terrainProvider.cacheGeneratedTiles(boardData)
		for (const regionSetKey of regionSetKeys) {
			if (this.appliedSettlementRegionSets.has(regionSetKey)) continue
			const inFlight = this.inFlightSettlementRegionSets.get(regionSetKey)
			if (inFlight) {
				await inFlight
				continue
			}
			const regionSetTiles = boardData.filter(
				(tileInfo) => this.settlementRegionSetKeyForCoord(tileInfo.coord) === regionSetKey
			)
			await this.applySettlementRegionSetPlan(regionSetKey, regionSetTiles)
		}

		const interiorKeys = new Set<string>()
		for (const sectorKey of sectorKeys) {
			for (const coord of this.coordsForGameplaySectorInterior(sectorKey)) {
				if (this.hasMaterializedGameplayTile(coord)) continue
				interiorKeys.add(axial.key(coord))
			}
		}
		if (interiorKeys.size === 0) return false

		const interiorBoardData = boardData.filter((tileInfo) =>
			interiorKeys.has(axial.key(tileInfo.coord))
		)
		if (interiorBoardData.length === 0) return false
		this.loadGeneratedBoard(interiorBoardData, {
			populateInitialGoods: options.populateInitialGoods ?? false,
		})
		return true
	}

	private parseGameplaySectorKey(sectorKey: string): AxialCoord {
		const [q, r] = sectorKey.split(',').map(Number)
		return { q: q ?? 0, r: r ?? 0 }
	}

	private coordsForGameplaySectorInterior(sectorKey: string): AxialCoord[] {
		const sector = this.parseGameplaySectorKey(sectorKey)
		const startQ = sector.q * GAMEPLAY_SECTOR_STEP
		const startR = sector.r * GAMEPLAY_SECTOR_STEP
		const coords: AxialCoord[] = []
		for (let q = startQ; q < startQ + GAMEPLAY_SECTOR_STEP; q++) {
			for (let r = startR; r < startR + GAMEPLAY_SECTOR_STEP; r++) {
				coords.push({ q, r })
			}
		}
		return coords
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

	/**
	 * Debug/test visibility into SSH-owned gameplay frontier state.
	 *
	 * Renderers may request visibility-driven frontier expansion through
	 * `requestGameplayFrontier`, but generation, retention, and persistence policy
	 * stay inside Game/ssh.
	 */
	public gameplayFrontierSnapshot() {
		return this.gameplayFrontier.snapshot()
	}

	public ensureGeneratedTiles(coords: Iterable<AxialCoord>) {
		this.materializeGameplayTiles(coords)
	}
	async ensureGeneratedTilesAsync(coords: Iterable<AxialCoord>) {
		await this.materializeGameplayTilesAsync(coords)
	}
	async generate(config: GameGenerationOptions, patches: GamePatches = {}, saveState?: SaveState) {
		try {
			const terrainTiles = terrainPatchesAsTiles(patches.terrains)
			const tilePatches = [...terrainTiles, ...(patches.tiles ?? [])]
			const terraforming: TerrainTerraformPatch[] = tilePatches
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
			this.appliedSettlementRegionSets.clear()
			this.inFlightSettlementRegionSets.clear()
			this.settlementTradeProfiles.clear()
			this.settlementTradeProfilesByCityHallCoord.clear()
			this.setPlayerAccountBalance(
				patches.playerAccount?.balanceVp ?? commerce.startingAccountBalanceVp
			)
			this.vehicles.deserialize([])

			const populationLoad = this.generateInitialWorld(config, patches)
			// Apply patches if any
			if (terrainTiles.length) this.applyTilePatches(terrainTiles)
			if (patches.tiles?.length) this.applyTilePatches(patches.tiles)
			if (patches.hives?.length)
				this.applyHivesPatches(patches.hives, saveState?.hiveConfigurations)
			if (patches.looseGoods) this.applyLooseGoodsPatches(patches.looseGoods)
			if (patches.zones) this.applyZonePatches(patches.zones)
			if (patches.projects) this.applyProjectPatches(patches.projects)
			if (patches.projectSites?.length) this.applyProjectSitePatches(patches.projectSites)
			if (patches.dwellings?.length) this.applyDwellingPatches(patches.dwellings)
			this.bootstrapFreightLines(patches)
			if (patches.vehicles?.length) this.applyVehiclePatches(patches.vehicles)
			if (patches.roads) this.applyRoadPatches(patches.roads)
			await populationLoad
		} catch (error) {
			console.error('Generation failed:', error)
		}
	}
	async generateAsync(
		config: GameGenerationOptions,
		patches: GamePatches = {},
		saveState?: SaveState,
		options: { restoreMode?: boolean } = {}
	) {
		try {
			console.info('[save-load][generateAsync] begin', {
				seed: config.terrainSeed,
				characterCount: config.characterCount,
				patches: {
					tiles: (patches.tiles ?? []).length,
					hives: (patches.hives ?? []).length,
					looseGoodsKinds: Object.keys(patches.looseGoods || {}).length,
					vehicles: (patches.vehicles ?? []).length,
					freightLines: (patches.freightLines ?? []).length,
					streamedFrontier:
						'streamedFrontier' in (patches as SaveState)
							? (((patches as SaveState).streamedFrontier ?? []).length as number)
							: 0,
					population:
						'population' in (patches as SaveState)
							? (((patches as SaveState).population ?? []).length as number)
							: 0,
				},
				hasSaveState: !!saveState,
			})
			const terrainTiles = terrainPatchesAsTiles(patches.terrains)
			const tilePatches = [...terrainTiles, ...(patches.tiles ?? [])]
			const terraforming: TerrainTerraformPatch[] = tilePatches
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
			this.appliedSettlementRegionSets.clear()
			this.inFlightSettlementRegionSets.clear()
			this.settlementTradeProfiles.clear()
			this.settlementTradeProfilesByCityHallCoord.clear()
			this.setPlayerAccountBalance(
				patches.playerAccount?.balanceVp ?? commerce.startingAccountBalanceVp
			)
			this.vehicles.deserialize([])

			if (options.restoreMode && saveState) {
				console.info(
					'[save-load][generateAsync] restoreMode enabled: skipping generateInitialWorldAsync'
				)
				this.materializeRestoreBaselineTiles(config, saveState)
			} else {
				await this.generateInitialWorldAsync(config, patches)
			}
			console.info('[save-load][generateAsync] after world baseline', {
				materializedGameplayTiles: this.materializedGameplayCoords.size,
				bootstrapGameplayTiles: this.bootstrapGameplayCoords.size,
			})
			if (terrainTiles.length) this.applyTilePatches(terrainTiles)
			if (patches.tiles?.length) this.applyTilePatches(patches.tiles)
			if (patches.hives?.length)
				this.applyHivesPatches(patches.hives, saveState?.hiveConfigurations)
			if (patches.looseGoods) this.applyLooseGoodsPatches(patches.looseGoods)
			if (patches.zones) this.applyZonePatches(patches.zones)
			if (patches.projects) this.applyProjectPatches(patches.projects)
			if (patches.projectSites?.length) this.applyProjectSitePatches(patches.projectSites)
			if (patches.dwellings?.length) this.applyDwellingPatches(patches.dwellings)
			this.bootstrapFreightLines(patches)
			if (patches.vehicles?.length) this.applyVehiclePatches(patches.vehicles)
			if (patches.roads) this.applyRoadPatches(patches.roads)
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
				const suppressGeneratedBurden = this.shouldSuppressGeneratedBurden(tileInfo)
				if (tileInfo.deposit && !suppressGeneratedBurden) {
					deposit = Deposit.create(tileInfo.deposit.type, tileInfo.deposit.amount)
				}

				const land = new UnBuiltLand(tile, tileInfo.terrain, deposit)
				this.hex.setTileContent(tile, land)
				// Mark as generated after the content attach path, which otherwise dirties the tile.
				tile.asGenerated = true

				if (!populateInitialGoods || suppressGeneratedBurden) continue

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
							preserveGeneratedTile: true,
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
						const plantedTrees = content.plantedTrees
						this.hex.setTileContent(tile, new UnBuiltLand(tile, p.terrain, deposit, plantedTrees))
					}
				}

				if (p.deposit) {
					const created = Deposit.create(p.deposit.type, p.deposit.amount)
					if (created) {
						// Re-fetch content in case it was replaced
						const currentContent = tile.content as UnBuiltLand
						currentContent.deposit = created
						this.notifyTerrainDepositsChanged(tile)
					}
				}
				if (p.plantedTrees) {
					const currentContent = tile.content as UnBuiltLand
					currentContent.plantedTrees = normalizePlantedTrees(
						{ ages: [...p.plantedTrees.ages] },
						currentContent.deposit
					)
					this.notifyTerrainDepositsChanged(tile)
				}
				if (
					p.terrain !== undefined ||
					p.deposit !== undefined ||
					p.plantedTrees !== undefined ||
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
		for (const [, coords] of looseGoodsPatchEntries(patches)) {
			for (const position of coords) {
				const coord = { q: position[0], r: position[1] }
				patchedCoords.set(axial.key(coord), coord)
			}
		}
		for (const coord of patchedCoords.values()) {
			const existingGoods = [...this.hex.looseGoods.getGoodsAt(coord)]
			for (const good of existingGoods) {
				if (!good.isRemoved) good.remove()
			}
		}
		for (const [goodType, coords] of looseGoodsPatchEntries(patches)) {
			for (const position of coords) {
				const tile = this.hex.getTile({ q: position[0], r: position[1] })
				if (!tile) continue
				this.hex.looseGoods.add(tile, goodType)
			}
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
				const alveolusType = a.alveolus
				if (a.underConstruction) {
					const constructionSite = createConstructionSiteState({
						kind: 'alveolus',
						alveolusType,
						variant: a.variant,
					})
					constructionSite.phase = a.constructionPhase ?? 'waiting_materials'
					constructionSite.workSecondsApplied = a.constructionWorkSecondsApplied ?? 0
					const build = createConstructionShell(tile, constructionSite)
					build.constructionWorkSecondsApplied = a.constructionWorkSecondsApplied ?? 0
					Object.assign(build, {
						hivePlanId: a.hivePlanId,
						hivePlanVersion: a.hivePlanVersion,
						planRoleId: a.planRoleId,
						planConfiguration: a.configuration,
					})
					this.hex.setTileContent(tile, build)
					if (a.goods)
						for (const [good, qty] of Object.entries(a.goods))
							build.storage?.addGood(good as GoodType, qty)
					tile.asGenerated = false
					continue
				}
				const alv = createAlveolus(alveolusType, tile, a.variant)
				if (!alv) throw new Error(`Unknown alveolus type in hive patch: ${a.alveolus}`)
				this.hex.setTileContent(tile, alv)
				if (a.goods && alv.name !== 'freight_bay')
					for (const [good, qty] of Object.entries(a.goods))
						alv.storage?.addGood(good as GoodType, qty)
				if (alv instanceof TransformAlveolus) {
					alv.restoreProcessBuffers(a.processBuffers)
				}
				// Restore configuration if present before hive attachment advertises the alveolus.
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
				if (a.assignedZoneIds) alv.setAssignedZoneIds(a.assignedZoneIds)
				if (!alv.hive && this.HiveClass) {
					const h = this.HiveClass.for(tile)
					if (hive.name !== undefined) h.name = hive.name
					h.working = hive.working ?? true
					h.attach(alv)
				}
				hiveInstance = alv.hive
				if (hive.name !== undefined) alv.hive.name = hive.name
				alv.hive.working = hive.working ?? true
				tile.asGenerated = false
			}
			assert(hiveInstance, 'Alveolus building on load')
			// Restore hive-level configurations
			if (hive.name && hiveConfigurations?.[hive.name] && hiveInstance) {
				for (const [alvType, config] of Object.entries(hiveConfigurations[hive.name])) {
					hiveInstance.configurations.set(alvType, config)
				}
				hiveInstance.invalidateAdvertisements?.(hiveInstance.alveoli, 'alveolus.config')
			}
		}
	}

	private applyZonePatches(zones: NonNullable<GamePatches['zones']>) {
		for (const zone of zones.named ?? []) {
			this.hex.zoneManager.defineZone(zone)
		}
		const applyCoords = (
			zone: Zone,
			coords: ReadonlyArray<readonly [number, number]> | undefined
		) => {
			for (const coord of coords ?? []) {
				const coordObj = { q: coord[0], r: coord[1] }
				const tile = this.hex.getTile(coordObj)
				if (!tile) continue
				tile.zone = zone
			}
		}
		applyCoords('harvest', zones.harvest)
		applyCoords('residential', zones.residential)
		applyCoords('commercial', zones.commercial)
		for (const zone of zones.named ?? []) {
			for (const coord of zone.coords) {
				const coordObj = { q: coord[0], r: coord[1] }
				const tile = this.hex.getTile(coordObj)
				if (!tile) continue
				tile.zone = zone.id
			}
		}
	}

	private applyGeneratedZonePatches(zones: NonNullable<GamePatches['zones']>) {
		for (const zone of zones.named ?? []) {
			this.hex.zoneManager.defineZone({ ...zone, generated: true, readonly: true })
		}
		const applyCoords = (
			zone: Zone,
			coords: ReadonlyArray<readonly [number, number]> | undefined
		) => {
			for (const coord of coords ?? []) {
				this.hex.zoneManager.setGeneratedZone({ q: coord[0], r: coord[1] }, zone)
			}
		}
		applyCoords('harvest', zones.harvest)
		applyCoords('residential', zones.residential)
		applyCoords('commercial', zones.commercial)
		for (const zone of zones.named ?? []) {
			for (const coord of zone.coords) {
				this.hex.zoneManager.setGeneratedZone({ q: coord[0], r: coord[1] }, zone.id)
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

	private applyProjectSitePatches(sites: NonNullable<GamePatches['projectSites']>) {
		for (const entry of sites) {
			const coordObj = { q: entry.coord[0], r: entry.coord[1] }
			const tile = this.hex.getTile(coordObj)
			if (!tile) continue
			const content = tile.content
			const constructionTarget = constructionTargetFromProject(entry.project)
			if (!constructionTarget) continue
			// Attach variant from the save if not already parsed from the project string
			if (entry.variant && constructionTarget.kind === 'alveolus' && !constructionTarget.variant) {
				;(constructionTarget as { variant?: string }).variant = entry.variant
			}
			const constructionSite = createConstructionSiteState(constructionTarget)
			constructionSite.phase = entry.constructionPhase ?? constructionSite.phase
			constructionSite.foundationConsumedGoods = { ...(entry.foundationConsumedGoods ?? {}) }
			if (entry.constructionGoods || entry.constructionWorkSecondsApplied !== undefined) {
				tile.baseTerrain = 'concrete'
				tile.terrainState = {
					...(tile.terrainState ?? {}),
					terrain: 'concrete',
				}
				this.upsertTerrainOverride(coordObj, { terrain: 'concrete' })
				const build = createConstructionShell(tile, constructionSite)
				build.constructionWorkSecondsApplied = entry.constructionWorkSecondsApplied ?? 0
				Object.assign(build, {
					hivePlanId: entry.hivePlanId,
					hivePlanVersion: entry.hivePlanVersion,
					planRoleId: entry.planRoleId,
					planConfiguration: this.hivePlans
						.find(entry.hivePlanId)
						?.entries.find((planEntry) => planEntry.roleId === entry.planRoleId)?.configuration,
				})
				this.hex.setTileContent(tile, build)
				for (const [good, qty] of Object.entries(entry.constructionGoods ?? {})) {
					build.storage?.addGood(good as GoodType, qty as number)
				}
				tile.asGenerated = false
				continue
			}
			if (!(content instanceof UnBuiltLand)) continue
			content.setProject(entry.project, constructionSite)
			for (const [good, qty] of Object.entries(entry.foundationGoods ?? {})) {
				content.foundationStorage?.addGood(good as GoodType, qty as number)
			}
			tile.asGenerated = false
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
				const build = createConstructionShell(tile, constructionSite)
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

	private applyRoadPatches(roads: NonNullable<GamePatches['roads']>) {
		if (Array.isArray(roads)) {
			for (const road of roads) {
				this.hex.setRoadType({ q: road.coord[0], r: road.coord[1] }, road.type)
			}
			return
		}
		for (const [type, coords] of Object.entries(roads) as Array<
			[RoadType, ReadonlyArray<readonly [number, number]> | undefined]
		>) {
			for (const coord of coords ?? []) {
				this.hex.setRoadType({ q: coord[0], r: coord[1] }, type)
			}
		}
	}

	public saveGameData(): SaveState {
		const tiles: Array<TilePatch> = []
		const hives = new Map<Hive, Array<AlveolusPatch>>()
		const looseGoodsPatches: Partial<Record<GoodType, Array<[number, number]>>> = {}
		// Untouched streamed gameplay tiles are just deterministic generated terrain/content,
		// so they are retained as frontier coordinates. Once gameplay mutates a tile,
		// `asGenerated` is cleared and the tile is persisted through ordinary patches below.
		const streamedFrontier = [...this.materializedGameplayCoords.values()]
			.filter((coord) => !this.bootstrapGameplayCoords.has(axial.key(coord)))
			.filter((coord) => this.hex.getTile(coord)?.asGenerated)
			.map((coord) => [coord.q, coord.r] as [number, number])
		const zones: {
			harvest: Array<[number, number]>
			residential: Array<[number, number]>
			commercial: Array<[number, number]>
			named: NamedZonePatch[]
		} = {
			harvest: [],
			residential: [],
			commercial: [],
			named: [],
		}
		const namedZoneCoords = new Map<string, Array<[number, number]>>()
		const projects: Record<string, Array<[number, number]>> = {}
		const projectSites: ProjectSitePatch[] = []
		const dwellings: DwellingPatch[] = []
		const roads: RoadPatches = {}
		for (const road of this.hex.roadSegments()) {
			const coords = [...(roads[road.type] ?? [])]
			coords.push([road.coord.q, road.coord.r])
			roads[road.type] = coords
		}

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
			} else if (zone === 'commercial') {
				zones.commercial!.push([q, r])
			} else if (zone) {
				const coords = namedZoneCoords.get(zone) ?? []
				coords.push([q, r])
				namedZoneCoords.set(zone, coords)
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
								type: content.deposit.name,
								amount: content.deposit.amount,
							}
						: undefined,
					plantedTrees: content.plantedTrees ? { ages: [...content.plantedTrees.ages] } : undefined,
				})

				// Save project information
				if (content.project) {
					if (!projects[content.project]) {
						projects[content.project] = []
					}
					projects[content.project].push([q, r])
					projectSites.push({
						coord: [q, r],
						project: content.project,
						variant:
							content.constructionSite?.target.kind === 'alveolus'
								? content.constructionSite.target.variant
								: undefined,
						constructionPhase: content.constructionSite?.phase,
						foundationGoods: content.foundationStorage?.stock ?? {},
						foundationConsumedGoods: content.constructionSite?.foundationConsumedGoods ?? {},
					})
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

			if (isConstructionSiteShell(content) && content.constructionSite.target.kind === 'alveolus') {
				const target = content.constructionSite.target
				const buildVariantId = (content as { variant?: string }).variant ?? target.variant
				const projectStr = buildVariantId
					? `build:${target.alveolusType}${VARIANT_DELIMITER}${buildVariantId}`
					: `build:${target.alveolusType}`
				projectSites.push({
					coord: [q, r],
					project: projectStr,
					variant: buildVariantId,
					constructionPhase: content.constructionSite.phase,
					foundationConsumedGoods: content.constructionSite.foundationConsumedGoods ?? {},
					constructionGoods: content.storage?.stock ?? {},
					constructionWorkSecondsApplied: content.constructionWorkSecondsApplied,
					hivePlanId: (content as { hivePlanId?: string }).hivePlanId,
					hivePlanVersion: (content as { hivePlanVersion?: number }).hivePlanVersion,
					planRoleId: (content as { planRoleId?: string }).planRoleId,
				})
			}

			if (content instanceof Alveolus) {
				// Assume alveolus-like content decorated by GcClassed with resourceName accessible via .name
				const alveolusName = content.name
				if (!hives.has(content.hive)) hives.set(content.hive, [])
				const constructionShell = isConstructionSiteShell(content) ? content : undefined
				const patch: AlveolusPatch =
					constructionShell?.constructionSite.target.kind === 'alveolus'
						? {
								coord: [q, r],
								alveolus: constructionShell.constructionSite.target.alveolusType,
								underConstruction: true,
								constructionWorkSecondsApplied: constructionShell.constructionWorkSecondsApplied,
								constructionPhase: constructionShell.constructionSite.phase,
								goods: constructionShell.storage?.stock || {},
								hivePlanId: (constructionShell as { hivePlanId?: string }).hivePlanId,
								hivePlanVersion: (constructionShell as { hivePlanVersion?: number })
									.hivePlanVersion,
								planRoleId: (constructionShell as { planRoleId?: string }).planRoleId,
							}
						: {
								coord: [q, r],
								alveolus: alveolusName as AlveolusType,
								variant: (content as { variant?: string }).variant,
								goods: content.storage?.stock || {},
								processBuffers:
									content instanceof TransformAlveolus ? { ...content.processBuffers } : undefined,
							}
				// Include configuration if not default hive scope
				if (content.configurationRef.scope !== 'hive' || content.individualConfiguration) {
					patch.configuration = {
						ref: content.configurationRef,
						individual: content.individualConfiguration,
					}
				}
				if (content.assignedZoneIds.length > 0) {
					patch.assignedZoneIds = [...content.assignedZoneIds]
				}
				hives.get(content.hive)!.push(patch)
			}

			if (isConstructionSiteShell(content) && content.constructionSite.target.kind === 'dwelling') {
				dwellings.push({
					coord: [q, r],
					tier: content.constructionSite.target.tier,
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

		// Save loose goods in the same grouped tile-coordinate format as authored patches.
		const looseGoodsMap = (this.hex.looseGoods as any).goods as Map<
			string,
			Array<{ goodType: GoodType; position: { q: number; r: number } }>
		>
		for (const [, goodsList] of looseGoodsMap.entries()) {
			for (const fg of goodsList) {
				const coord = axial.round(fg.position)
				if (!looseGoodsPatches[fg.goodType]) looseGoodsPatches[fg.goodType] = []
				looseGoodsPatches[fg.goodType]!.push([coord.q, coord.r])
			}
		}

		// Serialize hive configurations
		const hiveConfigurations: Record<string, Record<string, Ssh.AlveolusConfiguration>> = {}
		for (const [hive, _alveoli] of hives.entries()) {
			if (hive.name && hive.configurations.size > 0) {
				hiveConfigurations[hive.name] = Object.fromEntries(hive.configurations)
			}
		}

		for (const definition of this.hex.zoneManager.listCustomZoneDefinitions()) {
			zones.named.push({
				id: definition.id,
				name: definition.name,
				color: definition.color,
				harvestable: definition.harvestable,
				coords: namedZoneCoords.get(definition.id) ?? [],
			})
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
				projectSites,
				dwellings,
				playerAccount: { balanceVp: this.playerAccount.balanceVp },
				vehicles: this.vehicles.serialize(),
				roads,
				conveyMovements,
				population: this.population.serialize(),
				generationOptions: this.generationOptions,
				namedConfigurations: this.configurationManager.serialize(),
				hiveConfigurations,
				hivePlans: this.hivePlans.serialize(),
			}
		} finally {
			this.conveySaveIndexByRef = undefined
		}
	}

	public async loadGameData(state: SaveState) {
		await this.loaded
		this.conveyRestoredAtLoad = []
		console.info('[save-load][loadGameData] begin', {
			seed: state.generationOptions?.terrainSeed,
			characterCount: state.generationOptions?.characterCount,
			state: {
				tiles: (state.tiles ?? []).length,
				hives: (state.hives ?? []).length,
				looseGoodsKinds: Object.keys(state.looseGoods || {}).length,
				vehicles: (state.vehicles ?? []).length,
				freightLines: (state.freightLines ?? []).length,
				streamedFrontier: (state.streamedFrontier ?? []).length,
				population: (state.population ?? []).length,
			},
		})
		// 1. Restore named configurations first (before alveoli are created)
		if (state.namedConfigurations) {
			this.configurationManager.deserialize(state.namedConfigurations)
		}
		this.hivePlans.deserialize(state.hivePlans)

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
		await this.generateAsync(state.generationOptions, state, state, { restoreMode: true })
		console.info('[save-load][loadGameData] after generateAsync', {
			materializedGameplayTiles: this.materializedGameplayCoords.size,
			objects: this.objects.size,
			hives: (state.hives ?? []).length,
			freightLines: this.freightLines.length,
		})

		this.residentialDemandTicker = new ResidentialDemandTicker(this)

		this.conveyRestoredAtLoad = restoreSerializedConveyMovements(this, state.conveyMovements)

		// 4. Load Population (after board is ready)
		if (state.population) {
			this.population.deserialize(state.population)
		}
		console.info('[save-load][loadGameData] completed', {
			population: state.population?.length ?? 0,
			conveyRestored: this.conveyRestoredAtLoad.length,
		})
	}

	/**
	 * Get the bounding box of all player-owned content in the game.
	 * Returns null if there is no player content (new game).
	 */
	public getPlayerContentBounds(): {
		minQ: number
		maxQ: number
		minR: number
		maxR: number
	} | null {
		const coords: AxialCoord[] = []

		// Add tiles that have been modified by the player (not generated)
		for (const tile of this.hex.tiles) {
			if (!tile.asGenerated) {
				const coord = toAxialCoord(tile.position)
				if (coord) coords.push(coord)
			}
		}

		// Add character positions (Population has Symbol.iterator)
		for (const character of this.population) {
			const coord = toAxialCoord(character.position)
			if (coord) coords.push(coord)
		}

		// Add vehicle positions (Vehicles has Symbol.iterator)
		for (const vehicle of this.vehicles) {
			if (vehicle.position) {
				const coord = toAxialCoord(vehicle.position)
				if (coord) coords.push(coord)
			}
		}

		// Add freight line stop coordinates
		for (const line of this.freightLines) {
			for (const stop of line.stops) {
				if ('anchor' in stop) {
					// FreightBayAnchor has coord: readonly [number, number]
					coords.push({ q: stop.anchor.coord[0], r: stop.anchor.coord[1] })
				} else if ('zone' in stop) {
					const zoneDef = stop.zone
					if (zoneDef.kind === 'radius') {
						// Add the center and radius extent
						coords.push({ q: zoneDef.center[0], r: zoneDef.center[1] })
						const center = { q: zoneDef.center[0], r: zoneDef.center[1] }
						for (const offset of axial.allTiles(center, zoneDef.radius)) {
							coords.push(offset)
						}
					} else if (zoneDef.kind === 'named') {
						// Get coords for named zone
						const zoneCoords = this.hex.zoneManager.coordsForZone(zoneDef.zoneId)
						for (const coord of zoneCoords) {
							coords.push(coord)
						}
					}
				} else if ('trade' in stop) {
					const profile = this.getSettlementTradeProfile(stop.trade.settlementId)
					if (profile) coords.push(profile.center)
				}
			}
		}

		// Add named zone coordinates
		for (const zoneDef of this.hex.zoneManager.listCustomZoneDefinitions()) {
			const zoneCoords = this.hex.zoneManager.coordsForZone(zoneDef.id)
			for (const coord of zoneCoords) {
				coords.push(coord)
			}
		}

		// Add dwelling coordinates
		for (const tile of this.hex.tiles) {
			const content = tile.content
			if (content instanceof BasicDwelling) {
				const coord = toAxialCoord(tile.position)
				if (coord) coords.push(coord)
			} else if (isConstructionSiteShell(content)) {
				const coord = toAxialCoord(tile.position)
				if (coord) coords.push(coord)
			}
		}

		// Add loose goods coordinates
		const looseGoodsMap = (this.hex.looseGoods as any).goods as Map<
			string,
			Array<{ goodType: GoodType; position: { q: number; r: number } }>
		>
		for (const [, goodsList] of looseGoodsMap.entries()) {
			for (const fg of goodsList) {
				coords.push(axial.round(fg.position))
			}
		}

		// Add road endpoint coordinates
		for (const road of this.hex.roadSegments()) {
			coords.push(road.coord)
		}

		if (coords.length === 0) return null

		let minQ = Infinity
		let maxQ = -Infinity
		let minR = Infinity
		let maxR = -Infinity

		for (const coord of coords) {
			minQ = Math.min(minQ, coord.q)
			maxQ = Math.max(maxQ, coord.q)
			minR = Math.min(minR, coord.r)
			maxR = Math.max(maxR, coord.r)
		}

		return { minQ, maxQ, minR, maxR }
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
		this.clearTraceTimeSource?.()
		this.clearTraceTimeSource = undefined
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
		this.pendingPresentationEvents.clear()
		this.pendingConveyEvents.splice(0)
		this.objects.clear()
		this.interactiveLifecycleFlushScheduled = false
		this.presentationEventsFlushScheduled = false
		this.conveyEventsFlushScheduled = false
		this._workPlanningRevision = 0
	}
}
