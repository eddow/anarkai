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

vi.mock('./InspectorObjectLink', () => ({
	default: (props: { object?: { title?: string }; label?: string }) => (
		<button type="button" data-testid="inspector-object-link">
			{props.label ?? props.object?.title ?? 'link'}
		</button>
	),
}))

vi.mock('./LinkedEntityControl', () => ({
	default: (props: { object?: { title?: string } }) => (
		<div data-testid="linked-entity-control">{props.object?.title ?? 'linked'}</div>
	),
}))

vi.mock('./PropertyGridRow', () => ({
	default: (props: { label?: string; children?: JSX.Children }) => (
		<tr>
			{props.label ? <th>{props.label}</th> : null}
			<td>{props.children}</td>
		</tr>
	),
}))

let AssignedLinksPicker: typeof import('./AssignedLinksPicker').default

describe('AssignedLinksPicker', () => {
	let container: HTMLElement
	let stop: (() => void) | undefined

	beforeAll(async () => {
		;({ default: AssignedLinksPicker } = await import('./AssignedLinksPicker'))
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

	const mount = (overrides?: Partial<Parameters<typeof AssignedLinksPicker>[0]>) => {
		const onSelect = vi.fn()
		const onRemove = vi.fn()
		stop = latch(
			container,
			<table>
				<tbody>
					<AssignedLinksPicker
						assigned={[{ title: 'North route' }]}
						availableItems={[{ id: 'south', label: 'South route' }]}
						onSelect={onSelect}
						onRemove={onRemove}
						label="Lines"
						filterPlaceholder="Filter lines..."
						emptyAssigned="No lines assigned"
						emptyAvailable="No freight lines available"
						removeLabel="Remove line"
						pickerTestId="links-picker"
						assignedRowTestId="assigned-link"
						removeButtonTestId="unassign-link"
						{...overrides}
					/>
				</tbody>
			</table>
		)
		return { onSelect, onRemove }
	}

	const openCombo = () => {
		;(container.querySelector('[data-testid="links-picker-filter"]') as HTMLInputElement).click()
	}

	const itemIds = () =>
		[...document.querySelectorAll('[data-testid="links-picker-item"]')].map((node) =>
			node.getAttribute('data-item-id')
		)

	it('renders a single row containing both the assigned list and the add combo', () => {
		mount()

		const rows = [...container.querySelectorAll('tr')].filter(
			(row) => !row.closest('[data-testid="links-picker-item"]')
		)
		expect(rows).toHaveLength(1)
		expect(rows[0]?.textContent).toContain('Lines')
		expect(rows[0]?.querySelector('[data-testid="assigned-link"]')).not.toBeNull()
		expect(rows[0]?.querySelector('[data-testid="links-picker-filter"]')).not.toBeNull()
	})

	it('renders assigned rows with links and forwards remove clicks', () => {
		const { onRemove, onSelect } = mount()

		expect(container.querySelector('[data-testid="assigned-link"]')).not.toBeNull()
		expect(container.querySelector('[data-testid="linked-entity-control"]')).not.toBeNull()
		expect(container.querySelector('[data-testid="inspector-object-link"]')).not.toBeNull()

		;(container.querySelector('[data-testid="unassign-link"]') as HTMLButtonElement).click()
		expect(onRemove).toHaveBeenCalledWith({ title: 'North route' })
		expect(onSelect).not.toHaveBeenCalled()
	})

	it('renders collapsed with the search input and no items', () => {
		mount()

		const input = container.querySelector(
			'[data-testid="links-picker-filter"]'
		) as HTMLInputElement | null
		expect(input).not.toBeNull()
		expect(input?.getAttribute('aria-expanded')).toBe('false')
		expect(document.querySelectorAll('[data-testid="links-picker-item"]')).toHaveLength(0)
	})

	it('opens the list on input click and forwards selection, then closes', () => {
		const { onSelect } = mount()

		openCombo()
		expect(itemIds()).toEqual(['south'])
		expect(
			(container.querySelector('[data-testid="links-picker-filter"]') as HTMLInputElement).getAttribute(
				'aria-expanded'
			)
		).toBe('true')

		;(document.querySelector('[data-testid="links-picker-item"]') as HTMLButtonElement).click()
		expect(onSelect).toHaveBeenCalledWith({ id: 'south', label: 'South route' })
		expect(document.querySelectorAll('[data-testid="links-picker-item"]')).toHaveLength(0)
	})

	it('filters by text without creating a free-text option', () => {
		const onSelect = vi.fn()
		stop = latch(
			container,
			<table>
				<tbody>
					<AssignedLinksPicker
						assigned={[]}
						availableItems={[
							{ id: 'north-line', label: 'North Line', hint: 'wood route' },
							{ id: 'south-line', label: 'South Line', hint: 'stone route' },
						]}
						onSelect={onSelect}
						onRemove={vi.fn()}
						label="Lines"
						pickerTestId="links-picker"
					/>
				</tbody>
			</table>
		)

		openCombo()

		const filter = container.querySelector(
			'[data-testid="links-picker-filter"]'
		) as HTMLInputElement
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
			<table>
				<tbody>
					<AssignedLinksPicker
						assigned={[]}
						availableItems={[
							{ id: 'far', label: 'Far', coord: { q: 7, r: 0 } },
							{ id: 'near', label: 'Near', coord: { q: 1, r: 0 } },
							{ id: 'mid', label: 'Middle', coord: { q: 3, r: 0 } },
						]}
						onSelect={vi.fn()}
						onRemove={vi.fn()}
						label="Lines"
						pickerTestId="links-picker"
					/>
				</tbody>
			</table>
		)

		openCombo()

		expect(itemIds()).toEqual(['near', 'mid', 'far'])
	})

	it('does not select disabled options', () => {
		const onSelect = vi.fn()
		stop = latch(
			container,
			<table>
				<tbody>
					<AssignedLinksPicker
						assigned={[]}
						availableItems={[{ id: 'assigned', label: 'Assigned', disabled: true }]}
						onSelect={onSelect}
						onRemove={vi.fn()}
						label="Lines"
						pickerTestId="links-picker"
					/>
				</tbody>
			</table>
		)

		openCombo()

		;(document.querySelector('[data-testid="links-picker-item"]') as HTMLButtonElement).click()
		expect(onSelect).not.toHaveBeenCalled()
	})

	it('shows empty states when nothing is assigned or available', () => {
		mount({ assigned: [], availableItems: [] })

		expect(container.textContent).toContain('No lines assigned')
		expect(container.querySelector('[data-testid="assigned-link"]')).toBeNull()

		openCombo()
		expect(document.body.textContent).toContain('No freight lines available')
	})

	it('closes when clicking outside the input and menu', () => {
		mount()

		openCombo()
		expect(document.querySelectorAll('[data-testid="links-picker-item"]')).toHaveLength(1)

		document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
		expect(document.querySelectorAll('[data-testid="links-picker-item"]')).toHaveLength(0)
	})
})
