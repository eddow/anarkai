import type { GoodType } from 'ssh/types/base'

/** Axial distance for housing pressure vs capacity when evaluating a candidate residential tile. */
export const residentialHousingDemandRadius = 12

/** Minimum seconds between automatic residential project spawn attempts. */
export const residentialProjectSpawnCooldownSeconds = 2

/** Project id placed on `UnBuiltLand` for the v1 basic dwelling construction consumer. */
export const residentialBasicDwellingProject = 'residential:basic_dwelling' as const

/** Max per-good slots for home inventory UI on completed basic dwellings (v1 placeholder). */
export const basicDwellingHomeStorageMaxAmounts = {
	wood: 8,
	stone: 8,
	planks: 8,
	berries: 8,
	mushrooms: 8,
} as const satisfies Partial<Record<GoodType, number>>
