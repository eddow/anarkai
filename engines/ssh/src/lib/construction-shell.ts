import { BasicDwelling } from 'ssh/board/content/basic-dwelling'
import { BuildDwelling } from 'ssh/board/content/build-dwelling'
import type { TileContent } from 'ssh/board/content/content'
import type { Tile } from 'ssh/board/tile'
import type { ConstructionSiteShell } from 'ssh/build-site'
import {
	type ConstructionSiteState,
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
		return new BuildAlveolus(tile, site.target.alveolusType, site)
	}
	if (site.target.kind === 'dwelling') {
		return new BuildDwelling(tile, site.target.tier, site)
	}
	assert(false, 'Unsupported construction target')
}

export function constructionShellStepDescription(shell: ConstructionSiteShell): string {
	const target = normalizeConstructionSiteState(shell.constructionSite).target
	if (target.kind === 'alveolus') return `construct.${String(target.alveolusType)}`
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
		const alveolus = createAlveolus(target.alveolusType, shell.tile)
		assert(alveolus, 'Target alveolus must exist')
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
