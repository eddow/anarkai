import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import type { Tile } from 'ssh/board/tile'
import { type BuildSite, isBuildSite, materialsComplete } from 'ssh/build-site'
import type {
	ConstructionBlockingReason,
	ConstructionPhase,
	ConstructionSiteState,
	DwellingTier,
} from 'ssh/construction-state'
import type { Game } from 'ssh/game/game'
import { EngineerAlveolus } from 'ssh/hive/engineer'
import type { AlveolusType, GoodType } from 'ssh/types/base'
import { axial } from 'ssh/utils'
import { toAxialCoord } from 'ssh/utils/position'

export type { ConstructionBlockingReason, ConstructionPhase, ConstructionSiteState, DwellingTier }

/** Inspectable snapshot for UI and diagnostics. */
export interface ConstructionSiteView {
	readonly phase: ConstructionPhase
	readonly target?: AlveolusType
	readonly dwellingTier?: DwellingTier
	/** Seconds of construction work applied toward `constructionTotalSeconds`. */
	readonly constructionWorkSecondsApplied?: number
	readonly constructionTotalSeconds?: number
	readonly requiredGoods?: Partial<Record<GoodType, number>>
	readonly deliveredGoods?: Partial<Record<GoodType, number>>
	readonly consumedGoods?: Partial<Record<GoodType, number>>
	readonly blockingReasons: readonly ConstructionBlockingReason[]
}

function engineerCanReachTileWithinRadius(
	game: Game,
	engineer: EngineerAlveolus,
	targetCoord: ReturnType<typeof toAxialCoord>
): boolean {
	if (!targetCoord) return false
	const key = axial.key(targetCoord)
	return Boolean(
		game.hex.findNearest(
			engineer.tile.position,
			(coord) => axial.key(coord) === key,
			engineer.action.radius,
			true
		)
	)
}

function anyWorkingEngineerCanReach(game: Game, targetTile: Tile): EngineerAlveolus | undefined {
	for (const tile of game.hex.tiles) {
		const content = tile.content
		if (!(content instanceof EngineerAlveolus)) continue
		if (!content.working) continue
		const coord = toAxialCoord(targetTile.position)
		if (!coord) continue
		if (engineerCanReachTileWithinRadius(game, content, coord)) return content
	}
	return undefined
}

function engineerHivePaused(engineer: EngineerAlveolus): boolean {
	return !engineer.hive.working
}

function snapshotConstructionState(
	state: ConstructionSiteState,
	overrides?: Partial<ConstructionSiteView>
): ConstructionSiteView {
	const targetAlveolus = state.target.kind === 'alveolus' ? state.target.alveolusType : undefined
	const dwellingTier = state.target.kind === 'dwelling' ? state.target.tier : undefined
	return {
		phase: overrides?.phase ?? state.phase,
		target: overrides?.target ?? targetAlveolus,
		dwellingTier: overrides?.dwellingTier ?? dwellingTier,
		constructionWorkSecondsApplied:
			overrides?.constructionWorkSecondsApplied ?? state.workSecondsApplied,
		constructionTotalSeconds: overrides?.constructionTotalSeconds ?? state.recipe.workSeconds,
		requiredGoods: overrides?.requiredGoods ?? state.requiredGoods,
		deliveredGoods: overrides?.deliveredGoods ?? state.deliveredGoods,
		consumedGoods: overrides?.consumedGoods ?? state.consumedGoods,
		blockingReasons: overrides?.blockingReasons ?? [...state.blockingReasons],
	}
}

function buildUnbuiltConstructionView(
	game: Game,
	tile: Tile,
	state: ConstructionSiteState
): ConstructionSiteView {
	const blocking: ConstructionBlockingReason[] = []
	if (!tile.isClear) {
		return snapshotConstructionState(state, {
			phase: 'planned',
			blockingReasons: ['tile_not_clear'],
		})
	}
	const engineer = anyWorkingEngineerCanReach(game, tile)
	if (!engineer) {
		const anyEngineer = game.hex.tiles.some(
			(candidate) => candidate.content instanceof EngineerAlveolus
		)
		if (anyEngineer) {
			const paused = game.hex.tiles.some(
				(candidate) =>
					candidate.content instanceof EngineerAlveolus && engineerHivePaused(candidate.content)
			)
			if (paused) blocking.push('engineer_hive_paused')
		}
		blocking.push('no_engineer_in_range')
	}
	return snapshotConstructionState(state, {
		phase: 'foundation',
		blockingReasons: blocking,
	})
}

/** Shared inspector path for `BuildAlveolus` and `BuildDwelling` (same construction-site semantics). */
function buildActiveConstructionShellView(
	game: Game,
	tile: Tile,
	site: BuildSite
): ConstructionSiteView {
	const state = site.constructionSite
	const blocking: ConstructionBlockingReason[] = []
	const deliveredGoods = (site.storage?.stock ?? {}) as Partial<Record<GoodType, number>>
	const workSecondsApplied = Math.max(site.constructionWorkSecondsApplied, state.workSecondsApplied)
	if (site.destroyed) {
		return snapshotConstructionState(state, {
			phase: 'failed',
			deliveredGoods,
			constructionWorkSecondsApplied: workSecondsApplied,
			blockingReasons: [],
		})
	}
	if (!site.working) {
		blocking.push('construction_site_paused')
	}
	if (!materialsComplete(site)) {
		blocking.push('missing_goods')
		return snapshotConstructionState(state, {
			phase: 'waiting_materials',
			deliveredGoods,
			constructionWorkSecondsApplied: workSecondsApplied,
			blockingReasons: blocking,
		})
	}
	if (state.phase === 'building') {
		return snapshotConstructionState(state, {
			phase: 'building',
			deliveredGoods,
			constructionWorkSecondsApplied: workSecondsApplied,
			blockingReasons: blocking,
		})
	}
	const engineer = anyWorkingEngineerCanReach(game, tile)
	if (!engineer) {
		blocking.push('no_engineer_in_range')
	} else if (engineerHivePaused(engineer)) {
		blocking.push('engineer_hive_paused')
	}
	return snapshotConstructionState(state, {
		phase: 'waiting_construction',
		deliveredGoods,
		constructionWorkSecondsApplied: workSecondsApplied,
		blockingReasons: blocking,
	})
}

/**
 * Returns a snapshot for the current tile if it participates in the construction workflow,
 * otherwise `undefined`.
 */
export function queryConstructionSiteView(
	game: Game,
	tile: Tile
): ConstructionSiteView | undefined {
	const content = tile.content
	if (content instanceof UnBuiltLand && content.constructionSite) {
		return buildUnbuiltConstructionView(game, tile, content.constructionSite)
	}
	if (isBuildSite(content)) {
		return buildActiveConstructionShellView(game, tile, content)
	}
	return undefined
}
