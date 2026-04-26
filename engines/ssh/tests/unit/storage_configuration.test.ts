import { StorageAlveolus } from 'ssh/hive/storage'
import type { SlottedStorage } from 'ssh/storage/slotted-storage'
import type { SpecificStorage } from 'ssh/storage/specific-storage'
import { describe, expect, it, vi } from 'vitest'

// Mock game-content exports
vi.mock('../../../../assets/game-content', () => ({
	alveoli: {
		storage: { action: { type: 'slotted-storage', capacity: 10, slots: 5 } },
		warehouse: { action: { type: 'specific-storage', goods: { wood: 2, stone: 1 } } },
	},
	goods: { wood: {}, stone: {}, berries: {} },
	terrain: {},
	jobBalance: {
		offload: {
			projectTile: 30,
			alveolusBlocked: 25,
			residentialTile: 21,
			unloadToTile: 8,
			park: 17,
		},
		convey: 3,
		gather: 2.5,
		harvest: { clearing: 2.5, fallbackBase: 0.25, needsBonus: 0.5 },
		transform: 1,
		engineer: { foundation: 3, construct: 2 },
		defragment: 0.9,
	},
	configurations: {
		'slotted-storage': { working: true, generalSlots: 0, goods: {} },
		'specific-storage': { working: true, buffers: {} },
		default: { working: true },
	},
}))

// We need to set the prototype action for StorageAlveolus to work in tests
// since it reads from new.target.prototype
;(StorageAlveolus.prototype as any).action = {
	type: 'slotted-storage',
	capacity: 10,
	slots: 5,
}

class SpecificStorageTestAlveolus extends StorageAlveolus {
	declare action: Ssh.SpecificStorageAction
}

;(SpecificStorageTestAlveolus.prototype as any).action = {
	type: 'specific-storage',
	goods: { wood: 2, stone: 1 },
}

