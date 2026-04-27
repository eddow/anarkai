/**
 * Scripted transfer steps (`grab` / `drop` plans, loose pickup) for the operated vehicle storage.
 * Most freight paths are still driving, but zone browse temporarily steps off while keeping control
 * of the same vehicle, so these helpers resolve {@link Character.transportStorage} rather than only
 * `carry`. See
 * `sandbox/roadmap-no-character-inventory.md`.
 */
import { goods as goodsCatalog } from 'engine-rules'
import type { TileBorder } from 'ssh/board/border/border'
import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import type { LooseGood } from 'ssh/board/looseGoods'
import type { Tile } from 'ssh/board/tile'
import type { Character } from 'ssh/population/character'
import { contract, type Goods, type GoodType } from 'ssh/types'
import type { IdlePlan, PickupPlan, TransferPlan } from 'ssh/types/base'
import { axial, type Positioned, tileSize, toAxialCoord, toWorldCoord } from 'ssh/utils'
import { assert } from '../../dev/debug.ts'
import { subject } from '../scripts'
import { type ASingleStep, DurationStep } from '../steps'

function planSpecificLoosePickup(
	character: Character,
	looseGood: LooseGood,
	source: Positioned
): PickupPlan {
	const transport = character.requireTransportStorage()
	const canGrab = transport.hasRoom(looseGood.goodType)
	if (canGrab <= 0) {
		throw new Error(`No room in active transport storage for ${looseGood.goodType}`)
	}

	const vehicleAllocation = transport.allocate({ [looseGood.goodType]: 1 }, 'plan.pickup')
	const allocation = looseGood.allocate('plan.pickup')

	return {
		type: 'pickup' as const,
		goodType: looseGood.goodType,
		target: source,
		vehicleAllocation,
		allocation,
	}
}

type StorageTarget = {
	content: {
		storage?: {
			allocate(goods: Goods, reason: string): TransferPlan['allocation']
		}
	}
}

function hasStorageContent(target: Positioned): target is Positioned & StorageTarget {
	return (
		typeof target === 'object' &&
		target !== null &&
		'content' in target &&
		typeof target.content === 'object' &&
		target.content !== null &&
		'storage' in target.content
	)
}

function ensureDropPlanAllocations(action: TransferPlan, character: Character) {
	if (action.vehicleAllocation && action.allocation) return
	assert(action.description === 'drop', 'drop allocations can only be created for drop plans')
	assert(action.target, 'drop target must be set')
	const transport = character.requireTransportStorage()
	const target = action.target
	assert(hasStorageContent(target), 'planDropStored only works with TileContent that has storage')
	const content = target.content
	assert(content, 'destination.content must be set')
	assert('storage' in content, 'planDropStored only works with TileContent that has storage')

	let vehicleAllocation: TransferPlan['vehicleAllocation']
	let allocation: TransferPlan['allocation']
	try {
		vehicleAllocation = transport.reserve(action.goods, `planDropStored`)
		allocation = content.storage!.allocate(action.goods, `planDropStored`)
		action.vehicleAllocation = vehicleAllocation
		action.allocation = allocation
		action.resolvedGoods = action.goods
	} catch (error) {
		try {
			allocation?.cancel()
		} catch {}
		try {
			vehicleAllocation?.cancel()
		} catch {}
		throw error
	}
}

/**
 * NPC-bound transfer helpers. Stock moves through {@link Character.carry} (vehicle storage when
 * driving). Offload-only helpers tolerate missing transport; freight paths assert it.
 */
export class InventoryFunctions {
	declare [subject]: Character

