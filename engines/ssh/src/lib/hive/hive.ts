import { reactive, type ScopedCallback, unreactive } from 'mutts'
import { type HexBoard, isTileCoord } from 'ssh/src/lib/board/board'
import { AlveolusGate } from 'ssh/src/lib/board/border/alveolus-gate'
import { Alveolus } from 'ssh/src/lib/board/content/alveolus'
import type { Tile } from 'ssh/src/lib/board/tile'
import { assert, namedEffect, traces } from 'ssh/src/lib/debug'
import type { AllocationBase, Storage } from 'ssh/src/lib/storage/storage'
import type { GoodType } from 'ssh/src/lib/types'
import { type AxialCoord, findPath, type Positioned, setPop } from 'ssh/src/lib/utils'
import {
	type Advertisement,
	AdvertisementManager,
	type ExchangePriority,
} from 'ssh/src/lib/utils/advertisement'
import { AxialKeyMap } from 'ssh/src/lib/utils/mem'
import { toAxialCoord } from 'ssh/src/lib/utils/position'
import type { StorageAlveolus } from './storage'

export interface MovingGood {
	_mgId?: string
	goodType: GoodType
	path: AxialCoord[]
	provider: Alveolus
	demander: Alveolus
	from: AxialCoord
	allocations: {
		source: AllocationBase
		target: AllocationBase
	}
	hop(): AxialCoord
	place(): void
	finish(): void
}

@unreactive
export class Hive extends AdvertisementManager<Alveolus> {
	private constructor(public readonly board: HexBoard) {
		super()
	}
	// Path cache for complete paths between alveoli
	private pathCache = new Map<string, AxialCoord[]>()

	//#region Hives management on tile add/remove
	static for(tile: Tile) {
		const hives = new Set<Hive>()
		for (const neighbor of tile.neighborTiles) {
			// Check for hive property to support proxies
			if (neighbor?.content && 'hive' in neighbor.content) {
				const h = (neighbor.content as Alveolus).hive
				hives.add(h)
			}
		}
		if (hives.size === 0) return new Hive(tile.board)
		if (hives.size === 1) return setPop(hives)!

		const hivesArray = Array.from(hives)
		const targetHive = hivesArray.shift()!
		for (const hive of hivesArray) {
			for (const alveolus of hive.alveoli) targetHive.attach(alveolus)
			hive.destroy()
		}
		return targetHive
	}
	public name?: string
	public readonly alveoli = reactive(new Set<Alveolus>())
	/** Hive-level configurations by alveolus type */
	public readonly configurations = reactive(new Map<string, Ssh.AlveolusConfiguration>())

	// Structure and content
	//@memoize
	get byActionType() {
		const rv: Partial<Record<Ssh.Action['type'], Alveolus[]>> = {}
		for (const alveolus of this.alveoli) {
			const type = alveolus.action?.type
			if (!rv[type]) rv[type] = []
			rv[type].push(alveolus)
		}
		return rv
	}
	private readonly advertising: ScopedCallback[] = []
	private readonly gates = new Set<AlveolusGate>()
	public attach(alveolus: Alveolus) {
		this.alveoli.add(alveolus)
		// Ensure gates exist between neighboring alveoli in the hive
		for (const surrounding of alveolus.tile.surroundings) {
			if (surrounding.tile instanceof Alveolus) {
				if (!(surrounding.border.content instanceof AlveolusGate)) {
					surrounding.border.content = new AlveolusGate(surrounding.border)
				}
			}
		}
		for (const gate of alveolus.gates) this.gates.add(gate)
		alveolus.hive = this
		this.invalidatePathCache()
		this.advertising.push(
			namedEffect(`${alveolus.name}.advertise`, () =>
				this.advertise(alveolus, alveolus.goodsRelations),
			),
		)
	}
	/**
	 * This hive is defined as a copy of another hive after an alveolus removal didn't divide it
	 * @param hive
	 */
	private copyFrom(hive: Hive) {
		if (hive.name) this.name = hive.name
		this.movingGoods = hive.movingGoods
	}
	/**
	 * This hive is defined as a part of another hive who had just been divided by an alveolus removal
	 * @param hive
	 */
	private partOf(hive: Hive) {
		if (hive.name)
			this.name = `${hive.name} - ${Math.floor(this.board.game.random(36 ** 3))
				.toString(36)
				.padStart(3, '0')}`
		// TODO: destroying an alveolus (and its borders) should "free" the goods and cancel all the movements going through
	}
	/**
	 * Has to be called *after* tile.content is not a alveolus anymore
	 * @param alveolus
	 */
	removeAlveolus(alveolus: Alveolus) {
		this.alveoli.delete(alveolus)
		this.invalidatePathCache()
		const toPlaceAlveoli = new Set(this.alveoli)
		const hives: Hive[] = []

		while (toPlaceAlveoli.size > 0) {
			const hive = new Hive(this.board)
			hives.push(hive)
			const toAddSet = new Set<Alveolus>()
			toAddSet.add(setPop(toPlaceAlveoli)!)
			while (toAddSet.size > 0) {
				const alveolus = setPop(toAddSet)!
				hive.attach(alveolus)
				for (const neighbor of alveolus.neighborAlveoli)
					if (!hive.alveoli.has(neighbor)) toAddSet.add(neighbor)
			}
		}
		if (hives.length === 1) {
			const newHive = hives[0].copyFrom(this)
			// Destroy the old hive since it's being replaced
			this.destroy()
			return newHive
		}
		for (let i = 0; i < hives.length - 1; i++) hives[i].partOf(this)
		// Destroy the old hive since it's being replaced
		this.destroy()
	}
	//#endregion

