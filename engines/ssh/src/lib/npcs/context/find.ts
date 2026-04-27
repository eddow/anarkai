import { goods as goodsCatalog } from 'engine-rules'
import { BasicDwelling } from 'ssh/board/content/basic-dwelling'
import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import type { Tile } from 'ssh/board/tile'
import { buildAlveolusMarker } from 'ssh/hive/build-marker'
import type { Character } from 'ssh/population/character'
import { findDwellingReservedBy } from 'ssh/residential/housing-reservations'
import { contract } from 'ssh/types'
import type { GoodType } from 'ssh/types/base'
import { type AxialCoord, axial, tileSize, toWorldCoord } from 'ssh/utils'
import { type Positioned, toAxialCoord } from 'ssh/utils/position'
import { maxWalkTime } from '../../../../assets/constants'
import { subject } from '../scripts'

class FindFunctions {
	declare [subject]: Character
	@contract('Positioned', 'boolean?')
	path(to: Positioned, punctual: boolean = true) {
		const from = toAxialCoord(this[subject].position)
		if (!from) return undefined
		return this[subject].game.hex.findPathForCharacter(
			axial.round(from),
			axial.round(toAxialCoord(to)!),
			this[subject],
			maxWalkTime,
			punctual
		)
	}
	@contract()
	food() {
		const { hex } = this[subject].game
		function bestFoodOnTile(coord: Positioned): GoodType | null {
			const axialCoord = toAxialCoord(coord)
			const tile = hex.getTile(axialCoord)
			if (!tile) return null

			let best: { type: GoodType; strength: number } | null = null

			const storage = tile.content?.storage
			const goodsMap = storage?.stock || {}
			for (const [good] of Object.entries(goodsMap) as [GoodType, number][]) {
				if (!storage || storage.available(good as GoodType) < 1) continue
				const def: Ssh.GoodsDefinition = goodsCatalog[good as GoodType]
				if (!def) continue
				const s = def.satiationStrength ?? 0
				if (s > 0 && (!best || s > best.strength)) best = { type: good as GoodType, strength: s }
			}

			const looseGoodsArr = hex.looseGoods.getGoodsAt(axialCoord)
			for (const looseGood of looseGoodsArr) {
				if (!looseGood.available || looseGood.isRemoved) continue
				const def: Ssh.GoodsDefinition = goodsCatalog[looseGood.goodType]
				if (!def) continue
				const s = def.satiationStrength ?? 0
				if (s > 0 && (!best || s > best.strength)) best = { type: looseGood.goodType, strength: s }
			}
			return best?.type ?? null
		}
		const start = toAxialCoord(this[subject].tile.position)
		const path = hex.findNearestForCharacter(
			start,
			this[subject],
			(coord) => bestFoodOnTile(coord) !== null,
			maxWalkTime,
			true
		)
		if (!path || path.length === 0) return false as const
		const targetCoord = path[path.length - 1]
		const targetTile = hex.getTile(targetCoord)!
		const good = bestFoodOnTile(targetCoord)!
		return { tile: targetTile, good, path }
	}
	@contract('string')
	deposit(deposit: string) {
		console.error(`[FindFunctions] deposit called searching for: ${deposit}`)
		const { hex } = this[subject].game
		const start = toAxialCoord(this[subject].tile.position)

		// 1) Prefer deposits that block an active project directly.
		const pathOnProject = hex.findNearestForCharacter(
			start,
			this[subject],
			(coord) => {
				const tile = hex.getTile(coord)
				if (!(tile?.content instanceof UnBuiltLand)) return false
				if (tile.content.deposit?.name !== deposit) return false
				return !!tile.content.project
			},
			maxWalkTime,
			false
		)
		if (pathOnProject?.length) return pathOnProject

		// 2) Prefer deposits near building sites (clearing)
		const pathNearConstruction = hex.findNearestForCharacter(
			start,
			this[subject],
			(coord) => {
				const tile = hex.getTile(coord)
				if (!(tile?.content instanceof UnBuiltLand)) return false
				if (tile.content.deposit?.name !== deposit) return false
				// Check if this tile or any neighbor is a clearing/construction site
				return (
					tile.clearing ||
					tile.neighborTiles.some(
						(neighbor) => !!neighbor.content && buildAlveolusMarker in neighbor.content
					)
				)
			},
			maxWalkTime,
			false
		)
		if (pathNearConstruction?.length) return pathNearConstruction

		// 3) Prefer deposits in harvest zones
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
			false
		)
		if (pathInZone?.length) return pathInZone

