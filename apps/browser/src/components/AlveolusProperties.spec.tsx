import { document, latch } from '@sursaut/core'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const findFreightLinesForStop = vi.fn(() => [])

vi.mock('@app/lib/css', () => ({
	css: () => '',
}))

vi.mock('ssh/freight/freight-line', () => ({
	createSyntheticFreightLineObject: vi.fn(),
	findFreightLinesForStop,
}))

vi.mock('ssh/hive/storage', () => ({
	StorageAlveolus: class StorageAlveolus {},
}))

vi.mock('ssh/i18n', () => ({
	i18nState: {
		translator: {
			alveolus: {
				commands: 'Commands',
				workingTooltip: 'Working',
			},
			goods: {
				stored: 'Stored',
			},
			line: {
				section: 'Line',
			},
		},
	},
}))

vi.mock('./InspectorObjectLink', () => ({
	default: () => null,
}))

vi.mock('./LinkedEntityControl', () => ({
	default: () => null,
}))

vi.mock('./PropertyGridRow', () => ({
	default: (props: { if?: boolean; label?: string; children?: JSX.Element }) =>
		props.if === false ? null : (
			<tr data-testid={`row-${props.label ?? 'unlabeled'}`}>
				<th>{props.label}</th>
				<td>{props.children}</td>
			</tr>
		),
}))

vi.mock('./parts/WorkingIndicator', () => ({
	default: () => <button data-testid="working-indicator" />,
}))

vi.mock('./storage/StorageConfiguration', () => ({
	default: () => <div data-testid="storage-configuration" />,
}))

vi.mock('./storage/StoredGoodsRow', () => ({
	default: (props: { if?: boolean }) =>
		props.if === false ? null : <tr data-testid="stored-goods-row" />,
}))

let AlveolusProperties: typeof import('./AlveolusProperties').default

describe('AlveolusProperties', () => {
	let container: HTMLElement
	let stop: (() => void) | undefined

	beforeAll(async () => {
		;({ default: AlveolusProperties } = await import('./AlveolusProperties'))
	})

	beforeEach(() => {
		container = document.createElement('div')
		document.body.appendChild(container)
		findFreightLinesForStop.mockClear()
	})

	afterEach(() => {
		stop?.()
		stop = undefined
		container.remove()
		document.body.innerHTML = ''
	})

	it('does not query freight lines while content is unresolved', () => {
		expect(() => {
			stop = latch(
				container,
				<table>
					<tbody>
						<AlveolusProperties content={undefined as never} game={{ freightLines: [] } as never} />
					</tbody>
				</table>
			)
		}).not.toThrow()

		expect(findFreightLinesForStop).not.toHaveBeenCalled()
		expect(container.querySelector('[data-testid="stored-goods-row"]')).not.toBeNull()
	})
})
