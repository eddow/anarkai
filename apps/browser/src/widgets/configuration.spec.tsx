import { document, latch } from '@sursaut/core'
import type { DockviewWidgetProps } from '@sursaut/ui/dockview'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const commandBox = { input: { placeholder: 'Command...' } }
const palette = { id: 'browser-palette' }
const anarkaiPaletteCommandBox = vi.fn((props: Record<string, unknown>) => (
	<div
		data-testid="palette-command-box"
		data-editable={props.editable ? 'true' : 'false'}
		data-expanded={props.expanded ? 'true' : 'false'}
		data-floating={props.floating ? 'true' : 'false'}
	>
		{String((props.commandBox as { input: { placeholder: string } }).input.placeholder)}
	</div>
))

vi.mock('@app/palette/browser-palette', () => ({
	getBrowserPalette: () => ({
		commandBox,
		palette,
	}),
}))

vi.mock('@app/lib/css', () => ({
	css: () => '',
}))

vi.mock('@app/ui/anarkai', () => ({
	AnarkaiPaletteCommandBox: (props: Record<string, unknown>) => anarkaiPaletteCommandBox(props),
	InspectorSection: (props: { children?: any; title?: string }) => (
		<section data-testid="inspector-section">
			<div if={props.title}>{props.title}</div>
			{props.children}
		</section>
	),
}))

let ConfigurationWidget: typeof import('./configuration').default

describe('ConfigurationWidget', () => {
	let container: HTMLElement
	let stop: (() => void) | undefined

	beforeAll(async () => {
		;({ default: ConfigurationWidget } = await import('./configuration'))
	})

	beforeEach(() => {
		container = document.createElement('div')
		document.body.appendChild(container)
		anarkaiPaletteCommandBox.mockClear()
	})

	afterEach(() => {
		stop?.()
		stop = undefined
		container.remove()
		document.body.innerHTML = ''
	})

	it('renders the editable palette command box instead of theme/time radios', () => {
		const props: DockviewWidgetProps = {
			title: '',
			size: { width: 320, height: 240 },
			params: {},
			context: {},
		}

		stop = latch(container, <ConfigurationWidget {...props} />, {} as never)

		expect(container.textContent).toContain('Use the command box to drive tools')
		expect(container.querySelector('[data-testid="palette-command-box"]')).not.toBeNull()
		expect(container.textContent).toContain('Command...')
		expect(anarkaiPaletteCommandBox).toHaveBeenCalledWith(
			expect.objectContaining({
				commandBox,
				palette,
				editable: true,
				expanded: true,
				floating: false,
			})
		)
		expect(container.textContent).not.toContain('Theme')
		expect(container.textContent).not.toContain('Time control')
	})
})