	@contract()
	canDropLooseHere(): boolean {
		const character = this[subject]
		const tile = character.tile
		const content = tile.content
		if (!(content instanceof UnBuiltLand)) return false
		if (content.project) return false
		if (tile.zone === 'residential') return false
		if (!tile.isBurdened) return true
		// Maintenance unload still needs one legal state while the operator is actively driving the
		// wheelbarrow: the current tile may be marked burdened solely by that operated vehicle. Keep
		// deposit / loose-good / "another vehicle already here" cases blocked.
		const vehicle = character.operates
		if (!vehicle) return false
		if (!tile.isClear) return false
		const tileCoord = toAxialCoord(tile.position)
		const vehicleCoord = toAxialCoord(vehicle.position)
		if (Math.round(vehicleCoord.q) !== tileCoord.q || Math.round(vehicleCoord.r) !== tileCoord.r) {
			return false
		}
		for (const other of character.game.vehicles) {
			if (other.uid === vehicle.uid) continue
			const otherCoord = toAxialCoord(other.position)
			if (Math.round(otherCoord.q) === tileCoord.q && Math.round(otherCoord.r) === tileCoord.r) {
				return false
			}
		}
		return true
	}

	/**
	 * Good types with a positive available quantity in {@link Character.carry} (active transport).
	 * Used by `offloadDropBuffer` instead of `Object.keys(carry.availables)` — reactive getters may
	 * not enumerate reliably from NPC `keys()`.
	 */
	@contract()
	dropCandidateGoodTypes(): GoodType[] {
		const transport = this[subject].transportStorage
		if (!transport) return []
		const types: GoodType[] = []
		// Enumerate from the goods catalog — `Object.keys(transport.stock)` can miss reactive keys when
		// called from NPC scripts (`inventory.offloadDropBuffer` uses this list as the entry gate).
		for (const goodType of Object.keys(goodsCatalog) as GoodType[]) {
			const qty = transport.stock[goodType]
			if (!qty || qty <= 0) continue
			if ((transport.available(goodType) ?? 0) > 0) types.push(goodType)
		}
		return types
	}

	@contract('GoodType')
	carryAvailable(goodType: GoodType): number {
		return this[subject].carry?.available(goodType) ?? 0
	}

