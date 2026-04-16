import { document, latch } from '@sursaut/core'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@app/lib/css', () => ({
	css: () => '',
}))

vi.mock('@app/lib/freight-line-draft', () => ({
	addFreightDraftStop: vi.fn((draft: { stops?: unknown[] }) => ({
		...draft,
		stops: [...(draft.stops ?? []), { id: 'new-stop' }],
	})),
}))

vi.mock('ssh/i18n', () => ({
	i18nState: {
		translator: {
			line: {
				stopsEditor: {
					addStop: 'Add stop',
				},
			},
		},
	},
}))

vi.mock('./FreightStopCard', () => ({
	default: (props: { index: number }) => <div data-testid={`stop-card-${props.index}`} />,
}))

let FreightStopList: typeof import('./FreightStopList').default

describe('FreightStopList', () => {
	let container: HTMLElement
	let stop: (() => void) | undefined

	beforeAll(async () => {
		;({ default: FreightStopList } = await import('./FreightStopList'))
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

	it('renders safely when the draft is temporarily unavailable', () => {
		expect(() => {
			stop = latch(
				container,
				<FreightStopList draft={undefined} game={{} as never} readOnly={false} onChange={vi.fn()} />
			)
		}).not.toThrow()

		expect(container.querySelector('[data-testid="stop-card-0"]')).toBeNull()
		expect(container.querySelector('[data-testid="freight-stop-add"]')).not.toBeNull()
	})
})
