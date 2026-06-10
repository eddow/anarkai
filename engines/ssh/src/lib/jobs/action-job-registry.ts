import { harvestNpcSearchDistance, harvestTravelFatiguePerStep, jobBalance } from 'engine-rules'
import type { Alveolus } from 'ssh/board/content/alveolus'
import {
	canPlantDepositOnLand,
	hasMaturePlantedTree,
	UnBuiltLand,
} from 'ssh/board/content/unbuilt-land'
import { isConstructionSiteShell } from 'ssh/build-site'
import {
	foundationGoodsComplete,
	setConstructionFoundationDeliveredGoods,
} from 'ssh/construction-state'
import type { ConstructJob, FoundationJob, Job, ValidateHivePlanJob } from 'ssh/types/base'
import { type AxialCoord, axial } from 'ssh/utils'
import { axialDistance, type Positioned, toAxialCoord } from 'ssh/utils/position'
import { maxWalkTime } from '../../../assets/constants'
import { traces } from '../dev/debug.ts'

function isUndestroyedReadyConstructionSite(content: unknown): boolean {
	return isConstructionSiteShell(content) && content.isReady && !content.destroyed
}

// ---------------------------------------------------------------------------
// Provider types
// ---------------------------------------------------------------------------

/** A proposed job bundled with an optional target tile. */
export interface ActionProposedJob {
	job: Job
	/** Target tile for multi-target jobs (engineer construct/foundation, forester planting). */
	targetTile?: any
}

/** Result returned by an action-specific job provider. */
export interface ActionJobResult {
	proposedJobs: readonly ActionProposedJob[]
	jobForCharacter(character?: any): Job | undefined
}

export type ActionJobProvider = (alveolus: Alveolus) => ActionJobResult

const registry = new Map<string, ActionJobProvider>()

export function registerActionJobProvider(actionType: string, provider: ActionJobProvider): void {
	registry.set(actionType, provider)
}

export function getActionJobProvider(actionType: string): ActionJobProvider | undefined {
	return registry.get(actionType)
}

// ---------------------------------------------------------------------------
// Harvest
// ---------------------------------------------------------------------------

registerActionJobProvider('harvest', (alveolus) => {
	const action = alveolus.action as Ssh.HarvestingAction

	const findDeposit = (
		characterPosition: Positioned | undefined,
		priority: 'project' | 'clearing' | 'any'
	): Positioned[] | undefined => {
		const startPos = toAxialCoord(characterPosition ?? alveolus.tile.position)
		const hex = alveolus.tile.game.hex
		const searchDistance = characterPosition ? maxWalkTime : harvestNpcSearchDistance

		const searchFn = (coord: Positioned) => {
			const tile = hex.getTile(coord)
			if (!tile) return false
			const content = tile.content
			if (!(content instanceof UnBuiltLand)) return false
			if (content.deposit?.name !== action.deposit) return false

			if (priority === 'project') return !!content.project

			if (priority === 'clearing') {
				return (
					tile.clearing ||
					tile.neighborTiles.some(
						(neighbor) => neighbor.content !== undefined && 'hive' in (neighbor.content as object)
					)
				)
			}

			if (content.plantedTrees) return hasMaturePlantedTree(content)
			return hex.zoneManager.isHarvestableZone(tile.zone)
		}

		return hex.findNearest(startPos, searchFn, searchDistance, false)
	}

	const canStoreInHarvester = (() => {
		const output = action.output
		return output ? alveolus.storage.canStoreAll(output) : false
	})()

	const alveoliNeedingGood = (() => {
		const output = action.output
		if (!output) return 0
		return Object.keys(output).reduce(
			(acc, goodType) => acc + (goodType in (alveolus.hive?.needs ?? {}) ? 1 : 0),
			0
		)
	})()

	const fallbackUrgency =
		jobBalance.harvest.clearing + (alveoliNeedingGood ? jobBalance.harvest.needsBonus : 0)

	// Only propose harvest jobs when at least one valid deposit exists within
	// search distance from the alveolus.  Without this guard the planner keeps
	// assigning workers to the stonecutter even after every rock has been
	// depleted or planted over, creating an endless skip→give-up→retry loop.
	const anyDeposit = findDeposit(undefined, 'any')
	const proposedJobs: ActionProposedJob[] = anyDeposit
		? [
				{
					job: {
						job: 'harvest' as const,
						urgency: fallbackUrgency,
						fatigue: alveolus.getFatigueCost(),
					} satisfies Job,
				} satisfies ActionProposedJob,
			]
		: []

	return {
		proposedJobs,

		jobForCharacter(character: any) {
			const startPos = toAxialCoord(character ? character.position : alveolus.tile.position)

			let path = findDeposit(character?.position, 'project')
			if (path) {
				return {
					job: 'harvest' as const,
					path,
					urgency: jobBalance.harvest.project ?? jobBalance.harvest.clearing,
					fatigue:
						alveolus.getFatigueCost() +
						(character
							? axialDistance(startPos, path[path.length - 1]!) * harvestTravelFatiguePerStep
							: 0),
				} satisfies Job
			}

			path = findDeposit(character?.position, 'clearing')
			if (path) {
				return {
					job: 'harvest' as const,
					path,
					urgency: jobBalance.harvest.clearing,
					fatigue:
						alveolus.getFatigueCost() +
						(character
							? axialDistance(startPos, path[path.length - 1]!) * harvestTravelFatiguePerStep
							: 0),
				} satisfies Job
			}

			if (!canStoreInHarvester) return undefined

			path = findDeposit(character?.position, 'any')
			if (path) {
				return {
					job: 'harvest' as const,
					path,
					urgency:
						(alveoliNeedingGood ? jobBalance.harvest.needsBonus : 0) +
						jobBalance.harvest.fallbackBase,
					fatigue:
						alveolus.getFatigueCost() +
						(character
							? axialDistance(startPos, path[path.length - 1]!) * harvestTravelFatiguePerStep
							: 0),
				} satisfies Job
			}

			return undefined
		},
	}
})

