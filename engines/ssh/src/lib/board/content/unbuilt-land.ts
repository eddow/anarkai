import { deposits } from 'engine-rules'
import { effect, reactive } from 'mutts'
import {
	type ConstructionSiteState,
	constructionTargetFromProject,
	createConstructionSiteState,
	setConstructionFoundationDeliveredGoods,
} from 'ssh/construction-state'
import { traces } from 'ssh/dev/debug'
import { withTicked } from 'ssh/game/object'
import { gameIsaTypes } from 'ssh/npcs/utils'
import { residentialBasicDwellingProject } from 'ssh/residential/constants'
import { SpecificStorage } from 'ssh/storage/specific-storage'
import type { TerrainType } from 'ssh/types'
import type { GoodType } from 'ssh/types/base'
import { LCG, subSeed } from 'ssh/utils/numbers'
import { fastPoissonRandom } from 'ssh/utils/poisson'
import { toAxialCoord } from 'ssh/utils/position'
import type { Tile } from '../tile'
import { TileContent } from './content'
import { GcClassed } from './utils'

export interface PlantedTreesState {
	ages: number[]
}

export const plantedTreeMaxPerTile = 2
export const plantedTreeImmatureAgeSeconds = 30
export const plantedTreeMatureAgeSeconds = 60
export const plantedTreeWoodYield = 6

export class Deposit extends GcClassed<Ssh.DepositDefinition>() {
	constructor(
		public amount: number,
		definition: Ssh.DepositDefinition,
		resourceName: string
	) {
		super()
		this.assignGameContent(definition, resourceName)
	}

	static create(type: string, amount: number): Deposit | undefined {
		const def = deposits[type as keyof typeof deposits]
		if (!def) return undefined
		return new Deposit(amount, def, type)
	}
}

@reactive
export class UnBuiltLand extends withTicked(TileContent) {
	/** Project identifier (e.g., "build:sawmill") indicating pending construction */
	public project?: string
	public constructionSite?: ConstructionSiteState
	public foundationStorage?: SpecificStorage
	public plantedTrees?: PlantedTreesState

	/**
	 * Set a project and clear any existing zone
	 */
	setProject(project: string, constructionSite?: ConstructionSiteState): void {
		this.tile.asGenerated = false
		this.project = project
		const target = constructionTargetFromProject(project)
		this.constructionSite =
			constructionSite ?? (target ? createConstructionSiteState(target) : undefined)
		this.foundationStorage = this.constructionSite
			? new SpecificStorage(
					this.constructionSite.foundationRequiredGoods as Record<GoodType, number>
				)
			: undefined
		this.foundationStorage?.setPresentationChangeNotifier(() =>
			this.game.enqueueStoragePresentationChange(this.tile)
		)
		this.foundationStorage?.setPlanningChangeNotifier(() =>
			this.game.invalidateWorkPlanning('unbuilt-land.foundation-storage')
		)
		const coord = toAxialCoord(this.tile.position)
		traces.work.log?.('work.project.set', {
			project,
			tileQ: coord?.q,
			tileR: coord?.r,
			zone: this.tile.zone,
			targetKind: target?.kind,
			target: target?.kind === 'alveolus' ? target.alveolusType : target?.tier,
			phase: this.constructionSite?.phase,
			burdened: this.tile.isBurdened,
			looseGoods: this.tile.looseGoods.length,
			availableLooseGoods: this.tile.availableGoods.length,
			deposit: this.deposit?.name,
		})
		if (this.constructionSite) {
			effect`unbuilt-land:construction-phase`(() => {
				if (!this.project || !this.constructionSite) return
				setConstructionFoundationDeliveredGoods(
					this.constructionSite,
					this.foundationStorage?.stock ?? {}
				)
				const phase = this.tile.isBurdened ? 'planned' : 'foundation'
				if (this.constructionSite.phase === phase) return
				this.constructionSite.phase = phase
				traces.work.log?.('work.project.phase', {
					project: this.project,
					phase,
					tileQ: coord?.q,
					tileR: coord?.r,
					zone: this.tile.zone,
					burdened: this.tile.isBurdened,
					looseGoods: this.tile.looseGoods.length,
					availableLooseGoods: this.tile.availableGoods.length,
					deposit: this.deposit?.name,
				})
				this.game.invalidateWorkPlanning('unbuilt-land.construction-phase')
				this.game.enqueueInteractiveChange(this.tile)
			})
		}
		// Residential construction keeps the residential zone marker; alveolus projects clear it.
		if (project !== residentialBasicDwellingProject) {
			this.tile.zone = undefined
		}
		this.game.enqueueInteractiveChange(this.tile)
	}

