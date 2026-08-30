import { document, latch } from '@sursaut/core'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@app/lib/css', () => ({
	css: () => '',
}))

const activeWorldViewPov = vi.hoisted(() => ({
	viewId: 'primary',
	center: undefined as { q: number; r: number } | undefined,
}))

vi.mock('@app/lib/globals', () => ({
	activeWorldViewPov,
}))

let ComboSearchPicker: typeof import('./ComboSearchPicker').default

describe('ComboSearchPicker', () => {
	let container: HTMLElement
	let stop: (() => void) | undefined

	beforeAll(async () => {
		;({ default: ComboSearchPicker } = await import('./ComboSearchPicker'))
	})

	beforeEach(() => {
		activeWorldViewPov.viewId = 'primary'
		activeWorldViewPov.center = { q: 0, r: 0 }
		container = document.createElement('div')
		document.body.appendChild(container)
	})

	afterEach(() => {
		stop?.()
		stop = undefined
		container.remove()
		document.body.innerHTML = ''
	})

	const openCombo = () => {
		;(container.querySelector('[data-testid="picker-filter"]') as HTMLInputElement).click()
	}

	const itemIds = () =>
		[...document.querySelectorAll('[data-testid="picker-item"]')].map((node) =>
			node.getAttribute('data-item-id')
		)

	it('renders collapsed with the search input and no items', () => {
		stop = latch(
			container,
			<ComboSearchPicker
				testId="picker"
				items={[{ id: 'north', label: 'North Line' }]}
				onSelect={vi.fn()}
			/>
		)

		const input = container.querySelector(
			'[data-testid="picker-filter"]'
		) as HTMLInputElement | null
		expect(input).not.toBeNull()
		expect(input?.getAttribute('aria-expanded')).toBe('false')
		expect(document.querySelectorAll('[data-testid="picker-item"]')).toHaveLength(0)
	})

	it('opens the list on input click', () => {
		stop = latch(
			container,
			<ComboSearchPicker
				testId="picker"
				items={[{ id: 'north', label: 'North Line' }]}
				onSelect={vi.fn()}
			/>
		)

		openCombo()

		expect(itemIds()).toEqual(['north'])
		expect(
			(container.querySelector('[data-testid="picker-filter"]') as HTMLInputElement).getAttribute(
				'aria-expanded'
			)
		).toBe('true')
	})

	it('filters by text without creating a free-text option', () => {
		const onSelect = vi.fn()
		stop = latch(
			container,
			<ComboSearchPicker
				testId="picker"
				items={[
					{ id: 'north-line', label: 'North Line', hint: 'wood route' },
					{ id: 'south-line', label: 'South Line', hint: 'stone route' },
				]}
				onSelect={onSelect}
			/>
		)

		openCombo()

		const filter = container.querySelector('[data-testid="picker-filter"]') as HTMLInputElement
		filter.value = 'stone'
		filter.dispatchEvent(new Event('input', { bubbles: true }))

		expect(itemIds()).toEqual(['south-line'])
		expect(document.body.textContent).not.toContain('stone routewood')

		filter.value = 'brand new line'
		filter.dispatchEvent(new Event('input', { bubbles: true }))
		expect(itemIds()).toEqual([])
		expect(onSelect).not.toHaveBeenCalled()
	})

	it('sorts items by active-view axial distance', () => {
		stop = latch(
			container,
			<ComboSearchPicker
				testId="picker"
				items={[
					{ id: 'far', label: 'Far', coord: { q: 7, r: 0 } },
					{ id: 'near', label: 'Near', coord: { q: 1, r: 0 } },
					{ id: 'mid', label: 'Middle', coord: { q: 3, r: 0 } },
				]}
				onSelect={vi.fn()}
			/>
		)

		openCombo()

		expect(itemIds()).toEqual(['near', 'mid', 'far'])
	})

	it('does not select disabled options', () => {
		const onSelect = vi.fn()
		stop = latch(
			container,
			<ComboSearchPicker
				testId="picker"
				items={[{ id: 'assigned', label: 'Assigned', disabled: true }]}
				onSelect={onSelect}
			/>
		)

		openCombo()

		;(document.querySelector('[data-testid="picker-item"]') as HTMLButtonElement).click()
		expect(onSelect).not.toHaveBeenCalled()
	})

	it('selects an item, calls onSelect, and closes the menu', () => {
		const onSelect = vi.fn()
		stop = latch(
			container,
			<ComboSearchPicker
				testId="picker"
				items={[{ id: 'north', label: 'North Line' }]}
				onSelect={onSelect}
			/>
		)

		openCombo()
		;(document.querySelector('[data-testid="picker-item"]') as HTMLButtonElement).click()

		expect(onSelect).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'north', label: 'North Line' })
		)
		expect(document.querySelectorAll('[data-testid="picker-item"]')).toHaveLength(0)
	})

	it('shows the empty message when no items match', () => {
		stop = latch(
			container,
			<ComboSearchPicker
				testId="picker"
				items={[{ id: 'north', label: 'North Line' }]}
				emptyMessage="Nothing here"
				onSelect={vi.fn()}
			/>
		)

		openCombo()

		const filter = container.querySelector('[data-testid="picker-filter"]') as HTMLInputElement
		filter.value = 'zzz'
		filter.dispatchEvent(new Event('input', { bubbles: true }))

		expect(document.body.textContent).toContain('Nothing here')
	})

	it('closes when clicking outside the input and menu', () => {
		stop = latch(
			container,
			<ComboSearchPicker
				testId="picker"
				items={[{ id: 'north', label: 'North Line' }]}
				onSelect={vi.fn()}
			/>
		)

		openCombo()
		expect(document.querySelectorAll('[data-testid="picker-item"]')).toHaveLength(1)

		document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
		expect(document.querySelectorAll('[data-testid="picker-item"]')).toHaveLength(0)
	})
})