	//#region Path caching
	private invalidatePathCache() {
		this.pathCache.clear()
	}

	private getPath(from: Alveolus, to: Alveolus, goodType: GoodType): AxialCoord[] | undefined {
		const fromCoord = toAxialCoord(from.tile.position)
		const toCoord = toAxialCoord(to.tile.position)
		const key = `${fromCoord.q},${fromCoord.r}-${toCoord.q},${toCoord.r}-${goodType}`

		if (this.pathCache.has(key)) {
			return this.pathCache.get(key)!
		}

		// Use actual pathfinding to get the complete path
		const path = findPath(
			(c) => this.getNeighborsForGood(c, goodType).map((n) => toAxialCoord(n)),
			fromCoord,
			toCoord,
			Number.POSITIVE_INFINITY,
			true,
		)

		if (path && path.length > 0) {
			// path is tile - border - tile - border - ... - tile
			// We should keep only the borders and the last tile
			const maxNdx = Math.floor(path.length / 2)
			for (let i = 0; i < maxNdx; i++) path.splice(i, 1)
			this.pathCache.set(key, path)
			return path
		}

		return undefined
	}

	private getPathDistance(from: Alveolus, to: Alveolus, goodType: GoodType): number {
		const path = this.getPath(from, to, goodType)
		return path ? path.length : Number.POSITIVE_INFINITY
	}

	private findNearest<T extends Alveolus>(
		from: Alveolus,
		candidates: Set<T>,
		goodType: GoodType,
	): T | undefined {
		if (candidates.size === 0) return undefined

		let nearest: T | undefined
		let minDistance = Number.POSITIVE_INFINITY

		for (const candidate of candidates) {
			const distance = this.getPathDistance(from, candidate, goodType)
			if (distance < minDistance) {
				minDistance = distance
				nearest = candidate
			}
		}

		return nearest
	}
	//#endregion

	getNeighborsForGood(ref: Positioned, _goodType: GoodType) {
		const coord = toAxialCoord(ref)
		if (isTileCoord(coord)) {
			const content = this.board.getTileContent(ref) as Alveolus
			return content.gates.map((g) => g.border.position)
		}
		// Get a border's neighbors - find tileA's and tileB's borders who are gates but not me
		const border = this.board.getBorder(ref)!
		return [border.tile.a.position, border.tile.b.position]
	}
	//#region Needy / events
	public manualNeeds: Partial<Record<GoodType, number>> = {}

	get needs() {
		const calculatedNeeds = Object.fromEntries(
			Object.entries(this.advertisements)
				.filter(([_, { advertisement }]) => advertisement === 'demand')
				.map(([gt, { advertisers }]) => {
					// highest non-empty priority index represents the current priority
					let highest = 0
					for (let i = advertisers.length - 1; i >= 0; i--) {
						if (advertisers[i] && advertisers[i].length > 0) {
							highest = i
							break
						}
					}
					const asPriority: ExchangePriority = (['0-store', '1-buffer', '2-use'] as const)[
						highest as 0 | 1 | 2
					]
					return [gt as GoodType, asPriority] as const
				})
				// Filter out 0-store priority - these are only for internal conveying, not hive needs
				.filter(([_, priority]) => priority !== '0-store'),
		)
		// Merge manual needs
		for (const [good, _amount] of Object.entries(this.manualNeeds)) {
			// Priority 2-use for manual needs to ensure they are picked up
			if (calculatedNeeds[good as GoodType]) continue // Don't override existing demand
			calculatedNeeds[good as GoodType] = '2-use'
		}
		return calculatedNeeds
	}

