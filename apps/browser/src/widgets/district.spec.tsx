import { document, latch } from '@sursaut/core'
import { reactive } from 'mutts'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const showProps = vi.hoisted(() => vi.fn())

vi.mock('@app/lib/css', () => ({
	css: () => '',
}))

vi.mock('@app/lib/follow-selection', () => ({
	showProps,
}))

const interactionMode = reactive({ selectedAction: '' })
const marketObject = {
	uid: 'settlement:market-1',
	title: 'Market of One',
}
const game = {
	playerAccount: reactive({ balanceVp: 200 }),
	getDistrict: vi.fn(() => ({
		id: 'default',
		name: 'Default district',
		kind: 'mixed',
		memberCount: 2,
		members: [{ q: 0, r: 0 }],
		procurementPolicy: {
			autoBuyNeededGoods: true,
			usePurchaseReserveVp: 20,
			bufferPurchaseReserveVp: 80,
			maxInFlightPerGood: 1,
			goods: { concrete: { bufferTargetUnits: 3 } },
		},
	})),
	getObject: vi.fn(() => marketObject),
	getSettlementTradeProfile: vi.fn((id: string) =>
		id === 'market-1'
			? {
					id: 'market-1',
					name: 'Market of One',
				}
			: undefined
	),
	updateDistrictProcurementPolicy: vi.fn(),
	setDistrictProcurementGoodPolicy: vi.fn(),
	listDistrictEligibleSellGoods: vi.fn(() => ['wood']),
	listDistrictPurchaseRequests: vi.fn(() => [
		{
			id: 'purchase:default:buffer:concrete:0,0',
			districtId: 'default',
			good: 'concrete',
			quantity: 3,
			purpose: 'buffer',
			providerSettlementId: 'market-1',
			unitPriceVp: 10,
			totalPriceVp: 30,
			status: 'planned',
		},
	]),
	listSettlementTradeProfiles: vi.fn(() => [
		{
			id: 'market-1',
			name: 'Market of One',
			kind: 'town',
			center: { q: 5, r: 0 },
			radius: 3,
			offers: [
				{ good: 'concrete', direction: 'sell', priceVp: 10 },
				{ good: 'planks', direction: 'buy', priceVp: 8 },
			],
		},
	]),
	hex: {
		getTile: vi.fn(() => ({ content: undefined })),
	},
}

vi.mock('@app/lib/globals', () => ({
	game,
	interactionMode,
}))

vi.mock('@app/ui/anarkai', () => ({
	Button: (props: {
		ariaLabel?: string
		'el:title'?: string
		disabled?: boolean
		onClick?: () => void
		children?: JSX.Children
	}) => (
		<button
			aria-label={props.ariaLabel}
			disabled={props.disabled}
			title={props['el:title']}
			type="button"
			onClick={props.onClick}
		>
			{props.children}
		</button>
	),
	InspectorSection: (props: { title?: string; children?: JSX.Children }) => (
		<section data-title={props.title}>
			<h3>{props.title}</h3>
			{props.children}
		</section>
	),
}))

vi.mock('ssh/assets/game-content', () => ({
	alveoli: {
		storage: { construction: { goods: {} } },
	},
}))

vi.mock('engine-pixi/assets/visual-content', () => ({
	alveoli: {
		storage: { sprites: ['alveoli.storage'] },
	},
	goods: {
		concrete: { sprites: ['goods.cement'] },
	},
}))

vi.mock('../components/EntityBadge', () => ({
	default: (props: { text?: string; qty?: number }) => (
		<span>
			{props.text}:{props.qty}
		</span>
	),
}))

vi.mock('../components/ResourceImage', () => ({
	default: (props: { alt?: string }) => <span>{props.alt}</span>,
}))

vi.mock('../components/PropertyGrid', () => ({
	default: (props: { children?: JSX.Children }) => <div>{props.children}</div>,
}))

vi.mock('../components/PropertyGridRow', () => ({
	default: (props: { label?: string; children?: JSX.Children }) => (
		<div data-testid={`row-${props.label}`}>{props.children}</div>
	),
}))

let DistrictWidget: typeof import('./district').default

describe('DistrictWidget', () => {
	let container: HTMLElement
	let stop: (() => void) | undefined

	beforeAll(async () => {
		;({ default: DistrictWidget } = await import('./district'))
	})

	beforeEach(() => {
		container = document.createElement('div')
		document.body.appendChild(container)
		interactionMode.selectedAction = ''
		showProps.mockClear()
		game.getObject.mockClear()
		game.updateDistrictProcurementPolicy.mockClear()
		game.setDistrictProcurementGoodPolicy.mockClear()
	})

	afterEach(() => {
		stop?.()
		stop = undefined
		container.remove()
		document.body.innerHTML = ''
	})

	it('renders default district actions and changes selected action', () => {
		const props = { title: '' }
		stop = latch(container, <DistrictWidget {...(props as never)} />)

		expect(container.textContent).toContain('Default district')
		expect(container.textContent).toContain('Tools')
		const button = container.querySelector('button[title="Build storage"]')
		button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

		expect(interactionMode.selectedAction).toBe('build:storage')
	})

	it('collapses and expands tool groups with square plus/minus buttons', () => {
		const props = { title: '' }
		stop = latch(container, <DistrictWidget {...(props as never)} />)

		const collapse = container.querySelector('button[title="Collapse Build"]')
		expect(collapse).not.toBeNull()
		collapse?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

		expect(container.querySelector('button[title="Build storage"]')).toBeNull()
		expect(container.querySelector('button[title="Expand Build"]')).not.toBeNull()
	})

	it('opens settlement commerce from the district panel', () => {
		const props = { title: '' }
		stop = latch(container, <DistrictWidget {...(props as never)} />)

		expect(container.textContent).toContain('Commerce')
		expect(container.textContent).toContain('Buy needed goods')
		expect(container.textContent).toContain('Use reserve')
		expect(container.textContent).toContain('3 concrete for buffer')
		expect(container.textContent).toContain('Market of One · 30 vp · Planned')
		expect(container.textContent).toContain('Eligible to sell: wood')
		expect(container.textContent).toContain('Market of One')
		expect(container.textContent).toContain('Town · sells 1 · buys 1')
		expect(container.textContent).toContain('Concrete from Market of One · 10 vp')
		expect(container.querySelector('button[title^="Procurement jobs are next"]')).toHaveProperty(
			'disabled',
			true
		)

		const button = container.querySelector('button[title="Open market Market of One"]')
		button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

		expect(game.getObject).toHaveBeenCalledWith('settlement:market-1')
		expect(showProps).toHaveBeenCalledWith(marketObject)
	})

	it('updates district procurement controls', () => {
		const props = { title: '' }
		stop = latch(container, <DistrictWidget {...(props as never)} />)

		const useReserve = container.querySelector('#district-use-reserve') as HTMLInputElement
		useReserve.value = '42'
		useReserve.dispatchEvent(new InputEvent('input', { bubbles: true }))
		expect(game.updateDistrictProcurementPolicy).toHaveBeenCalledWith('default', {
			usePurchaseReserveVp: 42,
		})

		const bufferInput = container.querySelector(
			'input[title="Buffer target for concrete"]'
		) as HTMLInputElement
		bufferInput.value = '4'
		bufferInput.dispatchEvent(new InputEvent('input', { bubbles: true }))
		expect(game.setDistrictProcurementGoodPolicy).toHaveBeenCalledWith('default', 'concrete', {
			bufferTargetUnits: 4,
		})
	})
})
