import { document, latch } from '@sursaut/core'
import { ProjectCollection } from 'ssh/project'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@app/lib/css', () => ({
	css: () => '',
}))

const globals = vi.hoisted(() => ({
	game: {
		configurationManager: {
			getNamedConfigurations: vi.fn(() => new Map()),
			getNamedConfiguration: vi.fn(() => undefined),
		},
		hivePlans: { plans: [] },
		projects: undefined as unknown as ProjectCollection,
		commitProject: vi.fn(() => ({ ok: true })),
		invalidateWorkPlanning: vi.fn(),
	},
	projectEditingState: {
		project: undefined,
		tool: '',
		hivePlan: undefined,
		rotation: 0,
		mirror: false,
	},
	projectPreviewState: {
		project: undefined,
		active: false,
	},
}))

vi.mock('@app/lib/globals', () => globals)

vi.mock('@app/ui/anarkai', () => ({
	Button: (props: {
		children?: JSX.Element
		disabled?: boolean
		if?: boolean
		onClick?: () => void
	}) =>
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

let ProjectManagerWidget: typeof import('./project-manager').default

function click(element: Element | undefined | null) {
	element?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}

describe('ProjectManagerWidget', () => {
	let container: HTMLElement
	let stop: (() => void) | undefined

	beforeAll(async () => {
		;({ default: ProjectManagerWidget } = await import('./project-manager'))
	})

	beforeEach(() => {
		globals.game.projects = new ProjectCollection(globals.game as any)
		globals.projectEditingState.project = undefined
		globals.projectEditingState.tool = ''
		globals.projectPreviewState.project = undefined
		globals.projectPreviewState.active = false
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
		stop = latch(container, <ProjectManagerWidget />)

		click([...container.querySelectorAll('button')].find((button) => button.textContent === 'New'))

		expect(globals.game.projects.projects).toHaveLength(1)
		expect(container.textContent).toContain('New project')
		expect(container.textContent).toContain('No bill yet.')
	})

	it('lists projects with their stage', () => {
		const draft = globals.game.projects.createDraft('Draft project', [])
		const working = globals.game.projects.createDraft('Working project', [])
		working.stage = 'working'
		void draft
		stop = latch(container, <ProjectManagerWidget />)

		expect(container.textContent).toContain('Draft project')
		expect(container.textContent).toContain('Working project')
	})

	it('sets the editing tool when a build button is clicked', () => {
		const project = globals.game.projects.createDraft('Draft project', [])
		stop = latch(container, <ProjectManagerWidget />)
		globals.game.projects.projects[0] = project
		// Force selection via the effect picking the first project.
		expect(container.textContent).toContain('Draft project')

		click([...container.querySelectorAll('button')].find((button) => button.textContent === 'Build storage'))

		expect(globals.projectEditingState.project).toBe(project)
		expect(globals.projectEditingState.tool).toBe('build:storage')
	})

	it('commits a draft project from the Commit button', () => {
		const project = globals.game.projects.createDraft('Draft project', [
			{ coord: [0, 0], alveolusType: 'storage' },
		])
		void project
		globals.game.commitProject.mockReturnValue({ ok: true })
		stop = latch(container, <ProjectManagerWidget />)

		click([...container.querySelectorAll('button')].find((button) => button.textContent === 'Commit'))

		expect(globals.game.commitProject).toHaveBeenCalled()
	})

	it('lists hive plans in a Hives tool category and stamps them', () => {
		const project = globals.game.projects.createDraft('Draft project', [])
		const plan = { name: 'Wood Factory', entries: [], knownnessFingerprint: '' }
		globals.game.hivePlans.plans = [plan]
		stop = latch(container, <ProjectManagerWidget />)
		void project

		expect(container.textContent).toContain('Hives (1)')
		expect(container.textContent).toContain('Wood Factory')

		click([...container.querySelectorAll('button')].find((button) => button.textContent === 'Wood Factory'))

		expect(globals.projectEditingState.tool).toBe('hive')
		expect(globals.projectEditingState.hivePlan).toBe(plan)
	})

	it('collapses and expands a tool category', () => {
		const project = globals.game.projects.createDraft('Draft project', [])
		void project
		stop = latch(container, <ProjectManagerWidget />)

		const head = [...container.querySelectorAll('button')].find((button) =>
			button.textContent?.includes('Alveoli')
		)
		expect(head).toBeTruthy()
		const group = head!.closest('.project-manager__tool-group') as HTMLElement
		expect(group.getAttribute('data-collapsed')).toBe('false')

		click(head)

		expect(group.getAttribute('data-collapsed')).toBe('true')
	})
})
