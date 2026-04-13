import { cleanupFailedConveyMovement } from 'ssh/npcs/context/convey-cleanup'
import { describe, expect, it, vi } from 'vitest'

describe('Convey cleanup', () => {
	it('drops a loose good and closes allocations when preparation fails after pickup', () => {
		const addLooseGood = vi.fn()
		const sourceCancel = vi.fn()
		const targetCancel = vi.fn()
		const abort = vi.fn()
		const hive = {
			noteMovementLifecycle: vi.fn(),
			movementLifecycleIncludes: vi.fn(() => false),
			describeMovementMineContext: vi.fn(() => 'context'),
			assertMovementMine: vi.fn(),
			cancelMovementSource: vi.fn(),
		}

		const character = {
			game: {
				hex: {
					looseGoods: {
						add: addLooseGood,
					},
				},
			},
		}

		const movement = {
			goodType: 'wood',
			claimed: false,
			from: { q: 0, r: 0 },
			allocations: {
				source: { cancel: sourceCancel },
				target: { cancel: targetCancel },
			},
			provider: { hive },
			abort,
		}

		cleanupFailedConveyMovement(character as never, {
			movement: movement as never,
			from: { q: 0, r: 0 },
			sourceFulfilled: true,
		})

		expect(hive.cancelMovementSource).toHaveBeenCalledTimes(1)
		expect(targetCancel).toHaveBeenCalledTimes(1)
		expect(addLooseGood).toHaveBeenCalledWith({ q: 0, r: 0 }, 'wood')
		expect(abort).toHaveBeenCalledTimes(1)
	})

	it('removes the transient moving good instead of dropping another loose good', () => {
		const addLooseGood = vi.fn()
		const remove = vi.fn()
		const sourceCancel = vi.fn()
		const targetCancel = vi.fn()
		const abort = vi.fn()
		const hive = {
			noteMovementLifecycle: vi.fn(),
			movementLifecycleIncludes: vi.fn(() => false),
			describeMovementMineContext: vi.fn(() => 'context'),
			assertMovementMine: vi.fn(),
			cancelMovementSource: vi.fn(),
		}

		const character = {
			game: {
				hex: {
					looseGoods: {
						add: addLooseGood,
					},
				},
			},
		}

		const movement = {
			goodType: 'wood',
			claimed: false,
			from: { q: 0, r: 0 },
			allocations: {
				source: { cancel: sourceCancel },
				target: { cancel: targetCancel },
			},
			provider: { hive },
			abort,
		}

		cleanupFailedConveyMovement(character as never, {
			movement: movement as never,
			from: { q: 0, r: 0 },
			moving: { isRemoved: false, remove } as never,
			sourceFulfilled: true,
		})

		expect(hive.cancelMovementSource).toHaveBeenCalledTimes(1)
		expect(targetCancel).toHaveBeenCalledTimes(1)
		expect(remove).toHaveBeenCalledTimes(1)
		expect(addLooseGood).not.toHaveBeenCalled()
		expect(abort).toHaveBeenCalledTimes(1)
	})
})