	@contract('GoodType', 'number?')
	dropAsLooseGood(goodType: GoodType, maxAmount: number = 1) {
		const character = this[subject]
		const transport = character.requireTransportStorage()

		const available = transport.available(goodType) ?? 0
		let amount = Math.min(available, maxAmount)
		if (amount <= 0) throw new Error(`No ${goodType} to drop (available: ${available})`)
		const vehicleTransfer = transport.reserve({ [goodType]: amount }, `drop.${goodType}`)
		const tileCenter = toWorldCoord(character.tile.position)
		return new DurationStep(amount * character.freightTransferTime, 'convey', `drop.${goodType}`)
			.finished(() => {
				try {
					// Use the tile as the bucket key but jitter the exact world position inside it so
					// repeated unloads do not perfectly overlap on the tile center.
					while (amount--) {
						const offset = axial.randomPositionInTile(character.game.random, tileSize)
						character.game.hex.looseGoods.add(character.tile, goodType, {
							position: {
								x: tileCenter.x + offset.x,
								y: tileCenter.y + offset.y,
							},
						})
					}
					if (!vehicleTransfer) console.error('vehicleTransfer missing in dropAsLooseGood callback')
					vehicleTransfer.fulfill()
				} catch (e) {
					console.error('Error in dropAsLooseGood finished:', e)
					throw e
				}
			})
			.canceled(() => {
				vehicleTransfer.cancel()
			})
	}
	@contract('Goods', 'Tile | TileBorder')
	planDropStored(goods: Goods, destination: Tile | TileBorder): TransferPlan | IdlePlan {
		const character = this[subject]
		const content = destination.content
		const transport = character.requireTransportStorage()
		assert(content, 'destination.content must be set')
		assert('storage' in content, 'planDropStored only works with TileContent that has storage')

		// Calculate actual amounts for each good type
		const actualGoods: Goods = {}
		let totalAmount = 0

		for (const [goodType, requestedQuantity] of Object.entries(goods) as [GoodType, number][]) {
			if (!requestedQuantity || requestedQuantity <= 0) continue

			const available = transport.available(goodType) ?? 0
			const canStore = content.storage?.hasRoom(goodType) || 0
			const amount = Math.min(available, canStore, requestedQuantity)

			if (amount > 0) {
				actualGoods[goodType] = amount
				totalAmount += amount
			}
		}

		if (totalAmount <= 0) {
			// If we wanted to drop specific goods but couldn't (e.g. storage full or we don't have them)
			// But wait, earlier we check `available` in transport.
			// If we don't have the goods, `available` is 0.
			// If destination is full, `canStore` is 0.

			// Check why totalAmount is 0
			const reasons: string[] = []
			for (const [goodType, requestedQuantity] of Object.entries(goods) as [GoodType, number][]) {
				if (!requestedQuantity || requestedQuantity <= 0) continue
				const available = transport.available(goodType) ?? 0
				if (available <= 0) reasons.push(`No ${goodType} in active transport storage`)

				const canStore = content.storage?.hasRoom(goodType) || 0
				if (canStore <= 0) reasons.push(`No room for ${goodType} in target`)
			}
			throw new Error(
				`Cannot drop goods: ${reasons.join(', ') || 'Unknown reason'} (requested: ${JSON.stringify(goods)}, available: ${JSON.stringify(transport.availables)}, target-room: ${JSON.stringify(content.storage?.logInfo || 'no-storage')})`
			)
		}

		// Return plan without allocations - they will be created when the drop is
		// actually effectuated so border slots only reserve space for real transfers.
		return {
			type: 'transfer' as const,
			description: 'drop' as const,
			goods: actualGoods,
			target: destination,
		}
	}
	@contract('Goods', 'Tile | TileBorder')
	planGrabStored(goods: Goods, source: Tile | TileBorder): TransferPlan | IdlePlan {
		const character = this[subject]
		const transport = character.requireTransportStorage()
		const content = source.content
		assert(content, 'source.content must be set')
		assert('storage' in content, 'planGrabStored only works with TileContent that has storage')

		// Calculate actual amounts for each good type
		const actualGoods: Goods = {}
		let totalAmount = 0

		for (const [goodType, requestedQuantity] of Object.entries(goods) as [GoodType, number][]) {
			if (!requestedQuantity || requestedQuantity <= 0) continue

			const canGrab = transport.hasRoom(goodType)
			if (canGrab <= 0) continue // Skip this good type if no room

			const available = content.storage?.available(goodType) ?? 0
			const amount = Math.min(canGrab, available, requestedQuantity)

			if (amount > 0) {
				actualGoods[goodType] = amount
				totalAmount += amount
			}
		}

		if (totalAmount <= 0) {
			throw new Error(`No goods to grab from ${source} (requested: ${JSON.stringify(goods)})`)
		}

		// Create allocations immediately
		const vehicleAllocation = transport.allocate(actualGoods, 'plan.grab')
		const allocation = content.storage!.reserve(actualGoods, 'plan.get')

		return {
			type: 'transfer' as const,
			description: 'grab' as const,
			goods: actualGoods,
			sourceTile: source,
			vehicleAllocation,
			allocation,
		}
	}

	/**
	 * Plan to grab loose goods from a tile.
	 * @param goodType - Specific good to grab, or null/undefined to grab *any* available good that fits in active transport storage ("scavenge" mode).
	 * @param source - The location to grab from.
	 */
	planGrabSpecificLoose(looseGood: LooseGood, source: Positioned): PickupPlan {
		return planSpecificLoosePickup(this[subject], looseGood, source)
	}

