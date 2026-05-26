import { document, latch } from '@sursaut/core'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { HivePlanCollection } from 'ssh/hive-plan'

vi.mock('@app/lib/css', () => ({
	css: () => '',
}))

const globals = vi.hoisted(() => ({
	game: {
		configurationManager: {
			getNamedConfigurations: vi.fn(() => new Map()),
			getNamedConfiguration: vi.fn(() => undefined),
		},
		hivePlans: undefined as unknown as HivePlanCollection,
		invalidateWorkPlanning: vi.fn(),
	},
	hivePlanPlacementState: {
		rotation: 0,
		lastMessage: '',
	},
	interactionMode: {
		selectedAction: '',
	},
}))

vi.mock('@app/lib/globals', () => globals)

vi.mock('@app/ui/anarkai', () => ({
	Button: (props: { children?: JSX.Element; disabled?: boolean; if?: boolean; onClick?: () => void }) =>
		props.if === false ? undefined : (
			<button disabled={props.disabled} onClick={props.onClick}>
				{props.children}
			</button>
		),
	InspectorSection: (props: { title: string; children?: JSX.Element }) => (
		<section>
			<h2>{props.title}</h2>
			{props.children}
		</section>
	),
}))

vi.mock('@app/components/HivePlanCanvas', () => ({
	default: (props: { onHexClick?: (coord: { q: number; r: number }) => void }) => (
		<button data-testid="plan-canvas" onClick={() => props.onHexClick?.({ q: 0, r: 0 })}>
			plan canvas
		</button>
	),
}))

let PlanManagerWidget: typeof import('./plan-manager').default

function click(element: Element | undefined | null) {
	element?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

describe('PlanManagerWidget', () => {
	let container: HTMLElement
	let stop: (() => void) | undefined

	beforeAll(async () => {
		;({ default: PlanManagerWidget } = await import('./plan-manager'))
	})

	beforeEach(() => {
		globals.game.hivePlans = new HivePlanCollection(globals.game as any)
		globals.interactionMode.selectedAction = ''
		container = document.createElement('div')
		document.body.appendChild(container)
	})

	afterEach(() => {
		stop?.()
		stop = undefined
		container.remove()
		document.body.innerHTML = ''
	})

	it('creates and selects an empty draft from the New button', () => {
		stop = latch(container, <PlanManagerWidget />)

		click([...container.querySelectorAll('button')].find((button) => button.textContent === 'New'))

		expect(globals.game.hivePlans.draftPlans).toHaveLength(1)
		expect(container.textContent).toContain('New hive plan')
		expect(container.textContent).toContain('Add at least one alveolus.')
	})

	it('toggles stage filters back to All when the active non-All filter is clicked', () => {
		const draft = globals.game.hivePlans.createDraft('Draft plan', [])
		const working = globals.game.hivePlans.createDraft('Working plan', [])
		working.stage = 'working'
		void draft
		stop = latch(container, <PlanManagerWidget />)

		click([...container.querySelectorAll('button')].find((button) => button.textContent === 'Working'))
		expect(container.textContent).toContain('Working plan')
		expect(container.textContent).not.toContain('Draft plan')

		click([...container.querySelectorAll('button')].find((button) => button.textContent === 'Working'))
		expect(container.textContent).toContain('Working plan')
		expect(container.textContent).toContain('Draft plan')
	})

	it('uses the selected palette build action when the plan canvas is clicked', () => {
		stop = latch(container, <PlanManagerWidget />)
		click([...container.querySelectorAll('button')].find((button) => button.textContent === 'New'))
		globals.interactionMode.selectedAction = 'build:storage'

		click(container.querySelector('[data-testid="plan-canvas"]'))

		const plan = globals.game.hivePlans.draftPlans[0]
		expect(plan.entries).toHaveLength(1)
		expect(plan.entries[0].alveolusType).toBe('storage')
		expect(globals.interactionMode.selectedAction).toBe('build:storage')
	})
})
