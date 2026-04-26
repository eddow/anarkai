import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const addPanel = vi.fn()
const getPanel = vi.fn()
const focus = vi.fn()
type DockviewTestWindow = Window & { dockviewApi?: unknown }

const globals = {
	game: {
		getObject: vi.fn(),
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

describe('follow-selection', () => {
	beforeEach(() => {
		globals.game.getObject.mockClear()
		globals.selectionState.panelId = undefined
		globals.selectionState.selectedUid = undefined
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
			uid: 'tile:0,1',
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

	it('falls back to the resolved selected object title when no title is passed', async () => {
		const { ensureFollowSelectionPanel } = await import('./follow-selection')
		;(window as DockviewTestWindow).dockviewApi = {
			addPanel,
			getPanel,
		}
		globals.selectionState.selectedUid = 'character-1'
		globals.game.getObject.mockReturnValue({
			title: 'Character Ada',
		})

		ensureFollowSelectionPanel()

		expect(globals.game.getObject).toHaveBeenCalledWith('character-1')
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

		try {
			showProps({
				uid: 'operator-1',
				title: 'Operator Ada',
			})
		} finally {
			unregisterPinnedInspectorPanel('panel-pinned-vehicle', 'vehicle-1')
		}

		expect(globals.selectionState.selectedUid).toBe('operator-1')
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
			id: 'panel-existing-tile',
			focus,
		}
		;(window as DockviewTestWindow).dockviewApi = {
			addPanel,
			getPanel,
		}
		getPanel.mockImplementation((panelId?: string) =>
			panelId === 'panel-existing-tile' ? existingPanel : undefined
		)
		registerPinnedInspectorPanel('panel-existing-tile', 'tile:9,9')
		globals.selectionState.selectedUid = 'character-1'

		showProps({
			uid: 'tile:9,9',
			title: 'Tile 9, 9',
		})

		expect(globals.selectionState.selectedUid).toBe('character-1')
		expect(addPanel).not.toHaveBeenCalled()
		expect(focus).toHaveBeenCalledTimes(1)
	})
})
