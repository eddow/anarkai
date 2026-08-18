// @ts-nocheck
import {
	consumePresentationEvents,
	resetPresentationRevisionsForTests,
} from '@app/lib/presentation-events'
import { document, latch } from '@sursaut/core'
import { disconnectAllProfiles, profile, setProfileLevel } from 'ssh/dev/debug'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const activeWorldViewPov = vi.hoisted(() => ({
	viewId: 'primary',
	center: undefined as { q: number; r: number } | undefined,
}))

vi.mock('@app/lib/globals', () => ({
	activeWorldViewPov,
}))

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

vi.mock('@app/lib/i18n', () => ({
	i18nState,
	T: i18nState.translator,
	getTranslator: () => i18nState.translator,
}))

vi.mock('ssh/freight/freight-line', async (importOriginal) => {
	const actual = await importOriginal<typeof import('ssh/freight/freight-line')>()
	return {
		...actual,
		createSyntheticFreightLineObject: (
			game: unknown,
			line: { name: string; stops: readonly unknown[] }
		) => ({
			kind: 'freight-line' as const,
			title: `${line.name} (test)`,
			game: game as never,
			line: line as never,
			tile: undefined,
			position: undefined,
			logs: [],
			hoverObject: undefined,
		}),
	}
})

vi.mock('../EntityBadge', () => ({
	default: (props: { text?: string }) => <div data-testid="vehicle-entity-badge">{props.text}</div>,
}))

vi.mock('../GoodsList', () => ({
	default: (props: {
		goods?: string[]
		getBadgeProps?: (good: string) => { qty?: number | string | undefined }
	}) => (
		<div data-testid="goods-list">
			{(props.goods ?? []).map((good) => (
				<span data-testid={`vehicle-good-${good}`}>
					{String(props.getBadgeProps?.(good)?.qty ?? '')}
				</span>
			))}
		</div>
	),
}))

vi.mock('../InspectorObjectLink', () => ({
	default: (props: { object?: { title?: string }; label?: string }) => (
		<button type="button" data-testid="inspector-object-link">
			{props.label ?? props.object?.title ?? 'link'}
		</button>
	),
}))

vi.mock('../LinkedEntityControl', () => ({
	default: (props: { object?: { title?: string } }) => (
		<div data-testid="linked-entity-control">{props.object?.title ?? 'linked'}</div>
	),
}))

vi.mock('../PropertyGrid', () => ({
	default: (props: { children?: JSX.Children; class?: string }) => (
		<table class={props.class}>
			<tbody>{props.children}</tbody>
		</table>
	),
}))