// ---------------------------------------------------------------------------
// Transform
// ---------------------------------------------------------------------------

registerActionJobProvider('transform', (alveolus) => {
	const tx = alveolus as any as {
		canWork: boolean
		getFatigueCost(): number
	}

	const transformJob: ActionProposedJob = {
		job: {
			job: 'transform' as const,
			urgency: jobBalance.transform,
			fatigue: tx.getFatigueCost(),
		} satisfies Job,
	}

	return {
		proposedJobs: tx.canWork ? [transformJob] : [],

		jobForCharacter(_character: any) {
			if (!tx.canWork) return undefined
			return {
				job: 'transform' as const,
				urgency: jobBalance.transform,
				fatigue: tx.getFatigueCost(),
			} satisfies Job
		},
	}
})

// ---------------------------------------------------------------------------
// Plant (forester)
// ---------------------------------------------------------------------------

registerActionJobProvider('plant', (alveolus) => {
	const action = alveolus.action as Ssh.PlantingAction
	const assignedZoneIds = alveolus.assignedZoneIds as readonly string[]

	const findBestPath = (characterPosition: Positioned | undefined): Positioned[] | undefined => {
		if (assignedZoneIds.length === 0) return undefined
		const startPos = toAxialCoord(characterPosition ?? alveolus.tile.position)
		const hex = alveolus.tile.game.hex
		const candidateCoords = assignedZoneIds.flatMap((zoneId) =>
			hex.zoneManager.coordsForZone(zoneId)
		)
		let bestPath: Positioned[] | undefined

		for (const coord of candidateCoords) {
			const tile = hex.getTile(coord)
			if (!(tile?.content instanceof UnBuiltLand)) continue
			if (!canPlantDepositOnLand(tile.content, action.deposit)) continue
			const path = characterPosition
				? hex.findPathForCharacter(startPos, coord, characterPosition as any, maxWalkTime, false)
				: hex.findPath(startPos, coord, maxWalkTime, false)
			if (!path) continue
			if (!bestPath || path.length < bestPath.length) bestPath = path
		}

		return bestPath
	}

	// Find a best target tile for proposed-jobs advertisement so workers
	// can score distance themselves.
	const proposedPath = findBestPath(undefined)
	const targetTile = proposedPath
		? alveolus.tile.game.hex.getTile(proposedPath[proposedPath.length - 1]!)
		: undefined

	return {
		proposedJobs:
			assignedZoneIds.length > 0
				? [
						{
							job: {
								job: 'forester' as const,
								urgency: jobBalance.forester,
								fatigue: alveolus.getFatigueCost(),
							} satisfies Job,
							targetTile,
						} satisfies ActionProposedJob,
					]
				: [],

		jobForCharacter(character: any) {
			const startPos = toAxialCoord(character ? character.position : alveolus.tile.position)
			const bestPath = findBestPath(character?.position)
			if (!bestPath) return undefined
			return {
				job: 'forester' as const,
				path: bestPath,
				urgency: jobBalance.forester,
				fatigue:
					alveolus.getFatigueCost() +
					(character ? axialDistance(startPos, bestPath[bestPath.length - 1]!) * 0.01 : 0),
			} satisfies Job
		},
	}
})

