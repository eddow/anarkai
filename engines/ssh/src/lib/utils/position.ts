import { scope } from 'arktype'
import { immutables } from 'mutts'
import {
	type AxialCoord,
	type AxialKey,
	type AxialRef,
	axial,
	cartesian,
	fromCartesian,
	type WorldCoord,
} from './axial'
import { epsilon, tileSize } from './varied'

function roughly(x: number) {
	return Math.round(x / epsilon) * epsilon
}

// ============================================================
// Position Types Module
// ============================================================
// Defines position-related types that can be imported into other scopes

// Create a scope that includes base game types + position types
export const positionScope = scope({
	AxialCoord: { q: 'number', r: 'number' },
	WorldCoord: { x: 'number', y: 'number' },
	Position: () => positionScope.type('AxialCoord | WorldCoord'),
	'#PositionedObject': { position: () => positionScope.type('Position') },
	Positioned: () => positionScope.type('Position | PositionedObject'),
})

export const positionTypes = positionScope.export()

// Backward compatible exports
export const Position = positionTypes.Position
export const Positioned = positionTypes.Positioned
export type Position = typeof Position.infer
export type Positioned = typeof Positioned.infer

immutables.add((x) => Position.allows(x))

export function isWorldCoord(value: any): value is WorldCoord {
	return typeof value === 'object' && value !== null && 'x' in value && 'y' in value
}

export function isAxialRef(value: any): value is AxialRef {
	return (
		typeof value === 'number' ||
		(typeof value === 'object' && value !== null && 'q' in value && 'r' in value)
	)
}

// Conversion functions
export function toWorldCoord(positioned: Positioned | AxialKey): WorldCoord {
	if (isWorldCoord(positioned)) return positioned
	if (typeof positioned === 'string') return cartesian(positioned, tileSize)
	if (isAxialRef(positioned)) {
		const res = cartesian(positioned, tileSize)
		// DO NOT Object.assign here as it causes reactivity loops if positioned is reactive
		return { ...positioned, ...res } as unknown as WorldCoord
	}
	if (typeof positioned === 'object' && 'position' in positioned && positioned.position) {
		return toWorldCoord(positioned.position)
	}
	throw new Error(`Invalid position: ${positioned}`)
}

export function toAxialCoord(positioned: Positioned): { q: number; r: number } {
	if (isAxialRef(positioned)) {
		return axial.access(positioned)
	}
	if (isWorldCoord(positioned)) {
		const res = fromCartesian(positioned, tileSize)
		// DO NOT Object.assign here as it causes reactivity loops if positioned is reactive
		return { ...positioned, ...res } as unknown as AxialCoord
	}
	if (typeof positioned === 'object' && 'position' in positioned && positioned.position) {
		return toAxialCoord(positioned.position)
	}
	throw new Error(`Invalid position: ${positioned}`)
}

// Position operations
export function positionToString(positioned: Positioned): string {
	const axial = toAxialCoord(positioned)
	if (!axial) return '(Unknown Position)'
	return `<${axial.q}, ${axial.r}, ${-axial.q - axial.r}>`
}

export function axialDistance(a: Positioned, b: Positioned): number {
	const aAxial = toAxialCoord(a)
	const bAxial = toAxialCoord(b)
	if (!aAxial || !bAxial) return Infinity
	return axial.distance(aAxial as AxialCoord, bAxial as AxialCoord)
}

export function positionRoughly(positioned: Positioned): Positioned | undefined {
	if (isWorldCoord(positioned)) {
		return { x: roughly(positioned.x), y: roughly(positioned.y) }
	}
	const axial = toAxialCoord(positioned)
	if (axial) {
		return { q: roughly(axial.q), r: roughly(axial.r) }
	}
	if ('position' in positioned) {
		return positionRoughly(positioned.position)
	}
	return undefined
}

export function positionRoughlyEquals(a: Positioned, b: Positioned): boolean {
	if (isWorldCoord(a) && isWorldCoord(b)) {
		return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) < epsilon
	}
	const aAxial = toAxialCoord(a)
	const bAxial = toAxialCoord(b)
	if (!aAxial || !bAxial) return false
	return Math.abs(aAxial.q - bAxial.q) + Math.abs(aAxial.r - bAxial.r) < epsilon
}

export function positionEquals(a: Positioned, b: Positioned): boolean {
	if (isWorldCoord(a) && isWorldCoord(b)) {
		return a.x === b.x && a.y === b.y
	}
	const aAxial = toAxialCoord(a)
	const bAxial = toAxialCoord(b)
	if (!aAxial || !bAxial) return false
	return aAxial.q === bAxial.q && aAxial.r === bAxial.r
}

export function positionLerp(a: Positioned, b: Positioned, t: number): Positioned | undefined {
	if (isWorldCoord(a) && isWorldCoord(b)) {
		return {
			x: a.x + (b.x - a.x) * t,
			y: a.y + (b.y - a.y) * t,
		}
	}
	const aAxial = toAxialCoord(a)
	const bAxial = toAxialCoord(b)
	if (!aAxial || !bAxial) return undefined
	return {
		q: aAxial.q + (bAxial.q - aAxial.q) * t,
		r: aAxial.r + (bAxial.r - aAxial.r) * t,
	}
}

export function xyDistance(a: Positioned, b: Positioned): number {
	const aWorld = toWorldCoord(a)
	const bWorld = toWorldCoord(b)
	if (!aWorld || !bWorld) return Infinity
	return Math.sqrt((aWorld.x - bWorld.x) ** 2 + (aWorld.y - bWorld.y) ** 2)
}
