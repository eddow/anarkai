import { axial, type AxialCoord, type Positioned } from 'ssh/utils'
import type { Position } from 'ssh/utils/position'

export interface ConveyMovementSnapshot {
	from: AxialCoord
	hop: AxialCoord
	moving: { position: Position }
}

export function getConveyDuration(
	transferTime: number,
	movements: readonly Pick<ConveyMovementSnapshot, 'from' | 'hop'>[]
) {
	return movements.reduce((total, movement) => {
		return total + transferTime * axial.distance(movement.from, movement.hop) * movements.length
	}, 0)
}

export function getConveyVisualMovements(movements: readonly ConveyMovementSnapshot[]): Array<{
	who: { position: Position }
	from: Position
	to: Positioned
}> {
	return movements.map(({ moving, from, hop }) => ({
		who: moving,
		from,
		to: hop,
	}))
}
