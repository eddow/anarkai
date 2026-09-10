import { Alveolus } from 'ssh/board/content/alveolus'
import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import type { Tile } from 'ssh/board/tile'
import { isConstructionSiteShell, materialRemainingNeeds } from 'ssh/build-site'
import { RoadConstructionSite, roadBuildRecipe } from 'ssh/construction-road'
import { hivePlanValidationRequirements } from 'ssh/hive-plan'
import type { Project } from 'ssh/project'
import type { GoodType } from 'ssh/types/base'
import type { NeededGood, NetDeficit, NetDeficitLedger } from './commerce-model'

/**
 * The board/group-scoped net deficit, computed on demand from the current
 * construction demand origins. This is the read the deficit stop (and price
 * field) consumes — it is *not* stored, and it is origin-agnostic: player plans
 * (pushed `ConstructionSiteShell`s) and spontaneous residential/commercial
 * foundations (`UnBuiltLand`) all contribute.
 *
 * **Ledger v1 covers the demand half only:** `demand = Σ remaining construction
 * needs`, `surplus = 0` (construction plans produce nothing — cleared resources
 * and demolition leftovers are not accounted against the project), and
 * `deficit = demand` (in-flight reservations are deduped by the freight stop's
 * own reservation system, not folded in here yet).
 *
 * `forwardNeeds` are {@link computeProjectForwardNeeds} contributions: a working
 * project's **deferred** (not-yet-materialized) entry bills, added to the demand
 * side so the deficit reads the true forward demand even though those entries
 * have no live storage yet.
 */
export function computeNetDeficitLedger(
	tiles: Iterable<Tile>,
	forwardNeeds: readonly NeededGood[] = []
): NetDeficitLedger {
	// TODO: Redo completely the deficit calculation out of local little increments
	const byGood = new Map<GoodType, NeededGood[]>()

	const addNeed = (source: NeededGood['source'], good: GoodType, quantity: number): void => {
		if (!(quantity > 0)) return
		const list = byGood.get(good) ?? []
		list.push({ good, quantity, source })
		byGood.set(good, list)
	}

	for (const tile of tiles) {
		const content = tile.content
		if (!content) continue
		if (isConstructionSiteShell(content)) {
			for (const [good, qty] of Object.entries(content.remainingNeeds)) {
				addNeed(content, good as GoodType, qty ?? 0)
			}
		} else if (content instanceof RoadConstructionSite) {
			for (const [good, qty] of Object.entries(content.remainingNeeds)) {
				addNeed(content, good as GoodType, qty ?? 0)
			}
		} else if (
			content instanceof UnBuiltLand &&
			content.constructionSite &&
			content.foundationStorage
		) {
			const remaining = materialRemainingNeeds(
				content.constructionSite.foundationRequiredGoods,
				content.foundationStorage
			)
			for (const [good, qty] of Object.entries(remaining)) {
				addNeed(content, good as GoodType, qty ?? 0)
			}
		}
	}

	for (const need of forwardNeeds) addNeed(need.source, need.good, need.quantity)

	const ledger: NetDeficitLedger = {}
	for (const [good, needs] of byGood) {
		const demand = needs.reduce((sum, need) => sum + need.quantity, 0)
		const net: NetDeficit = { demand, surplus: 0, deficit: demand, needs }
		ledger[good] = net
	}
	return ledger
}

/**
 * A working project's **forward-declared** demand: the full bill (foundation +
 * construction recipe) of each entry that is not yet materialized on the board
 * (no construction shell, no finished alveolus — i.e. a deferred demolition
 * entry), plus the recipe of each road segment not yet built on the board.
 * Once materialized, the shell advertises the same demand through the ordinary
 * {@link computeNetDeficitLedger} path, so this only fills the gap between
 * commit and materialization.
 */
export function computeProjectForwardNeeds(
	projects: Iterable<Project>,
	getContent: (coord: readonly [number, number]) => unknown,
	getRoadType?: (coord: readonly [number, number]) => unknown
): NeededGood[] {
	const needs: NeededGood[] = []
	// Per-entry bills cached per call so a large project does not recompute the
	// variant recipe chain once per entry per ledger access.
	const billCache = new Map<string, Partial<Record<GoodType, number>>>()
	const billFor = (key: string, compute: () => Partial<Record<GoodType, number>>) => {
		const cached = billCache.get(key)
		if (cached) return cached
		const bill = compute()
		billCache.set(key, bill)
		return bill
	}
	for (const project of projects) {
		if (project.stage !== 'working') continue
		for (const entry of project.entries) {
			const content = getContent(entry.coord)
			if (isConstructionSiteShell(content) || content instanceof Alveolus) continue
			if (content instanceof UnBuiltLand && content.site) continue
			const bill = billFor(
				`e:${entry.alveolusType}#${entry.variant ?? ''}`,
				() => hivePlanValidationRequirements([entry], []).requiredGoods
			)
			for (const [good, qty] of Object.entries(bill)) {
				const quantity = qty ?? 0
				if (quantity <= 0) continue
				needs.push({
					good: good as GoodType,
					quantity,
					source: {
						kind: 'project-forward',
						projectName: project.name,
						coord: entry.coord,
					},
				})
			}
		}
		for (const road of project.roads ?? []) {
			if (getRoadType?.(road.coord)) continue
			const bill = billFor(`r:${road.type}`, () => roadBuildRecipe(road.type).goods)
			for (const [good, qty] of Object.entries(bill)) {
				const quantity = qty ?? 0
				if (quantity <= 0) continue
				needs.push({
					good: good as GoodType,
					quantity,
					source: {
						kind: 'project-forward',
						projectName: project.name,
						coord: road.coord,
					},
				})
			}
		}
	}
	return needs
}
