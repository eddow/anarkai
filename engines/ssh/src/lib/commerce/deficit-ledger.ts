import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import type { Tile } from 'ssh/board/tile'
import { isConstructionSiteShell, materialRemainingNeeds } from 'ssh/build-site'
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
 * needs`, `surplus = 0` (producer-buffer export availability is a later slice),
 * and `deficit = demand` (in-flight reservations are deduped by the freight
 * stop's own reservation system, not folded in here yet).
 */
export function computeNetDeficitLedger(tiles: Iterable<Tile>): NetDeficitLedger {
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

	const ledger: NetDeficitLedger = {}
	for (const [good, needs] of byGood) {
		const demand = needs.reduce((sum, need) => sum + need.quantity, 0)
		const net: NetDeficit = { demand, surplus: 0, deficit: demand, needs }
		ledger[good] = net
	}
	return ledger
}
