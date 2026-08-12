import { document, latch } from '@sursaut/core'
import { reactive } from 'mutts'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

class MockBuildAlveolus {
	target!: string
	tile!: object
	constructionSite!: object
	storage!: object
	constructionWorkSecondsApplied!: number
}

const buildAlveolus = Object.assign(new MockBuildAlveolus(), {
	name: 'build.storage',
	target: 'storage',
	tile: { position: { q: 1, r: 0 } },
	constructionSite: {
		target: { kind: 'alveolus', alveolusType: 'storage' },
		phase: 'waiting_construction',
		workSecondsApplied: 2,
		recipe: { workSeconds: 6, goods: {} },
	},
	constructionWorkSecondsApplied: 2,
	action: { type: 'storage' },
	goodsRelations: {
		wood: { advertisement: 'demand', priority: '2-use' },
	},
	storage: { stock: { wood: 2 } },
})

const hive = reactive({
	name: 'North Hive' as string | undefined,
	working: true,
	alveoli: [
		{
			name: 'freight_bay',
			action: { type: 'road-fret' },
			goodsRelations: {
				wood: { advertisement: 'provide', priority: '1-buffer' },
			},
			storage: { stock: { wood: 4 } },
		},
		{
			name: 'sawmill',
			action: { type: 'transform' },
			goodsRelations: {
				wood: { advertisement: 'demand', priority: '2-use' },
			},
			storage: { stock: { wood: 1 } },
		},
		buildAlveolus,
	],
})

const resolveHiveFromAnchorTile = vi.fn(() => hive)

vi.mock('@app/lib/css', () => ({
	css: () => '',
}))

vi.mock('@app/lib/globals', () => ({
	bumpSelectionTitleVersion: vi.fn(),
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

vi.mock('@app/lib/hive-inspector', () => ({
	resolveHiveFromAnchorTile,
}))

vi.mock('ssh/hive/build', () => ({
	BuildAlveolus: MockBuildAlveolus,
}))

// The under-construction gate is `isConstructionSiteShell`; this mock only
// supplies the view model once that gate passes (the single build alveolus).
vi.mock('ssh/construction', () => ({
	queryConstructionSiteView: vi.fn(() => ({
		phase: 'waiting_construction',
		constructionWorkSecondsApplied: 2,
		constructionTotalSeconds: 6,
		blockingReasons: ['no_engineer_in_range'],
	})),
}))

vi.mock('@app/lib/i18n', () => {
	const i18nState = {
		translator: {
			hive: {
				section: 'Hive',
				name: 'Name',
				commands: 'Commands',
				workingTooltip: 'Toggle hive activity',
				ads: 'Ads',
				noAds: 'No ads',
				sourcesHint: 'Sources',
				demand: 'Demand',
				provide: 'Provide',
			},
			alveoli: {
				storage: 'Storage',
			},
			goods: {
				wood: 'Wood',
			},
			construction: {
				section: 'Construction',
				phases: {
					waiting_construction: 'Waiting for builder',
				},
				blocking: {
					no_engineer_in_range: 'No engineer in range',
				},
				workProgress: 'Work: {applied}s / {total}s',
			},
		},
	}
	return {
		i18nState,
		T: i18nState.translator,
		getTranslator: () => i18nState.translator,
	}
})

vi.mock('./EntityBadge', () => ({
	default: (props: { text: string }) => (
		<span data-testid={`badge-${props.text}`}>{props.text}</span>
	),
}))

vi.mock('./parts/WorkingIndicator', () => ({
	default: (props: { checked: boolean; onChange?: (checked: boolean) => void }) => (
		<button
			data-testid="hive-working-toggle"
			data-checked={String(props.checked)}
			onClick={() => {
				(props as any).checked = !(props as any).checked
			}}
		/>
	),
}))

let HiveProperties: typeof import('./HiveProperties').default

describe('HiveProperties', () => {
	let container: HTMLElement
	let stop: (() => void) | undefined

	beforeAll(async () => {
		;({ default: HiveProperties } = await import('./HiveProperties'))
	})

	beforeEach(() => {
		container = document.createElement('div')
		document.body.appendChild(container)
		hive.name = 'North Hive'
		hive.working = true
		resolveHiveFromAnchorTile.mockClear()
		resolveHiveFromAnchorTile.mockReturnValue(hive)
	})

	afterEach(() => {
		stop?.()
		stop = undefined
		container.remove()
		document.body.innerHTML = ''
	})

	it('renders ads and allows editing hive metadata', async () => {
		stop = latch(
			container,
			<HiveProperties
				hiveObject={{
					kind: 'hive',
					title: 'North Hive',
					game: { vehicles: [] } as never,
					logs: [],

					tile: {} as never,
				}}
			/>
		)

		await new Promise((r) => setTimeout(r, 0))

		const nameInput = container.querySelector('input') as HTMLInputElement
		expect(nameInput).not.toBeNull()
		expect(nameInput.value).toBe('North Hive')
		expect(container.querySelector('[data-testid="hive-ad-row-wood-demand"]')).not.toBeNull()
		expect(container.querySelector('[data-testid="hive-ad-row-wood-provide"]')).not.toBeNull()
		expect(
			container.querySelector('[data-testid="hive-ad-quantity-wood-demand"]')?.textContent
		).toBe('7')
		expect(
			container.querySelector('[data-testid="hive-ad-quantity-wood-provide"]')?.textContent
		).toBe('7')
		expect(container.querySelector('[data-testid="badge-Wood"]')).not.toBeNull()
		expect(
			container.querySelector('[data-testid="hive-working-toggle"]')?.getAttribute('data-checked')
		).toBe('true')

		nameInput.value = 'Workshop Ring'
		nameInput.dispatchEvent(new Event('input', { bubbles: true }))

		expect(hive.name).toBe('Workshop Ring')
		expect(nameInput.value).toBe('Workshop Ring')

		;(container.querySelector('[data-testid="hive-working-toggle"]') as HTMLButtonElement).click()
		expect(hive.working).toBe(false)
	})
})
