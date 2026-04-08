import { document, latch } from '@sursaut/core'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const addPanel = vi.fn()
const getPanel = vi.fn()
const focus = vi.fn()
const globals = {
	mrg: {
		hoveredObject: undefined as any,
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

class MockAlveolus {
	name = 'tree_chopper'
}

class MockTile {
	content?: MockAlveolus
	terrainState?: { terrain?: string }
	baseTerrain?: string
	board: any
	uid: string
	title: string
	position: { q: number; r: number }
	game: any

	constructor(coord: { q: number; r: number }) {
		this.uid = `tile:${coord.q},${coord.r}`
		this.title = `Tile ${coord.q}, ${coord.r}`
		this.position = coord
		this.content = new MockAlveolus()
		this.baseTerrain = 'concrete'
		this.game = {
			loaded: Promise.resolve(),
			getTexture: vi.fn(() => 'terrain-texture'),
		}
		this.board = {
			game: this.game,
		}
	}
}

vi.mock('@app/lib/css', () => ({
	css: () => '',
}))

vi.mock('@app/lib/globals', () => globals)

vi.mock('engine-pixi/assets/visual-content', () => ({
	alveoli: {
		tree_chopper: {
			sprites: ['tree-chopper-sprite'],
		},
	},
}))

vi.mock('ssh/board/content/alveolus', () => ({
	Alveolus: MockAlveolus,
}))

vi.mock('ssh/board/tile', () => ({
	Tile: MockTile,
}))

vi.mock('ssh/utils/images', () => ({
	computeStyleFromTexture: vi.fn(() => 'background-image: url(test);'),
}))

vi.mock('ssh/utils/position', () => ({
	toAxialCoord: vi.fn((position: { q: number; r: number }) => position),
}))

vi.mock('./ResourceImage', () => ({
	default: (props: { alt?: string }) => <span data-testid="resource-image">{props.alt}</span>,
}))

let LinkedEntityControl: typeof import('./LinkedEntityControl').default

describe('LinkedEntityControl', () => {
	let container: HTMLElement
	let stop: (() => void) | undefined

	beforeAll(async () => {
		;({ default: LinkedEntityControl } = await import('./LinkedEntityControl'))
	})

	beforeEach(() => {
		container = document.createElement('div')
		document.body.appendChild(container)
		globals.mrg.hoveredObject = undefined
		globals.selectionState.panelId = undefined
		globals.selectionState.selectedUid = undefined
		globals.unreactiveInfo.hasLastSelectedInfoPanel = false
		globals.validateStoredSelectionState.mockClear()
		addPanel.mockClear()
		getPanel.mockClear()
		focus.mockClear()
		getPanel.mockReturnValue(undefined)
		addPanel.mockImplementation(({ id }: { id: string }) => ({ id, focus }))
		;(window as any).dockviewApi = { addPanel, getPanel }
	})

	afterEach(() => {
		stop?.()
		stop = undefined
		container.remove()
		document.body.innerHTML = ''
		delete (window as any).dockviewApi
	})

	it('mirrors tile hover into shared hoveredObject state', () => {
		const tile = new MockTile({ q: 0, r: 1 })

		stop = latch(container, <LinkedEntityControl object={tile as never} />)

		const button = container.querySelector('[data-testid="linked-entity-control"]')
		expect(button).not.toBeNull()

		button!.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
		expect(globals.mrg.hoveredObject?.uid).toBe(tile.uid)

		button!.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }))
		expect(globals.mrg.hoveredObject).toBeUndefined()
	})

	it('selects the object and opens a follow inspector on click', () => {
		const tile = new MockTile({ q: 0, r: 1 })

		stop = latch(container, <LinkedEntityControl object={tile as never} />)

		const button = container.querySelector('[data-testid="linked-entity-control"]') as HTMLButtonElement
		button.click()

		expect(globals.selectionState.selectedUid).toBe(tile.uid)
		expect(addPanel).toHaveBeenCalledWith({
			id: expect.stringMatching(/^selection-info-/),
			component: 'selection-info',
			params: {},
			tabComponent: 'selection-info-tab',
			floating: {
				width: 400,
				height: 600,
			},
		})
		expect(globals.selectionState.panelId).toMatch(/^selection-info-/)
		expect(globals.unreactiveInfo.hasLastSelectedInfoPanel).toBe(true)
		expect(focus).toHaveBeenCalled()
	})

	it('keeps the last resolved sprite while the same target tile churns data', () => {
		const tile = new MockTile({ q: 0, r: 1 })

		stop = latch(container, <LinkedEntityControl object={tile as never} />)

		expect(container.querySelector('[data-testid="resource-image"]')).not.toBeNull()

		tile.content = undefined

		expect(container.querySelector('[data-testid="resource-image"]')).not.toBeNull()
	})
})
