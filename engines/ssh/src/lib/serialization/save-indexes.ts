import type { ZoneDefinition } from 'ssh/board/zone'
import type { FreightLineDefinition } from 'ssh/freight/freight-line'
import type { HivePlan } from 'ssh/hive-plan'
import type { Character } from 'ssh/population/character'
import type { Vehicle } from 'ssh/population/vehicle/entity'
import { IndexStore } from './index-store'

/**
 * Central index stores for one save/load pass — the "central store" shared by
 * every serialize/deserialize helper so all cross-references use a single index
 * space per entity type.
 */
export interface SaveIndexes {
	readonly freightLines: IndexStore<FreightLineDefinition>
	readonly characters: IndexStore<Character>
	readonly vehicles: IndexStore<Vehicle>
	readonly customZones: IndexStore<ZoneDefinition>
	readonly hivePlans: IndexStore<HivePlan>
}

/** Live ordered collections a save pass builds its indexes from. */
export interface SaveIndexSources {
	freightLines: Iterable<FreightLineDefinition>
	characters: Iterable<Character>
	vehicles: Iterable<Vehicle>
	customZones: Iterable<ZoneDefinition>
	hivePlans: Iterable<HivePlan>
}

/**
 * Build the central stores from the live ordered collections (save side).
 * Order is what gives each object its serialization number, so callers must
 * iterate the same collections in the same order they will be written/read.
 */
export function buildSaveIndexes(sources: SaveIndexSources): SaveIndexes {
	return {
		freightLines: IndexStore.fromOrdered([...sources.freightLines]),
		characters: IndexStore.fromOrdered([...sources.characters]),
		vehicles: IndexStore.fromOrdered([...sources.vehicles]),
		customZones: IndexStore.fromOrdered([...sources.customZones]),
		hivePlans: IndexStore.fromOrdered([...sources.hivePlans]),
	}
}

/**
 * An empty index set, populated incrementally during load. Useful when objects
 * are created and cross-referenced in an interleaved order rather than two-pass.
 */
export function emptySaveIndexes(): SaveIndexes {
	return {
		freightLines: new IndexStore<FreightLineDefinition>(),
		characters: new IndexStore<Character>(),
		vehicles: new IndexStore<Vehicle>(),
		customZones: new IndexStore<ZoneDefinition>(),
		hivePlans: new IndexStore<HivePlan>(),
	}
}
