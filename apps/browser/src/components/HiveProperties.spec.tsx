import { document, latch } from '@sursaut/core'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

class MockBuildAlveolus {
	uid!: string
	target!: string
	tile!: { uid: string }
}

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
		Object.assign(new MockBuildAlveolus(), {
			uid: 'build:1',
			name: 'build.storage',
			target: 'storage',
			tile: { uid: 'tile:1,0' },
			action: { type: 'storage' },
			goodsRelations: {
				wood: { advertisement: 'demand', priority: '2-use' },
			},
		}),
	],
}

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

vi.mock('ssh/hive', () => ({
	resolveHiveFromAnchorTile,
}))

vi.mock('ssh/hive/build', () => ({
	BuildAlveolus: MockBuildAlveolus,
}))

vi.mock('ssh/construction', () => ({
	queryConstructionSiteView: vi.fn((_game: unknown, tile: { uid?: string }) =>
		tile?.uid === 'tile:1,0'
			? {
					phase: 'waiting_construction',
					constructionWorkSecondsApplied: 2,
					constructionTotalSeconds: 6,
					blockingReasons: ['no_engineer_in_range'],
				}
			: undefined
	),
}))

vi.mock('ssh/i18n', () => ({
	i18nState: {
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
	},
}))

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
			onClick={() => props.onChange?.(!props.checked)}
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

	it('renders ads and allows editing hive metadata', () => {
		stop = latch(
			container,
			<HiveProperties
				hiveObject={{
					uid: 'hive:tile%3A0%2C0',
					kind: 'hive',
					title: 'North Hive',
					game: {} as never,
					logs: [],
					anchorTileUid: 'tile:0,0',
					tile: {} as never,
				}}
			/>
		)

		const nameInput = container.querySelector('input') as HTMLInputElement
		expect(nameInput).not.toBeNull()
		expect(nameInput.value).toBe('North Hive')
		expect(container.querySelector('[data-testid="hive-ad-row-wood-demand"]')).not.toBeNull()
		expect(container.querySelector('[data-testid="hive-ad-row-wood-provide"]')).not.toBeNull()
		expect(container.querySelector('[data-testid="badge-Wood"]')).not.toBeNull()
		expect(
			container.querySelector('[data-testid="hive-build-site-build:1"]')?.textContent
		).toContain('Storage')
		expect(
			container.querySelector('[data-testid="hive-build-site-build:1"]')?.textContent
		).toContain('Waiting for builder')
		expect(
			container.querySelector('[data-testid="hive-build-site-build:1"]')?.textContent
		).toContain('No engineer in range')
		expect(container.querySelector('[data-testid="hive-build-progress-build:1"]')).not.toBeNull()
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
