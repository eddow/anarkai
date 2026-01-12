import { Eventful, reactive, unreactive } from 'mutts'
import { zip } from '$lib/utils'
import type { GameRenderer, InputAdapter } from '$lib/types/engine'
import { SimulationLoop } from '$lib/utils/loop'
import * as gameContent from '$assets/game-content'
import { assert, namedEffect } from '$lib/debug'
import { configuration } from '$lib/globals'
import { interactionMode, mrg } from '$lib/interactive-state'

import type { AlveolusType, DepositType, GoodType } from '$lib/types'
import { axial, axialRectangle, cartesian, fromCartesian } from '$lib/utils/axial'
import { LCG } from '$lib/utils/numbers'
import { toAxialCoord } from '$lib/utils/position'
import { tileSize } from '$lib/utils/varied'
import { Alveolus } from './board'
import { HexBoard } from './board/board'
import { Deposit, UnBuiltLand } from './board/content/unbuilt-land'
import { Tile } from './board/tile'
import type { Zone } from './board/zone'
import {
	type GameGenerationConfig,
	GameGenerator,
	type GeneratedCharacterData,
	type GeneratedTileData,
} from './generation'
import { alveolusClass, type Hive } from './hive'
import type { HittableGameObject, InteractiveGameObject } from './object'
import { Population } from './population/population'

try {
	unreactive(gameContent)
} catch {
	// Ignore errors in test environment where gameContent might be a mock namespace
}
const timeMultiplier = {
	pause: 0,
	play: 1,
	'fast-forward': 2,
	gonzales: 4,
} as const
const rootSpeed = 2
// Helper function to flatten the tree structure into dot-separated keys
// (Kept if needed for other logic, but resources import is gone?)
// actually flattenResources is exported, might be used? 
// But resources and assetUrls are definitely visual.
// Let's remove them.

export type GameEvents = {
	gameStart(): void
	objectOver(pointer: any, object: InteractiveGameObject, stopPropagation?: () => void): void
	objectOut(pointer: any, object: InteractiveGameObject): void
	objectDown(pointer: any, object: InteractiveGameObject, stopPropagation?: () => void): void
	objectUp(pointer: any, object: InteractiveGameObject): void
	objectClick(pointer: any, object: InteractiveGameObject): void
	objectDrag(tiles: Tile[], event: MouseEvent): void
}
unreactive(Eventful)
export type GameGenerationOptions = {
	boardSize: number
	terrainSeed: number
	characterCount: number
	characterRadius?: number
}

export interface AlveolusPatch {
	coord: [number, number]
	goods?: Partial<Record<GoodType, number>>
	alveolus: AlveolusType
}

export interface TilePatch {
	coord: [number, number]
	deposit?: {
		type: DepositType
		amount: number
	}
}
export interface GamePatches {
	tiles?: Array<TilePatch>
	hives?: Array<{
		name?: string
		alveoli: Array<AlveolusPatch>
	}>
	freeGoods?: Array<{
		goodType: GoodType
		position: { q: number; r: number }
	}>
	zones?: {
		harvest?: Array<[number, number]>
		residential?: Array<[number, number]>
	}
	projects?: Record<string, Array<[number, number]>>
}

export interface SaveState extends GamePatches {
	population: any[]
	generationOptions: GameGenerationOptions
}

export class Game extends Eventful<GameEvents> {
	public get name() {
		return 'GameX'
	}
	readonly random: ReturnType<typeof LCG> = LCG('gameSeed', 0)
	public lcg(seed: string | number) {
		return LCG('gameSeed', seed)
	}
	public renderer?: GameRenderer
	public input?: InputAdapter
	public readonly population: Population
	// Dynamically loaded usage of Hive class
	private HiveClass?: typeof Hive

	public readonly objects = reactive(new Map<string, InteractiveGameObject>())
	public readonly hittableObjects = new Set<HittableGameObject>()
	public readonly hex: HexBoard
	public readonly generator: GameGenerator
	public readonly ticker: SimulationLoop
	private tickedObjects = new Set<{ update(deltaSeconds: number): void }>()
	public loaded: Promise<void>
	private async load() {
        // Headless load - just start ticker?
		this.ticker.start()
	}

	getObject(uid: string) {
		return this.objects.get(uid)
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
		if (this.objects.delete(object.uid)) object.destroy()
	}

	registerTickedObject(object: { update(deltaSeconds: number): void }) {
		this.tickedObjects.add(object)
	}

	unregisterTickedObject(object: { update(deltaSeconds: number): void }) {
		this.tickedObjects.delete(object)
	}

