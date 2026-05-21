import { cancelFreightMapPick, freightMapPick } from '@app/lib/freight-map-pick'
import { hiveUidForAnchorTile } from '@app/lib/hive-inspector'
import { document, latch } from '@sursaut/core'
import type { DockviewWidgetProps } from '@sursaut/ui/dockview'
import { reactive } from 'mutts'
import { Tile } from 'ssh/board/tile'
import { Character } from 'ssh/population/character'
import { VehicleEntity } from 'ssh/population/vehicle/entity'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SelectionInfoContext, SelectionInfoTool } from './selection-info-tab'

const interactionModeMock = vi.hoisted(() => ({ selectedAction: '' }))
const updateParameters = vi.fn<(params: { uid?: string }) => void>()
const removePanel = vi.fn()
const onDidRemovePanel = vi.fn((handler: (panel: { id: string }) => void) => {
	void handler
	return { dispose: vi.fn() }
})
const gameObject = {
	uid: 'object-1',
	title: 'Workbench',
	logs: ['log line 1', 'log line 2'],
	position: { x: 2, y: 4 },
}
const tileUid = 'tile-1'
const TileForTest = Tile as unknown as new () => Record<string, unknown>
const tileObject = Object.assign(new TileForTest(), {
	uid: tileUid,
	title: 'tile tile-1',
	logs: [] as string[],
}) as InstanceType<typeof Tile>
const characterUid = 'character-1'
const CharacterForTest = Character as unknown as new () => Record<string, unknown>
const characterObject = Object.assign(new CharacterForTest(), {
	uid: characterUid,
	title: 'character character-1',
	logs: [] as string[],
}) as InstanceType<typeof Character>
const secondCharacterUid = 'character-2'
const secondCharacterObject = Object.assign(new CharacterForTest(), {
	uid: secondCharacterUid,
	title: 'character character-2',
	logs: [] as string[],
}) as InstanceType<typeof Character>

const hiveSyntheticUid = hiveUidForAnchorTile('tile:0,0')
const hiveSyntheticObject = {
	uid: hiveSyntheticUid,
	kind: 'hive' as const,
	title: 'Test Hive',
	logs: [] as const,
	anchorTileUid: 'tile:0,0',
}

