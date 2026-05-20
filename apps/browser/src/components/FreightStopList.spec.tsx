import { document, latch } from '@sursaut/core'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const freightMapPickMock = vi.hoisted(() => ({
	pending: undefined as undefined | { lineId: string; pickKind: string; apply: (stop: any) => void },
}))

vi.mock('@app/lib/css', () => ({
	css: () => '',
}))

vi.mock('@app/lib/freight-line-draft', () => ({
	addFreightDraftStop: vi.fn((draft: { stops?: unknown[] }, _index: number, stop?: unknown) => ({
		...draft,
		stops: [...(draft.stops ?? []), stop ?? { id: 'new-stop' }],
	})),
	applyFreightDraftBayAnchor: vi.fn(),
	applyFreightDraftZoneCenter: vi.fn(),
	defaultZoneCenterFromAnchorSwitch: vi.fn(() => [0, 0]),
	defaultZoneRadiusForNewZone: vi.fn(() => 6),
	moveFreightDraftStop: vi.fn((line) => line),
	newFreightStopId: vi.fn(() => 'new-stop'),
	removeFreightDraftStop: vi.fn((line) => line),
	setFreightDraftStopKindAnchor: vi.fn((line) => line),
	setFreightDraftStopKindNamedZone: vi.fn((line) => line),
	setFreightDraftStopKindTrade: vi.fn((line) => line),
	setFreightDraftStopKindZone: vi.fn((line) => line),
	setFreightDraftStopLoadSelection: vi.fn((line) => line),
	setFreightDraftStopMinBalanceAfterBuyVp: vi.fn((line, index, value) => ({
		...line,
		stops: line.stops.map((stop: unknown, i: number) =>
			i === index ? { ...(stop as object), minBalanceAfterBuyVp: value } : stop
		),
	})),
	setFreightDraftStopNamedZoneId: vi.fn((line) => line),
	setFreightDraftStopTradeSettlementId: vi.fn((line) => line),
	setFreightDraftStopUnloadSelection: vi.fn((line) => line),
	setFreightDraftStopZoneRadius: vi.fn((line) => line),
}))

vi.mock('@app/lib/freight-inspector-options', () => ({
	freightInspectorGoodOptions: vi.fn(() => []),
	freightInspectorTagOptions: vi.fn(() => []),
}))

vi.mock('@app/lib/freight-line-overlay', () => ({
	hoverFreightLineStop: vi.fn(),
}))

vi.mock('@app/lib/freight-map-pick', () => ({
	activateFreightAddStopPick: vi.fn((args: { lineId: string; apply: (stop: any) => void }) => {
		freightMapPickMock.pending = {
			lineId: args.lineId,
			pickKind: 'add-stop',
			apply: args.apply,
		}
	}),
	cancelFreightMapPick: vi.fn(() => {
		freightMapPickMock.pending = undefined
	}),
	freightMapPick: freightMapPickMock,
}))

vi.mock('@app/lib/globals', () => ({
	interactionMode: { selectedAction: '' },
}))

vi.mock('@app/ui/anarkai/icons/render-icon', () => ({
	renderAnarkaiIcon: () => <span data-testid="icon" />,
}))

vi.mock('@app/lib/i18n', () => {
	const i18nState = {
		translator: {
			line: {
				stopsEditor: {
					actions: 'Actions',
					addStop: 'Add stop',
					anchorLocation: 'Bay',
					kindAnchor: 'Bay anchor',
					kindZone: 'Radius zone',
					loadPolicy: 'Load',
					locationKind: 'Location',
					pickBay: 'Pick bay',
					pickCenter: 'Pick center',
					removeStop: 'Remove',
					unloadPolicy: 'Unload',
					zoneLocation: 'Zone',
				},
			},
			goods: {},
			goodsTags: {},
		},
	}
	return {
		i18nState,
		T: i18nState.translator,
		getTranslator: () => i18nState.translator,
	}
})

vi.mock('./GoodSelectionRulesEditor', () => ({
	default: () => <div data-testid="goods-editor" />,
}))

vi.mock('./InspectorObjectLink', () => ({
	default: () => null,
}))

vi.mock('./LinkedEntityControl', () => ({
	default: () => null,
}))

let FreightStopList: typeof import('./FreightStopList').default

