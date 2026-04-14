import { document, latch } from '@sursaut/core'
import type { DockviewWidgetProps } from '@sursaut/ui/dockview'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SelectionInfoContext } from './selection-info-tab'

const updateParameters = vi.fn<(params: { uid?: string }) => void>()
const onDidRemovePanel = vi.fn((handler: (panel: { id: string }) => void) => {
	void handler
	return { dispose: vi.fn() }
})

const hive = {
	name: 'North Hive',
	working: true,
	alveoli: [
		{
			name: 'gather',
			action: { type: 'gather' },
			goodsRelations: {
				wood: { advertisement: 'provide', priority: '1-buffer' },
			},
		},
		{
			name: 'sawmill',
			action: { type: 'transform' },
			goodsRelations: {
				wood: { advertisement: 'demand', priority: '2-use' },
			},
		},
	],
}

const hiveSyntheticUid = 'hive:tile%3A0%2C0'
const world = {
	position: { x: 0, y: 0 },
	scale: { x: 2 },
}

const globals = {
	selectionState: {
		selectedUid: undefined as string | undefined,
		titleVersion: 0,
	},
	bumpSelectionTitleVersion: vi.fn(),
	mrg: {
		hoveredObject: undefined as unknown,
	},
	unreactiveInfo: {
		hasLastSelectedInfoPanel: true,
	},
}

const game = {
	getObject: vi.fn((uid: string) => {
		if (uid !== hiveSyntheticUid) return undefined
		return {
			uid,
			kind: 'hive' as const,
			title: 'North Hive',
			logs: [],
			anchorTileUid: 'tile:0,0',
			position: { q: 0, r: 0 },
			game,
			tile: {},
		}
	}),
	objects: new Map(),
	freightLines: [],
	renderer: {
		world,
		app: {
			screen: { width: 200, height: 100 },
		},
	},
}

vi.mock('@app/lib/css', () => ({
	css: () => '',
}))

vi.mock('@app/lib/follow-selection', () => ({
	clearFollowSelectionPanel: vi.fn(),
	registerPinnedInspectorPanel: vi.fn(),
	unregisterPinnedInspectorPanel: vi.fn(),
}))

vi.mock('@app/lib/globals', () => ({
	game,
	mrg: globals.mrg,
	selectionState: globals.selectionState,
	bumpSelectionTitleVersion: globals.bumpSelectionTitleVersion,
	unreactiveInfo: globals.unreactiveInfo,
}))

vi.mock('@app/ui/anarkai', () => ({
	InspectorSection: (props: { title?: string; children?: JSX.Element }) => (
		<section data-testid="inspector-section" data-title={props.title}>
			{props.children}
		</section>
	),
	Panel: (props: { class?: string; children?: JSX.Element }) => (
		<div class={props.class}>{props.children}</div>
	),
}))

vi.mock('../components/CharacterProperties', () => ({
	default: () => <div data-testid="character-properties">character</div>,
}))

vi.mock('../components/TileProperties', () => ({
	default: () => <div data-testid="tile-properties">tile</div>,
}))

vi.mock('../components/FreightLineProperties', () => ({
	default: () => <div data-testid="freight-line-properties">freight</div>,
}))

vi.mock('../components/EntityBadge', () => ({
	default: (props: { text: string }) => (
		<span data-testid={`badge-${props.text}`}>{props.text}</span>
	),
}))

vi.mock('../components/parts/WorkingIndicator', () => ({
	default: (props: { checked: boolean; onChange?: (checked: boolean) => void }) => (
		<button
			data-testid="hive-working-toggle"
			data-checked={String(props.checked)}
			onClick={() => props.onChange?.(!props.checked)}
		/>
	),
}))

vi.mock('ssh/hive', () => ({
	isHiveUid: (uid: string) => uid.startsWith('hive:'),
	resolveHiveFromAnchorTile: vi.fn(() => hive),
	hiveInspectorTitle: (currentHive: { name?: string } | undefined) => currentHive?.name ?? 'Hive',
}))

vi.mock('ssh/hive/build', () => ({
	BuildAlveolus: class BuildAlveolus {},
}))

vi.mock('ssh/i18n', () => ({
	i18nState: {
		translator: {
			hive: {
				section: 'Hive',
				name: 'Name',
				commands: 'Commands',
				workingTooltip: 'Toggle hive',
				ads: 'Ads',
				noAds: 'No ads',
				sourcesHint: 'Sources',
				demand: 'Demand',
				provide: 'Provide',
			},
			goods: {
				wood: 'Wood',
			},
		},
	},
}))

vi.mock('ssh/population/character', () => ({
	Character: class Character {},
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

vi.mock('ssh/interactive-state', () => ({
	setHoveredObject: vi.fn((object: unknown) => {
		globals.mrg.hoveredObject = object
	}),
	isHoveredObject: vi.fn((object: unknown) => globals.mrg.hoveredObject === object),
}))

vi.mock('ssh/utils/position', async (importOriginal) => {
	const actual = await importOriginal<typeof import('ssh/utils/position')>()
	return {
		...actual,
		toWorldCoord: vi.fn(() => ({ x: 40, y: 10 })),
	}
})

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

describe('SelectionInfoWidget hive integration', () => {
	let container: HTMLElement
	let stop: (() => void) | undefined

	beforeAll(async () => {
		;({ default: SelectionInfoWidget } = await import('./selection-info'))
	})

	beforeEach(() => {
		container = document.createElement('div')
		document.body.appendChild(container)
		globals.selectionState.selectedUid = hiveSyntheticUid
		globals.selectionState.titleVersion = 0
		globals.unreactiveInfo.hasLastSelectedInfoPanel = true
		globals.mrg.hoveredObject = undefined
		globals.bumpSelectionTitleVersion.mockClear()
		updateParameters.mockClear()
		onDidRemovePanel.mockClear()
		game.getObject.mockClear()
		hive.name = 'North Hive'
		hive.working = true
	})

	afterEach(() => {
		stop?.()
		stop = undefined
		container.remove()
		document.body.innerHTML = ''
	})

	it('mounts the real hive widget inside the selection panel', () => {
		const props = createProps()
		const scope = createScope()

		stop = latch(container, <SelectionInfoWidget {...props} />, scope as never)

		const nameInput = container.querySelector('input') as HTMLInputElement
		expect(nameInput.value).toBe('North Hive')
		expect(container.querySelector('[data-testid="hive-ad-row-wood-demand"]')).not.toBeNull()
		expect(container.querySelector('[data-testid="hive-ad-row-wood-provide"]')).not.toBeNull()
		expect(container.querySelector('[data-testid="badge-Wood"]')).not.toBeNull()
		expect(
			container.querySelector('[data-testid="hive-working-toggle"]')?.getAttribute('data-checked')
		).toBe('true')

		nameInput.value = 'Workshop Ring'
		nameInput.dispatchEvent(new Event('input', { bubbles: true }))
		expect(hive.name).toBe('Workshop Ring')

		;(container.querySelector('[data-testid="hive-working-toggle"]') as HTMLButtonElement).click()
		expect(hive.working).toBe(false)
	})
})
