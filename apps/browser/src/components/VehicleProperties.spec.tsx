import { document, latch } from '@sursaut/core'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const i18nState = {
	translator: {
		goods: 'Goods',
		character: {
			plannerRankedWork: 'Ranked work',
			plannerWorkUrgency: 'urgency',
			plannerWorkPath: 'path',
			plannerWorkKinds: {
				convey: 'Convey',
				vehicleHop: 'Vehicle hop',
			},
		},
		line: { stop: 'Stop' },
		vehicle: {
			operator: 'Operator',
			service: 'Service',
			idle: 'Idle',
			offloadService: 'Offload',
			docked: 'Docked',
			underway: 'Underway',
		},
	},
}

vi.mock('@app/lib/css', () => ({
	css: () => '',
}))

vi.mock('engine-pixi/assets/visual-content', () => ({
	vehicles: {
		wheelbarrow: { sprites: ['vehicles.wheelbarrow'] },
	},
}))

vi.mock('engine-pixi/renderers/vehicle-visual', () => ({
	vehicleTextureKey: () => 'vehicles.wheelbarrow',
}))

vi.mock('ssh/i18n', () => ({
	i18nState,
}))

vi.mock('ssh/freight/freight-line', async (importOriginal) => {
	const actual = await importOriginal<typeof import('ssh/freight/freight-line')>()
	return {
		...actual,
		createSyntheticFreightLineObject: (
			game: unknown,
			line: { id: string; name: string; stops: readonly unknown[] }
		) => ({
			kind: 'freight-line' as const,
			uid: `freight-line:${line.id}`,
			title: `${line.name} (test)`,
			game: game as never,
			line: line as never,
			lineId: line.id,
			tile: undefined,
			position: undefined,
			logs: [],
			hoverObject: undefined,
		}),
	}
})

vi.mock('./EntityBadge', () => ({
	default: (props: { text?: string }) => <div data-testid="vehicle-entity-badge">{props.text}</div>,
}))

vi.mock('./GoodsList', () => ({
	default: () => <div data-testid="goods-list" />,
}))

vi.mock('./InspectorObjectLink', () => ({
	default: (props: { object?: { uid?: string }; label?: string }) => (
		<button type="button" data-testid="inspector-object-link" data-target-uid={props.object?.uid}>
			{props.label ?? props.object?.uid ?? 'link'}
		</button>
	),
}))

vi.mock('./LinkedEntityControl', () => ({
	default: (props: { object?: { uid?: string } }) => (
		<div data-testid="linked-entity-control" data-target-uid={props.object?.uid ?? ''}>
			{props.object?.uid ?? 'linked'}
		</div>
	),
}))

vi.mock('./PropertyGrid', () => ({
	default: (props: { children?: JSX.Children; class?: string }) => (
		<table class={props.class}>
			<tbody>{props.children}</tbody>
		</table>
	),
}))

vi.mock('./PropertyGridRow', () => ({
	default: (props: { label?: string; children?: JSX.Children; class?: string }) => (
		<tr class={props.class}>
			{props.label ? <th>{props.label}</th> : null}
			<td>{props.children}</td>
		</tr>
	),
}))

vi.mock('@app/ui/anarkai', () => ({
	InspectorSection: (props: { children?: JSX.Children }) => <section>{props.children}</section>,
}))

let VehicleProperties: typeof import('./VehicleProperties').default

