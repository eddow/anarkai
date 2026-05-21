import { document, latch } from '@sursaut/core'
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
				uid: `tile:${coord.q},${coord.r}`,
				position: coord,
			})),
		},
		getSettlementTradeProfile: vi.fn(),
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

const line = (id: string, name: string, stops: any[]) => ({ id, name, stops })
const anchorStop = (q: number, r: number) => ({
	id: `anchor-${q}-${r}`,
	anchor: { kind: 'alveolus', hiveName: '', alveolusType: 'freight_bay', coord: [q, r] },
})
const radiusStop = (q: number, r: number) => ({
	id: `zone-${q}-${r}`,
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
			line('bay-line', 'Bay Materials', [anchorStop(0, 0)]),
			line('zone-line', 'Remote Zone', [radiusStop(100, 100)]),
			line('snack-line', 'Snack Shuttle', [radiusStop(120, 120)]),
		]
		game.vehicles = []
		game.renderer = {
			app: { screen: { width: 100, height: 100 } },
			world: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 } },
		}
		game.getSettlementTradeProfile.mockReset()
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
		stop = latch(container, <LinesManagementWidget {...props()} />, scope())

		expect(rowIds(container)).toEqual(['bay-line', 'zone-line', 'snack-line'])

		const input = container.querySelector('[aria-label="Filter lines by name"]') as HTMLInputElement
		input.value = 'sNaCk'
		input.dispatchEvent(new Event('input', { bubbles: true }))

		expect(rowIds(container)).toEqual(['snack-line'])
	})

	it('filters bay-backed lines out with No bay', () => {
		stop = latch(container, <LinesManagementWidget {...props()} />, scope())

		const bay = container.querySelector('[aria-label="Filter lines by bay"]') as HTMLButtonElement
		expect(bay.getAttribute('aria-checked')).toBe('false')
		bay.click()

		expect(bay.getAttribute('aria-checked')).toBe('true')
		expect(rowIds(container)).toEqual(['zone-line', 'snack-line'])
	})

	it('visible filter includes visible stops and actively serving vehicles only', () => {
		game.freightLines = [
			line('visible-stop', 'Visible Stop', [radiusStop(0, 0)]),
			line('served-visible', 'Served Visible', [radiusStop(120, 120)]),
			line('assigned-idle', 'Assigned Idle', [radiusStop(130, 130)]),
			line('serving-other', 'Serving Other', [radiusStop(140, 140)]),
		]
		game.vehicles = [
			{
				position: { q: 0, r: 0 },
				servedLines: [game.freightLines[2]],
				service: undefined,
			},
			{
				position: { q: 0, r: 0 },
				servedLines: [game.freightLines[1]],
				service: { line: game.freightLines[1], stop: game.freightLines[1].stops[0], docked: false },
			},
			{
				position: { q: 0, r: 0 },
				servedLines: [game.freightLines[3]],
				service: { line: game.freightLines[0], stop: game.freightLines[0].stops[0], docked: false },
			},
		]
		stop = latch(container, <LinesManagementWidget {...props()} />, scope())

		const visibility = container.querySelector(
			'[aria-label="Filter lines by visibility"]'
		) as HTMLButtonElement
		expect(visibility.getAttribute('aria-checked')).toBe('false')
		visibility.click()

		expect(visibility.getAttribute('aria-checked')).toBe('true')
		expect(rowIds(container)).toEqual(['visible-stop', 'served-visible'])
	})

	it('hovers and clicks rows through the freight overlay and inspector path', () => {
		stop = latch(container, <LinesManagementWidget {...props()} />, scope())

		const first = rows(container)[0] as HTMLButtonElement
		first.dispatchEvent(new MouseEvent('mouseenter'))
		expect(showFreightLineOverlay).toHaveBeenLastCalledWith('bay-line')

		first.dispatchEvent(new MouseEvent('mouseleave'))
		expect(showFreightLineOverlay).toHaveBeenLastCalledWith(undefined)

		first.click()
		expect(selectInspectorObject).toHaveBeenCalledTimes(1)
		expect(selectInspectorObject.mock.calls[0]?.[0]).toMatchObject({
			kind: 'freight-line',
			lineId: 'bay-line',
		})
	})
})
