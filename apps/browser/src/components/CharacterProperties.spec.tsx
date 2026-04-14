import { document, latch } from '@sursaut/core'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const i18nState = {
	translator: {
		goods: 'Goods',
		character: {
			hunger: 'Hunger',
			tiredness: 'Tiredness',
			fatigue: 'Fatigue',
			currentActivity: 'Current Activity',
			noActivity: 'No activity',
			plannerSection: 'Planning (diagnostics)',
			plannerKeepWorking: 'Fit for work',
			plannerLastPick: 'Last stabilized pick',
			plannerOutcome: 'Last findAction outcome',
			plannerRanked: 'Ranked utilities',
			plannerRankedWork: 'Ranked work',
			plannerWorkUrgency: 'urgency',
			plannerWorkPath: 'path',
			plannerWorkWinner: 'winner',
			plannerKinds: {
				eat: 'Eat',
				home: 'Go home',
				drop: 'Drop goods',
				assignedWork: 'Assigned work',
				bestWork: 'Best work',
				wander: 'Wander',
			},
			plannerWorkKinds: {
				harvest: 'Harvest',
				transform: 'Transform',
				gather: 'Gather',
				convey: 'Convey',
				construct: 'Construct',
				offload: 'Offload',
				foundation: 'Foundation',
				defragment: 'Defragment',
			},
		},
		step: {
			idle: 'Idle',
			harvest: 'Harvest',
		},
	},
}

vi.mock('@app/lib/css', () => ({
	css: () => '',
}))

vi.mock('@app/ui/anarkai', () => ({
	Badge: (props: { children?: JSX.Children; tone?: string }) => (
		<span class="badge" data-tone={props.tone}>
			{props.children}
		</span>
	),
	InspectorSection: (props: { children?: JSX.Children; class?: string }) => (
		<section class={props.class}>{props.children}</section>
	),
	Panel: (props: { children?: JSX.Children; class?: string }) => (
		<div class={props.class}>{props.children}</div>
	),
}))

vi.mock('ssh/i18n', () => ({
	i18nState,
}))

vi.mock('ssh/npcs/steps', () => ({
	AEvolutionStep: class AEvolutionStep {},
	ALerpStep: class ALerpStep {},
}))

vi.mock('./GoodsList', () => ({
	default: () => <div data-testid="goods-list" />,
}))

vi.mock('./LinkedEntityControl', () => ({
	default: (props: { object?: { uid?: string; title?: string } }) => (
		<div data-testid="linked-entity-control">{props.object?.uid ?? 'linked'}</div>
	),
}))

vi.mock('./PropertyGrid', () => ({
	default: (props: { children?: JSX.Children; class?: string }) => (
		<table class={props.class}>
			<tbody>{props.children}</tbody>
		</table>
	),
}))

vi.mock('./PropertyGridRow', () => ({
	default: (props: { label?: string; children?: JSX.Children; class?: string }) => (
		<tr class={props.class}>
			{props.label ? <th>{props.label}</th> : null}
			<td>{props.children}</td>
		</tr>
	),
}))

vi.mock('./StatProgressBar', () => ({
	default: (props: { label: string }) => <div data-testid="stat-progress">{props.label}</div>,
}))

let CharacterProperties: typeof import('./CharacterProperties').default

