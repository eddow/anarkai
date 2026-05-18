import { document, latch } from '@sursaut/core'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@app/lib/css', () => ({
	css: () => '',
}))

vi.mock('@app/lib/globals', () => ({
	game: {},
}))

vi.mock('@app/ui/anarkai', () => ({
	InspectorSection: (props: { title?: string; children?: JSX.Children }) => (
		<section data-testid="inspector-section" data-title={props.title}>
			{props.children}
		</section>
	),
}))

vi.mock('engine-pixi/assets/visual-content', () => ({
	goods: {
		wood: { sprites: ['wood-sprite'] },
		planks: { sprites: ['planks-sprite'] },
		stone: { sprites: ['stone-sprite'] },
		berries: { sprites: ['berries-sprite'] },
		mushrooms: { sprites: ['mushrooms-sprite'] },
	},
}))

vi.mock('../EntityBadge', () => ({
	default: (props: { text?: string; qtyLabel?: string }) => (
		<span data-testid="entity-badge">
			{props.text}
			{props.qtyLabel ? `:${props.qtyLabel}` : ''}
		</span>
	),
}))

vi.mock('../PropertyGrid', () => ({
	default: (props: { children?: JSX.Children }) => <div>{props.children}</div>,
}))

vi.mock('../PropertyGridRow', () => ({
	default: (props: { label?: string; children?: JSX.Children; if?: boolean }) =>
		props.if === false ? null : (
			<div data-testid={`row-${props.label ?? 'unlabeled'}`}>
				<strong>{props.label}</strong>
				{props.children}
			</div>
		),
}))

let SettlementProperties: typeof import('./SettlementProperties').default

describe('SettlementProperties', () => {
	let container: HTMLElement
	let stop: (() => void) | undefined

	beforeAll(async () => {
		;({ default: SettlementProperties } = await import('./SettlementProperties'))
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

	it('renders read-only settlement market details and offer rows', () => {
		const settlementObject = {
			profile: {
				id: 'settlement-2,3',
				regionSetKey: '0,0',
				name: 'Town of (2,3)',
				kind: 'town',
				center: { q: 2, r: 3 },
				radius: 3,
				offers: [
					{ good: 'wood', direction: 'sell', priceVp: 6 },
					{ good: 'stone', direction: 'sell', priceVp: 4 },
					{ good: 'planks', direction: 'buy', priceVp: 8 },
					{ good: 'berries', direction: 'buy', priceVp: 2 },
				],
			},
		}

		stop = latch(container, <SettlementProperties settlementObject={settlementObject as never} />)

		expect(
			container.querySelector('[data-testid="inspector-section"]')?.getAttribute('data-title')
		).toBe('Town of (2,3)')
		expect(container.querySelector('[data-testid="row-Kind"]')?.textContent).toContain('Town')
		expect(container.querySelector('[data-testid="row-Center"]')?.textContent).toContain('2, 3')
		expect(container.querySelector('[data-testid="row-Radius"]')?.textContent).toContain('3')

		const sells = [...container.querySelectorAll('[data-testid="settlement-offer-sell"]')]
		const buys = [...container.querySelectorAll('[data-testid="settlement-offer-buy"]')]
		expect(sells).toHaveLength(2)
		expect(buys).toHaveLength(2)
		expect(sells[0]?.textContent).toContain('wood:wood')
		expect(sells[0]?.textContent).toContain('6 vp')
		expect(buys[0]?.textContent).toContain('planks:planks')
		expect(buys[0]?.textContent).toContain('8 vp')
	})
})