describe('FreightStopList', () => {
	let container: HTMLElement
	let stop: (() => void) | undefined

	beforeAll(async () => {
		;({ default: FreightStopList } = await import('./FreightStopList'))
	})

	beforeEach(() => {
		freightMapPickMock.pending = undefined
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

		expect(container.querySelector('[data-testid="freight-stop-row-0"]')).toBeNull()
		expect(container.querySelector('[data-testid="freight-stop-add"]')).not.toBeNull()
	})

	it('opens policy controls from the configure button and uses the order number as drag handle', () => {
		const draft = {
			id: 'line-1',
			name: 'Line 1',
			stops: [
				{
					id: 'stop-1',
					anchor: {
						kind: 'alveolus',
						coord: [0, 0],
						hiveName: 'Hive',
						alveolusType: 'freight_bay',
					},
				},
			],
		}
		const mockGame = {
			hex: {
				getTile: () => undefined,
				zoneManager: {
					listCustomZoneDefinitions: () => [{ id: 'market', name: 'Market' }],
				},
			},
			listSettlementTradeProfiles: () => [{ id: 'settlement-1', name: 'Settlement One' }],
			getSettlementTradeProfile: () => ({ id: 'settlement-1', name: 'Settlement One' }),
			getObject: () => undefined,
		}

		stop = latch(
			container,
			<FreightStopList draft={draft as never} game={mockGame as never} readOnly={false} onChange={vi.fn()} />
		)

		const orderButton = container.querySelector('.freight-stop-list__order-button')
		expect(orderButton?.textContent?.trim()).toBe('1')
		expect(orderButton?.hasAttribute('draggable')).toBe(true)

		const configure = container.querySelector('button[title="Configure policies"]') as HTMLButtonElement
		expect(container.querySelectorAll('[data-testid="goods-editor"]')).toHaveLength(0)
		configure.click()
		expect(container.querySelectorAll('[data-testid="goods-editor"]')).toHaveLength(2)
	})

	it('renders reserve only for NPC trade stops that can import goods', () => {
		const draft = {
			id: 'line-1',
			name: 'Line 1',
			stops: [
				{
					id: 'stop-1',
					trade: {
						kind: 'settlement',
						settlementId: 'settlement-1',
					},
				},
			],
		}
		const mockGame = {
			hex: {
				getTile: () => undefined,
				zoneManager: {
					listCustomZoneDefinitions: () => [],
				},
			},
			listSettlementTradeProfiles: () => [
				{
					id: 'settlement-1',
					name: 'Settlement One',
					offers: [{ direction: 'sell', good: 'concrete', priceVp: 5 }],
				},
			],
			getSettlementTradeProfile: () => ({
				id: 'settlement-1',
				name: 'Settlement One',
				offers: [{ direction: 'sell', good: 'concrete', priceVp: 5 }],
			}),
			getObject: () => undefined,
		}

		stop = latch(
			container,
			<FreightStopList draft={draft as never} game={mockGame as never} readOnly={false} onChange={vi.fn()} />
		)

		expect(container.querySelector('[data-testid="freight-stop-trade-settlement-0"]')).toBeNull()
		expect(container.querySelector('[data-testid="freight-stop-kind-label-0"]')?.textContent).toContain(
			'Trade'
		)
		const reserve = container.querySelector(
			'[data-testid="freight-stop-min-balance-0"]'
		) as HTMLInputElement | null
		expect(reserve?.value).toBe('0')
		expect(container.textContent).toContain('Settlement One')
		expect(container.textContent).toContain('provides concrete available')
		expect(container.textContent).toContain('no vehicle assigned')
	})

	it('hides reserve for export-only NPC trade stops', () => {
		const draft = {
			id: 'line-1',
			name: 'Line 1',
			stops: [
				{
					id: 'stop-1',
					trade: {
						kind: 'settlement',
						settlementId: 'settlement-1',
					},
				},
			],
		}
		const mockGame = {
			hex: {
				getTile: () => undefined,
				zoneManager: {
					listCustomZoneDefinitions: () => [],
				},
			},
			listSettlementTradeProfiles: () => [
				{
					id: 'settlement-1',
					name: 'Settlement One',
					offers: [{ direction: 'buy', good: 'planks', priceVp: 3 }],
				},
			],
			getSettlementTradeProfile: () => ({
				id: 'settlement-1',
				name: 'Settlement One',
				offers: [{ direction: 'buy', good: 'planks', priceVp: 3 }],
			}),
			getObject: () => undefined,
		}

		stop = latch(
			container,
			<FreightStopList draft={draft as never} game={mockGame as never} readOnly={false} onChange={vi.fn()} />
		)

		expect(container.querySelector('[data-testid="freight-stop-min-balance-0"]')).toBeNull()
	})

	it('activates add-stop board picking and appends the picked halt', () => {
		const onChange = vi.fn()
		const draft = {
			id: 'line-1',
			name: 'Line 1',
			stops: [
				{
					id: 'stop-1',
					anchor: {
						kind: 'alveolus',
						coord: [0, 0],
						hiveName: 'Hive',
						alveolusType: 'freight_bay',
					},
				},
			],
		}
		const mockGame = {
			procurementDefaults: { bufferPurchaseReserveVp: 80 },
			hex: {
				getTile: () => undefined,
				zoneManager: {
					listCustomZoneDefinitions: () => [],
				},
			},
			listSettlementTradeProfiles: () => [
				{
					id: 'settlement-1',
					name: 'Settlement One',
					offers: [{ direction: 'sell', good: 'concrete', priceVp: 5 }],
				},
			],
			getSettlementTradeProfile: () => ({
				id: 'settlement-1',
				name: 'Settlement One',
				offers: [{ direction: 'sell', good: 'concrete', priceVp: 5 }],
			}),
			getObject: () => undefined,
		}

		stop = latch(
			container,
			<FreightStopList draft={draft as never} game={mockGame as never} readOnly={false} onChange={onChange} />
		)

		;(container.querySelector('[data-testid="freight-stop-add"]') as HTMLButtonElement).click()
		expect(container.querySelector('[data-testid="freight-stop-add-kind"]')).toBeNull()
		expect(freightMapPickMock.pending?.pickKind).toBe('add-stop')
		freightMapPickMock.pending?.apply({
			id: 'picked-trade',
			trade: { kind: 'settlement', settlementId: 'settlement-1' },
		})

		const next = onChange.mock.calls.at(-1)?.[0] as { stops: Array<{ trade?: { settlementId: string } }> }
		expect(next.stops.at(-1)?.trade?.settlementId).toBe('settlement-1')
	})
})