describe('CharacterProperties', () => {
	let container: HTMLElement
	let stop: (() => void) | undefined

	beforeAll(async () => {
		;({ default: CharacterProperties } = await import('./CharacterProperties'))
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

	it('renders the top 6 planner choices with localized labels and clamped progress', () => {
		const character = {
			title: 'Ari',
			name: 'Ari',
			triggerLevels: {
				hunger: { satisfied: 20, high: 60, critical: 100 },
				tiredness: { satisfied: 20, high: 60, critical: 100 },
				fatigue: { satisfied: 20, high: 60, critical: 100 },
			},
			hunger: 10,
			tiredness: 15,
			fatigue: 5,
			keepWorking: true,
			lastPickedActivityKind: 'bestWork',
			stepExecutor: {
				type: 'work',
				description: 'harvest',
			},
			carry: { stock: {} },
			actionDescription: ['work.goWork', 'walk.until', 'inventory.drop'],
			lastPlannerSnapshot: {
				ranked: [
					{ kind: 'home', utility: 130 },
					{ kind: 'bestWork', utility: 95.123 },
					{ kind: 'assignedWork', utility: 42.5 },
					{ kind: 'eat', utility: 25 },
					{ kind: 'drop', utility: 5 },
					{ kind: 'wander', utility: -10 },
					{ kind: 'eat', utility: -50 },
				],
				outcome: { kind: 'bestWork', source: 'ranked' },
			},
			lastWorkPlannerSnapshot: {
				ranked: [
					{
						jobKind: 'offload',
						targetLabel: 'wood @ 0, 1',
						targetCoord: { q: 0, r: 1 },
						urgency: 4,
						pathLength: 1,
						score: 2,
						selected: true,
					},
					{
						jobKind: 'convey',
						targetLabel: 'sawmill @ 1, 0',
						targetCoord: { q: 1, r: 0 },
						urgency: 3,
						pathLength: 1,
						score: 1.5,
						selected: false,
					},
					{
						jobKind: 'harvest',
						targetLabel: 'tree_chopper @ 1, 2',
						targetCoord: { q: 1, r: 2 },
						urgency: 2.5,
						pathLength: 2,
						score: 0.833,
						selected: false,
					},
					{
						jobKind: 'transform',
						targetLabel: 'sawmill @ 1, 0',
						targetCoord: { q: 1, r: 0 },
						urgency: 1,
						pathLength: 0,
						score: 1,
						selected: false,
					},
					{
						jobKind: 'gather',
						targetLabel: 'berries @ 2, 2',
						targetCoord: { q: 2, r: 2 },
						urgency: 0.9,
						pathLength: 3,
						score: 0.225,
						selected: false,
					},
					{
						jobKind: 'defragment',
						targetLabel: 'wood @ storage @ 0, 0',
						targetCoord: { q: 0, r: 0 },
						urgency: 0.9,
						pathLength: 0,
						score: 0.9,
						selected: false,
					},
					{
						jobKind: 'construct',
						targetLabel: 'Tile 4, 4',
						targetCoord: { q: 4, r: 4 },
						urgency: 0.2,
						pathLength: 6,
						score: 0.028,
						selected: false,
					},
				],
			},
			game: {
				hex: {
					getTile: ({ q, r }: { q: number; r: number }) => ({
						uid: `tile:${q},${r}`,
						title: `Tile ${q}, ${r}`,
					}),
				},
			},
		}

		stop = latch(container, <CharacterProperties character={character as never} />, {
			setTitle: vi.fn(),
		} as never)

		const rows = Array.from(
			container.querySelectorAll('[data-testid="character-planner-choice"]')
		) as HTMLDivElement[]
		expect(rows).toHaveLength(6)
		expect(rows[0]?.textContent).toContain('Go home')
		expect(rows[0]?.textContent).toContain('130.00')
		expect(rows[1]?.textContent).toContain('Best work')
		expect(rows[5]?.textContent).toContain('Wander')
		expect(rows[5]?.textContent).toContain('-10.00')

		const fills = Array.from(
			container.querySelectorAll('.character-planner__choice-fill')
		) as HTMLDivElement[]
		expect(fills[0]?.getAttribute('style')).toContain('width: 100%')
		expect(fills[5]?.getAttribute('style')).toContain('width: 0%')
		expect(container.textContent).not.toContain('-50.00')
		expect(container.textContent).toContain('ranked → Best work')

		const workRows = Array.from(
			container.querySelectorAll('[data-testid="character-ranked-work"]')
		) as HTMLDivElement[]
		expect(workRows).toHaveLength(6)
		expect(workRows[0]?.textContent).toContain('Offload')
		expect(workRows[0]?.textContent).toContain('tile:0,1')
		expect(workRows[0]?.textContent).not.toContain('wood @ 0, 1')
		expect(workRows[0]?.textContent).toContain('2.00')
		expect(workRows[0]?.getAttribute('data-selected')).toBe('true')
		expect(workRows.some((row) => row.textContent?.includes('Convey'))).toBe(true)
		expect(container.textContent).not.toContain('Tile 4, 4')
	})

	it('renders a compact action path summary with the full path in the title', () => {
		const character = {
			title: 'Milo',
			name: 'Milo',
			triggerLevels: {
				hunger: { satisfied: 20, high: 60, critical: 100 },
				tiredness: { satisfied: 20, high: 60, critical: 100 },
				fatigue: { satisfied: 20, high: 60, critical: 100 },
			},
			hunger: 0,
			tiredness: 0,
			fatigue: 0,
			keepWorking: false,
			stepExecutor: {
				type: 'idle',
				description: undefined,
			},
			lastPickedActivityKind: undefined,
			carry: { stock: {} },
			actionDescription: ['work.goWork', 'walk.until', 'inventory.drop', 'walk.until'],
			lastPlannerSnapshot: undefined,
			lastWorkPlannerSnapshot: undefined,
			game: {},
		}

		stop = latch(container, <CharacterProperties character={character as never} />, {
			setTitle: vi.fn(),
		} as never)

		const actionPath = container.querySelector(
			'[data-testid="character-action-path"]'
		) as HTMLSpanElement | null
		expect(actionPath).not.toBeNull()
		expect(actionPath?.textContent).toBe('work.goWork / … / walk.until')
		expect(actionPath?.getAttribute('title')).toBe(
			'work.goWork / walk.until / inventory.drop / walk.until'
		)
	})
})