const vehicleUid = 'vehicle-1'
const VehicleForTest = VehicleEntity as unknown as new () => Record<string, unknown>
const vehicleObject = Object.assign(new VehicleForTest(), {
	uid: vehicleUid,
	title: 'wheelbarrow vehicle-1',
	logs: [] as string[],
}) as InstanceType<typeof VehicleEntity>
const secondVehicleUid = 'vehicle-2'
const secondVehicleObject = Object.assign(new VehicleForTest(), {
	uid: secondVehicleUid,
	title: 'wheelbarrow vehicle-2',
	logs: [] as string[],
}) as InstanceType<typeof VehicleEntity>
const world = {
	position: { x: 0, y: 0 },
	scale: { x: 2 },
}
const game = {
	getObject: vi.fn((uid: string) => {
		if (uid === 'object-1') return gameObject
		if (uid === tileUid) return tileObject
		if (uid === characterUid) return characterObject
		if (uid === secondCharacterUid) return secondCharacterObject
		if (uid === vehicleUid) return vehicleObject
		if (uid === secondVehicleUid) return secondVehicleObject
		return undefined
	}),
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
		selectedUid: undefined as string | undefined,
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
globals.selectionState = reactive(globals.selectionState)

vi.mock('@app/lib/css', () => ({
	css: () => '',
}))

vi.mock('@app/lib/globals', () => globals)

vi.mock('../components/properties/CharacterProperties', () => ({
	default: (props: { character: Character }) => (
		<div data-testid="character-properties">character {props.character.uid}</div>
	),
}))

vi.mock('../components/properties/TileProperties', () => ({
	default: (props: { tile: Tile }) => (
		<div data-testid="tile-properties">tile {props.tile.uid}</div>
	),
}))

vi.mock('../components/properties/FreightLineProperties', () => ({
	default: () => <div data-testid="freight-line-properties">freight</div>,
}))

vi.mock('../components/HiveProperties', () => ({
	default: () => <div data-testid="hive-properties">hive</div>,
}))

vi.mock('../components/properties/VehicleProperties', () => ({
	default: (props: { vehicle: VehicleEntity }) => (
		<div data-testid="vehicle-properties">vehicle {props.vehicle.uid}</div>
	),
}))

vi.mock('ssh/population/character', () => ({
	Character: class Character {},
}))

vi.mock('ssh/population/vehicle/entity', () => ({
	VehicleEntity: class VehicleEntity {},
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
		createSyntheticHiveObjectForUid: vi.fn((_: unknown, uid: string) =>
			uid === hiveSyntheticUid ? hiveSyntheticObject : undefined
		),
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

type SelectionInfoParams = { uid?: string }

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
		id: 'panel-1',
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
		globals.selectionState.selectedUid = undefined
		globals.selectionState.titleVersion = 0
		globals.mrg.hoveredObject = undefined
		globals.unreactiveInfo.hasLastSelectedInfoPanel = true
		cancelFreightMapPick()
		updateParameters.mockClear()
		removePanel.mockClear()
		onDidRemovePanel.mockClear()
		game.getObject.mockClear()
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
		globals.selectionState.selectedUid = 'object-1'
		const props = createProps()
		const scope = createScope()

		stop = latch(container, <SelectionInfoWidget {...props} />, scope as never)

		expect(container.textContent).toContain('Workbench')
		expect(container.textContent).toContain('ID: object-1')
		expect(container.textContent).toContain('log line 1')
		expect(container.textContent).toContain('log line 2')
		expect(getTool(props, 'Go to Object')).toBeDefined()
		expect(getTool(props, 'Pin Panel')).toBeDefined()
		expect(game.getObject).toHaveBeenCalledWith('object-1')
	})

	it('renders HiveProperties for a synthetic hive uid', () => {
		globals.selectionState.selectedUid = hiveSyntheticUid
		const props = createProps()
		const scope = createScope()

		stop = latch(container, <SelectionInfoWidget {...props} />, scope as never)

		expect(container.querySelector('[data-testid="hive-properties"]')).not.toBeNull()
		expect(game.getObject).not.toHaveBeenCalledWith(hiveSyntheticUid)
	})

	it('renders VehicleProperties for a vehicle entity', () => {
		globals.selectionState.selectedUid = vehicleUid
		const props = createProps()
		const scope = createScope()

		stop = latch(container, <SelectionInfoWidget {...props} />, scope as never)

		expect(container.querySelector('[data-testid="vehicle-properties"]')).not.toBeNull()
		expect(game.getObject).toHaveBeenCalledWith(vehicleUid)
	})

	it('replaces the property widget when switching object kinds', async () => {
		globals.selectionState.selectedUid = tileUid
		const props = createProps()
		const scope = createScope()

		stop = latch(container, <SelectionInfoWidget {...props} />, scope as never)

		expect(container.querySelector('[data-testid="tile-properties"]')?.textContent).toContain(
			tileUid
		)
		expect(container.querySelector('[data-testid="character-properties"]')).toBeNull()

		globals.selectionState.selectedUid = characterUid
		await Promise.resolve()

		expect(container.querySelector('[data-testid="character-properties"]')?.textContent).toContain(
			characterUid
		)
		expect(container.querySelector('[data-testid="tile-properties"]')).toBeNull()
		expect(
			container.querySelector('.selection-info-panel')?.getAttribute('data-test-object-uid')
		).toBe(characterUid)
	})

	it('updates the character property widget when switching between characters', async () => {
		globals.selectionState.selectedUid = characterUid
		const props = createProps()
		const scope = createScope()

		stop = latch(container, <SelectionInfoWidget {...props} />, scope as never)

		expect(container.querySelector('[data-testid="character-properties"]')?.textContent).toContain(
			characterUid
		)

		globals.selectionState.selectedUid = secondCharacterUid
		await Promise.resolve()

		expect(container.querySelector('[data-testid="character-properties"]')?.textContent).toContain(
			secondCharacterUid
		)
		expect(
			container.querySelector('.selection-info-panel')?.getAttribute('data-test-object-uid')
		).toBe(secondCharacterUid)
	})

	it('updates the vehicle property widget when switching between vehicles', async () => {
		globals.selectionState.selectedUid = vehicleUid
		const props = createProps()
		const scope = createScope()

		stop = latch(container, <SelectionInfoWidget {...props} />, scope as never)

		expect(container.querySelector('[data-testid="vehicle-properties"]')?.textContent).toContain(
			vehicleUid
		)

		globals.selectionState.selectedUid = secondVehicleUid
		await Promise.resolve()

		expect(container.querySelector('[data-testid="vehicle-properties"]')?.textContent).toContain(
			secondVehicleUid
		)
		expect(
			container.querySelector('.selection-info-panel')?.getAttribute('data-test-object-uid')
		).toBe(secondVehicleUid)
	})

	it('closes the panel when the inspected object disappears', () => {
		globals.selectionState.selectedUid = 'missing-object'
		const props = createProps()
		const scope = createScope()

		stop = latch(container, <SelectionInfoWidget {...props} />, scope as never)

		expect(removePanel).toHaveBeenCalledTimes(1)
		expect(globals.selectionState.selectedUid).toBeUndefined()
	})

	it('pins the currently selected object from the shared tab tools', () => {
		globals.selectionState.selectedUid = 'object-1'
		const props = createProps()
		const scope = createScope()

		stop = latch(container, <SelectionInfoWidget {...props} />, scope as never)

		getTool(props, 'Pin Panel')?.onClick()

		expect(updateParameters).toHaveBeenCalledWith({ uid: 'object-1' })
		expect(props.params.uid).toBe('object-1')
		expect(globals.unreactiveInfo.hasLastSelectedInfoPanel).toBe(false)
		expect(getTool(props, 'Pin Panel')).toBeUndefined()
	})

	it('moves the renderer world from the shared tab tools', () => {
		globals.selectionState.selectedUid = 'object-1'
		const props = createProps()
		const scope = createScope()

		stop = latch(container, <SelectionInfoWidget {...props} />, scope as never)

		getTool(props, 'Go to Object')?.onClick()

		expect(world.position.x).toBe(20)
		expect(world.position.y).toBe(30)
	})

	it('keeps the inspected object in shared context for hover handling', () => {
		globals.selectionState.selectedUid = 'object-1'
		const props = createProps()
		const scope = createScope()

		stop = latch(container, <SelectionInfoWidget {...props} />, scope as never)

		expect(props.context.hoveredObject).toBe(gameObject)
	})

	it('keeps rendering properties while a freight map pick is pending', () => {
		globals.selectionState.selectedUid = 'object-1'
		freightMapPick.pending = {
			lineId: 'line-1',
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
		expect(globals.mrg.hoveredObject?.uid).toBe(gameObject.uid)

		tab!.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }))
		expect(globals.mrg.hoveredObject).toBeUndefined()
	})
})
