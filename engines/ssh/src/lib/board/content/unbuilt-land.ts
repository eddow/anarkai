import { deposits } from 'engine-rules'
import { effect, reactive } from 'mutts'
import {
	type ConstructionSiteState,
	constructionTargetFromProject,
	createConstructionSiteState,
} from 'ssh/construction-state'
import { withTicked } from 'ssh/game/object'
import { gameIsaTypes } from 'ssh/npcs/utils'
import { residentialBasicDwellingProject } from 'ssh/residential/constants'
import type { TerrainType } from 'ssh/types'
import { LCG, subSeed } from 'ssh/utils/numbers'
import { fastPoissonRandom } from 'ssh/utils/poisson'
import { toAxialCoord } from 'ssh/utils/position'
import type { Tile } from '../tile'
import { TileContent } from './content'
import { GcClassed, GcClasses } from './utils'

export class Deposit extends GcClassed<Ssh.DepositDefinition>() {
	static class = GcClasses(() => Deposit, deposits)
	//declare readonly name: string

	constructor(public amount: number) {
		super()
	}
}

@reactive
export class UnBuiltLand extends withTicked(TileContent) {
	/** Project identifier (e.g., "build:sawmill") indicating pending construction */
	public project?: string
	public constructionSite?: ConstructionSiteState

	/**
	 * Set a project and clear any existing zone
	 */
	setProject(project: string, constructionSite?: ConstructionSiteState): void {
		this.project = project
		const target = constructionTargetFromProject(project)
		this.constructionSite =
			constructionSite ?? (target ? createConstructionSiteState(target) : undefined)
		if (this.constructionSite) {
			effect`unbuilt-land:construction-phase`(() => {
				if (!this.project || !this.constructionSite) return
				this.constructionSite.phase = this.tile.isClear ? 'foundation' : 'planned'
			})
		}
		this.terrain = 'concrete'
		this.tile.baseTerrain = 'concrete'
		this.tile.terrainState = {
			...(this.tile.terrainState ?? {}),
			terrain: 'concrete',
		}
		this.game.upsertTerrainOverride(this.tile.position as { q: number; r: number }, {
			terrain: 'concrete',
		})
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
		return undefined
	}

	constructor(
		public readonly tile: Tile,
		public terrain: TerrainType,
		public deposit?: Deposit
	) {
		const tileCoord = toAxialCoord(tile.position)!
		super(tile.board.game, `unbuilt-${tileCoord.q}-${tileCoord.r}`)
	}

	update(deltaSeconds: number) {
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
