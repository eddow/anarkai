import { document, latch } from '@sursaut/core'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@app/ui/anarkai', () => ({
	Button: (props: {
		onClick?: () => void
		title?: string
		class?: string
		children?: JSX.Children
		disabled?: boolean
		icon?: string | JSX.Element
		ariaLabel?: string
		'el:title'?: string
		'el:class'?: string
	}) => (
		<button
			type="button"
			onClick={props.onClick}
			title={props.title ?? props['el:title']}
			class={props.class ?? props['el:class']}
			disabled={props.disabled}
			aria-label={props.ariaLabel}
		>
			<>
				{props.icon ? (
					typeof props.icon === 'string' ? (
						<span data-testid="btn-icon">{props.icon}</span>
					) : (
						<span data-testid="btn-icon">{props.icon}</span>
					)
				) : null}
				{props.children}
			</>
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

let GoodPickerButton: typeof import('../GoodPickerButton').default
let GoodMultiSelect: typeof import('./GoodMultiSelect').default

describe('storage controls', () => {
	let container: HTMLElement
	let stop: (() => void) | undefined

	beforeAll(async () => {
		;({ default: GoodPickerButton } = await import('../GoodPickerButton'))
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

	it('GoodPickerButton opens the menu and selects a good', () => {
		const onSelect = vi.fn<(good: string) => void>()

		stop = latch(
			container,
			<GoodPickerButton availableGoods={['wood', 'stone']} game={{} as never} onSelect={onSelect} />
		)

		const trigger = container.querySelector('.combo-picker button') as HTMLButtonElement
		trigger.click()

		expect(container.textContent).toContain('wood')
		expect(container.textContent).toContain('stone')

		const items = Array.from(container.querySelectorAll('.menu-item')) as HTMLDivElement[]
		items[0].click()

		expect(onSelect).toHaveBeenCalledWith('wood')
		expect(container.querySelector('.combo-picker__backdrop')).toBeNull()
	})

	it('GoodPickerButton shows an empty message when no goods are available', () => {
		stop = latch(
			container,
			<GoodPickerButton availableGoods={[]} game={{} as never} onSelect={() => undefined} />
		)

		const trigger = container.querySelector('.combo-picker button') as HTMLButtonElement
		trigger.click()

		expect(container.textContent).toContain('No goods available')
	})

	it('GoodMultiSelect renders the empty state and add control', () => {
		stop = latch(
			container,
			<GoodMultiSelect
				value={[]}
				availableGoods={['wood']}
				game={{} as never}
				addTitle="Add Buffer"
				onAdd={() => undefined}
				onRemove={() => undefined}
			>
				No items selected
			</GoodMultiSelect>
		)

		expect(container.textContent).toContain('No items selected')
		expect(container.querySelector('button[title="Add Buffer"]')).not.toBeNull()
	})

	it('GoodMultiSelect remove action calls onRemove and onUpdate', () => {
		const onRemove = vi.fn<(good: string) => void>()
		const onUpdate = vi.fn<(value: string[]) => void>()

		stop = latch(
			container,
			<GoodMultiSelect
				value={['wood', 'stone']}
				availableGoods={['berries']}
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
