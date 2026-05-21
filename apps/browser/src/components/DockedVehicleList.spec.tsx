import { document, latch } from '@sursaut/core'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@app/lib/css', () => ({
	css: () => '',
}))

vi.mock('@app/lib/i18n', () => ({
	T: {
		goods: {
			concrete: 'Concrete',
			wood: 'Wood',
		},
		line: {
			stop: 'stop',
		},
		vehicle: {
			cargo: 'Cargo',
		},
	},
}))

vi.mock('./InspectorObjectLink', () => ({
	default: (props: { object: { title?: string; uid?: string } }) => (
		<span data-testid="object-link">{props.object.title ?? props.object.uid}</span>
	),
}))

vi.mock('./LinkedEntityControl', () => ({
	default: () => <span data-testid="linked-control" />,
}))

let DockedVehicleList: typeof import('./DockedVehicleList').default

const entry = (uid: string, stock: Record<string, number>) => ({
	vehicle: {
		uid,
		title: uid,
		storage: { stock },
	},
	line: {
		id: 'line-1',
		name: 'Line 1',
	},
	stop: {
		id: 'stop-1',
	},
})

describe('DockedVehicleList', () => {
	let container: HTMLElement
	let stop: (() => void) | undefined

	beforeAll(async () => {
		;({ default: DockedVehicleList } = await import('./DockedVehicleList'))
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

	it('shows compact cargo summaries for loaded and empty docked vehicles', () => {
		stop = latch(
			container,
			<DockedVehicleList
				entries={[
					entry('truck', { wood: 3, concrete: 2, stone: 0 }),
					entry('cart', {}),
				] as never}
				game={{} as never}
			/>
		)

		const summaries = Array.from(
			container.querySelectorAll('[data-testid="docked-vehicle-cargo-summary"]')
		).map((node) => node.textContent?.replace(/\s+/g, ' ').trim())

		expect(summaries).toEqual(['Cargo: Concrete 2, Wood 3', 'Cargo: empty'])
	})

	it('does not render the old show-cargo toggle', () => {
		stop = latch(
			container,
			<DockedVehicleList entries={[entry('truck', { wood: 3 })] as never} game={{} as never} />
		)

		expect(container.querySelector('[data-testid="docked-vehicle-show-content-toggle"]')).toBeNull()
	})
})
