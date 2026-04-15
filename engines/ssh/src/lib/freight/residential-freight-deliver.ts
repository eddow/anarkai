/**
 * Residential dwelling material delivery via distribute-line freight bays and a dedicated
 * `freightDeliver` job. Roadmap: treat as a **bridge** until construction sites can share the
 * same fulfillment path as hive conveying (`sandbox/roadmap-residential-zones.md` implementation review).
 */
import { jobBalance } from 'engine-rules'
import { Alveolus } from 'ssh/board/content/alveolus'
import { BuildDwelling } from 'ssh/board/content/build-dwelling'
import type { Tile } from 'ssh/board/tile'
import { traces } from 'ssh/debug'
import {
	distributeSegmentAllowsGoodTypeForSegment,
	distributeSegmentBayTile,
	distributeSegmentWithinRadius,
	findDistributeRouteSegments,
} from 'ssh/freight/freight-line'
import type { Game } from 'ssh/game/game'
import type { Character } from 'ssh/population/character'
import type { FreightDeliverJob, GoodType } from 'ssh/types/base'
import { type AxialCoord, axial } from 'ssh/utils'
import { toAxialCoord } from 'ssh/utils/position'
import { maxWalkTime } from '../../../assets/constants'

interface FreightDeliverPathPick {
	readonly lineId: string
	readonly bayTile: Tile
	readonly quantity: number
	readonly pathToBay: AxialCoord[]
	readonly pathToSite: AxialCoord[]
}
// TODO: rename the file: it should/is not bound to "residential" as the process is/should be unified for residential, commercial and industrial (hive) zones
/**
 * When a `BuildDwelling` still needs recipe goods, offers a non-convey job: walk to a distribute-line
 * freight bay, grab stored goods, walk to the construction tile, and drop into site storage.
 */
export function findFreightDeliverJob(
	game: Game,
	siteTile: Tile,
	character: Character
): FreightDeliverJob | undefined {
	const content = siteTile.content
	if (!(content instanceof BuildDwelling)) return undefined
	if (content.destroyed || content.isReady) return undefined

	const remainingRaw = content.remainingNeeds
	const remaining =
		remainingRaw && typeof remainingRaw === 'object'
			? remainingRaw
			: ({} as Partial<Record<GoodType, number>>)
	const goodTypes = (Object.keys(remaining) as GoodType[]).filter((g) => (remaining[g] ?? 0) > 0)
	if (goodTypes.length === 0) return undefined
	goodTypes.sort()

	for (const goodType of goodTypes) {
		const need = remaining[goodType] ?? 0
		if (need <= 0) continue

		let best: FreightDeliverPathPick | undefined

		for (const line of game.freightLines) {
			const segments = findDistributeRouteSegments(line)
			for (const segment of segments) {
				if (!distributeSegmentAllowsGoodTypeForSegment(line, segment, goodType)) continue

				const bayTile = distributeSegmentBayTile(game, line, segment)
				if (!bayTile) continue
				const bayContent = bayTile.content
				if (!(bayContent instanceof Alveolus) || bayContent.name !== 'freight_bay') continue
				const bayStorage = bayContent.storage
				if (!bayStorage || bayStorage.available(goodType) < 1) continue
				const quantity = Math.floor(
					Math.min(need, bayStorage.available(goodType), character.carry.hasRoom(goodType))
				)
				if (quantity < 1) continue

				const maybePathToBay = character.game.hex.findPathForCharacter(
					character.position,
					bayTile.position,
					character,
					maxWalkTime,
					false
				)
				if (!maybePathToBay) continue
				const maybePathToSite = character.game.hex.findPathForCharacter(
					bayTile.position,
					siteTile.position,
					character,
					maxWalkTime,
					false
				)
				if (!maybePathToSite) continue
				if (!distributeSegmentWithinRadius(line, segment, maybePathToSite.length)) continue

				const dist = maybePathToBay.length + maybePathToSite.length
				const bestDist = best
					? best.pathToBay.length + best.pathToSite.length
					: Number.POSITIVE_INFINITY
				if (dist < bestDist) {
					best = { lineId: line.id, bayTile, quantity, pathToBay: maybePathToBay, pathToSite: maybePathToSite }
				}
			}
		}

		if (best) {
			const pick = best
			const siteCoord = toAxialCoord(siteTile.position)!
			const bayCoord = toAxialCoord(pick.bayTile.position)!
			traces.residential?.log('[residential] freightDeliver job', {
				goodType,
				quantity: pick.quantity,
				lineId: pick.lineId,
				siteQ: siteCoord.q,
				siteR: siteCoord.r,
				bayQ: bayCoord.q,
				bayR: bayCoord.r,
			})
			return {
				job: 'freightDeliver',
				urgency: jobBalance.freightDeliver,
				fatigue: 2,
				goodType,
				quantity: pick.quantity,
				lineId: pick.lineId,
				bay: bayCoord,
				site: siteCoord,
				pathToBay: pick.pathToBay,
				pathToSite: pick.pathToSite,
			}
		}
	}

	return undefined
}

export function freightDeliverJobCacheKey(job: FreightDeliverJob): string {
	return `${job.job}:${job.goodType}:${axial.key(job.site)}:${axial.key(job.bay)}`
}
