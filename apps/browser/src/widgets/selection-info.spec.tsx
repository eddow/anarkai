// @ts-nocheck
import { cancelFreightMapPick, freightMapPick } from '@app/lib/freight-map-pick'
import { document, latch } from '@sursaut/core'
import type { DockviewWidgetProps } from '@sursaut/ui/dockview'
import { shallowReactive, unwrap } from 'mutts'
import { Tile } from 'ssh/board/tile'
import { debugObjectId } from 'ssh/dev/debug-object-id'
import { Character } from 'ssh/population/character'
import { Vehicle as VehicleEntity } from 'ssh/population/vehicle/entity'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SelectionInfoContext, SelectionInfoTool } from './selection-info-tab'

const interactionModeMock = vi.hoisted(() => ({ selectedAction: '' }))
const updateParameters = vi.fn<(params: { pinned?: boolean }) => void>()
const removePanel = vi.fn()
const onDidRemovePanel = vi.fn((handler: (panel: { id: string }) => void) => {
	void handler
	return { dispose: vi.fn() }
})
const gameObject = {
	title: 'Workbench',
	logs: ['log line 1', 'log line 2'],
	position: { x: 2, y: 4 },
}
const TileForTest = Tile as unknown as new () => Record<string, unknown>
const tileObject = Object.assign(new TileForTest(), {
	title: 'tile tile-1',
	logs: [] as string[],
}) as InstanceType<typeof Tile>
const CharacterForTest = Character as unknown as new () => Record<string, unknown>
const characterObject = Object.assign(new CharacterForTest(), {
	title: 'character character-1',
	logs: [] as string[],
}) as InstanceType<typeof Character>
const secondCharacterObject = Object.assign(new CharacterForTest(), {
	title: 'character character-2',
	logs: [] as string[],
}) as InstanceType<typeof Character>

const hiveSyntheticObject = {
	kind: 'hive' as const,
	title: 'Test Hive',
	logs: [] as const,
}

const VehicleForTest = VehicleEntity as unknown as new () => Record<string, unknown>
const vehicleObject = Object.assign(new VehicleForTest(), {
	title: 'wheelbarrow vehicle-1',
	logs: [] as string[],
}) as InstanceType<typeof VehicleEntity>
const secondVehicleObject = Object.assign(new VehicleForTest(), {
	title: 'wheelbarrow vehicle-2',
	logs: [] as string[],
}) as InstanceType<typeof VehicleEntity>
const world = {
	position: { x: 0, y: 0 },
	scale: { x: 2 },
}
const gameObjects = new Set<any>()

function seedGameObjects() {
	gameObjects.clear()
	gameObjects.add(gameObject)
	gameObjects.add(tileObject)
	gameObjects.add(characterObject)
	gameObjects.add(secondCharacterObject)
	gameObjects.add(vehicleObject)
	gameObjects.add(secondVehicleObject)
	// Anchor tile for hive synthetic object ()
	gameObjects.add(Object.assign(new TileForTest(), { title: 'anchor tile', logs: [] }))
}

const game = {
	objects: gameObjects,
	renderer: {
		world,
		app: {
			screen: { width: 200, height: 100 },
		},
	},
	freightLines: [],
}
const globals = {
	game,
	selectionState: {
		selectedObject: undefined as object | undefined,
		titleVersion: 0,
	},
	bumpSelectionTitleVersion: vi.fn(),
	mrg: {
		hoveredObject: undefined as typeof gameObject | undefined,
	},
	unreactiveInfo: {
		hasLastSelectedInfoPanel: true,
	},
}
globals.selectionState = shallowReactive(globals.selectionState)

vi.mock('@app/lib/css', () => ({
	css: () => '',
}))

vi.mock('@app/lib/globals', () => globals)

vi.mock('../components/properties/CharacterProperties', () => ({
	default: (props: { character: { title?: string } }) => (
		<div data-testid="character-properties">{props.character.title}</div>
	),
}))

vi.mock('../components/properties/TileProperties', () => ({
	default: (props: { tile: { title?: string } }) => (
		<div data-testid="tile-properties">{props.tile.title}</div>
	),
}))

vi.mock('../components/properties/FreightLineProperties', () => ({
	default: () => <div data-testid="freight-line-properties">freight</div>,
}))

vi.mock('../components/HiveProperties', () => ({
	default: () => <div data-testid="hive-properties">hive</div>,
}))

vi.mock('../components/properties/VehicleProperties', () => ({
	default: (props: { vehicle: { title?: string } }) => (
		<div data-testid="vehicle-properties">{props.vehicle.title}</div>
	),
}))

vi.mock('ssh/population/character', () => ({
	Character: class Character {},
}))

vi.mock('ssh/population/vehicle/entity', () => ({
	Vehicle: class Vehicle {},
}))

vi.mock('ssh/board/tile', () => ({
	Tile: class Tile {},
}))