	get name() {
		return ''
	}
	get storage() {
		return this.foundationStorage
	}

	constructor(
		public readonly tile: Tile,
		public terrain: TerrainType,
		public deposit?: Deposit,
		plantedTrees?: PlantedTreesState
	) {
		const tileCoord = toAxialCoord(tile.position)!
		super(tile.board.game, `unbuilt-${tileCoord.q}-${tileCoord.r}`)
		if (plantedTrees) this.plantedTrees = normalizePlantedTrees(plantedTrees, deposit)
	}

	update(deltaSeconds: number) {
		if (this.plantedTrees?.ages.length) {
			const hadMature = hasMaturePlantedTree(this)
			const previousStages = this.plantedTrees.ages.map(plantedTreeStage)
			this.plantedTrees.ages = normalizePlantedTreeAges(
				this.plantedTrees.ages.map((age) => age + deltaSeconds),
				this.deposit
			)
			const nextStages = this.plantedTrees.ages.map(plantedTreeStage)
			if (!hadMature && hasMaturePlantedTree(this)) {
				this.tile.board.game.invalidateWorkPlanning('planted-tree.mature')
			}
			if (nextStages.some((stage, index) => stage !== previousStages[index])) {
				this.tile.board.game.notifyTerrainDepositsChanged(this.tile)
			}
		}
		// Generate goods if this tile has a deposit with generation configuration
		if (!this.deposit) return

		const generation = this.deposit.generation
		if (!generation) return

		// Generate each good type based on its rate and deposit amount
		for (const [goodType, rate] of Object.entries(generation)) {
			const totalRate = (rate as number) * this.deposit.amount
			const lambda = totalRate * deltaSeconds

			// Use proper Poisson distribution for bursty generation
			const goodsToSpawn = fastPoissonRandom(lambda, (max?: number, min?: number) =>
				this.game.random(max, min)
			)

			// Spawn the calculated number of goods
			for (let i = 0; i < goodsToSpawn; i++) {
				this.generateGoodAtTile(goodType as any)
			}
		}
	}

	/**
	 * Provide jobs for construction project
	 */
	getJob(): any {
		if (!this.project) return undefined

		// Note: Foundation jobs are provided by engineer alveolus, not by UnBuiltLand
		return undefined
	}

	private generateGoodAtTile(goodType: string) {
		const tileCoord = toAxialCoord(this.tile.position)!

		// Generate random point using triangular distribution
		const u = this.game.random()
		const v = this.game.random()

		const q = (u - v) * 0.5
		const r = v - 0.5

		const randomPos = {
			q: tileCoord.q + q,
			r: tileCoord.r + r,
		}

		// Create the loose good
		this.tile.board.looseGoods.add(this.tile, goodType as any, {
			position: randomPos,
		})
	}

	get debugInfo() {
		return {
			type: 'UnBuiltLand',
			terrain: this.terrain,
			deposit: this.deposit?.amount,
			plantedTrees: this.plantedTrees,
		}
	}
	get walkTime() {
		return this.terrain === 'water' ? Number.POSITIVE_INFINITY : 1
	}
	get background() {
		return `terrain.${this.terrain}`
	}

	/**
	 * Override colorCode to show pink tint/border when there's a project
	 */
	colorCode(): { tint: number; borderColor?: number } {
		if (this.project) {
			return { tint: 0xffb4d9, borderColor: 0xff1493 } // pinkish tint, deep pink border
		}
		return super.colorCode()
	}