	private tickerCallback = (timer: SimulationLoop) => {
		const deltaSeconds =
			((rootSpeed * timer.elapsedMS) / 1000) * timeMultiplier[configuration.timeControl]
		if (deltaSeconds > 1) return // more than 1 second = paused on debugging, skip passing time when debugger paused

		for (const object of this.tickedObjects) {
			if ('destroyed' in object && object.destroyed) continue
			object.update(deltaSeconds)
		}
	}

	constructor(
		private readonly generationOptions: GameGenerationOptions = {
			boardSize: 12,
			terrainSeed: 1234,
			characterCount: 1,
			characterRadius: 200,
		},
		private readonly patches: GamePatches = {},
	) {
		super()
		this.ticker = new SimulationLoop()
		this.loaded = this.load()

		// Create hex board
		this.hex = new HexBoard(this)

		// Create population singleton
		this.population = new Population(this)

		// Create game generator
		this.generator = new GameGenerator()
		// Create game generator
		this.generator = new GameGenerator()
		this.loaded
			.then(() => import('./hive'))
			.then(({ Hive }) => {
				this.HiveClass = Hive
			})
			.then(() => {
				// Initialize base RNG with terrainSeed so everything is reproducible
				;(this as any).rng = LCG('gameSeed', this.generationOptions.terrainSeed)
			// Expose RNG to global for script helpers
			;(globalThis as any).__GAME_RANDOM__ = (max?: number, min?: number) => this.random(max, min)
			this.generate(this.generationOptions, this.patches)
			try {
				this.emit('gameStart')
			} catch (e) {
				console.error('Error during gameStart emission:', e)
			}

			// Register the main ticker callback and start the game ticker after everything is built
			this.ticker.add(this.tickerCallback)

			// Expose for testing
			;(globalThis as any).mrg = mrg
			;(globalThis as any).testHover = (uid?: string) => {
				const obj = uid ? this.getObject(uid) : undefined
				mrg.hoveredObject = obj
				console.log(`[testHover] set to ${uid} (${obj?.constructor.name})`)
			}
		})
	}

	public simulateObjectClick(object: InteractiveGameObject, event: MouseEvent = {} as any) {
		this.emit('objectClick', event, object)
	}
	generate(config: GameGenerationConfig, patches: GamePatches = {}) {
		try {
			// Generate data from the generator
			const result = this.generator.generate(config)

			// Load the generated data into the game
			this.loadGeneratedBoard(result.boardData)
			this.loadGeneratedPopulation(result.populationData)
			// Apply patches if any
			if (patches.tiles?.length) this.applyTilePatches(patches.tiles)
			if (patches.hives?.length) this.applyHivesPatches(patches.hives)
			if (patches.freeGoods?.length) this.applyFreeGoodsPatches(patches.freeGoods)
			if (patches.zones) this.applyZonePatches(patches.zones)
			if (patches.projects) this.applyProjectPatches(patches.projects)
		} catch (error) {
			console.error('Generation failed:', error)
		}
	}
	clickObject(event: any, object: InteractiveGameObject) {
		this.emit('objectClick', event, object)
	}

	/**
	 * Load generated board data into the game
	 */
	private loadGeneratedBoard(tileData: GeneratedTileData[]): void {
		for (const tileInfo of tileData) {
			const tile = new Tile(this.hex, tileInfo.coord)

			// Create deposit if present
			let deposit: Deposit | undefined
			if (tileInfo.deposit) {
				const DepositClass = Deposit.class[tileInfo.deposit.type as keyof typeof Deposit.class]
				if (DepositClass) {
					deposit = new DepositClass(tileInfo.deposit.amount)
				}
			}

			const land = new UnBuiltLand(tile, tileInfo.terrain, deposit)
			// As generated state
			tile.asGenerated = true

			tile.content = land // Set the UnBuiltLand as tile content

			// Create initial goods at equilibrium levels
			for (const [goodType, amount] of Object.entries(tileInfo.goods)) {
				for (let i = 0; i < amount; i++) {
					// Generate random position within the tile using triangular distribution
					const u = this.random()
					const v = this.random()
					const q = (u - v) * 0.5
					const r = v - 0.5

					const randomPos = {
						q: tileInfo.coord.q + q,
						r: tileInfo.coord.r + r,
					}

					// Add the good to the free goods system
					this.hex.freeGoods.add(tile, goodType as any, { position: randomPos })
				}
			}
		}
	}

	private applyTilePatches(patches: NonNullable<GamePatches['tiles']>) {
		for (const p of patches) {
			const coord = { q: p.coord[0], r: p.coord[1] }
			const tile = this.hex.getTile(coord)
			if (!tile) continue
			const content = tile.content
			if (content instanceof UnBuiltLand) {
				if (p.deposit) {
					const DepositClass = Deposit.class[p.deposit.type as keyof typeof Deposit.class]
					if (DepositClass) content.deposit = new DepositClass(p.deposit.amount)
				}
				tile.asGenerated = false
			}
		}
	}

