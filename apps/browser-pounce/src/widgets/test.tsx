import { reactive } from 'mutts'
import type { DockviewWidgetProps } from 'pounce-ui/src'
import StorageConfiguration from '../components/storage/StorageConfiguration'
import { SlottedStorage } from '@ssh/lib/game/storage/slotted-storage'
import { SpecificStorage } from '@ssh/lib/game/storage/specific-storage'
import type { StorageAlveolus } from '@ssh/lib/game/hive/storage'
import type { GoodType } from '@ssh/lib/types/base'
import { games } from '@app/lib/globals'

// Mocking storage classes purely for the UI test if real ones aren't fully instantiable without game context.
// However, since we import them, we try to use them or at least mock objects that satisfy the instanceof check if possible.
// If actual instantiation is hard, we can cast objects to StorageAlveolus for the props.

// We will create a mock-like structure.
// Note: We cannot easily 'mock' instanceof checks without the real class.
// Hopefully SlottedStorage/SpecificStorage don't have heavy side effects in constructor.

export default (_props: DockviewWidgetProps) => {
	// Mock Game
	const mockGame: any = {
		// Minimum game interface needed
	}

	// 1. Slotted Storage Mock
	// We need to trick TypeScript and runtime checks if we don't instantiate the real class.
	// But let's assume we can instantiate them or we are running in an env where we can.
	// If not, we might fail. Given the imports exist, we try to use them.

	// Using "as any" to bypass strict constructor requirements for the test widget if needed, 
	// but ideally we should construct them properly.
	// Let's create simple reactive objects that Mimic them for the components needs.
	// The component checks `instanceof SlottedStorage`.
	// We will assume the classes are available.

	// Helper to create a fake Alveolus
	const createAlveolus = (storage: any, buffers: Record<string, number> = {}): StorageAlveolus => reactive({
		storage,
		storageMode: 'all-but',
		storageExceptions: [],
		storageBuffers: buffers
	}) as any

	// We can't easily fetch real instances without a real hive/game probably.
	// So for this test widget, we might just have to rely on the fact that if it builds, it works, 
	// OR we rely on the component using the `isSlotted` derived which does `instanceof`.
	// If we can't create a real `SlottedStorage`, `instanceof` will fail if we just make a plain object.

	// Hack for test widget: create objects that have the prototype of the classes?
	// Or just try to instantiate.

	const slottedStorage = Object.create(SlottedStorage.prototype)
	slottedStorage.maxQuantityPerSlot = 10
	slottedStorage.maxSlots = 5

	const specificStorage = Object.create(SpecificStorage.prototype)
	specificStorage.maxAmounts = { 'wood': 1000, 'stone': 500 }

	return (
		<div style={{ padding: '1rem', height: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
			<h2>Storage Config Test</h2>

			<section>
				<h3>Slotted Storage (Max 10 per slot)</h3>
				<p>1 Star = 1 Slot (10 items)</p>
				<div style={{ border: '1px solid var(--pico-border-color)', padding: '1rem' }}>
					<StorageConfiguration
						game={mockGame}
						content={createAlveolus(slottedStorage, { 'wood': 2 })} // 2 slots of wood
					/>
				</div>
			</section>

			<section>
				<h3>Specific Storage (Wood: 1000, Stone: 500)</h3>
				<p>1 Star = 20%</p>
				<div style={{ border: '1px solid var(--pico-border-color)', padding: '1rem' }}>
					<StorageConfiguration
						game={mockGame}
						content={createAlveolus(specificStorage, { 'wood': 200 })} // 20% of wood => 1 star
					/>
				</div>
			</section>
		</div>
	)
}