describe('StorageAlveolus Configuration', () => {
	const mockTile = {
		position: { q: 0, r: 0 },
		board: {
			game: {
				random: () => 0.5,
				freightLines: [],
				configurationManager: {
					getNamedConfiguration: () => undefined,
				},
			},
		},
		log: () => {},
	} as any

	const mockHive = {
		working: true,
		needs: {},
		configurations: new Map(),
		movingGoods: new Map(),
		removeAlveolus: vi.fn(),
		hasIncomingMovementFor: vi.fn(() => false),
	} as any

	const withHive = <T extends StorageAlveolus>(alveolus: T): T => {
		;(alveolus as any).hive = mockHive
		return alveolus
	}

	it('should not advertise generic store-anything demand by default', () => {
		const alveolus = withHive(new StorageAlveolus(mockTile))
		alveolus.working = true

		const relations = alveolus.workingGoodsRelations

		expect(relations).toEqual({})
	})

	it('should advertise buffered goods as demand when below configured buffer', () => {
		const alveolus = withHive(new StorageAlveolus(mockTile))
		alveolus.working = true
		alveolus.setSlottedGoodConfiguration('wood', { minSlots: 2, maxSlots: 1 })
		alveolus.setSlottedGoodConfiguration('berries', { minSlots: 1, maxSlots: 0 })

		const relations = alveolus.workingGoodsRelations

		expect(relations['wood']).toMatchObject({
			advertisement: 'demand',
			priority: '1-buffer',
		})
		expect(relations['berries']).toMatchObject({
			advertisement: 'demand',
			priority: '1-buffer',
		})
		expect(relations['stone']).toBeUndefined()
	})

	it('allows buffered goods to satisfy 2-use while still demanding 1-buffer', () => {
		const alveolus = withHive(new StorageAlveolus(mockTile))
		alveolus.working = true
		alveolus.setSlottedGoodConfiguration('wood', { minSlots: 2, maxSlots: 0 })

		alveolus.storage.addGood('wood', 1)

		expect(alveolus.workingGoodsRelations.wood).toMatchObject({
			advertisement: 'demand',
			priority: '1-buffer',
		})
		expect(alveolus.canGive('wood', '0-store')).toBe(false)
		expect(alveolus.canGive('wood', '1-buffer')).toBe(false)
		expect(alveolus.canGive('wood', '2-use')).toBe(true)
	})

	it('keeps demanding until buffered slots are filled to their full quantity capacity', () => {
		const alveolus = withHive(new StorageAlveolus(mockTile))
		alveolus.working = true
		alveolus.setSlottedGoodConfiguration('wood', { minSlots: 2, maxSlots: 1 })

		alveolus.storage.addGood('wood', 11)

		expect((alveolus.storage as SlottedStorage).occupiedSlots('wood')).toBe(2)
		expect(alveolus.workingGoodsRelations.wood).toMatchObject({
			advertisement: 'demand',
			priority: '1-buffer',
		})
		expect(alveolus.canGive('wood', '0-store')).toBe(false)
		expect(alveolus.canGive('wood', '1-buffer')).toBe(false)
		expect(alveolus.canGive('wood', '2-use')).toBe(true)
	})

	it('allows 0-store and 1-buffer gives only from slots above the buffered floor', () => {
		const alveolus = withHive(new StorageAlveolus(mockTile))
		alveolus.working = true
		alveolus.setSlottedGoodConfiguration('wood', { minSlots: 1, maxSlots: 1 })

		alveolus.storage.addGood('wood', 20)

		expect((alveolus.storage as SlottedStorage).occupiedSlots('wood')).toBe(2)
		expect(alveolus.canGive('wood', '0-store')).toBe(true)
		expect(alveolus.canGive('wood', '1-buffer')).toBe(true)
		expect(alveolus.canGive('wood', '2-use')).toBe(true)
	})

	it('caps configured goods by buffered plus allowed slots', () => {
		const alveolus = withHive(new StorageAlveolus(mockTile))
		alveolus.working = true
		alveolus.setSlottedGoodConfiguration('wood', { minSlots: 1, maxSlots: 1 })

		alveolus.storage.addGood('wood', 20)

		expect((alveolus.storage as SlottedStorage).occupiedSlots('wood')).toBe(2)
		expect(alveolus.canTake('wood', '2-use')).toBe(false)
	})

	it('rejects unspecified goods once the general slot pool is full', () => {
		const alveolus = withHive(new StorageAlveolus(mockTile))
		alveolus.working = true
		alveolus.setSlottedGeneralSlots(1)

		alveolus.storage.addGood('stone', 2)

		expect(alveolus.canTake('berries', '2-use')).toBe(false)
		expect(alveolus.workingGoodsRelations.stone).toMatchObject({
			advertisement: 'provide',
			priority: '0-store',
		})
	})

	it('should not report slotted storage canTake when matching room is fully allocated', () => {
		const alveolus = withHive(new StorageAlveolus(mockTile))
		alveolus.working = true

		const storage = alveolus.storage as SlottedStorage
		const initialRoom = storage.hasRoom('wood')
		const inbound = storage.allocate({ wood: initialRoom }, 'test.allocated-slot-room')

		expect(storage.hasRoom('wood')).toBe(0)
		expect(alveolus.canTake('wood', '2-use')).toBe(false)
		expect(() => storage.allocate({ wood: 1 }, 'test.over-allocate-slot-room')).toThrow(
			'Insufficient room to allocate any goods'
		)

		inbound.cancel()

		expect(storage.hasRoom('wood')).toBe(initialRoom)
		expect(alveolus.canTake('wood', '2-use')).toBe(true)
	})

	it('should not report specific storage canTake when capacity is fully allocated', () => {
		const alveolus = withHive(new SpecificStorageTestAlveolus(mockTile))
		alveolus.working = true

		const storage = alveolus.storage as SpecificStorage
		const inbound = storage.allocate({ wood: 2 }, 'test.allocated-specific-room')

		expect(storage.hasRoom('wood')).toBe(0)
		expect(alveolus.canTake('wood', '2-use')).toBe(false)
		expect(() => storage.allocate({ wood: 1 }, 'test.over-allocate-specific-room')).toThrow(
			'Insufficient room to allocate any goods'
		)

		inbound.cancel()

		expect(storage.hasRoom('wood')).toBe(2)
		expect(alveolus.canTake('wood', '2-use')).toBe(true)
	})

	it('keeps specific-storage buffers protected from 1-buffer gives while allowing 2-use', () => {
		const alveolus = withHive(new SpecificStorageTestAlveolus(mockTile))
		alveolus.working = true
		alveolus.storageBuffers = { wood: 1 }

		alveolus.storage.addGood('wood', 1)
		expect(alveolus.canGive('wood', '0-store')).toBe(false)
		expect(alveolus.canGive('wood', '1-buffer')).toBe(false)
		expect(alveolus.canGive('wood', '2-use')).toBe(true)

		alveolus.storage.addGood('wood', 1)
		expect(alveolus.canGive('wood', '0-store')).toBe(true)
		expect(alveolus.canGive('wood', '1-buffer')).toBe(true)
	})
})
