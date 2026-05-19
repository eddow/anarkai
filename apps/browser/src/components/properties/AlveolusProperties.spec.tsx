import {
	consumePresentationEvents,
	resetPresentationRevisionsForTests,
} from '@app/lib/presentation-events'
import { document, latch } from '@sursaut/core'
import { reactive } from 'mutts'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { selectInspectorObject } = vi.hoisted(() => ({
	selectInspectorObject: vi.fn(),
}))

const findFreightLinesForStop = vi.fn(() => [])
const createSyntheticFreightLineObject = vi.fn((_game: unknown, line: { id: string }) => ({
	uid: `syn:${line.id}`,
	lineId: line.id,
}))
const createExchangeFreightLineDraftForFreightBay = vi.fn(() => ({
	id: 'new-explicit-line',
	name: 'New line',
	stops: [],
}))
const queryConstructionSiteView = vi.fn()
const replaceFreightLine = vi.fn()
const removeFreightLineById = vi.fn()

const { MockForesterAlveolus, MockFreightBayAlveolus, MockStorageAlveolus, MockTransformAlveolus } =
vi.hoisted(() => ({
	MockForesterAlveolus: class MockForesterAlveolus {
		hive = { name: 'H' }
		name = 'forester'
		tile = { position: { q: 0, r: 0 } }
		working = true
		action = { type: 'plant', deposit: 'tree' }
		assignedZoneIds: string[] = []
		addAssignedZoneId(zoneId: string) {
			if (!this.assignedZoneIds.includes(zoneId)) this.assignedZoneIds.push(zoneId)
		}
		removeAssignedZoneId(zoneId: string) {
			this.assignedZoneIds = this.assignedZoneIds.filter((id) => id !== zoneId)
		}
	},
	MockFreightBayAlveolus: class MockFreightBayAlveolus {
		hive = { name: 'H' }
		name = 'freight_bay'
		tile = { position: { q: 0, r: 0 } }
		working = true
		action = { type: 'road-fret' }
	},
	MockStorageAlveolus: class MockStorageAlveolus {
		hive = { name: 'H' }
		name = 'storage'
		tile = { position: { q: 0, r: 0 } }
		working = true
		action = { type: 'storage', kind: 'slotted', slots: 4, capacity: 2 }
	},
	MockTransformAlveolus: class MockTransformAlveolus {
		hive = { name: 'H' }
		name = 'sawmill'
		tile = { uid: 'tile:transform', position: { q: 0, r: 0 } }
		game = { freightLines: [] }
		working = true
		action = {
			type: 'transform',
			rates: { wood: -0.2, planks: 0.2 },
			productRatio: { inputGood: 'wood', outputGood: 'planks', maxProductRatio: 0.5 },
		}
		transformConfiguration = reactive({
			working: true,
			productRatio: { inputGood: 'wood', outputGood: 'planks', maxProductRatio: 0.5 },
		})
		processBuffers = { wood: 0.4, planks: 0.6 }
		consumedGoods = ['wood']
		producedGoods = ['planks']
		get rateEntries() {
			return [
				['planks', 0.2],
				['wood', -0.2],
			]
		}
		processBuffer(goodType: 'wood' | 'planks') {
			return this.processBuffers[goodType]
		}
		setProductRatioConfiguration(config: {
			inputGood?: string
			outputGood?: string
			maxProductRatio: number
		}) {
			this.transformConfiguration.productRatio = config
		}
	},
}))

class MockBuildAlveolus {
	tile = { uid: 'tile:build' }
	constructionSite = { target: { kind: 'alveolus', alveolusType: 'tree_chopper' } }
	requiredGoods = { wood: 2 }
	game = { freightLines: [] }
	working = true
	storage = { stock: {} }
	goodsRelations = {}
	constructionWorkSecondsApplied = 0
}

vi.mock('@app/lib/css', () => ({
	css: () => '',
}))

vi.mock('@app/lib/follow-selection', () => ({
	selectInspectorObject,
}))

vi.mock('ssh/freight/freight-line', () => ({
	createExchangeFreightLineDraftForFreightBay,
	createSyntheticFreightLineObject,
	findFreightLinesForStop,
	normalizeFreightLineDefinition: (line: { id: string; name: string; stops: unknown[] }) => line,
}))

vi.mock('ssh/hive/storage', () => ({
	StorageAlveolus: MockStorageAlveolus,
}))

vi.mock('ssh/hive/freight-bay', () => ({
	FreightBayAlveolus: MockFreightBayAlveolus,
}))

vi.mock('ssh/hive/forester', () => ({
	ForesterAlveolus: MockForesterAlveolus,
}))

