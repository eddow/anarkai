import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const addPanel = vi.fn()
const getPanel = vi.fn()

const globals = {
	game: {
		getObject: vi.fn(),
	},
	selectionState: {
		panelId: undefined as string | undefined,
		selectedUid: undefined as string | undefined,
	},
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
		globals.unreactiveInfo.hasLastSelectedInfoPanel = false
		globals.validateStoredSelectionState.mockClear()
		addPanel.mockClear()
		getPanel.mockClear()
		getPanel.mockReturnValue(undefined)
	})

	afterEach(() => {
		delete (window as any).dockviewApi
	})

	it('seeds a new follow-selection panel with the clicked object title', async () => {
		const { selectInspectorObject } = await import('./follow-selection')
		;(window as any).dockviewApi = {
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
		;(window as any).dockviewApi = {
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
})