describe('VehicleProperties', () => {
	let container: HTMLElement
	let stop: (() => void) | undefined

	beforeAll(async () => {
		;({ default: VehicleProperties } = await import('./VehicleProperties'))
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

	it('shows operator links when an operator is present', () => {
		const operator = { uid: 'char-1', title: 'Ari', tile: { uid: 'tile:0,0' } }
		const vehicle = {
			uid: 'veh-1',
			title: 'wheelbarrow veh-1',
			vehicleType: 'wheelbarrow',
			game: {},
			operator,
			storage: { stock: {} },
			service: { operator, line: { id: 'L1', name: 'Line A', stops: [] }, stop: { id: 's1' }, docked: false },
		}

		stop = latch(container, <VehicleProperties vehicle={vehicle as never} />, {
			setTitle: vi.fn(),
		} as never)

		const links = container.querySelectorAll('[data-testid="inspector-object-link"]')
		const operatorLink = [...links].find((el) => el.getAttribute('data-target-uid') === 'char-1')
		expect(operatorLink).toBeDefined()
	})

	it('renders goods list for storage stock', () => {
		const vehicle = {
			uid: 'veh-2',
			title: 'wheelbarrow veh-2',
			vehicleType: 'wheelbarrow',
			game: {},
			storage: { stock: { berries: 3 } },
			service: undefined,
		}

		stop = latch(container, <VehicleProperties vehicle={vehicle as never} />, {
			setTitle: vi.fn(),
		} as never)

		expect(container.querySelector('[data-testid="goods-list"]')).not.toBeNull()
	})

	it('shows line service summary and freight line links', () => {
		const vehicle = {
			uid: 'veh-3',
			title: 'wheelbarrow veh-3',
			vehicleType: 'wheelbarrow',
			game: {},
			storage: { stock: {} },
			service: {
				line: { id: 'L1', name: 'North route', stops: [{ id: 'stop-1', anchor: { kind: 'alveolus', hiveName: 'H', alveolusType: 'freight_bay', coord: [0, 0] as const } }] },
				stop: { id: 'stop-1', anchor: { kind: 'alveolus', hiveName: 'H', alveolusType: 'freight_bay', coord: [0, 0] as const } },
				docked: true,
			},
		}

		stop = latch(container, <VehicleProperties vehicle={vehicle as never} />, {
			setTitle: vi.fn(),
		} as never)

		expect(container.textContent).toContain('North route')
		expect(container.textContent).toContain('Stop stop-1')
		expect(container.textContent).toContain('Docked')

		const lineLinks = [...container.querySelectorAll('[data-testid="inspector-object-link"]')].filter(
			(el) => el.getAttribute('data-target-uid') === 'freight-line:L1'
		)
		expect(lineLinks.length).toBeGreaterThan(0)
	})

	it('shows offload text when service is offload-only', () => {
		const vehicle = {
			uid: 'veh-4',
			title: 'wheelbarrow veh-4',
			vehicleType: 'wheelbarrow',
			game: {},
			storage: { stock: {} },
			service: {
				kind: 'park' as const,
				targetCoord: { q: 0, r: 0 },
			},
		}

		stop = latch(container, <VehicleProperties vehicle={vehicle as never} />, {
			setTitle: vi.fn(),
		} as never)

		expect(container.textContent).toContain('Offload')
		expect(
			[...container.querySelectorAll('[data-testid="inspector-object-link"]')].some((el) =>
				el.getAttribute('data-target-uid')?.startsWith('freight-line:')
			)
		).toBe(false)
	})

	it('shows operator ranked work when the operator has a work planner snapshot', () => {
		const operator = {
			uid: 'char-jobs',
			title: 'Bo',
			game: {
				hex: {
					getTile: ({ q, r }: { q: number; r: number }) => ({
						uid: `tile:${q},${r}`,
						title: `Tile ${q}, ${r}`,
					}),
				},
			},
			workPlannerSnapshot: {
				ranked: [
					{
						jobKind: 'convey',
						targetLabel: 'wood @ 0, 1',
						targetCoord: { q: 0, r: 1 },
						urgency: 4,
						pathLength: 1,
						score: 2,
						selected: true,
					},
					{
						jobKind: 'vehicleHop',
						targetLabel: 'bay @ 2, 0',
						targetCoord: { q: 2, r: 0 },
						urgency: 1,
						pathLength: 3,
						score: 0.5,
						selected: false,
					},
				],
			},
		}
		const vehicle = {
			uid: 'veh-jobs',
			title: 'wheelbarrow veh-jobs',
			vehicleType: 'wheelbarrow',
			game: operator.game,
			operator,
			storage: { stock: {} },
			service: undefined,
		}

		stop = latch(container, <VehicleProperties vehicle={vehicle as never} />, {
			setTitle: vi.fn(),
		} as never)

		const rows = Array.from(
			container.querySelectorAll('[data-testid="vehicle-ranked-work"]')
		) as HTMLDivElement[]
		expect(rows).toHaveLength(2)
		expect(rows[0]?.textContent).toContain('Convey')
		expect(rows[0]?.textContent).toContain('tile:0,1')
		expect(rows[0]?.getAttribute('data-selected')).toBe('true')
		expect(rows[1]?.textContent).toContain('Vehicle hop')
	})

	it('shows idle when there is no service', () => {
		const vehicle = {
			uid: 'veh-5',
			title: 'wheelbarrow veh-5',
			vehicleType: 'wheelbarrow',
			game: {},
			storage: { stock: {} },
			service: undefined,
		}

		stop = latch(container, <VehicleProperties vehicle={vehicle as never} />, {
			setTitle: vi.fn(),
		} as never)

		expect(container.textContent).toContain('Idle')
	})
})
