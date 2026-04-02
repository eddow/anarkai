import type { TileBorder } from 'ssh/board/border/border'
import type { LooseGood } from 'ssh/board/looseGoods'
import type { Tile } from 'ssh/board/tile'
import { assert } from 'ssh/debug'
import type { Character } from 'ssh/population/character'
import { contract, type Goods, type GoodType } from 'ssh/types'
import type { IdlePlan, PickupPlan, TransferPlan } from 'ssh/types/base'
import { type Positioned, toAxialCoord } from 'ssh/utils'
import { subject } from '../scripts'
import { DurationStep } from '../steps'

function planSpecificLoosePickup(
	character: Character,
	looseGood: LooseGood,
	source: Positioned
): PickupPlan {
	const vehicle = character.vehicle
	assert(vehicle, 'character.vehicle must be set')
	assert(!looseGood.isRemoved, 'LooseGood already removed')
	assert(looseGood.available, 'LooseGood already allocated')

	const canGrab = vehicle.storage.hasRoom(looseGood.goodType)
	if (canGrab <= 0) throw new Error(`No room in vehicle to grab ${looseGood.goodType}`)

	const vehicleAllocation = vehicle.storage.allocate({ [looseGood.goodType]: 1 }, 'plan.pickup')
	const allocation = looseGood.allocate('plan.pickup')

	return {
		type: 'pickup' as const,
		goodType: looseGood.goodType,
		target: source,
		vehicleAllocation,
		allocation,
	}
}

function ensureDropPlanAllocations(action: TransferPlan, character: Character) {
	if (action.vehicleAllocation && action.allocation) return
	assert(action.description === 'drop', 'drop allocations can only be created for drop plans')
	assert(action.target, 'drop target must be set')
	const vehicle = character.vehicle
	const content = action.target.content
	assert(vehicle, 'tile.vehicle must be set')
	assert(content, 'destination.content must be set')
	assert('storage' in content, 'planDropStored only works with TileContent that has storage')

	let vehicleAllocation: TransferPlan['vehicleAllocation']
	let allocation: TransferPlan['allocation']
	try {
		vehicleAllocation = vehicle.storage.reserve(action.goods, `planDropStored`)
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

export class InventoryFunctions {
	declare [subject]: Character

	@contract('GoodType', 'number?')
	dropAsLooseGood(goodType: GoodType, maxAmount: number = 1) {
		const character = this[subject]
		const { vehicle } = character
		assert(vehicle, 'tile.vehicle must be set')

		const available = vehicle.storage.available(goodType) ?? 0
		let amount = Math.min(available, maxAmount)
		if (amount <= 0) throw new Error(`No ${goodType} to drop (available: ${available})`)
		const vehicleTransfer = vehicle.storage.reserve({ [goodType]: amount }, `drop.${goodType}`)
		return new DurationStep(amount * vehicle.transferTime, 'convey', `drop.${goodType}`)
			.finished(() => {
				try {
					while (amount--)
						character.game.hex.looseGoods.add(character.tile, goodType, {
							position: character.position,
						})
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
		const vehicle = character.vehicle
		assert(vehicle, 'tile.vehicle must be set')
		assert(content, 'destination.content must be set')
		assert('storage' in content, 'planDropStored only works with TileContent that has storage')

		// Calculate actual amounts for each good type
		const actualGoods: Goods = {}
		let totalAmount = 0

		for (const [goodType, requestedQuantity] of Object.entries(goods) as [GoodType, number][]) {
			if (!requestedQuantity || requestedQuantity <= 0) continue

			const available = vehicle.storage.available(goodType) ?? 0
			const canStore = content.storage?.hasRoom(goodType) || 0
			const amount = Math.min(available, canStore, requestedQuantity)

			if (amount > 0) {
				actualGoods[goodType] = amount
				totalAmount += amount
			}
		}

		if (totalAmount <= 0) {
			// If we wanted to drop specific goods but couldn't (e.g. storage full or we don't have them)
			// But wait, earlier we check `available` in vehicle.
			// If we don't have the goods, `available` is 0.
			// If destination is full, `canStore` is 0.

			// Check why totalAmount is 0
			const reasons: string[] = []
			for (const [goodType, requestedQuantity] of Object.entries(goods) as [GoodType, number][]) {
				if (!requestedQuantity || requestedQuantity <= 0) continue
				const available = vehicle.storage.available(goodType) ?? 0
				if (available <= 0) reasons.push(`No ${goodType} in inventory`)

				const canStore = content.storage?.hasRoom(goodType) || 0
				if (canStore <= 0) reasons.push(`No room for ${goodType} in target`)
			}
			throw new Error(
				`Cannot drop goods: ${reasons.join(', ') || 'Unknown reason'} (requested: ${JSON.stringify(goods)}, available: ${JSON.stringify(vehicle.storage.availables)}, target-room: ${JSON.stringify(content.storage?.debugInfo || 'no-storage')})`
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
		const vehicle = character.vehicle
		assert(vehicle, 'tile.vehicle must be set')
		const content = source.content
		assert(content, 'source.content must be set')
		assert('storage' in content, 'planGrabStored only works with TileContent that has storage')

		// Calculate actual amounts for each good type
		const actualGoods: Goods = {}
		let totalAmount = 0

		for (const [goodType, requestedQuantity] of Object.entries(goods) as [GoodType, number][]) {
			if (!requestedQuantity || requestedQuantity <= 0) continue

			const canGrab = vehicle.storage.hasRoom(goodType)
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
		const vehicleAllocation = vehicle.storage.allocate(actualGoods, 'plan.grab')
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
	 * @param goodType - Specific good to grab, or null/undefined to grab *any* available good that fits in inventory ("scavenge" mode).
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
		const vehicle = character.vehicle
		assert(vehicle, 'character.vehicle must be set')

		// If goodType is null (scavenge), we check strict room later per-item.
		// Here we just ensure we aren't totally full if checking a specific type.
		const canGrab = goodType ? vehicle.storage.hasRoom(goodType) : 1
		if (canGrab <= 0) throw new Error('No room in vehicle to grab goods')

		// Check for LooseGoods on the tile - always grab exactly 1
		// Filter for available goods that haven't been removed (decayed)
		const coord = toAxialCoord(source)
		const looseGoods = character.game.hex.looseGoods.getGoodsAt(coord)
		const matchingLooseGoods = looseGoods.filter(
			(good) =>
				(goodType ? good.goodType === goodType : vehicle.storage.hasRoom(good.goodType)) &&
				good.available &&
				!good.isRemoved
		)

		if (matchingLooseGoods.length === 0) {
			// If explicit good requested, throw error (command failed)
			if (goodType) throw new Error(`No ${goodType} to grab at ${coord}`)

			// If checking generic "any good" (scavenge), and none found matching criteria:
			// Return Idle plan to gracefully "cancel" or skip the grab attempt without crashing.
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
			vehicle,
		} = character
		assert(content, 'tile.content must be set')
		assert(vehicle, 'tile.vehicle must be set')

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

		return new DurationStep(totalAmount * vehicle.transferTime, 'convey', description)
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
}