// ---------------------------------------------------------------------------
// Storage (legacy slotted/specific)
// ---------------------------------------------------------------------------

registerActionJobProvider('slotted-storage', (alveolus) => ({
	proposedJobs: [],
	jobForCharacter() {
		const fragmentedGoodType = alveolus.storage.fragmented
		return fragmentedGoodType
			? ({
					job: 'defragment' as const,
					fatigue: 1,
					urgency: jobBalance.defragment,
					goodType: fragmentedGoodType,
				} satisfies Job)
			: undefined
	},
}))

registerActionJobProvider('specific-storage', (_alveolus) => ({
	proposedJobs: [] as ActionProposedJob[],
	jobForCharacter: () => undefined,
}))

// ---------------------------------------------------------------------------
// Unified storage ('storage')
// ---------------------------------------------------------------------------

registerActionJobProvider('storage', (alveolus) => {
	const action = alveolus.action as Ssh.UnifiedStorageAction
	if (action.kind === 'slotted') {
		return {
			proposedJobs: [] as ActionProposedJob[],
			jobForCharacter() {
				const fragmentedGoodType = alveolus.storage.fragmented
				return fragmentedGoodType
					? ({
							job: 'defragment' as const,
							fatigue: 1,
							urgency: jobBalance.defragment,
							goodType: fragmentedGoodType,
						} satisfies Job)
					: undefined
			},
		}
	}
	return { proposedJobs: [] as ActionProposedJob[], jobForCharacter: () => undefined }
})

// ---------------------------------------------------------------------------
// Engineer
// ---------------------------------------------------------------------------