vi.mock('ssh/game/object', async (importOriginal) => {
	const actual = await importOriginal<typeof import('ssh/game/object')>()
	return {
		...actual,
		resolveSelectableHoverObject: vi.fn((object: unknown) => object),
	}
})

vi.mock('@app/lib/interactive-state', () => ({
	interactionMode: interactionModeMock,
	setHoveredObject: vi.fn((object: unknown) => {
		globals.mrg.hoveredObject = object as typeof gameObject | undefined
	}),
	isHoveredObject: vi.fn((object: unknown) => globals.mrg.hoveredObject === object),
}))

vi.mock('@app/lib/hive-inspector', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@app/lib/hive-inspector')>()
	return {
		...actual,
		resolveHiveFromAnchorTile: vi.fn(() => ({ name: 'Test Hive' })),
	}
})

vi.mock('ssh/utils/position', async (importOriginal) => {
	const actual = await importOriginal<typeof import('ssh/utils/position')>()
	return {
		...actual,
		toWorldCoord: vi.fn(() => ({ x: 40, y: 10 })),
	}
})

let SelectionInfoWidget: typeof import('./selection-info').default
let SelectionInfoTab: typeof import('./selection-info-tab').default

type SelectionInfoParams = { pinned?: boolean }

const createProps = (): DockviewWidgetProps<SelectionInfoParams, SelectionInfoContext> => ({
	title: '',
	size: {
		width: 320,
		height: 240,
	},
	params: {},
	context: {},
})

const getTool = (
	props: DockviewWidgetProps<SelectionInfoParams, SelectionInfoContext>,
	ariaLabel: string
) => props.context.tools?.find((tool: SelectionInfoTool) => tool.ariaLabel === ariaLabel)

const createScope = () => ({
	panelApi: {
		updateParameters,
	},
	dockviewApi: {
		onDidRemovePanel,
		removePanel,
	},
	setTitle: vi.fn<(title: string) => void>(),
})

