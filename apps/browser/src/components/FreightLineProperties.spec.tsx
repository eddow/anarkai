import { document, latch } from '@sursaut/core'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@app/lib/css', () => ({
	css: () => '',
}))

vi.mock('@app/lib/globals', () => ({
	bumpSelectionTitleVersion: vi.fn(),
}))

vi.mock('@app/ui/anarkai', () => ({
	InspectorSection: (props: { title?: string; children?: JSX.Element }) => (
		<section data-testid="inspector-section" data-title={props.title}>
			{props.children}
		</section>
	),
	Button: (props: {
		onClick?: () => void
		disabled?: boolean
		icon?: string | JSX.Element
		ariaLabel?: string
		children?: JSX.Children
		'el:title'?: string
	}) => (
		<button
			type="button"
			onClick={props.onClick}
			disabled={props.disabled}
			title={props['el:title']}
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

vi.mock('ssh/i18n', () => ({
	i18nState: {
		translator: {
			line: {
				section: 'Freight line',
				name: 'Name',
				mode: 'Mode',
				radius: 'Radius',
				stations: 'Stations',
				unavailable: 'Unavailable',
				modes: {
					gather: 'Gather',
					distribute: 'Distribute',
				},
				goodsSelection: {
					section: 'Goods selection',
					goodRules: 'Goods rules',
					tagRules: 'Tag rules',
					fallback: 'Default',
					fallbackHint: 'When no rule matches:',
					addGoodRule: 'Add good rule',
					addTagRule: 'Add tag rule',
					remove: 'Remove',
					moveUp: 'Up',
					moveDown: 'Down',
					effectAllow: 'Allow',
					effectDeny: 'Deny',
					matchPresent: 'Present',
					matchAbsent: 'Absent',
					noGoodsToAdd: 'No goods left to add',
					noTagsToAdd: 'No tags left to add',
				},
			},
			goods: {
				wood: 'Wood',
				berries: 'Berries',
				mushrooms: 'Mushrooms',
				planks: 'Planks',
				stone: 'Stone',
			},
			goodsTags: {
				food: 'Food',
				bulk: 'Bulk',
				piece: 'Piece goods',
				'construction/lumber': 'Construction lumber',
				'construction/stone': 'Construction stone',
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

vi.mock('./EntityBadge', () => ({
	default: (props: { text?: string }) => <span data-testid="entity-badge">{props.text ?? ''}</span>,
}))

vi.mock('./PropertyGrid', () => ({
	default: (props: { children?: JSX.Element }) => <div>{props.children}</div>,
}))

vi.mock('./PropertyGridRow', () => ({
	default: (props: { label?: string; children?: JSX.Element; if?: boolean }) =>
		props.if === false ? null : (
			<div data-testid={`row-${props.label ?? 'unlabeled'}`}>{props.children}</div>
		),
}))

let FreightLineProperties: typeof import('./FreightLineProperties').default

describe('FreightLineProperties', () => {
	let container: HTMLElement
	let stop: (() => void) | undefined
	let replaceFreightLine: ReturnType<typeof vi.fn>
	let game: any

	beforeAll(async () => {
		;({ default: FreightLineProperties } = await import('./FreightLineProperties'))
	})

	beforeEach(() => {
		container = document.createElement('div')
		document.body.appendChild(container)
		replaceFreightLine = vi.fn((next) => {
			game.freightLines = [next]
		})
		game = {
			freightLines: [
				{
					id: 'line-1',
					name: 'Line 1',
					mode: 'gather',
					stops: [{ hiveName: 'H', alveolusType: 'freight_bay', coord: [0, 0] as const }],
					radius: 3,
				},
			],
			replaceFreightLine,
			hex: {
				getTile: vi.fn(() => undefined),
			},
		}
	})

	afterEach(() => {
		stop?.()
		stop = undefined
		container.remove()
		document.body.innerHTML = ''
	})

	it('replaces checkbox filters with the layered goods selection editor', () => {
		stop = latch(
			container,
			<FreightLineProperties
				lineObject={{
					uid: 'freight-line:line-1',
					kind: 'freight-line',
					title: 'Line 1 (Gather)',
					game,
					line: game.freightLines[0],
					lineId: 'line-1',
					logs: [],
				}}
			/>
		)

		const pickerTrigger = container.querySelector(
			'[data-testid="good-selection-add-good-rule"] button'
		) as HTMLButtonElement | null
		pickerTrigger?.click()

		const firstGood = container.querySelector('.menu-item') as HTMLDivElement | null
		firstGood?.click()

		expect(replaceFreightLine).toHaveBeenCalledTimes(1)
		expect(replaceFreightLine.mock.calls[0]?.[0]).toMatchObject({
			id: 'line-1',
			goodsSelection: {
				goodRules: [{ goodType: 'berries', effect: 'allow' }],
				tagRules: [],
				defaultEffect: 'allow',
			},
			filters: undefined,
		})
	})
})
