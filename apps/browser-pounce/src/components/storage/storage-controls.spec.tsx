import { document, latch } from '@pounce/core'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@pounce', () => ({
	Button: (props: { onClick?: () => void; title?: string; class?: string; children?: any }) => (
		<button onClick={props.onClick} title={props.title} class={props.class}>
			{props.children}
		</button>
	),
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

vi.mock('../EntityBadge', () => ({
	default: (props: { text?: string }) => <span data-testid="entity-badge">{props.text ?? ''}</span>,
}))

let AddGoodButton: typeof import('./AddGoodButton').default
let GoodMultiSelect: typeof import('./GoodMultiSelect').default

describe('storage controls', () => {
	let container: HTMLElement
	let stop: (() => void) | undefined

	beforeAll(async () => {
		;({ default: AddGoodButton } = await import('./AddGoodButton'))
		;({ default: GoodMultiSelect } = await import('./GoodMultiSelect'))
	})

	beforeEach(() => {
		container = document.createElement('div')
		document.body.appendChild(container)
	})

	afterEach(() => {
		stop?.()
		stop = undefined
		container.remove()
		document.body.innerHTML = ''
	})

	it('AddGoodButton opens the menu and selects a good', () => {
		const onSelect = vi.fn<(good: string) => void>()

		stop = latch(
			container,
			<AddGoodButton availableGoods={['wood', 'stone']} game={{} as never} onSelect={onSelect}>
				Add
			</AddGoodButton>
		)

		const wrapper = container.querySelector('.add-good-wrapper') as HTMLDivElement
		wrapper.getBoundingClientRect = () => ({
			x: 10,
			y: 15,
			width: 40,
			height: 20,
			top: 15,
			right: 50,
			bottom: 35,
			left: 10,
			toJSON: () => '',
		})

		const trigger = container.querySelector('button') as HTMLButtonElement
		trigger.click()

		expect(container.textContent).toContain('wood')
		expect(container.textContent).toContain('stone')

		const items = Array.from(container.querySelectorAll('.menu-item')) as HTMLDivElement[]
		items[0].click()

		expect(onSelect).toHaveBeenCalledWith('wood')
		expect(container.querySelector('.floating-menu-overlay')).toBeNull()
	})

	it('AddGoodButton shows an empty message when no goods are available', () => {
		stop = latch(
			container,
			<AddGoodButton availableGoods={[]} game={{} as never} onSelect={() => undefined} />
		)

		const wrapper = container.querySelector('.add-good-wrapper') as HTMLDivElement
		wrapper.getBoundingClientRect = () => ({
			x: 0,
			y: 0,
			width: 20,
			height: 20,
			top: 0,
			right: 20,
			bottom: 20,
			left: 0,
			toJSON: () => '',
		})

		const trigger = container.querySelector('button') as HTMLButtonElement
		trigger.click()

		expect(container.textContent).toContain('No goods available')
	})

	it('GoodMultiSelect renders the empty state and add label', () => {
		stop = latch(
			container,
			<GoodMultiSelect
				value={[]}
				availableGoods={['wood']}
				game={{} as never}
				addLabel="Add Buffer"
				onAdd={() => undefined}
				onRemove={() => undefined}
			>
				No items selected
			</GoodMultiSelect>
		)

		expect(container.textContent).toContain('No items selected')
		expect(container.textContent).toContain('Add Buffer')
	})

	it('GoodMultiSelect remove action calls onRemove and onUpdate', () => {
		const onRemove = vi.fn<(good: string) => void>()
		const onUpdate = vi.fn<(value: string[]) => void>()

		stop = latch(
			container,
			<GoodMultiSelect
				value={['wood', 'stone']}
				availableGoods={['food']}
				game={{} as never}
				onAdd={() => undefined}
				onRemove={onRemove}
				onUpdate={onUpdate}
			/>
		)

		expect(container.textContent).toContain('wood')
		expect(container.textContent).toContain('stone')

		const removeButtons = Array.from(
			container.querySelectorAll('.remove-btn')
		) as HTMLButtonElement[]
		removeButtons[0].click()

		expect(onRemove).toHaveBeenCalledWith('wood')
		expect(onUpdate).toHaveBeenCalledWith(['stone'])
	})
})
