import { document, latch } from '@sursaut/core'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const showProps = vi.fn()
const createSyntheticHiveObject = vi.fn()
const setHoveredObject = vi.fn((object: unknown) => {
	globals.mrg.hoveredObject = object
})
const isHoveredObject = vi.fn((object: unknown) => globals.mrg.hoveredObject === object)

const globals = {
	mrg: {
		hoveredObject: undefined as unknown,
	},
}

class MockAlveolus {}

vi.mock('@app/lib/css', () => ({
	css: () => '',
}))

vi.mock('@app/lib/follow-selection', () => ({
	showProps,
}))

vi.mock('@app/lib/globals', () => globals)

vi.mock('@app/ui/anarkai/icons/render-icon', () => ({
	renderAnarkaiIcon: (_icon: unknown, options?: { label?: string }) => (
		<span data-testid="hive-anchor-icon">{options?.label}</span>
	),
}))

vi.mock('ssh/board/content/alveolus', () => ({
	Alveolus: MockAlveolus,
}))

vi.mock('@app/lib/hive-inspector', () => ({
	createSyntheticHiveObject,
}))

vi.mock('@app/lib/interactive-state', () => ({
	setHoveredObject,
	isHoveredObject,
}))

let HiveAnchorButton: typeof import('./HiveAnchorButton').default

describe('HiveAnchorButton', () => {
	let container: HTMLElement
	let stop: (() => void) | undefined
	let tile: {
		uid: string
		title: string
		content: MockAlveolus
		board: { game: object }
	}

	beforeAll(async () => {
		;({ default: HiveAnchorButton } = await import('./HiveAnchorButton'))
	})

	beforeEach(() => {
		container = document.createElement('div')
		document.body.appendChild(container)
		globals.mrg.hoveredObject = undefined
		showProps.mockClear()
		createSyntheticHiveObject.mockClear()
		setHoveredObject.mockClear()
		isHoveredObject.mockClear()
		tile = {
			uid: 'tile:0,0',
			title: 'Tile 0, 0',
			content: new MockAlveolus(),
			board: { game: {} },
		}
	})

	afterEach(() => {
		stop?.()
		stop = undefined
		container.remove()
		document.body.innerHTML = ''
	})

	it('opens the synthetic hive inspector and mirrors hover state', () => {
		createSyntheticHiveObject.mockReturnValue({
			uid: 'hive:tile%3A0%2C0',
			title: 'Hive',
		})

		stop = latch(container, <HiveAnchorButton tile={tile as never} title="Hive" />)

		const button = container.querySelector(
			'[data-testid="hive-anchor-button"]'
		) as HTMLButtonElement
		expect(container.querySelector('[data-testid="hive-anchor-icon"]')).not.toBeNull()

		button.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
		expect(globals.mrg.hoveredObject).toBe(tile)

		button.click()
		expect(createSyntheticHiveObject).toHaveBeenCalledWith(tile.board.game, tile)
		expect(showProps).toHaveBeenCalledWith({
			uid: 'hive:tile%3A0%2C0',
			title: 'Hive',
		})

		button.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }))
		expect(globals.mrg.hoveredObject).toBeUndefined()
	})
})
