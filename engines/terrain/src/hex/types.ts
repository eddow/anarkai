export type Sextuplet<T> = [T, T, T, T, T, T]

export type AxialKey = string
export const AxialKey = 'string'
export interface AxialCoord {
	q: number
	r: number
}
export interface WorldCoord {
	x: number
	y: number
}
export interface Axial extends AxialCoord {
	key: AxialKey
}
export type AxialRef = AxialKey | AxialCoord | Axial

/** null = on center, 0-5 = on edge */
export type AxialDirection = null | 0 | 1 | 2 | 3 | 4 | 5

export type Rotation = (c: AxialCoord) => AxialCoord
