import { document, latch } from '@sursaut/core'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const addPanel = vi.fn()
const getPanel = vi.fn()
const focus = vi.fn()
const globals = {
	game: {
		getObject: vi.fn(),
	},
	mrg: {
		hoveredObject: undefined as any,
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

class MockVehicleEntity {
	uid = 'vehicle:wheelbarrow-1'
	title = 'Wheelbarrow 1'
	vehicleType = 'wheelbarrow'
	game = {
		loaded: Promise.resolve(),
		getTexture: vi.fn(() => undefined),
	}
}

class MockCharacter {
	uid = 'character:ada'
	title = 'Ada'
	game = {
		loaded: Promise.resolve(),
		getTexture: vi.fn(() => undefined),
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
	vehicles: {
		wheelbarrow: {
			sprites: ['wheelbarrow-sprite'],
		},
	},
	characters: {
		default: {
			sprites: ['character-default-sprite'],
		},
	},
}))

vi.mock('engine-pixi/renderers/vehicle-visual', () => ({
	vehicleTextureKey: vi.fn((vehicleType: string) => `vehicles.${vehicleType}`),
}))

vi.mock('ssh/board/content/alveolus', () => ({
	Alveolus: MockAlveolus,
}))

vi.mock('ssh/board/tile', () => ({
	Tile: MockTile,
}))

vi.mock('ssh/population/vehicle/entity', () => ({
	VehicleEntity: MockVehicleEntity,
}))

vi.mock('ssh/population/character', () => ({
	Character: MockCharacter,
}))

vi.mock('ssh/game/object', () => ({
	resolveSelectableHoverObject: vi.fn((object: unknown) => object),
}))

vi.mock('ssh/interactive-state', () => ({
	setHoveredObject: vi.fn((object: unknown) => {
		globals.mrg.hoveredObject = object
	}),
	isHoveredObject: vi.fn((object: unknown) => globals.mrg.hoveredObject === object),
}))

vi.mock('ssh/utils/images', () => ({
	computeStyleFromTexture: vi.fn(() => 'background-image: url(test);'),
}))

vi.mock('ssh/utils/position', () => ({
	toAxialCoord: vi.fn((position: { q: number; r: number }) => position),
}))

vi.mock('./ResourceImage', () => ({
	default: (props: { alt?: string; sprite?: string }) => (
		<span data-testid="resource-image">
			{props.sprite}:{props.alt}
		</span>
	),
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
		globals.selectionState.titleVersion = 0
		globals.unreactiveInfo.hasLastSelectedInfoPanel = false
		globals.game.getObject.mockClear()
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

		const button = container.querySelector(
			'[data-testid="linked-entity-control"]'
		) as HTMLButtonElement
		button.click()

		expect(globals.selectionState.selectedUid).toBe(tile.uid)
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
		expect(globals.selectionState.panelId).toMatch(/^selection-info-/)
		expect(globals.unreactiveInfo.hasLastSelectedInfoPanel).toBe(true)
		expect(focus).toHaveBeenCalled()
	})

	it('focuses an existing pinned inspector instead of adding a new one on click', async () => {
		const { registerPinnedInspectorPanel } = await import('@app/lib/follow-selection')
		const tile = new MockTile({ q: 3, r: 4 })
		const existingPanel = {
			id: 'panel-existing-tile',
			focus,
		}
		getPanel.mockImplementation((panelId?: string) =>
			panelId === 'panel-existing-tile' ? existingPanel : undefined
		)
		registerPinnedInspectorPanel('panel-existing-tile', tile.uid)
		globals.selectionState.selectedUid = 'tile:0,1'

		stop = latch(container, <LinkedEntityControl object={tile as never} />)

		const button = container.querySelector(
			'[data-testid="linked-entity-control"]'
		) as HTMLButtonElement
		button.click()

		expect(globals.selectionState.selectedUid).toBe('tile:0,1')
		expect(addPanel).not.toHaveBeenCalled()
		expect(focus).toHaveBeenCalledTimes(1)
	})

	it('keeps the last resolved sprite while the same target tile churns data', () => {
		const tile = new MockTile({ q: 0, r: 1 })

		stop = latch(container, <LinkedEntityControl object={tile as never} />)

		expect(container.querySelector('[data-testid="resource-image"]')).not.toBeNull()

		tile.content = undefined

		expect(container.querySelector('[data-testid="resource-image"]')).not.toBeNull()
	})

	it('renders a stable vehicle sprite for linked vehicles', () => {
		const vehicle = new MockVehicleEntity()

		stop = latch(container, <LinkedEntityControl object={vehicle as never} />)

		expect(container.querySelector('[data-testid="resource-image"]')?.textContent).toContain(
			'wheelbarrow-sprite:Wheelbarrow 1'
		)
	})

	it('renders a stable character sprite for linked characters', () => {
		const character = new MockCharacter()

		stop = latch(container, <LinkedEntityControl object={character as never} />)

		expect(container.querySelector('[data-testid="resource-image"]')?.textContent).toContain(
			'character-default-sprite:Ada'
		)
	})

	it('renders nothing when the target object is temporarily unavailable', () => {
		expect(() => {
			stop = latch(container, <LinkedEntityControl object={undefined} />)
		}).not.toThrow()

		expect(container.querySelector('[data-testid="linked-entity-control"]')).toBeNull()
	})
})
