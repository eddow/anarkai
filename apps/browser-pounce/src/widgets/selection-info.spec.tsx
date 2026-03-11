import type { DockviewWidgetProps } from '@pounce/ui/dockview'
import { document, latch } from '@pounce/core'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SelectionInfoContext, SelectionInfoTool } from './selection-info-tab'

const updateParameters = vi.fn<(params: { uid?: string }) => void>()
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
const world = {
	position: { x: 0, y: 0 },
	scale: { x: 2 },
}
const game = {
	getObject: vi.fn((uid: string) => (uid === 'object-1' ? gameObject : undefined)),
	renderer: {
		world,
		app: {
			screen: { width: 200, height: 100 },
		},
	},
}
const globals = {
	games: {
		game: vi.fn(() => game),
	},
	selectionState: {
		selectedUid: undefined as string | undefined,
	},
	mrg: {
		hoveredObject: undefined as typeof gameObject | undefined,
	},
	unreactiveInfo: {
		hasLastSelectedInfoPanel: true,
	},
}

vi.mock('@app/lib/css', () => ({
	css: () => '',
}))

vi.mock('@app/lib/globals', () => globals)

vi.mock('../components/CharacterProperties', () => ({
	default: () => <div data-testid="character-properties">character</div>,
}))

vi.mock('../components/TileProperties', () => ({
	default: () => <div data-testid="tile-properties">tile</div>,
}))

vi.mock('ssh/population/character', () => ({
	Character: class Character {},
}))

vi.mock('ssh/board/tile', () => ({
	Tile: class Tile {},
}))

vi.mock('ssh/utils/position', () => ({
	toWorldCoord: vi.fn(() => ({ x: 40, y: 10 })),
}))

let SelectionInfoWidget: typeof import('./selection-info').default

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

const getTool = (props: DockviewWidgetProps<SelectionInfoParams, SelectionInfoContext>, ariaLabel: string) =>
	props.context.tools?.find((tool: SelectionInfoTool) => tool.ariaLabel === ariaLabel)

const createScope = () => ({
	panelApi: {
		id: 'panel-1',
		updateParameters,
	},
	dockviewApi: {
		onDidRemovePanel,
	},
	setTitle: vi.fn<(title: string) => void>(),
})

describe('SelectionInfoWidget', () => {
	let container: HTMLElement
	let stop: (() => void) | undefined

	beforeAll(async () => {
		;({ default: SelectionInfoWidget } = await import('./selection-info'))
	})

	beforeEach(() => {
		container = document.createElement('div')
		document.body.appendChild(container)
		globals.selectionState.selectedUid = undefined
		globals.mrg.hoveredObject = undefined
		globals.unreactiveInfo.hasLastSelectedInfoPanel = true
		updateParameters.mockClear()
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
})
