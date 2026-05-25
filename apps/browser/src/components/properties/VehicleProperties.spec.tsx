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
	default: (props: { object?: { uid?: string }; label?: string }) => (
		<button type="button" data-testid="inspector-object-link" data-target-uid={props.object?.uid}>
			{props.label ?? props.object?.uid ?? 'link'}
		</button>
	),
}))

vi.mock('../LinkedEntityControl', () => ({
	default: (props: { object?: { uid?: string } }) => (
		<div data-testid="linked-entity-control" data-target-uid={props.object?.uid ?? ''}>
			{props.object?.uid ?? 'linked'}
		</div>
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
		const operator = { uid: 'char-1', title: 'Ari', tile: { uid: 'tile:0,0' } }
		const vehicle = {
			uid: 'veh-1',
			title: 'wheelbarrow veh-1',
			vehicleType: 'wheelbarrow',
			game: {},
			operator,
			storage: { stock: {} },
			service: {
				operator,
				line: { id: 'L1', name: 'Line A', stops: [] },
				stop: { id: 's1' },
				docked: false,
			},
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

	it('refreshes storage stock when the vehicle receives a storage presentation event', async () => {
		let stock = { berries: 3 }
		const vehicle = {
			uid: 'veh-refresh',
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

		consumePresentationEvents([{ type: 'storage.changed', ownerUid: 'veh-refresh' }])
		await new Promise((resolve) => setTimeout(resolve, 0))

		expect(container.querySelector('[data-testid="vehicle-good-berries"]')?.textContent).toBe('4')
	})

	it('shows line service summary and freight line links', () => {
		const vehicle = {
			uid: 'veh-3',
			title: 'wheelbarrow veh-3',
			vehicleType: 'wheelbarrow',
			game: {},
			storage: { stock: {} },
			service: {
				line: {
					id: 'L1',
					name: 'North route',
					stops: [
						{
							id: 'stop-1',
							anchor: {
								kind: 'alveolus',
								hiveName: 'H',
								alveolusType: 'freight_bay',
								coord: [0, 0] as const,
							},
						},
					],
				},
				stop: {
					id: 'stop-1',
					anchor: {
						kind: 'alveolus',
						hiveName: 'H',
						alveolusType: 'freight_bay',
						coord: [0, 0] as const,
					},
				},
				docked: true,
			},
		}

		stop = latch(container, <VehicleProperties vehicle={vehicle as never} />, {
			setTitle: vi.fn(),
		} as never)

		expect(container.textContent).toContain('North route')
		expect(container.textContent).toContain('Stop stop-1')
		expect(container.textContent).toContain('Docked')

		const lineLinks = [
			...container.querySelectorAll('[data-testid="inspector-object-link"]'),
		].filter((el) => el.getAttribute('data-target-uid') === 'freight-line:L1')
		expect(lineLinks.length).toBeGreaterThan(0)
	})

	it('assigns and unassigns served freight lines without changing active service text', () => {
		const lineA = {
			id: 'L1',
			name: 'North route',
			stops: [{ id: 'a', zone: { kind: 'radius', center: [1, 0] as const, radius: 1 } }],
		}
		const lineB = {
			id: 'L2',
			name: 'South route',
			stops: [{ id: 'b', zone: { kind: 'radius', center: [2, 0] as const, radius: 1 } }],
		}
		const vehicle = {
			uid: 'veh-lines',
			title: 'wheelbarrow lines',
			vehicleType: 'wheelbarrow',
			storage: { stock: {} },
			servedLines: [lineA],
			service: {
				line: lineA,
				stop: lineA.stops[0],
				docked: false,
			},
			game: {
				freightLines: [lineA, lineB],
				assignVehicleToFreightLine: vi.fn((_vehicleUid: string, lineId: string) => {
					const line = lineId === lineB.id ? lineB : lineA
					vehicle.servedLines = [...vehicle.servedLines, line]
				}),
				unassignVehicleFromFreightLine: vi.fn((_vehicleUid: string, lineId: string) => {
					vehicle.servedLines = vehicle.servedLines.filter((line) => line.id !== lineId)
				}),
			},
		}

		stop = latch(container, <VehicleProperties vehicle={vehicle as never} />, {
			setTitle: vi.fn(),
		} as never)

		expect(container.textContent).toContain('North route · Stop a · Underway')
		expect(
			container
				.querySelector(
					'[data-testid="vehicle-assigned-line"] [data-testid="inspector-object-link"]'
				)
				?.getAttribute('data-target-uid')
		).toBe('freight-line:L1')

		;(
			container.querySelector('[data-testid="vehicle-line-picker-item"]') as HTMLButtonElement
		).click()
		expect(vehicle.game.assignVehicleToFreightLine).toHaveBeenCalledWith('veh-lines', 'L2')

		;(container.querySelector('[data-testid="vehicle-unassign-line"]') as HTMLButtonElement).click()
		expect(vehicle.game.unassignVehicleFromFreightLine).toHaveBeenCalledWith('veh-lines', 'L1')
		expect(container.textContent).toContain('North route · Stop a · Underway')
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

	it('shows proposed vehicle jobs without character contract details', () => {
		const operator = { uid: 'char-jobs', title: 'Bo' }
		const targetTile = {
			uid: 'tile:2,0',
			title: 'Tile 2, 0',
			position: { x: 2, y: 0 },
		}
		const vehicle = {
			uid: 'veh-jobs',
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
			uid: 'tile:2,0',
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
			uid: 'veh-jobs',
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
			uid: 'tile:2,0',
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
			uid: 'veh-advertised',
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
			uid: 'tile:2,0',
			title: 'Tile 2, 0',
			position: { x: 2, y: 0 },
		}
		const vehicle = {
			uid: 'veh-profile',
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

	it('renders vehicle-local logs in the vehicle widget', () => {
		const vehicle = {
			uid: 'veh-logs',
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

		expect(container.querySelector('[data-testid="vehicle-logs"]')).not.toBeNull()
		expect(container.textContent).toContain('vehicleJob.selected')
		expect(container.textContent).toContain('vehicleUid: veh-logs')
	})
})
