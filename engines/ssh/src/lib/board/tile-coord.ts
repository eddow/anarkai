import { type AxialCoord, isInteger } from 'ssh/utils'

export function isTileCoord(coord: AxialCoord | undefined): boolean {
	return !!coord && isInteger(coord.q) && isInteger(coord.r)
}
