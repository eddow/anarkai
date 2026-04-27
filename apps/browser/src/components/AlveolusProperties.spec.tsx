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
const createExplicitFreightLineDraftForFreightBay = vi.fn(() => ({
	id: 'new-explicit-line',
	name: 'New line',
	stops: [],
}))
const queryConstructionSiteView = vi.fn()
const replaceFreightLine = vi.fn()
const removeFreightLineById = vi.fn()

const { MockStorageAlveolus } = vi.hoisted(() => ({
	MockStorageAlveolus: class MockStorageAlveolus {
		hive = { name: 'H' }
		name = 'freight_bay'
		tile = { position: { q: 0, r: 0 } }
		working = true
		action = { type: 'road-fret', kind: 'slotted', slots: 4, capacity: 2 }
	},
}))

class MockBuildAlveolus {
	tile = { uid: 'tile:build' }
	game = { freightLines: [] }
	working = true
}

vi.mock('@app/lib/css', () => ({
	css: () => '',
}))

vi.mock('@app/lib/follow-selection', () => ({
	selectInspectorObject,
}))

vi.mock('ssh/freight/freight-line', () => ({
	createExplicitFreightLineDraftForFreightBay,
	createSyntheticFreightLineObject,
	findFreightLinesForStop,
	normalizeFreightLineDefinition: (line: { id: string; name: string; stops: unknown[] }) => line,
}))

vi.mock('ssh/hive/storage-action', () => ({
	isRoadFretAction: () => true,
}))

vi.mock('ssh/hive/storage', () => ({
	StorageAlveolus: MockStorageAlveolus,
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
				addGather: 'Add gather line',
				addDistribute: 'Add distribute line',
				removeLine: 'Remove line',
			},
		},
	}
	return {
		i18nState,
		getTranslator: () => i18nState.translator,
	}
})

vi.mock('./InspectorObjectLink', () => ({
	default: () => null,
}))

vi.mock('./LinkedEntityControl', () => ({
	default: () => null,
}))

vi.mock('./PropertyGridRow', () => ({
	default: (props: { if?: boolean; label?: string; children?: JSX.Element }) =>
		props.if === false ? null : (
			<tr data-testid={`row-${props.label ?? 'unlabeled'}`}>
				<th>{props.label}</th>
				<td>{props.children}</td>
			</tr>
		),
}))

vi.mock('./parts/WorkingIndicator', () => ({
	default: () => <button data-testid="working-indicator" />,
}))

vi.mock('./storage/StorageConfiguration', () => ({
	default: () => <div data-testid="storage-configuration" />,
}))

vi.mock('./storage/StoredGoodsRow', () => ({
	default: (props: { if?: boolean; label?: string }) =>
		props.if === false ? null : <tr data-testid={`stored-goods-row-${props.label ?? 'unknown'}`} />,
}))

let AlveolusProperties: typeof import('./AlveolusProperties').default

describe('AlveolusProperties', () => {
	let container: HTMLElement
	let stop: (() => void) | undefined

	beforeAll(async () => {
		;({ default: AlveolusProperties } = await import('./AlveolusProperties'))
	})

	beforeEach(() => {
		container = document.createElement('div')
		document.body.appendChild(container)
		findFreightLinesForStop.mockClear()
		createSyntheticFreightLineObject.mockClear()
		createExplicitFreightLineDraftForFreightBay.mockClear()
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
						<AlveolusProperties content={undefined as never} game={{ freightLines: [], vehicles: [] } as never} />
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
		const bay = new MockStorageAlveolus()
		stop = latch(
			container,
			<table>
				<tbody>
					<AlveolusProperties content={bay as never} game={game as never} />
				</tbody>
			</table>
		)
		container
			.querySelector('[data-testid="freight-bay-add-gather"]')
			?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
		expect(selectInspectorObject).toHaveBeenCalledTimes(1)
	})

	it('updates the bay line list when freight lines change', () => {
		const game = reactive({
			freightLines: [] as { id: string; name: string; stops: unknown[] }[],
			vehicles: [],
			replaceFreightLine,
			removeFreightLineById,
		})
		findFreightLinesForStop.mockImplementation(() => game.freightLines as never)
		const bay = new MockStorageAlveolus()
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
		const bay = new MockStorageAlveolus()
		stop = latch(
			container,
			<table>
				<tbody>
					<AlveolusProperties
						content={bay as never}
						game={{ freightLines: [], vehicles: [], replaceFreightLine, removeFreightLineById } as never}
					/>
				</tbody>
			</table>
		)
		expect(container.querySelector('[data-testid="row-Lines at this bay"]')).not.toBeNull()
		expect(container.querySelector('[data-testid="freight-bay-add-gather"]')).not.toBeNull()
		expect(container.querySelector('[data-testid="freight-bay-add-distribute"]')).not.toBeNull()
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
	})
})