vi.mock('ssh/hive/transform', () => ({
	TransformAlveolus: MockTransformAlveolus,
}))

vi.mock('ssh/hive/build', () => ({
	BuildAlveolus: MockBuildAlveolus,
}))

vi.mock('ssh/construction', () => ({
	queryConstructionSiteView,
}))

vi.mock('@app/lib/i18n', () => {
	const i18nState = {
		translator: {
			construction: {
				section: 'Construction',
				materials: 'Materials',
				phases: {
					building: 'Building',
				},
				blocking: {
					construction_site_paused: 'Construction site is paused',
				},
				workProgress: 'Work: {applied}s / {total}s',
			},
			alveolus: {
				commands: 'Commands',
				process: 'Process',
				productRatio: 'Product ratio',
				productRatioInput: 'Input good',
				productRatioOutput: 'Output good',
				workingTooltip: 'Working',
			},
			goods: {
				stored: 'Stored',
			},
			line: {
				section: 'Freight line',
				linesSection: 'Freight lines',
			},
			bay: {
				linesAtThisBay: 'Lines at this bay',
				addLine: 'Add line',
				addLineHint: 'Create route',
				removeLine: 'Remove line',
			},
		},
	}
	return {
		i18nState,
		T: i18nState.translator,
		getTranslator: () => i18nState.translator,
	}
})

vi.mock('../InspectorObjectLink', () => ({
	default: (props: { label?: string; object?: { title?: string } }) => (
		<button type="button" class="inspector-object-link">
			{props.label ?? props.object?.title}
		</button>
	),
}))

vi.mock('../LinkedEntityControl', () => ({
	default: () => null,
}))

vi.mock('../PropertyGridRow', () => ({
	default: (props: { if?: boolean; label?: string; children?: JSX.Element }) =>
		props.if === false ? null : (
			<tr data-testid={`row-${props.label ?? 'unlabeled'}`}>
				<th>{props.label}</th>
				<td>{props.children}</td>
			</tr>
		),
}))

vi.mock('../parts/WorkingIndicator', () => ({
	default: () => <button data-testid="working-indicator" />,
}))

vi.mock('../storage/StorageConfiguration', () => ({
	default: () => <div data-testid="storage-configuration" />,
}))

vi.mock('../storage/StoredGoodsRow', () => ({
	default: (props: {
		if?: boolean
		label?: string
		content?: {
			requiredGoods?: Record<string, number>
			storage?: { stock?: Record<string, number> }
		}
	}) =>
		props.if === false ? null : (
			<tr data-testid={`stored-goods-row-${props.label ?? 'unknown'}`}>
				<td>
					{Object.entries(props.content?.requiredGoods ?? {}).map(([good, qty]) => (
						<span data-testid={`construction-material-${good}`} key={good}>
							{good} {props.content?.storage?.stock?.[good] ?? 0}/{qty}
						</span>
					))}
				</td>
			</tr>
		),
}))

let AlveolusProperties: typeof import('./AlveolusProperties').default