	@contract('GoodType | null', 'Positioned')
	planGrabLoose(
		goodType: GoodType | null | undefined,
		source: Positioned
	): PickupPlan | TransferPlan | IdlePlan {
		const character = this[subject]
		const transport = character.transportStorage
		if (!transport) {
			return { type: 'idle' as const, duration: 0.1 }
		}

		// If goodType is null (scavenge), we check strict room later per-item.
		// Here we bail softly if the carrier cannot hold the requested type (same as missing goods).
		const canGrab = goodType ? transport.hasRoom(goodType) : 1
		if (canGrab <= 0) {
			return { type: 'idle' as const, duration: 0.1 }
		}

		// Check for LooseGoods on the tile - always grab exactly 1
		// Filter for available goods that haven't been removed (decayed)
		const coord = toAxialCoord(source)
		const looseGoods = character.game.hex.looseGoods.getGoodsAt(coord)
		const matchingLooseGoods = looseGoods.filter(
			(good) =>
				(goodType ? good.goodType === goodType : transport.hasRoom(good.goodType)) &&
				good.available &&
				!good.isRemoved
		)

		if (matchingLooseGoods.length === 0) {
			// Loose goods can disappear between pathfinding and execution (another worker picks them,
			// they are reserved, etc). Fail softly so the caller can re-plan instead of breaking the
			// whole reactive batch.
			return {
				type: 'idle',
				duration: 0.1,
			}
		}

		const chosenGood = matchingLooseGoods[0]
		return planSpecificLoosePickup(character, chosenGood, source)
	}
	@contract('TransferPlan | PickupPlan | IdlePlan')
	effectuate(action: TransferPlan | PickupPlan | IdlePlan) {
		const character = this[subject]
		const {
			tile: { content },
		} = character
		assert(content, 'tile.content must be set')

		if (action.type === 'idle') {
			return new DurationStep(action.duration, 'idle', 'waiting')
		}

		// Calculate total transfer time based on plan type
		let totalAmount: number
		let description: string

		if (action.type === 'transfer') {
			if (action.description === 'drop') ensureDropPlanAllocations(action, character)
			const goods = action.resolvedGoods ?? action.goods
			totalAmount = Object.values(goods).reduce((sum, qty) => sum + qty, 0)
			description = action.description
		} else if (action.type === 'pickup') {
			totalAmount = 1 // Always grab exactly 1 LooseGood
			description = 'pickup'
		} else {
			throw new Error('Unknown plan type')
		}
		const { vehicleAllocation, allocation } = action
		assert(vehicleAllocation, 'vehicleAllocation must be set before effectuating transfer')

		return new DurationStep(totalAmount * character.freightTransferTime, 'convey', description)
			.finished(() => {
				try {
					if (!vehicleAllocation) {
						console.error('vehicleAllocation is missing in effectuate callback!', action)
						throw new Error('vehicleAllocation is missing in effectuate callback') // Prevent crash
					}
					vehicleAllocation.fulfill()
					allocation?.fulfill()
				} catch (e) {
					console.error('Error in effectuate finished:', e)
					console.log('Action:', action)
					console.log('VehicleAlloc:', vehicleAllocation)
					throw e
				}
			})
			.canceled(() => {
				vehicleAllocation!.cancel()
				allocation?.cancel()
			})
	}

	/**
	 * Drops one unit of buffered active-transport stock as a loose good on the current tile.
	 * Caller must ensure {@link canDropLooseHere} before invoking (see `vehicle.npcs` offload prelude).
	 * Vehicle service completion is owned by the vehicle job script after this step resumes.
	 */
	@contract()
	offloadDropBuffer(): ASingleStep | false {
		return offloadDropBufferNative(this)
	}
}
// TODO: this is `scriptContext` indeed, not InventoryFunctions

/** Test hook for {@link InventoryFunctions.offloadDropBuffer} (same implementation as the method). */
export function offloadDropBufferNative(inv: InventoryFunctions): ASingleStep | false {
	const character = inv[subject]
	const types = character.scriptsContext.inventory.dropCandidateGoodTypes()
	if (types.length === 0) return false
	const goodType = types[0]!
	return character.scriptsContext.inventory.dropAsLooseGood(goodType, 1)
}
