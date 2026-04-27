import { document, latch } from '@sursaut/core'
import { reactive } from 'mutts'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

class MockAlveolus {}
class MockBasicDwelling {}
class MockBuildAlveolus extends MockAlveolus {
	target = 'storage'
	name = 'build.storage'
	title = 'Build storage'
}
class MockBuildDwelling {}
class MockUnBuiltLand {}

vi.mock('@app/lib/css', () => ({
	css: () => '',
}))

vi.mock('@app/ui/anarkai', () => ({
	Badge: (props: { children?: JSX.Children }) => <span>{props.children}</span>,
	InspectorSection: (props: { children?: JSX.Children; class?: string }) => (
		<section class={props.class}>{props.children}</section>
	),
}))

vi.mock('engine-pixi/assets/visual-content', () => ({
	alveoli: {
		storage: {
			sprites: ['buildings.store'],
		},
	},
	dwellings: {},
}))

vi.mock('ssh/board/content/alveolus', () => ({
	Alveolus: MockAlveolus,
}))

vi.mock('ssh/board/content/basic-dwelling', () => ({
	BasicDwelling: MockBasicDwelling,
}))

vi.mock('ssh/board/content/build-dwelling', () => ({
	BuildDwelling: MockBuildDwelling,
}))

vi.mock('ssh/hive/build', () => ({
	BuildAlveolus: MockBuildAlveolus,
}))

vi.mock('ssh/board/content/unbuilt-land', () => ({
	UnBuiltLand: MockUnBuiltLand,
}))

vi.mock('@app/lib/i18n', () => {
	const i18nState = {
		translator: {
			tile: {
				walkTime: 'Walk time',
				unwalkable: 'Unwalkable',
			},
			goods: {
				stored: 'Stored',
				loose: 'Loose',
			},
		},
	}
	return {
		i18nState,
		getTranslator: () => i18nState.translator,
	}
})

vi.mock('ssh/utils/images', () => ({
	computeStyleFromTexture: vi.fn(() => ''),
}))

vi.mock('ssh/construction', () => ({
	queryConstructionSiteView: vi.fn(() => undefined),
}))

vi.mock('./AlveolusProperties', () => ({
	default: () => null,
}))

vi.mock('./ConstructionProgressBar', () => ({
	default: () => null,
}))

vi.mock('./DwellingProperties', () => ({
	default: () => null,
}))

vi.mock('./EntityBadge', () => ({
	default: (props: { sprite?: string; text?: string }) => (
		<div data-testid="entity-badge">
			{props.sprite}:{props.text}
		</div>
	),
}))

vi.mock('./GoodsList', () => ({
	default: (props: { goods: string[] }) => (
		<div data-testid="goods-list">{props.goods.join(',')}</div>
	),
}))

vi.mock('./HiveAnchorButton', () => ({
	default: () => null,
}))

vi.mock('./PropertyGrid', () => ({
	default: (props: { children?: JSX.Children }) => <div>{props.children}</div>,
}))

vi.mock('./PropertyGridRow', () => ({
	default: (props: { label?: string; children?: JSX.Children; if?: boolean }) =>
		props.if === false ? null : (
			<div data-testid={`row-${props.label ?? 'none'}`}>
				{props.label}
				{props.children}
			</div>
		),
}))

vi.mock('./storage/StoredGoodsRow', () => ({
	default: (props: { if?: boolean; label?: string }) =>
		props.if === false ? null : <div data-testid={`stored-goods-${props.label ?? 'unknown'}`} />,
}))

vi.mock('./UnBuiltProperties', () => ({
	default: () => null,
}))

let TileProperties: typeof import('./TileProperties').default

describe('TileProperties', () => {
	let container: HTMLElement
	let stop: (() => void) | undefined

	beforeAll(async () => {
		;({ default: TileProperties } = await import('./TileProperties'))
	})

	beforeEach(() => {
		container = document.createElement('div')
		document.body.appendChild(container)
	})

	afterEach(() => {
		stop?.()
		stop = undefined
		container.remove()
		document.body.innerHTML = ''
	})

	it('does not throw when storage disappears after mount', () => {
		const content = reactive({
			walkTime: 1,
			storage: reactive({
				stock: reactive({
					wood: 2,
				}),
			}),
		})
		const tile = reactive({
			content,
			looseGoods: [],
			board: {
				game: {
					loaded: Promise.resolve(),
					getTexture: vi.fn(() => undefined),
				},
			},
		})

		stop = latch(container, <TileProperties tile={tile as never} />)
		expect(container.textContent).toContain('Stored')
		expect(container.textContent).toContain('wood')

		expect(() => {
			content.storage = undefined as never
		}).not.toThrow()

		expect(container.textContent).not.toContain('wood')
	})

	it('does not throw when board game disappears after mount', () => {
		const tile = reactive({
			content: new MockBasicDwelling(),
			looseGoods: [],
			board: reactive({
				game: {
					loaded: Promise.resolve(),
					getTexture: vi.fn(() => undefined),
				},
			}),
		})

		stop = latch(container, <TileProperties tile={tile as never} />)
		expect(container.querySelector('[data-testid="stored-goods-Stored"]')).not.toBeNull()

		expect(() => {
			tile.board = undefined as never
		}).not.toThrow()

		expect(container.querySelector('[data-testid="stored-goods-Stored"]')).toBeNull()
	})

	it('does not throw when an alveolus construction shell resolves visuals via its target', () => {
		const tile = reactive({
			content: new MockBuildAlveolus(),
			looseGoods: [],
			board: {
				game: {
					loaded: Promise.resolve(),
					getTexture: vi.fn(() => undefined),
				},
			},
		})

		expect(() => {
			stop = latch(container, <TileProperties tile={tile as never} />)
		}).not.toThrow()
		expect(container.querySelector('[data-testid="entity-badge"]')?.textContent).toContain(
			'buildings.store'
		)
	})
})
