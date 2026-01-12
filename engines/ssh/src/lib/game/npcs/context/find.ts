import { maxWalkTime } from '$assets/constants'
import { goods as goodsCatalog } from '$assets/game-content'
import { BuildAlveolus } from '$lib/game/hive/build'
import type { GatherAlveolus } from '$lib/game/hive/gather'
import type { Character } from '$lib/game/population/character'
import { contract, type GoodType } from '$lib/types'
import { type AxialCoord, axial, tileSize, toWorldCoord } from '$lib/utils'
import { type Positioned, toAxialCoord } from '../../../utils/position'
import { UnBuiltLand } from '../../board/content/unbuilt-land'
import type { Tile } from '../../board/tile'
import { subject } from '../scripts'

class FindFunctions {
	declare [subject]: Character
	@contract('Positioned', 'boolean?')
	path(to: Positioned, punctual: boolean = true) {
		return this[subject].game.hex.findPathForCharacter(
			toAxialCoord(this[subject].tile.position),
			axial.round(toAxialCoord(to)),
			this[subject],
			maxWalkTime,
			punctual,
		)
	}
	@contract()
	food() {
		const { hex } = this[subject].game
		function bestFoodOnTile(coord: Positioned): GoodType | null {
			const axialCoord = toAxialCoord(coord)
			const tile = hex.getTile(axialCoord)
			if (!tile) return null

			let best: { type: GoodType; fv: number } | null = null

			// Check storage goods first (existing behavior)
			const goodsMap = tile.content!.storage?.stock || {}
			for (const [good] of Object.entries(goodsMap) as [GoodType, number][]) {
				if (!tile.content!.storage?.available(good as GoodType)) continue
				const def = goodsCatalog[good as GoodType]
				if (!def) continue
				const fv = 'feedingValue' in def ? (def as any).feedingValue : 0
				if (fv > 0 && (!best || fv > best.fv)) best = { type: good as GoodType, fv }
			}

			// Check free goods on the ground (new behavior)
			const freeGoodsArr = hex.freeGoods.getGoodsAt(axialCoord)
			for (const freeGood of freeGoodsArr) {
				// Skip allocated or removed goods
				if (!freeGood.available) continue
				const def = goodsCatalog[freeGood.goodType]
				if (!def) continue
				const fv = 'feedingValue' in def ? (def as any).feedingValue : 0
				if (fv > 0 && (!best || fv > best.fv)) best = { type: freeGood.goodType, fv }
			}
			return best?.type ?? null
		}
		const start = toAxialCoord(this[subject].tile.position)
		const path = hex.findNearestForCharacter(
			start,
			this[subject],
			(coord) => bestFoodOnTile(coord) !== null,
			maxWalkTime,
			true,
		)
		if (!path || path.length === 0) return false as const
		const targetCoord = path[path.length - 1]
		const targetTile = hex.getTile(targetCoord)!
		const good = bestFoodOnTile(targetCoord)!
		return { tile: targetTile, good, path }
	}
	@contract('string')
	deposit(deposit: string) {
        console.error(`[FindFunctions] deposit called searching for: ${deposit}`);
		const { hex } = this[subject].game
		const start = toAxialCoord(this[subject].tile.position)

		// 1) Prefer deposits near building sites (construction tiles take priority)
		const pathNearConstruction = hex.findNearestForCharacter(
			start,
			this[subject],
			(coord) => {
				const tile = hex.getTile(coord)
				if (!(tile?.content instanceof UnBuiltLand)) return false
				if (tile.content.deposit?.name !== deposit) return false
				// Check if any neighbor is a BuildAlveolus (construction site)
				return tile.neighborTiles.some((neighbor) => neighbor.content instanceof BuildAlveolus)
			},
			maxWalkTime,
			false,
		)
		if (pathNearConstruction?.length) return pathNearConstruction

		// 2) Prefer deposits in harvest zones (cleaning duties)
		const pathInZone = hex.findNearestForCharacter(
			start,
			this[subject],
			(coord) => {
				const tile = hex.getTile(coord)
				if (!(tile?.content instanceof UnBuiltLand)) return false
				if (tile.content.deposit?.name !== deposit) return false
				// Check if this tile is in a harvest zone
				return tile.zone === 'harvest'
			},
			maxWalkTime,
			false,
		)
		if (pathInZone?.length) return pathInZone

		// 3) Fallback to any matching deposit
		const pathAny = hex.findNearestForCharacter(
			start,
			this[subject],
			(coord) => {
				const tile = hex.getTile(coord)
				return tile?.content instanceof UnBuiltLand && tile.content.deposit?.name === deposit
			},
			maxWalkTime,
			false,
		)
		if (!pathAny || pathAny.length === 0) return false as const
		return pathAny
	}

