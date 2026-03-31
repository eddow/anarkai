import {
	type Advertisement,
	AdvertisementManager,
	type ExchangePriority,
	type GoodsRelations,
	type StorageBase,
} from 'ssh/utils/advertisement'
import { describe, expect, it } from 'vitest'

type TestAdvertiser = StorageBase & {
	name: string
	canGive(goodType: 'wood', priority: ExchangePriority): boolean
	canTake(goodType: 'wood', priority: ExchangePriority): boolean
}

class TestManager extends AdvertisementManager<TestAdvertiser> {
	readonly generalStorages: TestAdvertiser[] = []
	readonly movements: Array<{ goodType: 'wood'; giver: string; taker: string }> = []
	readonly selections: Array<{
		advertisement: Advertisement
		giver: string
		storages: string[]
		goodType: 'wood'
	}> = []

	createMovement(_goodType: 'wood', _giver: TestAdvertiser, _taker: TestAdvertiser): void {}

	selectMovement(
		advertisement: Advertisement,
		giver: TestAdvertiser,
		storages: TestAdvertiser[],
		goodType: 'wood',
		sourcePriority: ExchangePriority,
		targetPriority: ExchangePriority,
		onCreated?: (storage: TestAdvertiser) => void
	): TestAdvertiser {
		const selected = storages[0]

		// Simulate the same validation logic as Hive.selectMovement
		const isDemand = advertisement === 'demand'
		const targetStorage = isDemand ? giver : selected
		const providerStorage = isDemand ? selected : giver

		// Check provider can give the goods
		if ('canGive' in providerStorage && typeof providerStorage.canGive === 'function') {
			const providerCanGive = providerStorage.canGive(goodType, sourcePriority)
			if (!providerCanGive) {
				throw new Error(
					`Provider ${providerStorage.name} cannot give ${goodType} at priority ${sourcePriority}`
				)
			}
		}

		// Check target can take the goods
		if ('canTake' in targetStorage && typeof targetStorage.canTake === 'function') {
			const targetCanTake = targetStorage.canTake(goodType, targetPriority)
			if (!targetCanTake) {
				throw new Error(
					`Target ${targetStorage.name} cannot take ${goodType} at priority ${targetPriority}`
				)
			}
		}

		this.selections.push({
			advertisement,
			giver: giver.name,
			storages: storages.map((storage) => storage.name),
			goodType,
		})
		this.movements.push({
			goodType,
			giver: advertisement === 'provide' ? giver.name : selected.name,
			taker: advertisement === 'provide' ? selected.name : giver.name,
		})
		onCreated?.(selected)
		return selected
	}
}

const mkStorage = (name: string): TestAdvertiser => ({
	name,
	canGive: (_goodType, priority) => Number(priority[0]) > 0, // Storage units respect priority for giving
	canTake: (_goodType, _priority) => true, // Storage units can always take
})

// For tests that need non-storage advertisers, create ones that only have canGive or canTake
const mkProvider = (name: string): TestAdvertiser => ({
	name,
	canGive: (_goodType, priority) => Number(priority[0]) > 0,
	canTake: (_goodType, _priority) => false, // Producers can't take
})

const mkDemander = (name: string): TestAdvertiser => ({
	name,
	canGive: (_goodType, _priority) => false, // Demanders can't give
	canTake: (_goodType, _priority) => true, // Demanders can take
})