	private applyFreeGoodsPatches(patches: NonNullable<GamePatches['freeGoods']>) {
		for (const fg of patches) {
			const tile = this.hex.getTile(axial.round(fg.position))
			if (!tile) continue
			this.hex.freeGoods.add(tile, fg.goodType, { position: fg.position })
		}
	}

	private applyHivesPatches(hives: NonNullable<GamePatches['hives']>) {
		for (const hive of hives) {
			let hiveInstance: Hive | undefined
			for (const a of hive.alveoli) {
				const coord = { q: a.coord[0], r: a.coord[1] }
				const tile = this.hex.getTile(coord)
				if (!tile) continue
				const AlveolusCtor = alveolusClass[a.alveolus as keyof typeof alveolusClass]
				if (!AlveolusCtor) continue
				const alv = new AlveolusCtor(tile)
				tile.content = alv
				if (!alv.hive) {
					if (this.HiveClass) {
						const h = this.HiveClass.for(tile)
						h.attach(alv)
					}
				}
				hiveInstance = alv.hive
				alv.hive.name = hive.name
				if (a.goods)
					for (const [good, qty] of Object.entries(a.goods))
						alv.storage?.addGood(good as GoodType, qty)
				tile.asGenerated = false
			}
			assert(hiveInstance, 'Alveolus building on load')
		}
	}

	private applyZonePatches(zones: NonNullable<GamePatches['zones']>) {
		for (const [zone, coords] of Object.entries(zones)) {
			for (const coord of coords) {
				const coordObj = { q: coord[0], r: coord[1] }
				this.hex.zoneManager.setZone(coordObj, zone as Zone)
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

	public saveGameData(): SaveState {
		const tiles: Array<TilePatch> = []
		const hives = new Map<Hive, Array<AlveolusPatch>>()
		const freeGoodsPatches: GamePatches['freeGoods'] = []
		const zones: GamePatches['zones'] = {
			harvest: [],
			residential: [],
		}
		const projects: GamePatches['projects'] = {}

		// Enumerate using hex board contents map by sampling existing tiles
		for (let q = -this.hex.boardSize; q <= this.hex.boardSize; q++) {
			for (let r = -this.hex.boardSize; r <= this.hex.boardSize; r++) {
				const coord = { q, r }
				const tile = this.hex.getTile(coord)
				if (!tile || tile.asGenerated) continue
				const content = tile.content
				if (!content) continue
				// Serialize minimal content state
				if (content instanceof UnBuiltLand) {
					tiles.push({
						coord: [q, r],
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
				} else if (content instanceof Alveolus) {
					// Assume alveolus-like content decorated by GcClassed with resourceName accessible via .name
					const alveolusName = content.name
					if (!hives.has(content.hive)) hives.set(content.hive, [])
					hives.get(content.hive)!.push({
						coord: [q, r],
						alveolus: alveolusName as AlveolusType,
						goods: content.storage?.stock || {},
					})
				}

				// Save zone information
				const zone = this.hex.zoneManager.getZone(coord)
				if (zone === 'harvest') {
					zones.harvest!.push([q, r])
				} else if (zone === 'residential') {
					zones.residential!.push([q, r])
				}
			}
		}

		// Save all freeGoods with their exact positions
		const freeGoodsMap = (this.hex.freeGoods as any).goods as Map<
			string,
			Array<{ goodType: GoodType; position: { q: number; r: number } }>
		>
		for (const [, goodsList] of freeGoodsMap.entries()) {
			for (const fg of goodsList) {
				freeGoodsPatches!.push({
					goodType: fg.goodType,
					position: fg.position,
				})
			}
		}

		return {
			tiles,
			hives: Array.from(hives.entries()).map(([hive, alveoli]) => ({ name: hive.name, alveoli })),
			freeGoods: freeGoodsPatches,
			zones,
			projects,
			population: this.population.serialize(),
			generationOptions: this.generationOptions,
		}
	}

	public loadGameData(state: SaveState) {
		// 1. Re-generate the base world (terrain)
		// We assume state.generationOptions has the original seed
		// TODO: Restore RNG state if necessary, or just rely on seed
		
		// Reset simulation if needed (though generate usually overwrites)
		// Ideally we should clear everything first?
		// for now, let's allow generate to overwrite.

		// 2. Generate and apply patches
		this.generate(state.generationOptions, state)

		// 3. Load Population (after board is ready)
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
		// Remove the ticker callback and stop the game ticker
		this.ticker.remove(this.tickerCallback)
		this.ticker.stop()
	}
}
