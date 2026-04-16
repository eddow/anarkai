import type { TrackedMovement } from 'ssh/hive/hive'
import { rebindConveyMovementRows } from 'ssh/npcs/context/convey'
import { describe, expect, it, vi } from 'vitest'

describe('rebindConveyMovementRows', () => {
	it('replaces a stale movement reference with the canonical hive entry', () => {
		const ref = {}
		const canonical = { ref } as TrackedMovement
		const zombie = { ref } as TrackedMovement
		const getCanonicalMovement = vi.fn(() => canonical)
		const noteMovementLifecycle = vi.fn()
		const hive = { getCanonicalMovement, noteMovementLifecycle }
		zombie.provider = { hive } as TrackedMovement['provider']

		const row = { movement: zombie, hop: { q: 0, r: 0 }, from: { q: 0, r: 0 } }
		expect(rebindConveyMovementRows([row])).toBe(true)
		expect(row.movement).toBe(canonical)
		expect(getCanonicalMovement).toHaveBeenCalledWith(zombie)
		expect(noteMovementLifecycle).toHaveBeenCalledWith(canonical, 'convey.rebind-to-canonical')
	})

	it('returns false when the movement ref is no longer active', () => {
		const zombie = { ref: {} } as TrackedMovement
		const getCanonicalMovement = vi.fn(() => undefined)
		const hive = { getCanonicalMovement, noteMovementLifecycle: vi.fn() }
		zombie.provider = { hive } as TrackedMovement['provider']

		const row = { movement: zombie }
		expect(rebindConveyMovementRows([row])).toBe(false)
		expect(row.movement).toBe(zombie)
	})
})