		return false as const
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
					if (tile?.content && Number.isFinite(tile.effectiveWalkTime)) {
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
				true
			),
		}
	}

	@contract()
	homeTile() {
		const character = this[subject]
		const { hex } = character.game
		const zm = hex.zoneManager
		const start = toAxialCoord(character.tile.position)
		if (!start) return false as const

		const existingDwelling = findDwellingReservedBy(character.game, character)
		if (existingDwelling) {
			const dest = toAxialCoord(existingDwelling.tile.position)
			if (!dest) return false as const
			const path = hex.findPathForCharacter(start, dest, character, maxWalkTime, true)
			if (path) return { coord: dest, path }
			existingDwelling.releaseHome(character)
		}

		const existing = zm.getReservation(character)
		if (existing) {
			const path = hex.findPathForCharacter(start, existing, character, maxWalkTime, true)
			if (path) return { coord: existing, path }
			zm.releaseReservation(character)
		}

		let bestDwelling: { dwelling: BasicDwelling; coord: AxialCoord; path: AxialCoord[] } | undefined
		for (const tile of hex.tiles) {
			const content = tile.content
			if (!(content instanceof BasicDwelling)) continue
			if (content.freeHomeSlots <= 0) continue
			const coord = toAxialCoord(tile.position)
			if (!coord) continue
			const path = hex.findPathForCharacter(start, coord, character, maxWalkTime, true)
			if (!path) continue
			if (!bestDwelling || path.length < bestDwelling.path.length) {
				bestDwelling = { dwelling: content, coord, path }
			}
		}

		let best: { coord: AxialCoord; path: AxialCoord[] } | undefined
		for (const coord of zm.listUnreservedResidentialCoords()) {
			const path = hex.findPathForCharacter(start, coord, character, maxWalkTime, true)
			if (!path) continue
			if (!best || path.length < best.path.length) best = { coord, path }
		}

		if (bestDwelling && (!best || bestDwelling.path.length <= best.path.length)) {
			zm.releaseReservation(character)
			if (!bestDwelling.dwelling.tryReserveHome(character)) return false as const
			return { coord: bestDwelling.coord, path: bestDwelling.path }
		}

		if (!best) return false as const
		if (!zm.tryReserveResidentialAt(character, best.coord)) return false as const
		return { coord: best.coord, path: best.path }
	}

	@contract()
	freeSpot() {
		const character = this[subject]
		const { hex } = character.game
		const start = toAxialCoord(character.tile.position)
		// Wheelbarrows apply {@link Character.mobilityMultiplier} per step; scale the walk budget so
		// reachable hex radius matches on-foot search (vehicle-offload drop uses this path).
		const walkBudget = maxWalkTime * character.mobilityMultiplier
		const result = hex.findBestForCharacter(
			start,
			character,
			(coord) => {
				const tile = hex.getTile(coord)
				if (!tile || !tile.content) return false
				if (!(tile.content instanceof UnBuiltLand)) return false
				if (tile.content.project) return false
				if (tile.zone === 'residential') return false

				const looseCount = hex.looseGoods.getGoodsAt(coord).length
				let score = 1 / (looseCount + 1)
				// Penalize current tile (`isBurdened` would tautologically include the operator's own
				// vehicle here — drop scoring uses {@link Tile.isClear} which ignores vehicles, since
				// they can move out of the way and the script will drop after walking off).
				if (axial.distance(coord, start) < 0.1) {
					score *= 0.01
				}
				return score
			},
			(_coord, walkTime) => walkTime > walkBudget,
			1,
			true
		)
		if (!result || result.length === 0) return false as const
		return result
	}

	/** Walk path to the vehicle's tile (`punctual`: exact vehicle hex). Matches {@link findVehicleApproachJob} / {@link FindFunctions.path}. */
	@contract('string')
	pathToVehicle(vehicleUid: string): AxialCoord[] | undefined {
		const character = this[subject]
		const vehicle = character.game.vehicles.vehicle(vehicleUid)
		if (!vehicle) return undefined
		return character.game.hex.findPathForCharacter(
			character.tile.position,
			vehicle.tile.position,
			character,
			maxWalkTime,
			true
		)
	}

	/** Whether the character's foot hex matches the vehicle hex (same predicate as boarding). */
	@contract('string')
	isAtVehicle(vehicleUid: string): boolean {
		const character = this[subject]
		const vehicle = character.game.vehicles.vehicle(vehicleUid)
		if (!vehicle) return false
		const a = toAxialCoord(character.position)
		const b = toAxialCoord(vehicle.position)
		if (!a || !b) return false
		return axial.key(a) === axial.key(b)
	}
}

export { FindFunctions }
