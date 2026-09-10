import { document, latch } from '@sursaut/core'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const showProps = vi.fn()
const setHoveredObject = vi.fn()
const isHoveredObject = vi.fn(() => false)

const globals = {
	mrg: {
		hoveredObject: undefined as unknown,
	},
}

class MockProject {
	name = 'P1'
	entries: unknown[] = []
}

vi.mock('@app/lib/css', () => ({
	css: () => '',
}))

vi.mock('@app/lib/follow-selection', () => ({
	showProps,
}))

vi.mock('@app/lib/globals', () => globals)

vi.mock('@app/ui/anarkai/icons/render-icon', () => ({
	renderAnarkaiIcon: (_icon: unknown, options?: { label?: string }) => (
		<span data-testid="project-anchor-icon">{options?.label}</span>
	),
}))

vi.mock('@app/lib/project-inspector', () => ({
	createSyntheticProjectObject: vi.fn((game: unknown, project: unknown) => ({
		kind: 'project',
		title: 'P1',
		game,
		project,
	})),
}))

vi.mock('@app/lib/interactive-state', () => ({
	setHoveredObject,
	isHoveredObject,
}))

let ProjectAnchorButton: typeof import('./ProjectAnchorButton').default

describe('ProjectAnchorButton', () => {
	let container: HTMLElement
	let stop: (() => void) | undefined
	let tile: { board: { game: object } }
	let project: MockProject

	beforeAll(async () => {
		;({ default: ProjectAnchorButton } = await import('./ProjectAnchorButton'))
	})

	beforeEach(() => {
		container = document.createElement('div')
		document.body.appendChild(container)
		showProps.mockClear()
		setHoveredObject.mockClear()
		project = new MockProject()
		tile = { board: { game: {} } }
	})

	afterEach(() => {
		stop?.()
		stop = undefined
		container.remove()
		document.body.innerHTML = ''
	})

	it('opens the synthetic project inspector', () => {
		stop = latch(
			container,
			<ProjectAnchorButton project={project as never} tile={tile as never} title="P1" />
		)

		const button = container.querySelector(
			'[data-testid="project-anchor-button"]'
		) as HTMLButtonElement
		expect(container.querySelector('[data-testid="project-anchor-icon"]')).not.toBeNull()

		button.click()
		expect(showProps).toHaveBeenCalledWith(
			expect.objectContaining({ kind: 'project', project })
		)
	})
})
