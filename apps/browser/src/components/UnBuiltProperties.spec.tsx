import { document, latch, sursautOptions } from '@sursaut/core'
import { reactive } from 'mutts'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const i18nState = {
	translator: {
		project: 'Project',
		clearing: 'Clearing',
		deposit: 'Deposit',
		alveoli: {
			sawmill: { label: 'Sawmill' },
		},
		deposits: {},
	},
}

vi.mock('@app/lib/css', () => ({
	css: () => '',
}))

vi.mock('@app/ui/anarkai', () => ({
	Badge: (props: { children?: JSX.Children; tone?: string }) => (
		<span data-tone={props.tone}>{props.children}</span>
	),
}))

vi.mock('engine-pixi/assets/visual-content', () => ({
	deposits: {
		stone: { sprites: ['stone-sprite'] },
	},
}))

vi.mock('ssh/i18n', () => ({
	i18nState,
}))

vi.mock('./EntityBadge', () => ({
	default: (props: { text: string; qty?: number }) => (
		<span>
			{props.text}
			{props.qty ?? ''}
		</span>
	),
}))

vi.mock('./PropertyGridRow', () => ({
	default: (props: { label?: string; children?: JSX.Children }) => (
		<tr>
			<th>{props.label}</th>
			<td>{props.children}</td>
		</tr>
	),
}))

let UnBuiltProperties: typeof import('./UnBuiltProperties').default

describe('UnBuiltProperties', () => {
	let container: HTMLElement
	let stop: (() => void) | undefined

	beforeAll(async () => {
		;({ default: UnBuiltProperties } = await import('./UnBuiltProperties'))
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

	it('falls back safely when translator values are non-primitive', () => {
		const content = {
			project: 'build:sawmill',
			tile: {
				isClear: true,
				board: { game: {} },
			},
		}

		stop = latch(
			container,
			<table>
				<tbody>
					<UnBuiltProperties content={content as never} />
				</tbody>
			</table>
		)

		expect(container.textContent).toContain('Project')
		expect(container.textContent).toContain('build:sawmill')
	})

	it('falls back safely when deposit metadata is non-primitive', () => {
		const badKey = {
			[Symbol.toPrimitive]() {
				throw new TypeError('boom')
			},
		}
		const content = {
			project: undefined,
			deposit: {
				amount: 3,
				constructor: {
					key: badKey,
					name: badKey,
				},
			},
			tile: {
				isClear: true,
				board: { game: {} },
			},
		}

		stop = latch(
			container,
			<table>
				<tbody>
					<UnBuiltProperties content={content as never} />
				</tbody>
			</table>
		)

		expect(container.innerHTML).toBeTruthy()
	})

	it('does not trip the rebuild fence when deposit amount changes', () => {
		sursautOptions.checkRebuild = 'error'
		const content = reactive({
			project: undefined as string | undefined,
			deposit: reactive({
				amount: 3,
				constructor: {
					key: 'stone',
					name: 'stone',
				},
			}),
			tile: reactive({
				isClear: true,
				board: { game: {} },
			}),
		})

		stop = latch(
			container,
			<table>
				<tbody>
					<UnBuiltProperties content={content as never} />
				</tbody>
			</table>
		)

		expect(() => {
			content.deposit.amount = 2
		}).not.toThrow()
		expect(container.textContent).toContain('2')
	})
})