registerActionJobProvider('engineer', (alveolus) => {
	const action = alveolus.action as Ssh.EngineerAction
	const spec = alveolus.variantSpec

	/**
	 * Which jobs this variant enables.
	 * Root engineer (no spec) enables all jobs for backward compatibility.
	 * Variant specs filter the set:
	 *   building → construct + foundation
	 *   research → validateHivePlan
	 *   road     → (none yet, future)
	 */
	const allowedJobs = (() => {
		const jobs = new Set<string>()
		if (!spec) {
			// Root engineer: enable everything (backward-compatible default)
			jobs.add('construct')
			jobs.add('foundation')
			jobs.add('validateHivePlan')
			return jobs
		}
		switch (spec.kind) {
			case 'building':
			case 'construct-foundation':
				jobs.add('construct')
				jobs.add('foundation')
				break
			case 'research':
				jobs.add('validateHivePlan')
				break
			case 'road':
				// Road jobs are not yet implemented; future
				break
		}
		return jobs
	})()

	const collectTargets = () => {
		if (allowedJobs.size === 0)
			return [] as { tile: any; job: ConstructJob | FoundationJob | ValidateHivePlanJob }[]

		const hex = alveolus.tile.game.hex
		const origin = toAxialCoord(alveolus.tile.position)
		if (!origin)
			return [] as { tile: any; job: ConstructJob | FoundationJob | ValidateHivePlanJob }[]

		type EngTarget = {
			tile: any
			job: ConstructJob | FoundationJob | ValidateHivePlanJob
		}
		const targets: EngTarget[] = []

		for (const tile of hex.tilesAround(origin, action.radius)) {
			const coord = toAxialCoord(tile.position)
			if (!coord || axial.distance(origin, coord as AxialCoord) > action.radius) continue
			const content = tile.content
			if (allowedJobs.has('construct') && content && isUndestroyedReadyConstructionSite(content)) {
				targets.push({
					tile,
					job: {
						job: 'construct' as const,
						urgency: jobBalance.engineer.construct,
						fatigue: alveolus.getFatigueCost(),
					},
				})
				continue
			}
			if (
				allowedJobs.has('foundation') &&
				content instanceof UnBuiltLand &&
				content.constructionSite
			) {
				setConstructionFoundationDeliveredGoods(
					content.constructionSite,
					content.foundationStorage?.stock ?? {}
				)
			}
			if (
				allowedJobs.has('foundation') &&
				content instanceof UnBuiltLand &&
				content.project &&
				content.constructionSite &&
				foundationGoodsComplete(content.constructionSite) &&
				!tile.isBurdened
			) {
				targets.push({
					tile,
					job: {
						job: 'foundation' as const,
						urgency: jobBalance.engineer.foundation,
						fatigue: 3,
					},
				})
			}
		}
		if (allowedJobs.has('validateHivePlan'))
			for (const plan of alveolus.tile.game.hivePlans.validatingPlans) {
				if (
					plan.validationProgress.workSecondsApplied >= plan.validationProgress.workSecondsRequired
				) {
					continue
				}
				targets.push({
					tile: alveolus.tile,
					job: {
						job: 'validateHivePlan' as const,
						planId: plan.id,
						urgency: jobBalance.engineer.construct * 0.8,
						fatigue: alveolus.getFatigueCost(),
					},
				})
			}
		return targets.sort((a, b) => {
			const priority = (job: any) =>
				job.job === 'construct' ? 0 : job.job === 'foundation' ? 1 : 2
			const priorityDiff = priority(a.job) - priority(b.job)
			if (priorityDiff !== 0) return priorityDiff
			const ac = toAxialCoord(a.tile.position)!
			const bc = toAxialCoord(b.tile.position)!
			const aq = Array.isArray(ac) ? { q: ac[0], r: ac[1] } : (ac as AxialCoord)
			const bq = Array.isArray(bc) ? { q: bc[0], r: bc[1] } : (bc as AxialCoord)
			const oq = Array.isArray(origin) ? { q: origin[0], r: origin[1] } : (origin as AxialCoord)
			const distanceDiff = axial.distance(oq, aq) - axial.distance(oq, bq)
			if (distanceDiff !== 0) return distanceDiff
			return axial.key(aq).localeCompare(axial.key(bq))
		})
	}

	const targets = collectTargets()

	return {
		proposedJobs: targets.map(
			(t): ActionProposedJob => ({
				job: t.job satisfies Job,
				targetTile: t.tile,
			})
		),

		jobForCharacter(character: any) {
			const targets = collectTargets()
			if (!character) return targets[0]?.job
			const startPos = toAxialCoord(character.position)
			if (!startPos) return undefined

			const priority = (job: any) => (job.job === 'construct' ? 0 : 1)
			let best: ((typeof targets)[number] & { path: any[] }) | undefined
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
					radius: action.radius,
					targetQ: Array.isArray(terminal) ? undefined : terminal?.q,
					targetR: Array.isArray(terminal) ? undefined : terminal?.r,
					tier: c.constructionSite.target.tier,
				})
			}
			if (best.job.job === 'foundation' && c instanceof UnBuiltLand) {
				traces.residential.log?.('[engineer] nextJob', {
					job: 'foundation',
					fromQ: startPos.q,
					fromR: startPos.r,
					radius: action.radius,
					targetQ: Array.isArray(terminal) ? undefined : terminal?.q,
					targetR: Array.isArray(terminal) ? undefined : terminal?.r,
				})
			}
			const pathTail = best.path.slice(1)
			return {
				...best.job,
				path: pathTail.length > 0 ? pathTail : undefined,
			} satisfies Job
		},
	}
})

// ---------------------------------------------------------------------------
// road-fret
// ---------------------------------------------------------------------------

registerActionJobProvider('road-fret', (_alveolus) => ({
	proposedJobs: [] as ActionProposedJob[],
	jobForCharacter: () => undefined,
}))
