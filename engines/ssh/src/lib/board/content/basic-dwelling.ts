import { reactive } from 'mutts'
import { gameIsaTypes } from 'ssh/npcs/utils'
import { basicDwellingHomeStorageMaxAmounts } from 'ssh/residential/constants'
import { SpecificStorage } from 'ssh/storage/specific-storage'
import type { GoodType } from 'ssh/types/base'
import type { GoodsRelations } from 'ssh/utils/advertisement'
import { toAxialCoord } from 'ssh/utils/position'
import type { Tile } from '../tile'
import { TileContent } from './content'

export type HomeQualityTier = 'fallback_tile' | 'basic_dwelling'

@reactive
export class BasicDwelling extends TileContent {
	readonly capacity = 1
	/** Single-slot reservation for v1 (capacity is 1). */
	reservedBy?: object

	constructor(public readonly tile: Tile) {
		const coord = toAxialCoord(tile.position)!
		super(tile.board.game, `dwelling:${coord.q},${coord.r}`)
		this.storage = new SpecificStorage({ ...basicDwellingHomeStorageMaxAmounts } as Record<
			GoodType,
			number
		>)
	}

	public readonly storage: SpecificStorage

	get name(): string {
		return 'basic_dwelling'
	}

	/** Inspector parity with alveolus `goodsRelations` (home storage is not advertised). */
	get goodsRelations(): GoodsRelations {
		return {}
	}

	get title(): string {
		return 'Basic dwelling'
	}

	get homeQualityTier(): HomeQualityTier {
		return 'basic_dwelling'
	}

	get freeHomeSlots(): number {
		return this.reservedBy ? 0 : this.capacity
	}

	isReservedBy(owner: object): boolean {
		return this.reservedBy === owner
	}

	tryReserveHome(owner: object): boolean {
		if (this.reservedBy === owner) return true
		if (this.reservedBy !== undefined) return false
		this.reservedBy = owner
		return true
	}

	releaseHome(owner: object): void {
		if (this.reservedBy === owner) this.reservedBy = undefined
	}

	get debugInfo() {
		return {
			type: 'BasicDwelling',
			capacity: this.capacity,
			occupied: Boolean(this.reservedBy),
		}
	}

	get walkTime(): number {
		return 1
	}

	get background(): string {
		return 'buildings.cabin'
	}

	canInteract(_action: string): boolean {
		return false
	}
}

gameIsaTypes.basicDwelling = (value: unknown) => {
	return value instanceof BasicDwelling
}