describe('AlveolusProperties', () => {
	let container: HTMLElement
	let stop: (() => void) | undefined

	beforeAll(async () => {
		;({ default: AlveolusProperties } = await import('./AlveolusProperties'))
	})

	beforeEach(() => {
		resetPresentationRevisionsForTests()
		container = document.createElement('div')
		document.body.appendChild(container)
		findFreightLinesForStop.mockClear()
		createSyntheticFreightLineObject.mockClear()
		createExchangeFreightLineDraftForFreightBay.mockClear()
		selectInspectorObject.mockClear()
		replaceFreightLine.mockClear()
		removeFreightLineById.mockClear()
		queryConstructionSiteView.mockReset()
		queryConstructionSiteView.mockReturnValue(undefined)
	})

	afterEach(() => {
		stop?.()
		stop = undefined
		container.remove()
		document.body.innerHTML = ''
	})

	it('does not query freight lines while content is unresolved', () => {
		expect(() => {
			stop = latch(
				container,
				<table>
					<tbody>
						<AlveolusProperties
							content={undefined as never}
							game={{ freightLines: [], vehicles: [] } as never}
						/>
					</tbody>
				</table>
			)
		}).not.toThrow()

		expect(findFreightLinesForStop).not.toHaveBeenCalled()
		expect(container.querySelector('[data-testid="stored-goods-row-Stored"]')).not.toBeNull()
	})

	it('uses plural freight line heading when several lines attach to the same stop', () => {
		findFreightLinesForStop.mockReturnValue([{ id: 'a' } as never, { id: 'b' } as never])
		stop = latch(
			container,
			<table>
				<tbody>
					<AlveolusProperties
						content={
							{
								hive: { name: 'H' },
								name: 'sawmill',
								tile: { position: { q: 0, r: 0 } },
								working: true,
							} as never
						}
						game={{ freightLines: [{}, {}], replaceFreightLine, removeFreightLineById } as never}
					/>
				</tbody>
			</table>
		)
		const row = container.querySelector('[data-testid="row-Freight lines"]')
		expect(row).not.toBeNull()
	})

	it('opens the new freight line in the inspector after creating it from a bay', () => {
		const game = {
			freightLines: [] as { id: string; name: string; stops: unknown[] }[],
			vehicles: [],
			replaceFreightLine(line: { id: string; name: string; stops: unknown[] }) {
				game.freightLines = [line]
			},
		}
		const bay = new MockFreightBayAlveolus()
		stop = latch(
			container,
			<table>
				<tbody>
					<AlveolusProperties content={bay as never} game={game as never} />
				</tbody>
			</table>
		)
		container
			.querySelector('[data-testid="freight-bay-add-line"]')
			?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
		expect(selectInspectorObject).toHaveBeenCalledTimes(1)
		expect(createExchangeFreightLineDraftForFreightBay).toHaveBeenCalledTimes(1)
	})

	it('updates the bay line list when freight lines change', () => {
		const game = reactive({
			freightLines: [] as { id: string; name: string; stops: unknown[] }[],
			vehicles: [],
			replaceFreightLine,
			removeFreightLineById,
		})
		findFreightLinesForStop.mockImplementation(() => game.freightLines as never)
		const bay = new MockFreightBayAlveolus()
		stop = latch(
			container,
			<table>
				<tbody>
					<AlveolusProperties content={bay as never} game={game as never} />
				</tbody>
			</table>
		)

		expect(container.querySelectorAll('.alveolus-line-list__item')).toHaveLength(0)
		game.freightLines = [{ id: 'line-a', name: 'A', stops: [] }]
		expect(container.querySelectorAll('.alveolus-line-list__item')).toHaveLength(1)
		game.freightLines = []
		expect(container.querySelectorAll('.alveolus-line-list__item')).toHaveLength(0)
	})

	it('renders freight bay line controls with bay-specific heading', () => {
		findFreightLinesForStop.mockReturnValue([{ id: 'HiveX:implicit-gather:0,0' } as never])
		const bay = new MockFreightBayAlveolus()
		stop = latch(
			container,
			<table>
				<tbody>
					<AlveolusProperties
						content={bay as never}
						game={
							{ freightLines: [], vehicles: [], replaceFreightLine, removeFreightLineById } as never
						}
					/>
				</tbody>
			</table>
		)
		expect(container.querySelector('[data-testid="row-Lines at this bay"]')).not.toBeNull()
		expect(container.querySelector('[data-testid="freight-bay-add-line"]')).not.toBeNull()
		expect(container.querySelector('[data-testid="freight-bay-add-gather"]')).toBeNull()
		expect(container.querySelector('[data-testid="freight-bay-add-distribute"]')).toBeNull()
	})

	it('renders construction status through the shared formatter for build sites', () => {
		queryConstructionSiteView.mockReturnValue({
			phase: 'building',
			blockingReasons: ['construction_site_paused'],
			constructionWorkSecondsApplied: 3,
			constructionTotalSeconds: 6,
		})

		stop = latch(
			container,
			<table>
				<tbody>
					<AlveolusProperties
						content={new MockBuildAlveolus() as never}
						game={{ freightLines: [], vehicles: [] } as never}
					/>
				</tbody>
			</table>
		)

		expect(container.textContent).toContain('Construction')
		expect(container.textContent).toContain('Building')
		expect(container.textContent).toContain('Construction site is paused')
		expect(container.querySelector('[data-testid="alveolus-construction-progress"]')).not.toBeNull()
		expect(container.querySelector('[data-testid="stored-goods-row-Materials"]')).not.toBeNull()
		expect(container.querySelector('[data-testid="construction-material-wood"]')?.textContent).toBe(
			'wood 0/2'
		)
	})

	it('renders transform process buffers separately from stored goods', () => {
		stop = latch(
			container,
			<table>
				<tbody>
					<AlveolusProperties
						content={new MockTransformAlveolus() as never}
						game={{ freightLines: [], vehicles: [] } as never}
					/>
				</tbody>
			</table>
		)

		expect(container.querySelector('[data-testid="row-Process"]')).not.toBeNull()
		expect(container.querySelector('[data-testid="alveolus-process-buffer-wood"]')).not.toBeNull()
		expect(container.querySelector('[data-testid="alveolus-process-buffer-planks"]')).not.toBeNull()
		expect(container.querySelector('[data-testid="stored-goods-row-Stored"]')).not.toBeNull()
	})

	it('renders transform ratio configuration and updates it from the slider', () => {
		const transform = new MockTransformAlveolus()
		stop = latch(
			container,
			<table>
				<tbody>
					<AlveolusProperties
						content={transform as never}
						game={{ freightLines: [], vehicles: [] } as never}
					/>
				</tbody>
			</table>
		)

		expect(container.querySelector('[data-testid="row-Product ratio"]')).not.toBeNull()
		expect(
			container.querySelector<HTMLSelectElement>('[data-testid="transform-ratio-input-good"]')
				?.value
		).toBe('wood')
		expect(
			container.querySelector<HTMLSelectElement>('[data-testid="transform-ratio-output-good"]')
				?.value
		).toBe('planks')
		expect(
			container.querySelector<HTMLInputElement>('[data-testid="transform-ratio-slider"]')?.value
		).toBe('50')
		expect(container.querySelector('[data-testid="transform-ratio-value"]')?.textContent).toBe(
			'50%'
		)

		const slider = container.querySelector<HTMLInputElement>(
			'[data-testid="transform-ratio-slider"]'
		)!
		slider.value = '65'
		slider.dispatchEvent(new Event('input', { bubbles: true }))

		expect(transform.transformConfiguration.productRatio.maxProductRatio).toBe(0.65)
		expect(container.querySelector('[data-testid="transform-ratio-value"]')?.textContent).toBe(
			'65%'
		)
	})

	it('renders assigned-zone controls for foresters and updates assignments', () => {
		const forester = reactive(new MockForesterAlveolus())
		const game = {
			freightLines: [],
			vehicles: [],
			getObject: (uid: string) => ({
				uid,
				title: uid.includes('north-grove') ? 'North Grove' : 'Zone',
			}),
			hex: {
				zoneManager: {
					listCustomZoneDefinitions: () => [
						{ id: 'north-grove', name: 'North Grove' },
						{ id: 'south-grove', name: 'South Grove' },
					],
					getZoneDefinition: (zoneId: string) =>
						({
							'north-grove': { id: 'north-grove', name: 'North Grove' },
							'south-grove': { id: 'south-grove', name: 'South Grove' },
						})[zoneId],
				},
			},
		}

		stop = latch(
			container,
			<table>
				<tbody>
					<AlveolusProperties content={forester as never} game={game as never} />
				</tbody>
			</table>
		)

		expect(container.querySelector('[data-testid="row-Assigned zones"]')).not.toBeNull()
		container
			.querySelector('[data-testid="forester-zone-picker"] button')
			?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
		const north = [...container.querySelectorAll('.combo-picker__item')].find((item) =>
			item.textContent?.includes('North Grove')
		)
		north?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

		expect(forester.assignedZoneIds).toEqual(['north-grove'])
		expect(container.querySelector('[data-testid="forester-zone-chip"]')?.textContent).toContain(
			'North Grove'
		)
		expect(
			container.querySelector('[data-testid="forester-zone-chip"] .inspector-object-link')
		).not.toBeNull()

		container
			.querySelector('[data-testid="forester-zone-remove-north-grove"]')
			?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
		expect(forester.assignedZoneIds).toEqual([])
	})

	it('does not render assigned-zone controls for non-forester alveoli', () => {
		stop = latch(
			container,
			<table>
				<tbody>
					<AlveolusProperties
						content={new MockTransformAlveolus() as never}
						game={{ freightLines: [], vehicles: [] } as never}
					/>
				</tbody>
			</table>
		)

		expect(container.querySelector('[data-testid="row-Assigned zones"]')).toBeNull()
	})

	it('refreshes transform process buffers from presentation events', async () => {
		const transform = new MockTransformAlveolus()
		stop = latch(
			container,
			<table>
				<tbody>
					<AlveolusProperties
						content={transform as never}
						game={{ freightLines: [], vehicles: [] } as never}
					/>
				</tbody>
			</table>
		)

		const woodLabel = () =>
			container.querySelector('[data-testid="alveolus-process-buffer-wood"]')?.textContent

		expect(woodLabel()).toContain('40%')

		transform.processBuffers.wood = 0.8
		await new Promise((resolve) => setTimeout(resolve, 0))
		expect(woodLabel()).toContain('40%')

		consumePresentationEvents([{ type: 'storage.changed', ownerUid: 'tile:transform' }])
		await new Promise((resolve) => setTimeout(resolve, 0))

		expect(woodLabel()).toContain('80%')
	})
})
