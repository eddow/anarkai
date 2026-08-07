import { Tile } from 'ssh/board/tile'
import { debugObjectId } from 'ssh/dev/debug-object-id'
// @ts-nocheck
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const addPanel = vi.fn()
const getPanel = vi.fn()
const focus = vi.fn()
type DockviewTestWindow = Window & { dockviewApi?: unknown }

const gameObjects = new Set<any>()
const globals = {
	game: {
		objects: gameObjects,
		freightLines: [],
		ensureGameplaySectors: vi.fn(),
		ensureGeneratedTiles: vi.fn(),
	},
	selectionState: {
		panelId: undefined as string | undefined,
		selectedUid: undefined as string | undefined,
		titleVersion: 0,
	},
	bumpSelectionTitleVersion: vi.fn(),
	unreactiveInfo: {
		hasLastSelectedInfoPanel: false,
	},
	validateStoredSelectionState: vi.fn(),
}

vi.mock('./globals', () => globals)

vi.mock('ssh/board/tile', () => ({
	Tile: class Tile {
		position: any
		constructor(coords?: { q: number; r: number }) {
			this.position = coords ?? { q: 0, r: 0 }
		}
	},
}))

describe('follow-selection', () => {
	beforeEach(() => {
		gameObjects.clear()
		globals.game.ensureGameplaySectors.mockClear()
		globals.game.ensureGeneratedTiles.mockClear()
		globals.selectionState.panelId = undefined
		globals.selectionState.selectedUid = undefined
		globals.selectionState.selectedObject = undefined
		globals.selectionState.titleVersion = 0
		globals.unreactiveInfo.hasLastSelectedInfoPanel = false
		globals.validateStoredSelectionState.mockClear()
		addPanel.mockClear()
		getPanel.mockClear()
		focus.mockClear()
		getPanel.mockReturnValue(undefined)
	})

	afterEach(() => {
		delete (window as DockviewTestWindow).dockviewApi
	})

	it('seeds a new follow-selection panel with the clicked object title', async () => {
		const { selectInspectorObject } = await import('./follow-selection')
		;(window as DockviewTestWindow).dockviewApi = {
			addPanel,
			getPanel,
		}

		selectInspectorObject({
			title: 'Tile 0, 1',
		})

		expect(addPanel).toHaveBeenCalledWith({
			id: expect.stringMatching(/^selection-info-/),
			component: 'selection-info',
			title: 'Tile 0, 1',
			params: {},
			tabComponent: 'selection-info-tab',
			floating: {
				width: 400,
				height: 600,
			},
		})
	})

	it('materializes tile content before showing tile properties', async () => {
		const { selectInspectorObject } = await import('./follow-selection')
		const tile = new Tile({ q: 12, r: -3 })
		Object.assign(tile, {
			title: 'Tile 12, -3',
		})
		const tileUid = debugObjectId(tile)

		selectInspectorObject(tile as never)

		expect(globals.game.ensureGameplaySectors).toHaveBeenCalledWith(['0,-1'])
		expect(globals.game.ensureGeneratedTiles).not.toHaveBeenCalled()
		expect(globals.selectionState.selectedUid).toBe(tileUid)
	})

	it('falls back to the resolved selected object title when no title is passed', async () => {
		const { ensureFollowSelectionPanel } = await import('./follow-selection')
		;(window as DockviewTestWindow).dockviewApi = {
			addPanel,
			getPanel,
		}
		const charObject = { title: 'Character Ada' }
		gameObjects.add(charObject)
		globals.selectionState.selectedUid = debugObjectId(charObject)

		ensureFollowSelectionPanel()

		expect(addPanel).toHaveBeenCalledWith(
			expect.objectContaining({
				title: 'Character Ada',
			})
		)
	})

	it('opens the follow-selection panel after the active pinned inspector', async () => {
		const { registerPinnedInspectorPanel, unregisterPinnedInspectorPanel, showProps } =
			await import('./follow-selection')
		const group = {
			panels: [] as Array<{ id: string }>,
		}
		const pinnedSourcePanel = {
			id: 'panel-pinned-vehicle',
			group,
			focus,
			api: {
				setActive: focus,
			},
		}
		group.panels = [{ id: 'panel-before' }, pinnedSourcePanel, { id: 'panel-after' }]
		;(window as DockviewTestWindow).dockviewApi = {
			activePanel: pinnedSourcePanel,
			addPanel,
			getPanel,
		}
		registerPinnedInspectorPanel('panel-pinned-vehicle', 'vehicle-1')

		const operatorObject = { title: 'Operator Ada' }
		const operatorUid = debugObjectId(operatorObject)

		try {
			showProps(operatorObject as never)
		} finally {
			unregisterPinnedInspectorPanel('panel-pinned-vehicle', 'vehicle-1')
		}

		expect(globals.selectionState.selectedUid).toBe(operatorUid)
		expect(addPanel).toHaveBeenCalledWith({
			id: expect.stringMatching(/^selection-info-/),
			component: 'selection-info',
			title: 'Operator Ada',
			params: {},
			tabComponent: 'selection-info-tab',
			floating: false,
			position: {
				referencePanel: pinnedSourcePanel,
				direction: 'within',
				index: 2,
			},
		})
	})
	it('focuses an existing pinned inspector instead of opening a duplicate panel', async () => {
		const { registerPinnedInspectorPanel, showProps } = await import('./follow-selection')
		const existingPanel = {
			focus,
		}
		;(window as DockviewTestWindow).dockviewApi = {
			addPanel,
			getPanel,
		}
		getPanel.mockImplementation((panelId?: string) =>
			panelId === 'panel-existing-tile' ? existingPanel : undefined
		)
		const tileObject = { title: 'Tile 9, 9' }
		const tileUid = debugObjectId(tileObject)
		registerPinnedInspectorPanel('panel-existing-tile', tileUid)
		globals.selectionState.selectedUid = 'character-1'

		showProps(tileObject as never)

		expect(globals.selectionState.selectedUid).toBe('character-1')
		expect(addPanel).not.toHaveBeenCalled()
		expect(focus).toHaveBeenCalledTimes(1)
	})
})