vi.mock('../PropertyGridRow', () => ({
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

vi.mock('../HardListSearchPicker', () => ({
	default: (props: {
		items?: readonly { item?: unknown; label?: string }[]
		onSelect?: (item: { item?: unknown; label?: string }) => void
		testId?: string
	}) => (
		<div>
			{(props.items ?? []).map((item) => (
				<button
					type="button"
					data-testid={`${props.testId ?? 'search-picker'}-item`}
					onClick={() => props.onSelect?.(item)}
				>
					{item.label}
				</button>
			))}
		</div>
	),
}))

let VehicleProperties: typeof import('./VehicleProperties').default

describe('VehicleProperties', () => {
	let container: HTMLElement
	let stop: (() => void) | undefined

	beforeAll(async () => {
		;({ default: VehicleProperties } = await import('./VehicleProperties'))
	})

	beforeEach(() => {
		resetPresentationRevisionsForTests()
		activeWorldViewPov.viewId = 'primary'
		activeWorldViewPov.center = { q: 0, r: 0 }
		container = document.createElement('div')
		document.body.appendChild(container)
	})

	afterEach(() => {
		stop?.()
		stop = undefined
		setProfileLevel('proposedJobs', undefined)
		disconnectAllProfiles()
		container.remove()
		document.body.innerHTML = ''
	})

	it('shows operator links when an operator is present', () => {
		const operator = { title: 'Ari', tile: {} }
		const vehicle = {
			title: 'wheelbarrow veh-1',
			vehicleType: 'wheelbarrow',
			game: {},
			operator,
			storage: { stock: {} },
			service: {
				operator,
				line: { name: 'Line A', stops: [] },
				stop: {},
				docked: false,
			},
		}

		stop = latch(container, <VehicleProperties vehicle={vehicle as never} />, {
			setTitle: vi.fn(),
		} as never)

		const links = container.querySelectorAll('[data-testid="inspector-object-link"]')
		const operatorLink = [...links].find((el) => el.textContent?.includes('Ari'))
		expect(operatorLink).toBeDefined()
	})

	it('renders goods list for storage stock', () => {
		const vehicle = {
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

	it('refreshes storage stock when the vehicle receives a storage presentation event', async () => {
		let stock = { berries: 3 }
		const vehicle = {
			title: 'wheelbarrow refresh',
			vehicleType: 'wheelbarrow',
			game: {},
			storage: {
				get stock() {
					return stock
				},
			},
			service: undefined,
		}

		stop = latch(container, <VehicleProperties vehicle={vehicle as never} />, {
			setTitle: vi.fn(),
		} as never)

		expect(container.querySelector('[data-testid="vehicle-good-berries"]')?.textContent).toBe('3')

		stock = { berries: 4 }
		await new Promise((resolve) => setTimeout(resolve, 0))
		expect(container.querySelector('[data-testid="vehicle-good-berries"]')?.textContent).toBe('3')

		consumePresentationEvents([{ type: 'storage.changed', owner: vehicle as any }])
		await new Promise((resolve) => setTimeout(resolve, 0))
		await new Promise((resolve) => setTimeout(resolve, 0))

		expect(container.querySelector('[data-testid="vehicle-good-berries"]')?.textContent).toBe('4')
	})

	it('shows line service summary and freight line links', () => {
		const stopRef = {
			anchor: {
				kind: 'alveolus' as const,
				hiveName: 'H',
				alveolusType: 'freight_bay',
				coord: [0, 0] as const,
			},
		}
		const lineRef = {
			id: 'L1',
			name: 'North route',
			stops: [stopRef],
		}
		const vehicle = {
			title: 'wheelbarrow veh-3',
			vehicleType: 'wheelbarrow',
			game: {},
			storage: { stock: {} },
			service: {
				line: lineRef,
				stop: stopRef,
				docked: true,
			},
		}

		stop = latch(container, <VehicleProperties vehicle={vehicle as never} />, {
			setTitle: vi.fn(),
		} as never)

		expect(container.textContent).toContain('North route')
		expect(container.textContent).toContain('Stop 0')
		expect(container.textContent).toContain('Docked')

		const lineLinks = [
			...container.querySelectorAll('[data-testid="inspector-object-link"]'),
		].filter((el) => el.textContent?.includes('North route'))
		expect(lineLinks.length).toBeGreaterThan(0)
	})

	it('assigns and unassigns served freight lines without changing active service text', async () => {
		const stopA = { id: 'a', zone: { kind: 'radius' as const, center: [1, 0] as const, radius: 1 } }
		const lineA = {
			id: 'L1',
			name: 'North route',
			stops: [stopA],
		}
		const lineB = {
			id: 'L2',
			name: 'South route',
			stops: [{ id: 'b', zone: { kind: 'radius', center: [2, 0] as const, radius: 1 } }],
		}
		const vehicle = {
			title: 'wheelbarrow lines',
			vehicleType: 'wheelbarrow',
			storage: { stock: {} },
			servedLines: [lineA] as any[],
			service: {
				line: lineA,
				stop: stopA,
				docked: false,
			},
			game: {
				freightLines: [lineA, lineB],
				assignVehicleToFreightLine: vi.fn((_v: any, line: any) => {
					vehicle.servedLines = [...vehicle.servedLines, line]
				}),
				unassignVehicleFromFreightLine: vi.fn((_v: any, line: any) => {
					vehicle.servedLines = vehicle.servedLines.filter((l) => l !== line)
				}),
			},
		}

		stop = latch(container, <VehicleProperties vehicle={vehicle as never} />, {
			setTitle: vi.fn(),
		} as never)

		expect(container.textContent).toContain('North route · Stop 0 · Underway')
		expect(
			container.querySelector(
				'[data-testid="vehicle-assigned-line"] [data-testid="inspector-object-link"]'
			)?.textContent
		).toContain('North route')

		;(
			container.querySelector('[data-testid="vehicle-line-picker-item"]') as HTMLButtonElement
		).click()
		expect(vehicle.game.assignVehicleToFreightLine).toHaveBeenCalledWith(
			expect.objectContaining({ title: 'wheelbarrow lines' }),
			lineB
		)
		await new Promise((r) => setTimeout(r, 0))

		expect(container.querySelector('[data-testid="vehicle-unassign-line"]')).not.toBeNull()
		expect(container.textContent).toContain('North route · Stop 0 · Underway')
	})

	it('shows offload text when service is offload-only', () => {
		const vehicle = {
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
		expect(container.textContent).not.toContain('freight-line:')
	})

	it('shows proposed vehicle jobs without character contract details', () => {
		const operator = { title: 'Bo' }
		const targetTile = {
			title: 'Tile 2, 0',
			position: { x: 2, y: 0 },
		}
		const vehicle = {
			title: 'wheelbarrow veh-jobs',
			vehicleType: 'wheelbarrow',
			game: {},
			operator,
			storage: { stock: {} },
			service: undefined,
			get proposedJobs() {
				return [
					{
						job: 'vehicleOffload',
						maintenanceKind: 'unloadToTile',
						vehicleUid: 'veh-jobs',
						targetCoord: { q: 2, r: 0 },
						path: [],
						urgency: 4,
						fatigue: 1,
						source: { kind: 'vehicle', vehicle: undefined },
						targetTile,
					},
				]
			},
		}

		stop = latch(container, <VehicleProperties vehicle={vehicle as never} />, {
			setTitle: vi.fn(),
		} as never)

		const rows = Array.from(
			container.querySelectorAll('[data-testid="vehicle-proposed-job"]')
		) as HTMLDivElement[]
		expect(rows).toHaveLength(1)
		expect(rows[0]?.textContent).toContain('vehicleOffload')
		expect(rows[0]?.textContent).toContain('unloadToTile')
		expect(rows[0]?.textContent).not.toContain('Bo')
	})

	it('reads proposed vehicle jobs once for the proposed-job render', () => {
		const targetTile = {
			title: 'Tile 2, 0',
			position: { x: 2, y: 0 },
		}
		const proposedJobsGetter = vi.fn(() => [
			{
				job: 'vehicleOffload',
				maintenanceKind: 'unloadToTile',
				vehicleUid: 'veh-jobs',
				targetCoord: { q: 2, r: 0 },
				path: [],
				urgency: 4,
				fatigue: 1,
				source: { kind: 'vehicle', vehicle: undefined },
				targetTile,
			},
		])
		const vehicle = {
			title: 'wheelbarrow veh-jobs',
			vehicleType: 'wheelbarrow',
			game: {},
			storage: { stock: {} },
			service: undefined,
			get proposedJobs() {
				return proposedJobsGetter()
			},
		}

		stop = latch(container, <VehicleProperties vehicle={vehicle as never} />, {
			setTitle: vi.fn(),
		} as never)

		expect(container.querySelectorAll('[data-testid="vehicle-proposed-job"]')).toHaveLength(1)
		expect(proposedJobsGetter).toHaveBeenCalledTimes(1)
	})

	it('uses advertised vehicle jobs without touching proposed planner jobs', () => {
		const targetTile = {
			title: 'Tile 2, 0',
			position: { x: 2, y: 0 },
		}
		const advertisedJobsGetter = vi.fn(() => [
			{
				job: 'vehicleOffload',
				maintenanceKind: 'park',
				vehicleUid: 'veh-advertised',
				targetCoord: { q: 2, r: 0 },
				path: [],
				urgency: 3,
				fatigue: 1,
				source: { kind: 'vehicle', vehicle: undefined },
				targetTile,
			},
		])
		const proposedJobsGetter = vi.fn(() => [])
		const vehicle = {
			title: 'wheelbarrow veh-advertised',
			vehicleType: 'wheelbarrow',
			game: {},
			storage: { stock: {} },
			service: undefined,
			get advertisedJobs() {
				return advertisedJobsGetter()
			},
			get proposedJobs() {
				return proposedJobsGetter()
			},
		}

		stop = latch(container, <VehicleProperties vehicle={vehicle as never} />, {
			setTitle: vi.fn(),
		} as never)

		expect(container.querySelectorAll('[data-testid="vehicle-proposed-job"]')).toHaveLength(1)
		expect(advertisedJobsGetter).toHaveBeenCalledTimes(1)
		expect(proposedJobsGetter).not.toHaveBeenCalled()
	})

	it('profiles vehicle properties as the parent of proposed vehicle jobs', () => {
		setProfileLevel('proposedJobs', 'summary')
		const targetTile = {
			title: 'Tile 2, 0',
			position: { x: 2, y: 0 },
		}
		const vehicle = {
			title: 'wheelbarrow veh-profile',
			vehicleType: 'wheelbarrow',
			game: {},
			storage: { stock: {} },
			service: undefined,
			get proposedJobs() {
				const end = profile.proposedJobs.begin?.('vehicle.proposedJobs', {
					vehicleUid: 'veh-profile',
				})
				try {
					return [
						{
							job: 'vehicleOffload',
							maintenanceKind: 'unloadToTile',
							vehicleUid: 'veh-profile',
							targetCoord: { q: 2, r: 0 },
							path: [],
							urgency: 4,
							fatigue: 1,
							source: { kind: 'vehicle', vehicle: undefined },
							targetTile,
						},
					]
				} finally {
					end?.()
				}
			},
		}

		stop = latch(container, <VehicleProperties vehicle={vehicle as never} />, {
			setTitle: vi.fn(),
		} as never)

		const text = profile.proposedJobs.read()
		expect(text).toContain('vehicle-properties.workChoices')
		expect(text).toContain('vehicle-properties.workChoices > vehicle.proposedJobs')
	})

	it('shows idle when there is no service', () => {
		const vehicle = {
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

	it('renders vehicle-local logs in the vehicle widget', () => {
		const vehicle = {
			title: 'wheelbarrow veh-logs',
			vehicleType: 'wheelbarrow',
			game: {},
			storage: { stock: {} },
			service: undefined,
			logs: ['vehicleJob.selected\n\tvehicleUid: veh-logs'],
		}

		stop = latch(container, <VehicleProperties vehicle={vehicle as never} />, {
			setTitle: vi.fn(),
		} as never)

		// Logs are rendered in SelectionInfoWidget, not VehicleProperties
		expect(container.textContent).toContain('wheelbarrow veh-logs')
	})
})
