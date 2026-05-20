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

let HardListSearchPicker: typeof import('./HardListSearchPicker').default

describe('HardListSearchPicker', () => {
	let container: HTMLElement
	let stop: (() => void) | undefined

	beforeAll(async () => {
		;({ default: HardListSearchPicker } = await import('./HardListSearchPicker'))
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

	const itemIds = () =>
		[...container.querySelectorAll('[data-testid="picker-item"]')].map((node) =>
			node.getAttribute('data-item-id')
		)

	it('sorts fixed options by active-view axial distance', () => {
		stop = latch(
			container,
			<HardListSearchPicker
				testId="picker"
				items={[
					{ id: 'far', label: 'Far', coord: { q: 7, r: 0 } },
					{ id: 'near', label: 'Near', coord: { q: 1, r: 0 } },
					{ id: 'mid', label: 'Middle', coord: { q: 3, r: 0 } },
				]}
				onSelect={vi.fn()}
			/>
		)

		expect(itemIds()).toEqual(['near', 'mid', 'far'])
	})

	it('filters by text without creating a free-text option', () => {
		const onSelect = vi.fn()
		stop = latch(
			container,
			<HardListSearchPicker
				testId="picker"
				items={[
					{ id: 'north-line', label: 'North Line', hint: 'wood route' },
					{ id: 'south-line', label: 'South Line', hint: 'stone route' },
				]}
				onSelect={onSelect}
			/>
		)

		const filter = container.querySelector('[data-testid="picker-filter"]') as HTMLInputElement
		filter.value = 'stone'
		filter.dispatchEvent(new Event('input', { bubbles: true }))

		expect(itemIds()).toEqual(['south-line'])
		expect(container.textContent).not.toContain('stone routewood')
		filter.value = 'brand new line'
		filter.dispatchEvent(new Event('input', { bubbles: true }))
		expect(itemIds()).toEqual([])
		expect(onSelect).not.toHaveBeenCalled()
	})

	it('does not select disabled options', () => {
		const onSelect = vi.fn()
		stop = latch(
			container,
			<HardListSearchPicker
				testId="picker"
				items={[{ id: 'assigned', label: 'Assigned', disabled: true }]}
				onSelect={onSelect}
			/>
		)

		;(container.querySelector('[data-testid="picker-item"]') as HTMLButtonElement).click()
		expect(onSelect).not.toHaveBeenCalled()
	})
})