describe('Advertisement matching', () => {
	it('matches opposite advertisements when demand arrives after provide', async () => {
		const manager = new TestManager()
		const provider = mkProvider('gather')
		const demander = mkDemander('sawmill')

		const provide: GoodsRelations = {
			wood: { advertisement: 'provide', priority: '2-use' },
		}
		const demand: GoodsRelations = {
			wood: { advertisement: 'demand', priority: '2-use' },
		}

		manager.advertise(provider, provide)
		expect(manager.advertisements.wood?.advertisement).toBe('provide')

		manager.advertise(demander, demand)

		// Wait a bit for the async callback to complete
		await new Promise((resolve) => setTimeout(resolve, 10))

		expect(manager.movements).toEqual([{ goodType: 'wood', giver: 'gather', taker: 'sawmill' }])
		expect(manager.advertisements.wood).toBeUndefined()
	})

	it('matches opposite advertisements when provide arrives after demand', () => {
		const manager = new TestManager()
		const provider = mkProvider('gather')
		const demander = mkDemander('sawmill')

		const provide: GoodsRelations = {
			wood: { advertisement: 'provide', priority: '2-use' },
		}
		const demand: GoodsRelations = {
			wood: { advertisement: 'demand', priority: '2-use' },
		}

		manager.advertise(demander, demand)
		expect(manager.advertisements.wood?.advertisement).toBe('demand')

		manager.advertise(provider, provide)

		expect(manager.movements).toEqual([{ goodType: 'wood', giver: 'gather', taker: 'sawmill' }])
		expect(manager.advertisements.wood).toBeUndefined()
	})

	it('prefers 2-use over 1-buffer when both are available', () => {
		const manager = new TestManager()
		const provider = mkProvider('gather')
		const lowPriorityDemander = mkDemander('storage')
		const highPriorityDemander = mkDemander('build')

		const provide: GoodsRelations = {
			wood: { advertisement: 'provide', priority: '1-buffer' },
		}
		const lowDemand: GoodsRelations = {
			wood: { advertisement: 'demand', priority: '1-buffer' },
		}
		const highDemand: GoodsRelations = {
			wood: { advertisement: 'demand', priority: '2-use' },
		}

		// Set up low priority demand first
		manager.advertise(lowPriorityDemander, lowDemand)
		expect(manager.advertisements.wood?.advertisement).toBe('demand')

		// Then add high priority demand
		manager.advertise(highPriorityDemander, highDemand)

		// When provider arrives, it should match with high priority (2-use) first
		manager.advertise(provider, provide)

		expect(manager.movements).toEqual([{ goodType: 'wood', giver: 'gather', taker: 'build' }])
		// Low priority demand should still be available
		expect(manager.advertisements.wood?.advertisement).toBe('demand')
	})

	it('allows 2-use provider to match with empty storage through general storage fallback', async () => {
		const manager = new TestManager()
		const provider = mkProvider('sawmill')
		const storage = mkStorage('storage')

		// Add storage to generalStorages list
		manager.generalStorages.push(storage)

		// Storage is empty and can take goods
		storage.canTake = (_goodType, _priority) => true

		const provide: GoodsRelations = {
			wood: { advertisement: 'provide', priority: '2-use' },
		}

		// Provider advertises high priority - should match with storage through general storage fallback
		manager.advertise(provider, provide)

		// Wait a bit for the async callback to complete
		await new Promise((resolve) => setTimeout(resolve, 10))

		expect(manager.movements).toEqual([{ goodType: 'wood', giver: 'sawmill', taker: 'storage' }])
	})

	it('prevents 0-store to 0-store storage-to-storage movements', () => {
		const manager = new TestManager()
		const storage1 = mkStorage('storage1')
		const storage2 = mkStorage('storage2')

		// Make them look like storage units by adding canGive/canTake methods that respect priority
		storage1.canGive = (_goodType, priority) => Number(priority[0]) > 0
		storage2.canTake = (_goodType, _priority) => true

		const provide: GoodsRelations = {
			wood: { advertisement: 'provide', priority: '0-store' },
		}
		const demand: GoodsRelations = {
			wood: { advertisement: 'demand', priority: '0-store' },
		}

		manager.advertise(storage1, provide)
		manager.advertise(storage2, demand)

		// Should not create movement for 0-store to 0-store
		expect(manager.movements).toEqual([])
		expect(manager.advertisements.wood).toBeDefined()
	})

	it('allows 0-store provider to match with 1-buffer demander', () => {
		const manager = new TestManager()
		const provider = mkStorage('storage')
		const demander = mkDemander('build')

		provider.canGive = (_goodType, _priority) => true
		demander.canTake = (_goodType, _priority) => true

		const provide: GoodsRelations = {
			wood: { advertisement: 'provide', priority: '0-store' },
		}
		const demand: GoodsRelations = {
			wood: { advertisement: 'demand', priority: '1-buffer' },
		}

		manager.advertise(provider, provide)
		manager.advertise(demander, demand)

		// Should create movement since demander has priority > 0
		expect(manager.movements).toEqual([{ goodType: 'wood', giver: 'storage', taker: 'build' }])
		expect(manager.advertisements.wood).toBeUndefined()
	})

	it('prevents 0-store provider from using general storage fallback to other storage', () => {
		const manager = new TestManager()
		const provider = mkStorage('storage1')
		const targetStorage = mkStorage('storage2')

		// Add targetStorage to generalStorages to test fallback path
		manager.generalStorages.push(targetStorage)

		provider.canGive = (_goodType, _priority) => true
		targetStorage.canTake = (_goodType, _priority) => true

		const provide: GoodsRelations = {
			wood: { advertisement: 'provide', priority: '0-store' },
		}

		manager.advertise(provider, provide)

		// Should not create movement through general storage fallback
		expect(manager.movements).toEqual([])
	})
})
