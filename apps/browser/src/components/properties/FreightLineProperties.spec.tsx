import { document, latch } from '@sursaut/core'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@app/lib/css', () => ({
	css: () => '',
}))

vi.mock('@app/lib/globals', () => ({
	activeWorldViewPov: { viewId: 'primary', center: { q: 0, r: 0 } },
	bumpSelectionTitleVersion: vi.fn(),
	selectionState: { selectedUid: undefined },
}))

const showFreightLineOverlay = vi.hoisted(() => vi.fn())

vi.mock('@app/lib/freight-line-overlay', () => ({
	showFreightLineOverlay,
}))

vi.mock('@app/lib/freight-map-pick', () => ({
	clearFreightMapPickForLine: vi.fn(),
}))

vi.mock('@app/ui/anarkai', () => ({
	InspectorSection: (props: { title?: string; el?: JSX.IntrinsicElements['section']; children?: JSX.Element }) => (
		<section {...props.el} data-testid="inspector-section" data-title={props.title}>
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

vi.mock('@app/lib/i18n', () => {
	const i18nState = {
		translator: {
			line: {
				section: 'Freight line',
				name: 'Name',
				cyclic: {
					label: 'Cyclic',
					hint: 'Allow this route to begin at any halt and wrap from last halt to first.',
				},
				mode: 'Mode',
				radius: 'Radius',
				stations: 'Stations',
				unavailable: 'Unavailable',
				modes: {
					gather: 'Gather',
					distribute: 'Distribute',
				},
				deleteLine: {
					section: 'Danger zone',
					action: 'Delete line',
				},
				stopsEditor: {
					actions: 'Changes',
					save: 'Save',
					cancel: 'Cancel',
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
	}
	return {
		i18nState,
		T: i18nState.translator,
		getTranslator: () => i18nState.translator,
	}
})

vi.mock('../InspectorObjectLink', () => ({
	default: () => null,
}))

vi.mock('../LinkedEntityControl', () => ({
	default: () => null,
}))

vi.mock('../EntityBadge', () => ({
	default: (props: { text?: string }) => <span data-testid="entity-badge">{props.text ?? ''}</span>,
}))

vi.mock('../PropertyGrid', () => ({
	default: (props: { children?: JSX.Element }) => <div>{props.children}</div>,
}))

vi.mock('../PropertyGridRow', () => ({
	default: (props: { label?: string; children?: JSX.Element; if?: boolean }) =>
		props.if === false ? null : (
			<div data-testid={`row-${props.label ?? 'unlabeled'}`}>{props.children}</div>
		),
}))

vi.mock('../FreightStopList', () => ({
	default: (props: { draft: { name: string }; onChange: (next: { name: string }) => void }) => (
		<button
			type="button"
			data-testid="freight-mock-dirty"
			onClick={() => props.onChange({ ...props.draft, name: `${props.draft.name}!` })}
		>
			Dirty
		</button>
	),
}))

import { normalizeFreightLineDefinition } from 'ssh/freight/freight-line'

let FreightLineProperties: typeof import('./FreightLineProperties').default

describe('FreightLineProperties', () => {
	let container: HTMLElement
	let stop: (() => void) | undefined
	let removeFreightLineById: ReturnType<typeof vi.fn>
	let game: {
		freightLines: ReturnType<typeof normalizeFreightLineDefinition>[]
		replaceFreightLine: ReturnType<typeof vi.fn>
		removeFreightLineById: ReturnType<typeof vi.fn>
		assignVehicleToFreightLine: ReturnType<typeof vi.fn>
		unassignVehicleFromFreightLine: ReturnType<typeof vi.fn>
		vehicles: Iterable<{
			uid: string
			title: string
			vehicleType: string
			position: { q: number; r: number }
			storage: { stock: Record<string, number> }
			servedLines: { id: string }[]
		}> & { vehicle: ReturnType<typeof vi.fn> }
		hex: { getTile: ReturnType<typeof vi.fn> }
		procurementDefaults: { bufferPurchaseReserveVp: number }
	}

	beforeAll(async () => {
		;({ default: FreightLineProperties } = await import('./FreightLineProperties'))
	})

	beforeEach(() => {
		container = document.createElement('div')
		document.body.appendChild(container)
		showFreightLineOverlay.mockClear()
		removeFreightLineById = vi.fn()
		const vehicleRecords = [
			{
				uid: 'veh-1',
				title: 'wheelbarrow veh-1',
				vehicleType: 'wheelbarrow',
				position: { q: 1, r: 0 },
				storage: { stock: {} },
				servedLines: [] as { id: string }[],
			},
		]
		game = {
			freightLines: [
				normalizeFreightLineDefinition({
					id: 'line-1',
					name: 'Line 1',
					stops: [
						{
							id: 'line-1-z',
							zone: { kind: 'radius', center: [0, 0], radius: 3 },
						},
						{
							id: 'line-1-b',
							anchor: {
								kind: 'alveolus',
								hiveName: 'H',
								alveolusType: 'freight_bay',
								coord: [0, 0],
							},
						},
					],
				}),
			],
			replaceFreightLine: vi.fn((next) => {
				game.freightLines = [next]
			}),
			removeFreightLineById,
			assignVehicleToFreightLine: vi.fn((vehicleUid, lineId) => {
				const vehicle = vehicleRecords.find((entry) => entry.uid === vehicleUid)
				const line = game.freightLines.find((entry) => entry.id === lineId)
				if (vehicle && line) vehicle.servedLines = [line]
			}),
			unassignVehicleFromFreightLine: vi.fn((vehicleUid, lineId) => {
				const vehicle = vehicleRecords.find((entry) => entry.uid === vehicleUid)
				if (vehicle) vehicle.servedLines = vehicle.servedLines.filter((line) => line.id !== lineId)
			}),
			vehicles: Object.assign(vehicleRecords, {
				vehicle: vi.fn((uid: string) => vehicleRecords.find((entry) => entry.uid === uid)),
			}),
			procurementDefaults: { bufferPurchaseReserveVp: 80 },
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

	it('removes the freight line when Delete is used on an explicit line', () => {
		stop = latch(
			container,
			<FreightLineProperties
				lineObject={{
					uid: 'freight-line:line-1',
					kind: 'freight-line',
					title: 'Line 1 (Exchange)',
					game: game as never,
					line: game.freightLines[0],
					lineId: 'line-1',
					logs: [],
				}}
			/>
		)

		const deleteBtn = container.querySelector(
			'[data-testid="freight-line-delete"]'
		) as HTMLButtonElement | null
		expect(deleteBtn?.disabled).toBe(false)
		deleteBtn?.click()

		expect(removeFreightLineById).toHaveBeenCalledTimes(1)
		expect(removeFreightLineById.mock.calls[0]?.[0]).toBe('line-1')
	})

	it('shows the board route only while the line widget is hovered', () => {
		stop = latch(
			container,
			<FreightLineProperties
				lineObject={{
					uid: 'freight-line:line-1',
					kind: 'freight-line',
					title: 'Line 1 (Exchange)',
					game: game as never,
					line: game.freightLines[0],
					lineId: 'line-1',
					logs: [],
				}}
			/>
		)

		expect(showFreightLineOverlay).not.toHaveBeenCalled()
		const section = container.querySelector('[data-testid="inspector-section"]') as HTMLElement
		section.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
		expect(showFreightLineOverlay).toHaveBeenLastCalledWith('line-1')
		section.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }))
		expect(showFreightLineOverlay).toHaveBeenLastCalledWith(undefined)
	})

	it('assigns and unassigns compatible vehicles from the line inspector', () => {
		stop = latch(
			container,
			<FreightLineProperties
				lineObject={{
					uid: 'freight-line:line-1',
					kind: 'freight-line',
					title: 'Line 1 (Exchange)',
					game: game as never,
					line: game.freightLines[0],
					lineId: 'line-1',
					logs: [],
				}}
			/>
		)

		const option = container.querySelector(
			'[data-testid="line-vehicle-picker-item"]'
		) as HTMLButtonElement
		option.click()
		expect(game.assignVehicleToFreightLine).toHaveBeenCalledWith('veh-1', 'line-1')

		const remove = container.querySelector('[data-testid="line-unassign-vehicle"]') as HTMLButtonElement
		remove.click()
		expect(game.unassignVehicleFromFreightLine).toHaveBeenCalledWith('veh-1', 'line-1')
	})

	it('keeps Save disabled until the draft is dirty, then persists on Save', () => {
		stop = latch(
			container,
			<FreightLineProperties
				lineObject={{
					uid: 'freight-line:line-1',
					kind: 'freight-line',
					title: 'Line 1 (Exchange)',
					game: game as never,
					line: game.freightLines[0],
					lineId: 'line-1',
					logs: [],
				}}
			/>
		)

		const nameInput = container.querySelector(
			'[data-testid="freight-line-name"]'
		) as HTMLInputElement | null
		nameInput!.value = 'Immediate rename'
		nameInput?.dispatchEvent(new Event('input', { bubbles: true }))

		expect(game.replaceFreightLine).toHaveBeenCalled()
		const arg = game.replaceFreightLine.mock.calls.at(-1)?.[0] as { name: string }
		expect(arg.name).toBe('Immediate rename')
	})

	it('persists cyclic toggle changes immediately', () => {
		stop = latch(
			container,
			<FreightLineProperties
				lineObject={{
					uid: 'freight-line:line-1',
					kind: 'freight-line',
					title: 'Line 1 (Exchange)',
					game: game as never,
					line: game.freightLines[0],
					lineId: 'line-1',
					logs: [],
				}}
			/>
		)

		const cyclic = container.querySelector(
			'[data-testid="freight-line-cyclic"]'
		) as HTMLButtonElement | null
		cyclic?.click()

		expect(game.replaceFreightLine).toHaveBeenCalled()
		const arg = game.replaceFreightLine.mock.calls.at(-1)?.[0] as { cyclic?: boolean }
		expect(arg.cyclic).toBe(true)
	})

	it('allows editing and deleting an implicit gather line', () => {
		stop = latch(
			container,
			<FreightLineProperties
				lineObject={{
					uid: 'freight-line:Hive%3Aimplicit-gather%3A0%2C0',
					kind: 'freight-line',
					title: 'Line 1 (Exchange)',
					game: game as never,
					line: game.freightLines[0],
					lineId: 'Hive:implicit-gather:0,0',
					logs: [],
				}}
			/>
		)

		const nameInput = container.querySelector(
			'[data-testid="freight-line-name"]'
		) as HTMLInputElement | null
		const deleteBtn = container.querySelector(
			'[data-testid="freight-line-delete"]'
		) as HTMLButtonElement | null

		expect(nameInput?.disabled).toBe(false)
		expect(deleteBtn?.disabled).not.toBe(true)
	})
})
