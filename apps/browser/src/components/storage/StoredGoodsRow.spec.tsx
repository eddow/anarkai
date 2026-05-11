import {
	consumePresentationEvents,
	resetPresentationRevisionsForTests,
} from '@app/lib/presentation-events'
import { document, latch } from '@sursaut/core'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const classMocks = vi.hoisted(() => {
	class MockBuildAlveolus {
		tile = { uid: 'tile:build-site' }
		constructionSite = { target: { kind: 'alveolus', alveolusType: 'tree_chopper' } }
		requiredGoods = { stone: 1 }
		storage = { stock: {} }
		goodsRelations = {}
		constructionWorkSecondsApplied = 0
	}

	return { MockBuildAlveolus }
})

vi.mock('@app/lib/css', () => ({
	css: () => '',
}))

vi.mock('@app/lib/i18n', () => ({
	T: {
		alveolus: {
			cleanUpConfirmText: 'Confirm cleanup?',
			cleanUpGoodTooltip: ({ goodType }: { goodType: string }) => `Clear ${goodType}`,
			cleanUpTooltip: 'Clear all',
			clear: 'Clear',
			keep: 'Keep',
		},
	},
}))

vi.mock('@app/ui/anarkai', () => ({
	Button: (props: { children?: JSX.Children }) => <button type="button">{props.children}</button>,
}))

vi.mock('engine-pixi/assets/visual-content', () => ({
	goods: {
		stone: { sprites: ['goods.stone'] },
		wood: { sprites: ['goods.wood'] },
	},
}))

vi.mock('../EntityBadge', () => ({
	default: (props: { text?: string; qtyLabel?: string }) => (
		<span data-testid={`badge-${props.text}`}>{props.qtyLabel}</span>
	),
}))

vi.mock('../PropertyGridRow', () => ({
	default: (props: { if?: boolean; children?: JSX.Children }) =>
		props.if === false ? null : <div data-testid="property-row">{props.children}</div>,
}))

vi.mock('ssh/hive/build', () => ({
	BuildAlveolus: classMocks.MockBuildAlveolus,
}))

let StoredGoodsRow: typeof import('./StoredGoodsRow').default

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('StoredGoodsRow presentation refresh', () => {
	let container: HTMLElement
	let stop: (() => void) | undefined

	beforeAll(async () => {
		;({ default: StoredGoodsRow } = await import('./StoredGoodsRow'))
	})

	beforeEach(() => {
		resetPresentationRevisionsForTests()
		container = document.createElement('div')
		document.body.appendChild(container)
	})

	afterEach(() => {
		stop?.()
		stop = undefined
		container.remove()
		document.body.innerHTML = ''
	})

	it('refreshes stock display when the owning tile receives a storage presentation event', async () => {
		let stock = { wood: 1 }
		const content = {
			tile: { uid: 'tile:stored-goods' },
			game: {},
			storage: {
				get stock() {
					return stock
				},
			},
			goodsRelations: {},
		}

		stop = latch(
			container,
			<StoredGoodsRow content={content as never} game={{} as never} label="Stored" />
		)

		expect(container.querySelector('[data-testid="badge-wood"]')?.textContent).toBe('×1')

		stock = { wood: 2 }
		await flush()
		expect(container.querySelector('[data-testid="badge-wood"]')?.textContent).toBe('×1')

		consumePresentationEvents([{ type: 'storage.changed', ownerUid: 'tile:stored-goods' }])
		await flush()

		expect(container.querySelector('[data-testid="badge-wood"]')?.textContent).toBe('×2')
	})

	it('shows empty construction goods even when inbound allocation hides the demand relation', async () => {
		const { BuildAlveolus } = await import('ssh/hive/build')
		const site = new BuildAlveolus()

		stop = latch(
			container,
			<StoredGoodsRow content={site as never} game={{} as never} label="Materials" />
		)

		expect(container.querySelector('[data-testid="badge-stone"]')?.textContent).toBe('0/1')
	})

	it('tolerates transient construction shells before required goods are populated', async () => {
		const { BuildAlveolus } = await import('ssh/hive/build')
		const site = new BuildAlveolus()
		site.requiredGoods = undefined as never

		stop = latch(
			container,
			<StoredGoodsRow content={site as never} game={{} as never} label="Materials" />
		)

		expect(container.querySelector('[data-testid="property-row"]')).toBeNull()
	})
})
