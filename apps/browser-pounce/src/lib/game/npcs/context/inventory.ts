import { assert } from '$lib/debug'
import { Alveolus } from '$lib/game/board'
import type { TileBorder } from '$lib/game/board/border/border'
import type { Tile } from '$lib/game/board/tile'
import type { Character } from '$lib/game/population/character'
import { contract, type Goods, type GoodType } from '$lib/types'
import type { PickupPlan, TransferPlan } from '$lib/types/base'
import { type Positioned, toAxialCoord } from '$lib/utils'
import { subject } from '../scripts'
import { DurationStep } from '../steps'

export class InventoryFunctions {
	declare [subject]: Character

	@contract('GoodType', 'number?')
	dropAsFreeGood(goodType: GoodType, maxAmount: number = 1) {
		const character = this[subject]
		const { vehicle } = character
		assert(vehicle, 'tile.vehicle must be set')

		const available = vehicle.storage.available(goodType) ?? 0
		let amount = Math.min(available, maxAmount)
		if (amount <= 0) return undefined // throw new Error('No goods to drop')
		const vehicleTransfer = vehicle.storage.reserve({ [goodType]: amount }, `drop.${goodType}`)
		if (character.tile.content instanceof Alveolus) debugger
		return new DurationStep(amount * vehicle.transferTime, 'convey', `drop.${goodType}`)
			.finished(() => {
				while (amount--)
					character.game.hex.freeGoods.add(character.tile, goodType, {
						position: character.position,
					})
				vehicleTransfer.fulfill()
			})
			.canceled(() => {
				vehicleTransfer.cancel()
			})
	}
	@contract('Goods', 'Tile | TileBorder')
	planDropStored(goods: Goods, destination: Tile | TileBorder): TransferPlan {
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
			// Idle fallback
			return {
				type: 'transfer' as const,
				description: 'idle' as const,
				goods: {},
				target: destination,
				vehicleAllocation: undefined,
				allocation: undefined
			} as any
		}

		// Return plan without allocations - they will be created in plan.begin()
		return {
			type: 'transfer' as const,
			description: 'drop' as const,
			goods: actualGoods,
			target: destination,
		}
	}
	@contract('Goods', 'Tile | TileBorder')
	planGrabStored(goods: Goods, source: Tile | TileBorder) {
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
			// Idle fallback
			return {
				type: 'transfer' as const,
				description: 'idle' as const,
				goods: {},
				target: source,
				vehicleAllocation: undefined,
				allocation: undefined
			} as any
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

	@contract('GoodType | null', 'Positioned')
	planGrabFree(goodType: GoodType | undefined, source: Positioned): PickupPlan {
		const character = this[subject]
		const vehicle = character.vehicle
		assert(vehicle, 'character.vehicle must be set')

		const canGrab = goodType ? vehicle.storage.hasRoom(goodType) : 1
		if (canGrab <= 0) throw new Error('No room in vehicle to grab goods')

		// Check for FreeGoods on the tile - always grab exactly 1
		const coord = toAxialCoord(source)
		const freeGoods = character.game.hex.freeGoods.getGoodsAt(coord)
		const matchingFreeGoods = freeGoods.filter(
			(good) =>
				(goodType ? good.goodType === goodType : vehicle.storage.hasRoom(good.goodType)) &&
				good.available,
		)

		if (matchingFreeGoods.length === 0 || matchingFreeGoods[0].goodType === undefined) {
			// Instead of throwing, return a safe "IDLE" plan that does nothing.
			// This prevents the engine from crashing/looping violently.
			return {
				type: 'transfer' as const,
				description: 'idle' as const,
				goods: {},
				target: source instanceof Alveolus ? source : source, // Valid target
				vehicleAllocation: undefined,
				allocation: undefined
			} as any // Cast to satisfy strict return type temporarily
		}

		const chosenGood = matchingFreeGoods[0]
		
		// Create allocations immediately
		const vehicleAllocation = vehicle.storage.allocate(
			{ [chosenGood.goodType]: 1 },
			'plan.pickup',
		)
		const allocation = chosenGood.allocate('plan.pickup')

		return {
			type: 'pickup' as const,
			goodType: chosenGood.goodType,
			target: source,
			vehicleAllocation,
			allocation,
		}
	}
	@contract('TransferPlan | PickupPlan')
	effectuate(action: TransferPlan | PickupPlan) {
		if (action.type === 'transfer' && action.description === 'idle') {
			return new DurationStep(1, 'idle', 'wait.for.goods')
		}

		const character = this[subject]
		const { vehicleAllocation, allocation } = action
		const {
			tile: { content },
			vehicle,
		} = character
		assert(content, 'tile.content must be set')
		assert(vehicle, 'tile.vehicle must be set')
		assert(vehicleAllocation, 'vehicleAllocation must be set - plan should be in begin() state')

		// Calculate total transfer time based on plan type
		let totalAmount: number
		let description: string

		if (action.type === 'transfer') {
			totalAmount = Object.values(action.goods).reduce((sum, qty) => sum + qty, 0)
			description = action.description
		} else if (action.type === 'pickup') {
			totalAmount = 1 // Always grab exactly 1 FreeGood
			description = 'pickup'
		} else {
			throw new Error('Unknown plan type')
		}

		return new DurationStep(totalAmount * vehicle.transferTime, 'convey', description)
			.finished(() => {
				vehicleAllocation!.fulfill()
				allocation?.fulfill()
			})
			.canceled(() => {
				vehicleAllocation!.cancel()
				allocation?.cancel()
			})
	}
}