describe('SelectionInfoWidget', () => {
	let container: HTMLElement
	let stop: (() => void) | undefined

	beforeAll(async () => {
		;({ default: SelectionInfoWidget } = await import('./selection-info'))
		;({ default: SelectionInfoTab } = await import('./selection-info-tab'))
	})

	beforeEach(() => {
		container = document.createElement('div')
		document.body.appendChild(container)
		globals.selectionState.selectedObject = undefined
		globals.selectionState.titleVersion = 0
		globals.mrg.hoveredObject = undefined
		globals.unreactiveInfo.hasLastSelectedInfoPanel = true
		cancelFreightMapPick()
		seedGameObjects()
		updateParameters.mockClear()
		removePanel.mockClear()
		onDidRemovePanel.mockClear()
		world.position.x = 0
		world.position.y = 0
	})

	afterEach(() => {
		stop?.()
		stop = undefined
		container.remove()
		document.body.innerHTML = ''
	})

	it('shows the empty state when nothing is selected', () => {
		const props = createProps()
		const scope = createScope()

		stop = latch(container, <SelectionInfoWidget {...props} />, scope as never)

		expect(container.textContent).toContain('Select an object in the game view to inspect it.')
		expect(getTool(props, 'Pin Panel')).toBeDefined()
		expect(getTool(props, 'Go to Object')).toBeUndefined()
	})

	it('renders the generic object summary and logs for the selected object', () => {
		globals.selectionState.selectedObject = gameObject as any
		const props = createProps()
		const scope = createScope()

		stop = latch(container, <SelectionInfoWidget {...props} />, scope as never)

		expect(container.textContent).toContain('Workbench')
		expect(container.textContent).toContain('log line 1')
		expect(container.textContent).toContain('log line 2')
		expect(getTool(props, 'Go to Object')).toBeDefined()
		expect(getTool(props, 'Pin Panel')).toBeDefined()
	})

	it('renders HiveProperties for a synthetic hive uid', () => {
		globals.selectionState.selectedObject = hiveSyntheticObject as any
		const props = createProps()
		const scope = createScope()

		stop = latch(container, <SelectionInfoWidget {...props} />, scope as never)

		expect(container.querySelector('[data-testid="hive-properties"]')).not.toBeNull()
	})

	it('renders VehicleProperties for a vehicle entity', () => {
		globals.selectionState.selectedObject = vehicleObject as any
		const props = createProps()
		const scope = createScope()

		stop = latch(container, <SelectionInfoWidget {...props} />, scope as never)

		expect(container.querySelector('[data-testid="vehicle-properties"]')).not.toBeNull()
	})

	it('replaces the property widget when switching object kinds', async () => {
		globals.selectionState.selectedObject = tileObject as any
		const props = createProps()
		const scope = createScope()

		stop = latch(container, <SelectionInfoWidget {...props} />, scope as never)

		expect(container.querySelector('[data-testid="tile-properties"]')?.textContent).toContain(
			tileObject.title
		)
		expect(container.querySelector('[data-testid="character-properties"]')).toBeNull()

		globals.selectionState.selectedObject = characterObject as any
		await Promise.resolve()

		expect(container.querySelector('[data-testid="character-properties"]')?.textContent).toContain(
			characterObject.title
		)
		expect(container.querySelector('[data-testid="tile-properties"]')).toBeNull()
		expect(
			container.querySelector('.selection-info-panel')?.getAttribute('data-test-object-uid')
		).toBe(debugObjectId(characterObject))
	})

	it('updates the character property widget when switching between characters', async () => {
		globals.selectionState.selectedObject = characterObject as any
		const props = createProps()
		const scope = createScope()

		stop = latch(container, <SelectionInfoWidget {...props} />, scope as never)

		expect(container.querySelector('[data-testid="character-properties"]')?.textContent).toContain(
			characterObject.title
		)

		globals.selectionState.selectedObject = secondCharacterObject as any
		await Promise.resolve()

		expect(container.querySelector('[data-testid="character-properties"]')?.textContent).toContain(
			secondCharacterObject.title
		)
		expect(
			container.querySelector('.selection-info-panel')?.getAttribute('data-test-object-uid')
		).toBe(debugObjectId(secondCharacterObject))
	})

	it('updates the vehicle property widget when switching between vehicles', async () => {
		globals.selectionState.selectedObject = vehicleObject as any
		const props = createProps()
		const scope = createScope()

		stop = latch(container, <SelectionInfoWidget {...props} />, scope as never)

		expect(container.querySelector('[data-testid="vehicle-properties"]')?.textContent).toContain(
			vehicleObject.title
		)

		globals.selectionState.selectedObject = secondVehicleObject as any
		await Promise.resolve()

		expect(container.querySelector('[data-testid="vehicle-properties"]')?.textContent).toContain(
			secondVehicleObject.title
		)
		expect(
			container.querySelector('.selection-info-panel')?.getAttribute('data-test-object-uid')
		).toBe(debugObjectId(secondVehicleObject))
	})

	it('closes the panel when the inspected object disappears', () => {
		const missingObject = Object.assign(new CharacterForTest(), {
			title: 'Missing',
			logs: [] as string[],
		})
		globals.selectionState.selectedObject = missingObject
		const props = createProps()
		const scope = createScope()

		stop = latch(container, <SelectionInfoWidget {...props} />, scope as never)

		expect(removePanel).toHaveBeenCalledTimes(1)
		expect(globals.selectionState.selectedObject).toBeUndefined()
	})

	it('pins the currently selected object from the shared tab tools', () => {
		globals.selectionState.selectedObject = gameObject as any
		const props = createProps()
		const scope = createScope()

		stop = latch(container, <SelectionInfoWidget {...props} />, scope as never)

		expect(getTool(props, 'Pin Panel')).toBeDefined()
	})

	it('moves the renderer world from the shared tab tools', () => {
		globals.selectionState.selectedObject = gameObject as any
		const props = createProps()
		const scope = createScope()

		stop = latch(container, <SelectionInfoWidget {...props} />, scope as never)

		getTool(props, 'Go to Object')?.onClick()

		expect(world.position.x).toBe(20)
		expect(world.position.y).toBe(30)
	})

	it('keeps the inspected object in shared context for hover handling', () => {
		globals.selectionState.selectedObject = gameObject as any
		const props = createProps()
		const scope = createScope()

		stop = latch(container, <SelectionInfoWidget {...props} />, scope as never)

		expect(props.context.hoveredObject).toBe(gameObject)
	})

	it('keeps rendering properties while a freight map pick is pending', () => {
		globals.selectionState.selectedObject = gameObject as any
		freightMapPick.pending = {
			pickKind: 'add-stop',
			apply: vi.fn(),
		}
		const props = createProps()
		const scope = createScope()

		stop = latch(container, <SelectionInfoWidget {...props} />, scope as never)

		expect(container.querySelector('[data-testid="freight-map-pick-banner"]')).not.toBeNull()
		expect(container.textContent).toContain('Workbench')
	})

	it('highlights the inspected object while hovering the tab', () => {
		const props: DockviewWidgetProps<Record<string, never>, SelectionInfoContext> = {
			title: 'Workbench',
			size: {
				width: 180,
				height: 40,
			},
			params: {},
			context: {
				hoveredObject: gameObject as never,
			},
		}
		const scope = createScope()

		stop = latch(container, <SelectionInfoTab {...props} />, scope as never)

		const tab = container.querySelector('.selection-info-tab')
		expect(tab).not.toBeNull()

		tab!.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
		expect(unwrap(globals.mrg.hoveredObject)).toBe(gameObject)

		tab!.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }))
		expect(globals.mrg.hoveredObject).toBeUndefined()
	})
})
