import { document, latch } from '@pounce/core'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const goodMultiSelectCalls: Array<Record<string, unknown>> = []

vi.mock('@pounce', () => ({
	Button: (props: { onClick?: () => void; children?: any; class?: string }) => (
		<button onClick={props.onClick} class={props.class}>
			{props.children}
		</button>
	),
	Stars: () => <div data-testid="stars" />,
}))

vi.mock('@app/lib/css', () => ({
	css: () => '',
}))

vi.mock('engine-pixi/assets/visual-content', () => ({
	goods: {
		wood: { sprites: ['wood-sprite'] },
		stone: { sprites: ['stone-sprite'] },
		food: { sprites: ['food-sprite'] },
	},
}))

vi.mock('../PropertyGridRow', () => ({
	default: (props: { label?: string; children?: any }) => (
		<div class="property-grid-row">
			<div class="property-grid-row__label">{props.label ?? ''}</div>
			<div class="property-grid-row__value">{props.children}</div>
		</div>
	),
}))

vi.mock('./GoodMultiSelect', () => ({
	default: (props: {
		value: string[]
		availableGoods: string[]
		onAdd: (good: string) => void
		onRemove: (good: string) => void
		children?: any
	}) => {
		goodMultiSelectCalls.push(props)
		return (
			<div class="good-multi-select-mock">
				<div class="value">{props.value.join(',')}</div>
				<div class="available">{props.availableGoods.join(',')}</div>
				<div class="fallback">{props.children}</div>
				<button
					class="mock-add"
					onClick={() => {
						const next = props.availableGoods[0]
						if (next) props.onAdd(next)
					}}
				>
					add
				</button>
				<button
					class="mock-remove"
					onClick={() => {
						const current = props.value[0]
						if (current) props.onRemove(current)
					}}
				>
					remove
				</button>
			</div>
		)
	},
}))

vi.mock('./SpecificStorageConfiguration', () => ({
	default: (props: { action: unknown; configuration: unknown }) => (
		<div
			data-testid="specific-storage-config"
			data-has-action={String(Boolean(props.action))}
			data-has-configuration={String(Boolean(props.configuration))}
		/>
	),
}))

vi.mock('ssh/storage/slotted-storage', () => ({
	SlottedStorage: class SlottedStorage {
		maxQuantityPerSlot = 10
	},
}))

vi.mock('ssh/storage/specific-storage', () => ({
	SpecificStorage: class SpecificStorage {
		constructor(public readonly maxAmounts: Record<string, number>) {}
	},
}))

let StorageConfiguration: typeof import('./StorageConfiguration').default
let SlottedStorage: typeof import('ssh/storage/slotted-storage').SlottedStorage
let SpecificStorage: typeof import('ssh/storage/specific-storage').SpecificStorage

describe('StorageConfiguration', () => {
	let container: HTMLElement
	let stop: (() => void) | undefined

	beforeAll(async () => {
		;({ default: StorageConfiguration } = await import('./StorageConfiguration'))
		;({ SlottedStorage } = await import('ssh/storage/slotted-storage'))
		;({ SpecificStorage } = await import('ssh/storage/specific-storage'))
	})

	beforeEach(() => {
		container = document.createElement('div')
		document.body.appendChild(container)
		goodMultiSelectCalls.length = 0
	})

	afterEach(() => {
		stop?.()
		stop = undefined
		container.remove()
		document.body.innerHTML = ''
	})

	it('shows the slotted placeholder for slotted storage', () => {
		const content = {
			storage: new SlottedStorage(2, 10),
			storageMode: 'all-but',
			storageExceptions: [],
			storageBuffers: {},
			storageConfiguration: { buffers: {} },
		}

		stop = latch(
			container,
			<table>
				<tbody>
					<StorageConfiguration content={content as never} game={{} as never} />
				</tbody>
			</table>
		)

		expect(container.textContent).toContain('TODO: Slotted Storage Configuration')
	})

	it('toggles acceptance mode and mutates exception lists for generic storage', () => {
		const content = {
			storage: {},
			storageMode: 'all-but' as 'all-but' | 'only',
			storageExceptions: ['wood'],
			storageBuffers: {},
			storageConfiguration: { buffers: {} },
		}

		stop = latch(
			container,
			<table>
				<tbody>
					<StorageConfiguration content={content as never} game={{} as never} />
				</tbody>
			</table>
		)

		expect(container.textContent).toContain('Acceptance')
		expect(container.textContent).toContain('Store all but...')
		expect(container.textContent).toContain('Buffers')

		const modeButton = Array.from(container.querySelectorAll('button')).find((button) =>
			button.textContent?.includes('Store all but')
		) as HTMLButtonElement
		modeButton.click()
		expect(content.storageMode).toBe('only')

		const addButtons = Array.from(container.querySelectorAll('.mock-add')) as HTMLButtonElement[]
		addButtons[0].click()
		expect(content.storageExceptions).toContain('stone')

		const removeButtons = Array.from(
			container.querySelectorAll('.mock-remove')
		) as HTMLButtonElement[]
		removeButtons[0].click()
		expect(content.storageExceptions).not.toContain('wood')
	})

	it('delegates to SpecificStorageConfiguration for specific storage', () => {
		const content = {
			storage: new SpecificStorage({ wood: 50 }),
			action: { goods: { wood: 50 } },
			storageMode: 'all-but',
			storageExceptions: [],
			storageBuffers: {},
			storageConfiguration: { buffers: { wood: 10 } },
		}

		stop = latch(
			container,
			<table>
				<tbody>
					<StorageConfiguration content={content as never} game={{} as never} />
				</tbody>
			</table>
		)

		expect(container.querySelector('[data-testid="specific-storage-config"]')).not.toBeNull()
		expect(container.textContent).not.toContain('Acceptance')
	})
})
