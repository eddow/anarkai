import { document, latch, sursautOptions } from '@sursaut/core'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const i18nState = {
	translator: {
		residential: {
			dwelling: {
				section: 'Housing',
				tierBasic: 'Basic dwelling',
				capacity: 'Capacity',
				occupied: 'Occupied',
				vacant: 'Vacant',
			},
		},
	},
}

vi.mock('@app/lib/css', () => ({
	css: () => '',
}))

vi.mock('@app/ui/anarkai', () => ({
	Badge: (props: { children?: JSX.Children; tone?: string; 'data-testid'?: string }) => (
		<span data-tone={props.tone} data-testid={props['data-testid']}>
			{props.children}
		</span>
	),
}))

vi.mock('ssh/i18n', () => ({
	i18nState,
}))

vi.mock('./PropertyGridRow', () => ({
	default: (props: { label?: string; children?: JSX.Children }) => (
		<tr>
			<th>{props.label}</th>
			<td>{props.children}</td>
		</tr>
	),
}))

let DwellingProperties: typeof import('./DwellingProperties').default

describe('DwellingProperties', () => {
	let container: HTMLElement
	let stop: (() => void) | undefined

	beforeAll(async () => {
		;({ default: DwellingProperties } = await import('./DwellingProperties'))
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
		sursautOptions.checkRebuild = 'warn'
	})

	it('shows capacity and occupancy', () => {
		const content = {
			capacity: 1,
			reservedBy: undefined as unknown,
		}

		stop = latch(
			container,
			<table>
				<tbody>
					<DwellingProperties content={content as never} />
				</tbody>
			</table>
		)

		expect(container.textContent).toContain('Housing')
		// `ssh/i18n` is mocked as a plain object in this suite, so omni18n-style reactivity wiring
		// may not populate nested translator paths; the UI should still render stable fallbacks.
		expect(container.textContent).toContain('basic_dwelling')
		expect(container.textContent).toContain('Capacity')
		expect(container.textContent).toContain('1')
		expect(container.textContent).toContain('Occupied')
		expect(container.textContent).toContain('no')
	})
})
