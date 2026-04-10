import type { AxialCoord } from '../hex/types'
import type { TerrainConfig } from '../types'
import { riverRng } from './rng'

/**
 * Deterministic spring test per tile (hexaboard-style).
 * Parity mask prevents adjacent springs while keeping the candidate lattice dense
 * enough for medium boards after the macro-elevation terrain pass.
 */
export function isSpring(
	coord: AxialCoord,
	height: number,
	seed: number,
	config: TerrainConfig
): boolean {
	if (height < config.seaLevel) return false
	if ((coord.q + coord.r) & 1) return false

	const span = config.hydrologyLandCeiling - config.seaLevel
	if (span <= 0) return false

	const ratio = (height - config.seaLevel) / span
	if (ratio <= 0) return false

	const probability = config.hydrologySourcesPerTile * Math.min(1, ratio)
	return riverRng(seed, coord.q, coord.r)() < probability
}
