import { MoveToStep } from 'ssh/npcs/steps'
import type { Position } from 'ssh/utils/position'
import { describe, expect, it } from 'vitest'

describe('AEvolutionStep zero delta', () => {
	it('does not evolve lerp steps when paused', () => {
		let position: Position = { q: 0, r: 0 }
		let writes = 0
		const who: { position: Position } = {
			get position() {
				return position
			},
			set position(next: Position) {
				writes++
				position = next
			},
		}
		const step = new MoveToStep(1, who, { q: 1, r: 0 })

		expect(step.tick(0)).toBeUndefined()
		expect(step.evolution).toBe(0)
		expect(writes).toBe(0)
		expect(position).toEqual({ q: 0, r: 0 })

		expect(step.tick(0.5)).toBeUndefined()
		expect(step.evolution).toBe(0.5)
		expect(writes).toBe(1)
		expect(position).toEqual({ q: 0.5, r: 0 })
	})
})
