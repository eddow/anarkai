import { document, latch } from '@sursaut/core'
import { debugObjectId } from 'ssh/dev/debug-object-id'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@app/lib/css', () => ({
	css: () => '',
}))

const { game, selectInspectorObject, showFreightLineOverlay } = vi.hoisted(() => ({
	game: {
		freightLines: [] as any[],
		vehicles: [] as any[],
		renderer: {
			app: { screen: { width: 100, height: 100 } },
			world: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 } },
		},
		hex: {
			getTile: vi.fn((coord: { q: number; r: number }) => ({
				position: coord,
			})),
		},
		getSettlementTradeProfileAtCenter: vi.fn(),
	},
	selectInspectorObject: vi.fn(),
	showFreightLineOverlay: vi.fn(),
}))

vi.mock('@app/lib/globals', () => ({ game }))
vi.mock('@app/lib/follow-selection', () => ({ selectInspectorObject }))
vi.mock('@app/lib/freight-line-overlay', () => ({ showFreightLineOverlay }))
vi.mock('@app/ui/anarkai/icons/render-icon', () => ({
	renderAnarkaiIcon: (source: string) => <span data-testid="filter-icon">{source}</span>,
}))
vi.mock('@app/ui/anarkai', () => ({
	InspectorSection: (props: { title?: string; class?: string; children?: unknown }) => (
		<section class={props.class} aria-label={props.title}>
			{props.children}
		</section>
	),
	Panel: (props: { class?: string; children?: unknown }) => (
		<div class={props.class}>{props.children}</div>
	),
}))

let LinesManagementWidget: typeof import('./lines-management').default

const line = (name: string, stops: any[]) => ({ name, stops })
const anchorStop = (q: number, r: number) => ({
	anchor: { kind: 'alveolus', hiveName: '', alveolusType: 'freight_bay', coord: [q, r] },
})
const radiusStop = (q: number, r: number) => ({
	zone: { kind: 'radius', center: [q, r], radius: 1 },
})

function props() {
	return { title: '', params: {}, context: {} } as any
}

function scope() {
	return { dockviewApi: { id: 'dock' } } as any
}

function rows(container: HTMLElement) {
	return [...container.querySelectorAll('[data-testid="line-management-row"]')]
}

function rowIds(container: HTMLElement) {
	return rows(container).map((node) => node.getAttribute('data-line-id'))
}

describe('LinesManagementWidget', () => {
	let container: HTMLElement
	let stop: (() => void) | undefined

	beforeAll(async () => {
		;({ default: LinesManagementWidget } = await import('./lines-management'))
	})

	beforeEach(() => {
		game.freightLines = [
			line('Bay Materials', [anchorStop(0, 0)]),
			line('Remote Zone', [radiusStop(100, 100)]),
			line('Snack Shuttle', [radiusStop(120, 120)]),
		]
		game.vehicles = []
		game.renderer = {
			app: { screen: { width: 100, height: 100 } },
			world: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 } },
		}
		game.getSettlementTradeProfileAtCenter.mockReset()
		selectInspectorObject.mockClear()
		showFreightLineOverlay.mockClear()
		container = document.createElement('div')
		document.body.appendChild(container)
	})

	afterEach(() => {
		stop?.()
		stop = undefined
		container.remove()
		document.body.innerHTML = ''
	})

	it('renders all freight lines by default and filters names case-insensitively', () => {
		const bay = line('Bay Materials', [anchorStop(0, 0)])
		const zone = line('Remote Zone', [radiusStop(100, 100)])
		const snack = line('Snack Shuttle', [radiusStop(120, 120)])
		game.freightLines = [bay, zone, snack]

		stop = latch(container, <LinesManagementWidget {...props()} />, scope())

		expect(rowIds(container)).toEqual([bay, zone, snack].map((l) => debugObjectId(l)))

		const input = container.querySelector('[aria-label="Filter lines by name"]') as HTMLInputElement
		input.value = 'sNaCk'
		input.dispatchEvent(new Event('input', { bubbles: true }))

		expect(rowIds(container)).toEqual([debugObjectId(snack)])
	})

	it('shows exchange-route pickup and delivery summaries', () => {
		game.freightLines = [
			line('Material Loop', [
				radiusStop(0, 0),
				anchorStop(0, 0),
				anchorStop(1, 0),
				radiusStop(1, 0),
			]),
		]
		stop = latch(container, <LinesManagementWidget {...props()} />, scope())

		expect(rows(container)[0]?.textContent).toContain('1 pickup + 1 delivery')
	})

	it('filters bay-backed lines out with No bay', () => {
		const bay = line('Bay Materials', [anchorStop(0, 0)])
		const zone = line('Remote Zone', [radiusStop(100, 100)])
		const snack = line('Snack Shuttle', [radiusStop(120, 120)])
		game.freightLines = [bay, zone, snack]

		stop = latch(container, <LinesManagementWidget {...props()} />, scope())

		const bayFilter = container.querySelector(
			'[aria-label="Filter lines by bay"]'
		) as HTMLButtonElement
		expect(bayFilter.getAttribute('aria-checked')).toBe('false')
		bayFilter.click()

		expect(bayFilter.getAttribute('aria-checked')).toBe('true')
		expect(rowIds(container)).toEqual([debugObjectId(zone), debugObjectId(snack)])
	})

	it('visible filter includes visible stops and actively serving vehicles only', () => {
		const visibleStop = line('Visible Stop', [radiusStop(0, 0)])
		const servedVisible = line('Served Visible', [radiusStop(120, 120)])
		const assignedIdle = line('Assigned Idle', [radiusStop(130, 130)])
		const servingOther = line('Serving Other', [radiusStop(140, 140)])
		game.freightLines = [visibleStop, servedVisible, assignedIdle, servingOther]
		game.vehicles = [
			{
				position: { q: 0, r: 0 },
				servedLines: [assignedIdle],
				service: undefined,
			},
			{
				position: { q: 0, r: 0 },
				servedLines: [servedVisible],
				service: { line: servedVisible, stop: servedVisible.stops[0], docked: false },
			},
			{
				position: { q: 0, r: 0 },
				servedLines: [servingOther],
				service: { line: visibleStop, stop: visibleStop.stops[0], docked: false },
			},
		]
		stop = latch(container, <LinesManagementWidget {...props()} />, scope())

		const visibility = container.querySelector(
			'[aria-label="Filter lines by visibility"]'
		) as HTMLButtonElement
		expect(visibility.getAttribute('aria-checked')).toBe('false')
		visibility.click()

		expect(visibility.getAttribute('aria-checked')).toBe('true')
		expect(rowIds(container)).toEqual([debugObjectId(visibleStop), debugObjectId(servedVisible)])
	})

	it('hovers and clicks rows through the freight overlay and inspector path', async () => {
		stop = latch(container, <LinesManagementWidget {...props()} />, scope())
		await new Promise((r) => setTimeout(r, 0))

		const first = rows(container)[0] as HTMLButtonElement
		first.dispatchEvent(new MouseEvent('mouseenter'))
		expect(showFreightLineOverlay).toHaveBeenNthCalledWith(1, game.freightLines[0])

		first.dispatchEvent(new MouseEvent('mouseleave'))
		expect(showFreightLineOverlay).toHaveBeenLastCalledWith(undefined)

		first.click()
		expect(selectInspectorObject).toHaveBeenCalledTimes(1)
		expect(selectInspectorObject.mock.calls[0]?.[0]).toMatchObject({
			kind: 'freight-line',
		})
	})
})
