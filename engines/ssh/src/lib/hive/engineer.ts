import { jobBalance } from 'engine-rules'
import { inert, reactive } from 'mutts'
import { Alveolus } from 'ssh/board/content/alveolus'
import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import type { Tile } from 'ssh/board/tile'
import { isConstructionSiteShell } from 'ssh/build-site'
import {
	foundationGoodsComplete,
	setConstructionFoundationDeliveredGoods,
} from 'ssh/construction-state'
import { type AlveolusProposedJob, asAlveolusProposedJob } from 'ssh/jobs/offers'
import type { Character } from 'ssh/population/character'
import { residentialBasicDwellingProject } from 'ssh/residential/constants'
import { SlottedStorage } from 'ssh/storage/slotted-storage'
import type { ConstructJob, FoundationJob } from 'ssh/types/base'
import { type AxialCoord, axial } from 'ssh/utils'
import type { GoodsRelations } from 'ssh/utils/advertisement'
import { toAxialCoord } from 'ssh/utils/position'
import { RevisionedCache } from 'ssh/utils/revisioned-cache'
import { maxWalkTime } from '../../../assets/constants'
import { traces } from '../dev/debug.ts'

type EngineeringJob = ConstructJob | FoundationJob
type EngineeringTarget = {
	readonly job: EngineeringJob
	readonly tile: Tile
}

function pathAfterCurrentTile(path: AxialCoord[] | undefined): AxialCoord[] | undefined {
	if (!path || path.length === 0) return path
	const [first, ...rest] = path
	return first && rest.length > 0 ? rest : path
}

function isUndestroyedReadyConstructionSite(content: unknown): boolean {
	return isConstructionSiteShell(content) && content.isReady && !content.destroyed
}

@reactive
export class EngineerAlveolus extends Alveolus {
	declare action: Ssh.EngineerAction
	private readonly engineeringProposedJobsCache = new RevisionedCache<
		readonly AlveolusProposedJob[]
	>()
	constructor(tile: Tile, definition: Ssh.AlveolusDefinition, resourceName: string) {
		if (definition.action.type !== 'engineer') {
			throw new Error('EngineerAlveolus can only be created from an engineer action')
		}
		super(tile, new SlottedStorage(0, 0))
		this.assignGameContent(definition, resourceName)
	}

	private engineeringTargets(): EngineeringTarget[] {
		if (!this.canProposeAlveolusSpecificJobs) return []
		const hex = this.tile.game.hex
		const origin = toAxialCoord(this.tile.position)
		if (!origin) return []
		const targets: EngineeringTarget[] = []
		for (const tile of hex.tilesAround(origin, this.action.radius)) {
			const coord = toAxialCoord(tile.position)
			if (!coord || axial.distance(origin, coord) > this.action.radius) continue
			const content = tile.content
			if (content && isUndestroyedReadyConstructionSite(content)) {
				targets.push({
					tile,
					job: {
						job: 'construct',
						urgency: jobBalance.engineer.construct,
						fatigue: this.getFatigueCost(),
					},
				})
				continue
			}
			if (content instanceof UnBuiltLand && content.constructionSite) {
				setConstructionFoundationDeliveredGoods(
					content.constructionSite,
					content.foundationStorage?.stock ?? {}
				)
			}
			if (
				content instanceof UnBuiltLand &&
				content.project &&
				content.constructionSite &&
				foundationGoodsComplete(content.constructionSite) &&
				!tile.isBurdened
			) {
				targets.push({
					tile,
					job: {
						job: 'foundation',
						urgency: jobBalance.engineer.foundation,
						fatigue: 3,
					},
				})
			}
		}
		return targets.sort((a, b) => {
			const priority = (job: EngineeringJob) => (job.job === 'construct' ? 0 : 1)
			const priorityDiff = priority(a.job) - priority(b.job)
			if (priorityDiff !== 0) return priorityDiff
			const ac = toAxialCoord(a.tile.position)!
			const bc = toAxialCoord(b.tile.position)!
			const distanceDiff = axial.distance(origin, ac) - axial.distance(origin, bc)
			if (distanceDiff !== 0) return distanceDiff
			return axial.key(ac).localeCompare(axial.key(bc))
		})
	}

	override get proposedJobs(): readonly AlveolusProposedJob[] {
		return this.engineeringProposedJobsCache.get(this.game.workPlanningRevision, () => {
			if (this.tile.isBurdened && !this.hasConveyNearby) return []
			if (this.tile.isBurdened) return []
			return this.engineeringTargets().map((target) =>
				asAlveolusProposedJob(target.job, this, target.tile)
			)
		})
	}

	@inert
	protected override nextAlveolusJob(
		character?: Character
	): ConstructJob | FoundationJob | undefined {
		const targets = this.engineeringTargets()
		if (!character) return targets[0]?.job
		const startPos = toAxialCoord(character.position)
		if (!startPos) return undefined
		let best: (EngineeringTarget & { path: AxialCoord[] }) | undefined
		const priority = (job: EngineeringJob) => (job.job === 'construct' ? 0 : 1)
		for (const target of targets) {
			const path = character.game.hex.findPathForCharacter(
				startPos,
				target.tile.position,
				character,
				maxWalkTime,
				false
			)
			if (!path) continue
			if (
				!best ||
				priority(target.job) < priority(best.job) ||
				(priority(target.job) === priority(best.job) && path.length < best.path.length)
			) {
				best = { ...target, path }
			}
		}
		if (!best) return undefined
		const terminal = toAxialCoord(best.tile.position)
		const c = best.tile.content
		if (
			best.job.job === 'construct' &&
			isConstructionSiteShell(c) &&
			c.constructionSite.target.kind === 'dwelling'
		) {
			traces.residential.log?.('[engineer] nextJob', {
				job: 'construct',
				fromQ: startPos.q,
				fromR: startPos.r,
				radius: this.action.radius,
				targetQ: terminal?.q,
				targetR: terminal?.r,
				tier: c.constructionSite.target.tier,
			})
		}
		if (
			best.job.job === 'foundation' &&
			c instanceof UnBuiltLand &&
			c.project === residentialBasicDwellingProject
		) {
			traces.residential.log?.('[engineer] nextJob', {
				job: 'foundation',
				fromQ: startPos.q,
				fromR: startPos.r,
				radius: this.action.radius,
				targetQ: terminal?.q,
				targetR: terminal?.r,
				project: c.project,
			})
		}
		return {
			...best.job,
			path: pathAfterCurrentTile(best.path),
		}
	}

	get workingGoodsRelations(): GoodsRelations {
		return {}
	}
}