	movingGoods = reactive(new AxialKeyMap<MovingGood[]>())
	storageAt(coord: Positioned): Storage | undefined {
		if (isTileCoord(toAxialCoord(coord))) {
			const content = this.board.getTileContent(coord) as Alveolus
			return content.storage
		}
		const border = this.board.getBorder(coord)!
		return border.content?.storage
	}

	public createMovement(goodType: GoodType, provider: Alveolus, demander: Alveolus) {
		const positions = {
			provider: toAxialCoord(provider.tile.position),
			demander: toAxialCoord(demander.tile.position),
		}
		const { movingGoods } = this

		// Use cached path if available, otherwise calculate it
		const path = [...this.getPath(provider, demander, goodType)!]

		if (!path || path.length < 1) return false

		const reason = {
			type: 'hive-transfer',
			goodType,
			...positions,
		}

		/*
		 * Attempt to reserve the good from the provider and allocate space in the demander.
		 * If either fails, we cancel the other and return false.
		 */
		const providerToken = provider.storage.reserve({ [goodType]: 1 }, reason)
		const demanderToken = demander.storage.allocate({ [goodType]: 1 }, reason)

		if (!providerToken || !demanderToken) {
			console.warn('[createMovement] Failed to obtain tokens', { providerToken, demanderToken })
			if (providerToken) providerToken.cancel()
			if (demanderToken) demanderToken.cancel()
			return false
		}

		const self = this
		const movingGood: MovingGood = {
			goodType,
			path,
			provider,
			demander,
			from: positions.provider,
			allocations: {
				source: providerToken,
				target: demanderToken,
			},
			hop() {
				const fromCoord = this.from
				const nextCoord = this.path.shift()!

				const currentList = self.movingGoods.get(fromCoord)
				if (currentList) {
					// Find the original movingGood in the list (this might be a wrapper)
					const original = currentList.find(
						(mg) => mg === this || Object.getPrototypeOf(this) === mg,
					)
					if (original) {
						const idx = currentList.indexOf(original)
						currentList.splice(idx, 1)
						if (currentList.length === 0) self.movingGoods.delete(fromCoord)
					}
				}

				this.from = nextCoord
				movingGood.from = nextCoord // Also update the canonical movingGood
				return nextCoord
			},
			place() {
				const here = movingGood.from // Use movingGood.from, not this.from (which is on the wrapper)
				if (!self.movingGoods.has(here)) self.movingGoods.set(here, [])
				// Push the original movingGood, not the wrapper
				self.movingGoods.get(here)!.push(movingGood)
			},
			finish() {
				const fromCoord = this.from
				const currentList = self.movingGoods.get(fromCoord)
				if (currentList) {
					// Find the original movingGood in the list (this might be a wrapper)
					const original = currentList.find(
						(mg) => mg === this || Object.getPrototypeOf(this) === mg,
					)
					if (original) {
						const idx = currentList.indexOf(original)
						currentList.splice(idx, 1)
						if (currentList.length === 0) self.movingGoods.delete(fromCoord)
					}
				}
				this.allocations.target.fulfill()
				this.allocations.source.fulfill()
			},
		}

		movingGood.place()
		return true
	}

	get generalStorages() {
		return (this.byActionType['slotted-storage'] || []) as StorageAlveolus[]
	}
	selectMovement(
		advertisement: Advertisement,
		alveolus: Alveolus,
		storages: Alveolus[],
		goodType: GoodType,
	): Alveolus {
		// We consider A->B === B->A
		const storage = this.findNearest(alveolus, new Set(storages), goodType)
		assert(storage !== undefined, 'Storage found but none reachable')
		traces.advertising?.log(
			`Creating movement for ${goodType}: ${alveolus.name} -> ${storage.name}`,
		)
		// Defer movement creation to avoid reactive cycle:
		// The advertise effect reads storage state, and createMovement modifies it.
		queueMicrotask(() => {
			try {
				this.createMovement(
					goodType,
					...((advertisement === 'provide' ? [alveolus, storage] : [storage, alveolus]) as [
						Alveolus,
						Alveolus,
					]),
				)
			} catch (e) {
				// Ignore allocation errors that occur if resources are no longer available
				// The system will retry naturally on next advertisement if needed
				if ((e as Error).name !== 'AllocationError') console.error(e)
			}
		})
		return storage
	}

	destroy() {
		// Clean up all advertising effects
		for (const cleanup of this.advertising) {
			cleanup()
		}
		this.advertising.length = 0
	}
	//#endregion
}