	/** Deterministic entry position for deposit interaction on this tile */
	get depositEntryPosition() {
		const tileCoord = toAxialCoord(this.tile.position)!
		const seed = subSeed('deposit-entry', tileCoord.q, tileCoord.r)
		const rnd = LCG('gameSeed', seed)
		// entry biased towards lower side of hex for visibility
		const offsetQ = (rnd() - 0.5) * 0.3
		const offsetR = 0.35 + rnd() * 0.1
		return { q: tileCoord.q + offsetQ, r: tileCoord.r + offsetR }
	}

	canInteract(action: string): boolean {
		// UnBuiltLand can accept building actions
		if (action.startsWith('build:')) {
			return true
		}
		// UnBuiltLand can accept zoning actions, but only if no project is set
		if (action.startsWith('zone:')) {
			return !this.project // Cannot zone if there's already a project
		}
		// Can also accept other actions if they make sense
		return false
	}
}

gameIsaTypes.unbuilt = (value: any) => {
	return value instanceof UnBuiltLand
}

export function normalizePlantedTreeAges(
	ages: readonly number[] | undefined,
	deposit?: Deposit
): number[] {
	const count = Math.max(
		0,
		Math.min(plantedTreeMaxPerTile, Math.floor(deposit?.name === 'tree' ? deposit.amount : 0))
	)
	const normalized = [...(ages ?? [])]
		.map((age) => Math.max(0, Number.isFinite(age) ? Number(age) : 0))
		.slice(0, count)
	while (normalized.length < count) normalized.push(0)
	return normalized
}

export function normalizePlantedTrees(
	state: PlantedTreesState | undefined,
	deposit?: Deposit
): PlantedTreesState | undefined {
	if (!state || deposit?.name !== 'tree') return undefined
	const ages = normalizePlantedTreeAges(state.ages, deposit)
	return ages.length ? { ages } : undefined
}

export function plantedTreeStage(age: number): 'small' | 'medium' | 'mature' {
	if (age >= plantedTreeMatureAgeSeconds) return 'mature'
	if (age >= plantedTreeImmatureAgeSeconds) return 'medium'
	return 'small'
}

export function hasMaturePlantedTree(land: UnBuiltLand): boolean {
	return !!land.plantedTrees?.ages.some((age) => plantedTreeStage(age) === 'mature')
}

export function canPlantTreeOnLand(land: UnBuiltLand): boolean {
	if (land.project) return false
	if (land.terrain !== 'forest') return false
	if (land.deposit && land.deposit.name !== 'tree') return false
	return (land.deposit?.amount ?? 0) < plantedTreeMaxPerTile
}

export function plantTreeOnLand(land: UnBuiltLand): boolean {
	if (!canPlantTreeOnLand(land)) return false
	if (!land.deposit) {
		const deposit = Deposit.create('tree', 0)
		if (!deposit) return false
		land.deposit = deposit
	}
	land.deposit.amount = Math.max(
		0,
		Math.min(plantedTreeMaxPerTile, Math.floor(land.deposit.amount) + 1)
	)
	land.plantedTrees = {
		ages: normalizePlantedTreeAges([...(land.plantedTrees?.ages ?? []), 0], land.deposit),
	}
	land.tile.board.game.notifyTerrainDepositsChanged(land.tile)
	land.tile.board.game.invalidateWorkPlanning('planted-tree.plant')
	return true
}

export function harvestMaturePlantedTree(land: UnBuiltLand): boolean {
	if (!land.deposit || land.deposit.name !== 'tree' || !land.plantedTrees?.ages.length) return false
	const index = land.plantedTrees.ages.findIndex((age) => plantedTreeStage(age) === 'mature')
	if (index < 0) return false
	land.plantedTrees.ages.splice(index, 1)
	land.deposit.amount = Math.max(0, Math.floor(land.deposit.amount) - 1)
	if (land.deposit.amount <= 0) {
		land.deposit = undefined
		land.plantedTrees = undefined
	} else {
		land.plantedTrees = normalizePlantedTrees(land.plantedTrees, land.deposit)
	}
	land.tile.board.game.notifyTerrainDepositsChanged(land.tile)
	land.tile.board.game.invalidateWorkPlanning('planted-tree.harvest')
	return true
}
