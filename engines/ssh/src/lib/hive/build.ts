import { memoize, reactive } from 'mutts'
import { alveoli as alveoliDefs } from '$assets/game-content'
import { Alveolus } from '$lib/board/content/alveolus'
import type { Tile } from '$lib/board/tile'
import { SpecificStorage } from '$lib/storage/specific-storage'
import type { AlveolusType, GoodType } from '$lib/types/base'
import type { GoodsRelations } from '$lib/utils/advertisement'

@reactive
export class BuildAlveolus extends Alveolus {
	public readonly target: AlveolusType

	constructor(tile: Tile, target: AlveolusType) {
		const targetDef = alveoliDefs[target]
		const cost = (targetDef.construction?.goods || {}) as Record<GoodType, number>

		super(tile, new SpecificStorage(cost))

		// Store properties
		this.target = target
	}

	@memoize
	get remainingNeeds(): Record<string, number> {
		const targetDef = alveoliDefs[this.target]
		const cost = targetDef.construction?.goods || {}
		const needs: Record<string, number> = {}
		for (const [good, qty] of Object.entries(cost)) {
			const have = this.storage.available(good as GoodType) || 0
			if (have < qty) needs[good] = qty - have
		}
		return needs
	}

	@memoize
	get isReady(): boolean {
		return Object.keys(this.remainingNeeds).length === 0 && !this.destroyed
	}

	get workingGoodsRelations(): GoodsRelations {
		// Demand construction materials
		if (this.destroyed) return {}

		return Object.fromEntries(
			Object.keys(this.remainingNeeds)
				.filter((goodType) => this.storage.hasRoom(goodType as GoodType))
				.map((goodType) => [goodType as GoodType, { advertisement: 'demand', priority: '2-use' }]),
		)
	}
}
