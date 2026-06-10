import { BasicDwelling } from 'ssh/board/content/basic-dwelling'
import { BuildDwelling } from 'ssh/board/content/build-dwelling'
import type { TileContent } from 'ssh/board/content/content'
import type { Tile } from 'ssh/board/tile'
import type { ConstructionSiteShell } from 'ssh/build-site'
import {
	type ConstructionSiteState,
	createConstructionSiteState,
	normalizeConstructionSiteState,
	setConstructionConsumedGoods,
} from 'ssh/construction-state'
import { assert, traces } from 'ssh/dev/debug'
import { createAlveolus } from 'ssh/hive'
import { BuildAlveolus } from 'ssh/hive/build'
import { toAxialCoord } from 'ssh/utils/position'

export function applyConstructionConcreteTerrain(tile: Tile): void {
	tile.baseTerrain = 'concrete'
	tile.terrainState = {
		...(tile.terrainState ?? {}),
		terrain: 'concrete',
	}
	tile.game.upsertTerrainOverride(tile.position as { q: number; r: number }, {
		terrain: 'concrete',
	})
}

export function createConstructionShell(
	tile: Tile,
	constructionSite: ConstructionSiteState
): ConstructionSiteShell & TileContent {
	const site = normalizeConstructionSiteState(constructionSite)
	if (site.target.kind === 'alveolus') {
		return new BuildAlveolus(tile, site.target.alveolusType, site, site.target.variantId)
	}
	if (site.target.kind === 'dwelling') {
		return new BuildDwelling(tile, site.target.tier, site)
	}
	assert(false, 'Unsupported construction target')
}

export function constructionShellStepDescription(shell: ConstructionSiteShell): string {
	const target = normalizeConstructionSiteState(shell.constructionSite).target
	if (target.kind === 'alveolus') {
		const desc = `construct.${String(target.alveolusType)}`
		return target.variantId ? `${desc}#${target.variantId}` : desc
	}
	if (target.kind === 'dwelling') return `construct.dwelling.${target.tier}`
	assert(false, 'Unsupported construction target')
}

export function finalizeConstructionShell(shell: ConstructionSiteShell): void {
	const constructionSite = normalizeConstructionSiteState(shell.constructionSite)
	setConstructionConsumedGoods(constructionSite, constructionSite.requiredGoods)
	applyConstructionConcreteTerrain(shell.tile)
	const assignableShell = shell as { assignedWorker?: { assignedAlveolus?: unknown } | undefined }
	const assignedWorker = assignableShell.assignedWorker
	if (assignedWorker?.assignedAlveolus === shell) assignedWorker.assignedAlveolus = undefined
	if ('assignedWorker' in shell) assignableShell.assignedWorker = undefined
	const target = constructionSite.target
	if (target.kind === 'alveolus') {
		// Multi-hop construction queue: if there are more steps, advance to the next one
		const buildShell = shell as {
			constructionQueue?: readonly any[]
			constructionStepIndex?: number
			nextVariantId?: string
			variantId?: string
			targetVariantId?: string
			planConfiguration?: any
			hivePlanId?: string
			hivePlanVersion?: number
			planRoleId?: string
		}
		const queue = buildShell.constructionQueue
		const currentIdx = buildShell.constructionStepIndex ?? 0
		if (queue && currentIdx + 1 < queue.length) {
			// Intermediate step: create a new BuildAlveolus for the next variant segment
			const nextIdx = currentIdx + 1
			// Build a construction site with the correct step recipe, not the leaf
			const nextSite = createConstructionSiteState(
				{ kind: 'alveolus', alveolusType: target.alveolusType, variantId: buildShell.targetVariantId },
				nextIdx
			)
			const nextBuild = new BuildAlveolus(
				shell.tile,
				target.alveolusType,
				nextSite,
				buildShell.targetVariantId,
				queue,
				nextIdx
			)
			nextBuild.assignedWorker = assignedWorker
			if (assignedWorker) assignedWorker.assignedAlveolus = nextBuild
			Object.assign(nextBuild, {
				hivePlanId: (shell as { hivePlanId?: string }).hivePlanId,
				hivePlanVersion: (shell as { hivePlanVersion?: number }).hivePlanVersion,
				planRoleId: (shell as { planRoleId?: string }).planRoleId,
				planConfiguration: (shell as { planConfiguration?: any }).planConfiguration,
			})
			shell.tile.content = nextBuild
			return
		}
		// Final step: create the finished alveolus
		const alveolus = createAlveolus(target.alveolusType, shell.tile, target.variantId)
		assert(alveolus, 'Target alveolus must exist')
		const planned = shell as {
			planConfiguration?: {
				ref: Ssh.ConfigurationReference
				individual?: Ssh.AlveolusConfiguration
			}
		}
		if (planned.planConfiguration) {
			alveolus.configurationRef = planned.planConfiguration.ref
			if (planned.planConfiguration.individual) {
				alveolus.individualConfiguration = planned.planConfiguration.individual
			}
		}
		shell.tile.content = alveolus
		return
	}
	if (target.kind === 'dwelling') {
		shell.tile.content = new BasicDwelling(shell.tile)
		traces.residential.log?.('[residential] dwelling complete', {
			q: toAxialCoord(shell.tile.position)?.q,
			r: toAxialCoord(shell.tile.position)?.r,
			tier: target.tier,
		})
		return
	}
	assert(false, 'Unsupported construction target')
}
