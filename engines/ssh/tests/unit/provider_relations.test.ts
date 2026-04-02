import { StorageAlveolus } from 'ssh/hive/storage'
import { TransitAlveolus } from 'ssh/hive/transit'
import { SpecificStorage } from 'ssh/storage/specific-storage'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('npc-script', () => ({
	jsIsaTypes: {},
	jsOperators: {
		'==': (left: unknown, right: unknown) => left === right,
		'-': (left: number, right: number) => left - right,
		'+': (left: number, right: number) => left + right,
		'*': (left: number, right: number) => left * right,
		'/': (left: number, right: number) => left / right,
	},
	NpcScript: class {},
	ScriptExecutor: class {},
}))

describe('Provider relations', () => {
	afterEach(() => {
		// no-op, placeholder to mirror suite style
	})

	it('storage stops advertising provide once its only good is reserved', async () => {
		const storage = Object.create(StorageAlveolus.prototype) as StorageAlveolus
		storage.storage = new SpecificStorage({ wood: 4 })
		storage.storage.addGood('wood', 1)
		Object.defineProperty(storage, 'working', { value: true })
		Object.defineProperty(storage, 'buffers', { value: new Map() })

		expect(storage.goodsRelations).toMatchObject({
			wood: { advertisement: 'provide', priority: '0-store' },
		})

		const reservation = storage.storage.reserve({ wood: 1 }, 'test.provider-reserved')
		try {
			expect(storage.storage.available('wood')).toBe(0)
			expect(storage.goodsRelations.wood).toBeUndefined()
		} finally {
			reservation.cancel()
		}
	})

	it('transit alveolus stops advertising provide once its only good is reserved', async () => {
		const stonecutter = Object.create(TransitAlveolus.prototype) as TransitAlveolus
		stonecutter.storage = new SpecificStorage({ stone: 4 })
		stonecutter.storage.addGood('stone', 1)
		Object.defineProperty(stonecutter, 'working', { value: true })

		expect(stonecutter.goodsRelations).toMatchObject({
			stone: { advertisement: 'provide', priority: '2-use' },
		})

		const reservation = stonecutter.storage.reserve({ stone: 1 }, 'test.provider-reserved')
		try {
			expect(stonecutter.storage.available('stone')).toBe(0)
			expect(stonecutter.goodsRelations.stone).toBeUndefined()
		} finally {
			reservation.cancel()
		}
	})
})