	@contract()
	randomPositionInTile() {
		const tile = this[subject].tile

		// Generate a random position within the current tile
		// Using a simple approach: generate random offset from tile center
		const { x: tileX, y: tileY } = toWorldCoord(tile.position)
		const { x, y } = axial.randomPositionInTile(this[subject].game.random, tileSize)
		return { x: tileX + x, y: tileY + y }
	}
	@contract()
	wanderingTile() {
		const { hex } = this[subject].game
		const start = toAxialCoord(this[subject].tile.position)
		const distance = 2 + this[subject].game.random() * 3 // 2-5 tiles away

		// Find all walkable tiles within the distance range
		const walkableTiles: { coord: AxialCoord; tile: Tile }[] = []

		for (let q = -Math.ceil(distance); q <= Math.ceil(distance); q++) {
			for (let r = -Math.ceil(distance); r <= Math.ceil(distance); r++) {
				const coord = axial.linear({ q, r }, start)
				const actualDistance = axial.distance(start, coord)
				if (actualDistance >= 2) {
					const tile = hex.getTile(coord)
					if (tile && Number.isFinite(tile.content!.walkTime)) {
						walkableTiles.push({ coord, tile })
					}
				}
			}
		}

		if (walkableTiles.length === 0) return false

		// Pick a random walkable tile
		const randomIndex = Math.floor(this[subject].game.random(walkableTiles.length))
		const { coord: targetCoord, tile: targetTile } = walkableTiles[randomIndex]

		return {
			tile: targetTile,
			path: this[subject].game.hex.findPathForCharacter(
				toAxialCoord(this[subject].tile.position),
				targetCoord,
				this[subject],
				maxWalkTime,
				true,
			),
		}
	}
	@contract('GatherAlveolus', 'number')
	gatherables(gatherer: GatherAlveolus, maxWalkTime: number) {
		const { hex } = this[subject].game
		const start = toAxialCoord(this[subject].tile.position)
		const selectableGoods = Object.keys(gatherer.hive.needs).filter((good) =>
			this[subject].carry.hasRoom(good as GoodType),
		)
		if (!selectableGoods.length) return false as const
		// Count all goods within walk time using findNearest exploration
		const goodCounts = Object.fromEntries(selectableGoods.map((good) => [good, 0])) as Partial<
			Record<GoodType, number>
		>

		// Custom exploration function that counts goods but never returns true
		const exploreForGoods = (pos: Positioned): boolean => {
			// Count goods at this tile
			const goodsAtTile = hex.freeGoods.getGoodsAt(pos)
			for (const good of goodsAtTile) {
				if (good.available && good.goodType in goodCounts) goodCounts[good.goodType]!++
			}

			// Never return true - we just want to explore and count
			return false
		}

		// Explore all tiles within walk time
		hex.findNearest(start, exploreForGoods, maxWalkTime, false)

		// Find the good with the maximum count
		const targetGood = Object.entries(goodCounts).reduce(
			(max, [good, count]) => (count > max.count ? { good: good as GoodType, count } : max),
			{ good: null as GoodType | null, count: 0 },
		).good

		if (!targetGood) return false as const

		const path = hex.freeGoods.findNearestGoods(start, start, [targetGood], maxWalkTime)
		return path
	}

	@contract()
	freeSpot() {
		const { hex } = this[subject].game
		const start = toAxialCoord(this[subject].tile.position)
		// Use findBest with a cost function: walkTime * crowding
		// Only drop in non-clearing tiles (UnBuiltLand with no/harvest zone and no project)
		const result = hex.findBestForCharacter(
			start,
			this[subject],
			(coord) => {
				const tile = hex.getTile(coord)
				if (!tile || !tile.content) return false

                // Must be UnBuiltLand (implies not an Alveolus)
				if (!(tile.content instanceof UnBuiltLand)) return false
                
                // Must not be a project (construction site)
                if (tile.content.project) return false
				
				let score = 1 / (hex.freeGoods.getGoodsAt(coord).length + 1)
                
                // Penalize current tile to encourage moving goods away (fixes infinite loop in offload)
                if (axial.distance(coord, start) < 0.1) {
                    score *= 0.01
                }
                return score
			},
			(_coord, walkTime) => walkTime > maxWalkTime,
			1, // best possible score (minimum cost => score 0 when dist*crowd == 0)
			true,
		)
		if (!result || result.length === 0) return false as const
		return result
	}
}

export { FindFunctions }
