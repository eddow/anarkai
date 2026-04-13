import { reactive } from 'mutts'
import { Alveolus } from 'ssh/board/content/alveolus'
import type { Tile } from 'ssh/board/tile'
import { SpecificStorage } from 'ssh/storage/specific-storage'
import type { AlveolusType, GoodType } from 'ssh/types/base'
import type { ExchangePriority, GoodsRelations } from 'ssh/utils/advertisement'
import { alveoli as alveoliDefs } from '../../../assets/game-content'

@reactive
export class BuildAlveolus extends Alveolus {
	public readonly target: AlveolusType

	constructor(tile: Tile, target: AlveolusType) {
		super(tile, new SpecificStorage((alveoliDefs[target].construction?.goods || {}) as Record<
			GoodType,
			number
		>))

		// Store properties
		this.target = target

		// Override name property to provide build-specific naming
		Object.defineProperty(this, 'name', {
			value: `build.${this.target}`,
			writable: false,
			configurable: false,
			enumerable: true,
		})
	}

	/**
	 * Buildings can take goods they still need for construction
	 */
	canTake(goodType: GoodType, _priority: ExchangePriority): boolean {
		if (!this.working) return false

		return (this.advertisedNeeds[goodType] ?? 0) > 0 && !this.destroyed
	}

	/**
	 * Buildings typically don't give goods back (default false)
	 */
	canGive(_goodType: GoodType, _priority: ExchangePriority): boolean {
		return false
	}

	get requiredGoods(): Record<GoodType, number> {
		return (alveoliDefs[this.target].construction?.goods || {}) as Record<GoodType, number>
	}

	get remainingNeeds(): Record<string, number> {
		const needs: Record<string, number> = {}

		// Guard against uninitialized storage
		if (!this.storage || !this.storage.stock) {
			return this.requiredGoods // If storage isn't ready, we need everything
		}

		for (const [good, qty] of Object.entries(this.requiredGoods)) {
			const goodType = good as GoodType
			const have = this.storage.available(goodType) || 0
			if (have < qty) needs[good] = qty - have
		}
		return needs
	}

	get advertisedNeeds(): Record<string, number> {
		const needs: Record<string, number> = {}

		for (const [good, qty] of Object.entries(this.requiredGoods)) {
			const goodType = good as GoodType
			const room = Math.max(0, this.storage.hasRoom(goodType))
			if (room > 0) needs[good] = Math.min(qty, room)
		}

		return needs
	}

	get isReady(): boolean {
		return Object.keys(this.remainingNeeds).length === 0 && !this.destroyed
	}

	get workingGoodsRelations(): GoodsRelations {
		// TODO: Implement more sophisticated priority system that considers construction urgency,
		// resource scarcity, and build order rather than just using distance as tie-breaker
		if (this.destroyed) return {}
		return Object.fromEntries(
			Object.entries(this.requiredGoods)
				.filter(([goodType]) => (this.advertisedNeeds[goodType] ?? 0) > 0)
				.map(([goodType]) => [goodType as GoodType, { advertisement: 'demand', priority: '2-use' }])
		)
	}
}
