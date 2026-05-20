import { document, latch, sursautOptions } from '@sursaut/core'
import { reactive } from 'mutts'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const i18nState = {
	translator: {
		project: 'Project',
		clearing: 'Clearing',
		deposit: 'Deposit',
		construction: {
			section: 'Construction',
			phases: {
				foundation: 'Foundation',
			},
			blocking: {
				no_engineer_in_range: 'No engineer in range',
			},
		},
		alveoli: {
			sawmill: 'Sawmill',
		},
		deposits: new Proxy(
			{
				stone: 'Stone',
			},
			{
				get(target, key) {
					if (key === '') throw new Error('empty deposit translation lookup')
					return target[key as keyof typeof target]
				},
			}
		),
		goods: {
			concrete: 'Concrete',
		},
	},
}

const queryConstructionSiteView = vi.fn()

vi.mock('@app/lib/css', () => ({
	css: () => '',
}))

vi.mock('@app/ui/anarkai', () => ({
	Badge: (props: { children?: JSX.Children; tone?: string }) => (
		<span data-tone={props.tone}>{props.children}</span>
	),
	Button: (props: {
		ariaLabel?: string
		'el:title'?: string
		onClick?: () => void
		children?: JSX.Children
	}) => (
		<button
			aria-label={props.ariaLabel}
			title={props['el:title']}
			type="button"
			onClick={props.onClick}
		>
			{props.children}
		</button>
	),
}))

vi.mock('@app/ui/anarkai/icons/render-icon', () => ({
	renderAnarkaiIcon: (_icon: unknown, options: { label?: string }) => (
		<span data-testid="zone-icon">{options.label}</span>
	),
}))

vi.mock('engine-pixi/assets/visual-content', () => ({
	deposits: {
		'': { sprites: ['empty-deposit-sprite'] },
		stone: { sprites: ['stone-sprite'] },
	},
	goods: {
		concrete: { sprites: ['concrete-sprite'] },
	},
}))

vi.mock('@app/lib/i18n', () => ({
	i18nState,
	T: i18nState.translator,
	getTranslator: () => i18nState.translator,
}))

vi.mock('ssh/construction', () => ({
	queryConstructionSiteView,
}))

vi.mock('../EntityBadge', () => ({
	default: (props: { text: string; qty?: number; qtyLabel?: string; qtyTone?: string }) => (
		<span data-tone={props.qtyTone}>
			{props.text}
			{props.qtyLabel ?? props.qty ?? ''}
		</span>
	),
}))

vi.mock('../PropertyGridRow', () => ({
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
		queryConstructionSiteView.mockReset()
		queryConstructionSiteView.mockReturnValue(undefined)
	})

	afterEach(() => {
		stop?.()
		stop = undefined
		container.remove()
		document.body.innerHTML = ''
		sursautOptions.checkRebuild = 'warn'
	})

	it('renders project labels through T without a hardcoded fallback', () => {
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
		expect(container.textContent).toContain('Sawmill')
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
				name: badKey,
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

	it('does not translate or render an unnamed deposit', () => {
		const content = {
			project: undefined,
			deposit: {
				amount: 3,
				name: '',
			},
			tile: {
				isClear: true,
				board: { game: {} },
			},
		}

		expect(() => {
			stop = latch(
				container,
				<table>
					<tbody>
						<UnBuiltProperties content={content as never} />
					</tbody>
				</table>
			)
		}).not.toThrow()

		expect(container.textContent).not.toContain('Deposit')
	})

	it('renders deposits using the generated deposit instance name', () => {
		const content = {
			project: undefined,
			deposit: {
				amount: 7,
				name: 'stone',
				constructor: {
					name: 'GeneratedStoneDeposit',
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

		expect(container.textContent).toContain('Deposit')
		expect(container.textContent).toContain('Stone')
		expect(container.textContent).toContain('7')
	})

	it('renders the tile zone as a colored unbuilt-land title', () => {
		const content = {
			project: undefined,
			tile: {
				effectiveZone: 'orchard',
				isClear: true,
				board: {
					game: {
						hex: {
							zoneManager: {
								getZoneDefinition: vi.fn(() => ({
									id: 'orchard',
									name: 'Orchard',
									color: '#12ab34',
								})),
							},
						},
					},
				},
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

		const title = container.querySelector('[data-testid="unbuilt-zone-title"]') as HTMLElement
		expect(title).not.toBeNull()
		expect(title.textContent).toContain('Orchard')
		expect(title.getAttribute('style')).toContain('--unbuilt-zone-color: #12ab34')
		expect(container.querySelector('[data-testid="zone-icon"]')?.textContent).toBe('Orchard')
	})

	it('does not trip the rebuild fence when deposit amount changes', () => {
		sursautOptions.checkRebuild = 'error'
		const content = reactive({
			project: undefined as string | undefined,
			deposit: reactive({
				amount: 3,
				name: 'stone',
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

	it('renders construction phase and blocking labels through the shared formatter path', () => {
		const content = {
			project: 'build:sawmill',
			constructionSite: {},
			tile: {
				isClear: true,
				board: { game: {} },
			},
		}
		queryConstructionSiteView.mockReturnValue({
			phase: 'foundation',
			blockingReasons: ['no_engineer_in_range'],
		})

		stop = latch(
			container,
			<table>
				<tbody>
					<UnBuiltProperties content={content as never} />
				</tbody>
			</table>
		)

		expect(container.textContent).toContain('Construction')
		expect(container.textContent).toContain('Foundation')
		expect(container.textContent).toContain('No engineer in range')
	})

	it('renders foundation materials as delivered over required and marks missing goods', () => {
		const executeDistrictPurchaseRequest = vi.fn()
		const listDistrictPurchaseRequests = vi.fn(() => [
			{
				id: 'purchase:default:use:concrete:0,0',
				districtId: 'default',
				good: 'concrete',
				quantity: 1,
				purpose: 'use',
				targetCoord: { q: 0, r: 0 },
				status: 'planned',
			},
		])
		const content = {
			project: 'build:sawmill',
			constructionSite: {},
			tile: {
				position: { q: 0, r: 0 },
				isClear: true,
				board: {
					game: {
						listDistricts: vi.fn(() => [{ id: 'default' }]),
						listDistrictPurchaseRequests,
						executeDistrictPurchaseRequest,
					},
				},
			},
		}
		queryConstructionSiteView.mockReturnValue({
			phase: 'waiting_materials',
			requiredGoods: { concrete: 1 },
			deliveredGoods: {},
			blockingReasons: ['missing_goods'],
		})

		stop = latch(
			container,
			<table>
				<tbody>
					<UnBuiltProperties content={content as never} />
				</tbody>
			</table>
		)

		expect(container.textContent).toContain('Concrete')
		expect(container.textContent).toContain('0/1')
		expect(container.querySelector('[data-tone="danger"]')).not.toBeNull()
		const button = container.querySelector('button[title="Buy Concrete"]')
		expect(button).toBeNull()
		button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
		expect(executeDistrictPurchaseRequest).not.toHaveBeenCalled()
	})
})
