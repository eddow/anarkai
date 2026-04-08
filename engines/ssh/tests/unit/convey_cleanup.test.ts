import { cleanupFailedConveyMovement } from 'ssh/npcs/context/convey-cleanup'
import { describe, expect, it, vi } from 'vitest'

describe('Convey cleanup', () => {
	it('drops a loose good and closes allocations when preparation fails after pickup', () => {
		const addLooseGood = vi.fn()
		const sourceCancel = vi.fn()
		const targetCancel = vi.fn()
		const finish = vi.fn()

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
			allocations: {
				source: { cancel: sourceCancel },
				target: { cancel: targetCancel },
			},
			finish,
		}

		cleanupFailedConveyMovement(character as never, {
			mg: movement as never,
			from: { q: 0, r: 0 },
			sourceFulfilled: true,
		})

		expect(sourceCancel).toHaveBeenCalledTimes(1)
		expect(targetCancel).toHaveBeenCalledTimes(1)
		expect(addLooseGood).toHaveBeenCalledWith({ q: 0, r: 0 }, 'wood')
		expect(finish).toHaveBeenCalledTimes(1)
	})

	it('removes the transient moving good instead of dropping another loose good', () => {
		const addLooseGood = vi.fn()
		const remove = vi.fn()
		const sourceCancel = vi.fn()
		const targetCancel = vi.fn()
		const finish = vi.fn()

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
			allocations: {
				source: { cancel: sourceCancel },
				target: { cancel: targetCancel },
			},
			finish,
		}

		cleanupFailedConveyMovement(character as never, {
			mg: movement as never,
			from: { q: 0, r: 0 },
			moving: { isRemoved: false, remove } as never,
			sourceFulfilled: true,
		})

		expect(sourceCancel).toHaveBeenCalledTimes(1)
		expect(targetCancel).toHaveBeenCalledTimes(1)
		expect(remove).toHaveBeenCalledTimes(1)
		expect(addLooseGood).not.toHaveBeenCalled()
		expect(finish).toHaveBeenCalledTimes(1)
	})
})
