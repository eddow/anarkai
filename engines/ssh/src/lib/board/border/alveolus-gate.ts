import { SlottedStorage } from 'ssh/src/lib/storage/slotted-storage'
import { toAxialCoord } from 'ssh/src/lib/utils/position'
import type { Alveolus } from '../content/alveolus'
import { type TileBorder, TileBorderContent } from './border'

// A storage gate placed on a border between two tiles/alveoli.
export class AlveolusGate extends TileBorderContent {
	readonly storage: SlottedStorage

	get alveolusA() {
		return this.border.tile.a.content as Alveolus
	}
	get alveolusB() {
		return this.border.tile.b.content as Alveolus
	}

	get hive() {
		return this.alveolusA!.hive
	}

	readonly debugInfo = {
		type: 'AlveolusGate',
		storage: 'SlottedStorage',
	}

	constructor(readonly border: TileBorder) {
		const axialPos = toAxialCoord(border.position)
		super(border.game, `gate:${axialPos.q},${axialPos.r}`)
		this.storage = new SlottedStorage(2, 1) // 2 slots, max quantity 1 per slot
	}

	attach(): void {
		this.border.content = this
	}

	// Remove the gate if not exactly two alveoli are connected.
	validateOrRemove(): void {
		if (!this.alveolusA || !this.alveolusB) {
			this.border.content = undefined
		}
	}
}
