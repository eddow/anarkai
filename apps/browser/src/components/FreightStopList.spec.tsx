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
	applyFreightDraftBayAnchor: vi.fn(),
	applyFreightDraftZoneCenter: vi.fn(),
	defaultZoneCenterFromAnchorSwitch: vi.fn(() => [0, 0]),
	defaultZoneRadiusForNewZone: vi.fn(() => 6),
	moveFreightDraftStop: vi.fn((line) => line),
	removeFreightDraftStop: vi.fn((line) => line),
	setFreightDraftStopKindAnchor: vi.fn((line) => line),
	setFreightDraftStopKindNamedZone: vi.fn((line) => line),
	setFreightDraftStopKindZone: vi.fn((line) => line),
	setFreightDraftStopLoadSelection: vi.fn((line) => line),
	setFreightDraftStopNamedZoneId: vi.fn((line) => line),
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
	freightMapPick: {},
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
					listZoneDefinitions: () => [{ id: 'market', name: 'Market' }],
				},
			},
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
})
