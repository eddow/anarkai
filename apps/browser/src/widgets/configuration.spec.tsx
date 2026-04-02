import { document, latch } from '@sursaut/core'
import type { DockviewWidgetProps } from '@sursaut/ui/dockview'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const commandBox = { input: { placeholder: 'Command...' } }
const palette = { id: 'browser-palette' }
const getBrowserPaletteConfigurationJson = vi.fn(() => '{"top":[],"keyBindings":{}}')
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
const anarkaiPaletteKeyBindingsEditor = vi.fn((props: Record<string, unknown>) => (
	<div data-testid="palette-keybindings-editor">{String((props.palette as { id: string }).id)}</div>
))

vi.mock('@app/palette/browser-palette', () => ({
	getBrowserPalette: () => ({
		commandBox,
		palette,
	}),
	getBrowserPaletteConfigurationJson: () => getBrowserPaletteConfigurationJson(),
}))

vi.mock('@app/lib/css', () => ({
	css: () => '',
}))

vi.mock('@app/ui/anarkai', () => ({
	AnarkaiPaletteCommandBox: (props: Record<string, unknown>) => anarkaiPaletteCommandBox(props),
	AnarkaiPaletteKeyBindingsEditor: (props: Record<string, unknown>) =>
		anarkaiPaletteKeyBindingsEditor(props),
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
	let consoleLog: ReturnType<typeof vi.spyOn>

	beforeAll(async () => {
		;({ default: ConfigurationWidget } = await import('./configuration'))
	})

	beforeEach(() => {
		container = document.createElement('div')
		document.body.appendChild(container)
		consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
		anarkaiPaletteCommandBox.mockClear()
		anarkaiPaletteKeyBindingsEditor.mockClear()
		getBrowserPaletteConfigurationJson.mockClear()
	})

	afterEach(() => {
		stop?.()
		stop = undefined
		consoleLog.mockRestore()
		container.remove()
		document.body.innerHTML = ''
	})

	it('renders the editable palette command box and key bindings editor', () => {
		const props: DockviewWidgetProps = {
			title: '',
			size: { width: 320, height: 240 },
			params: {},
			context: {},
		}

		stop = latch(container, <ConfigurationWidget {...props} />, {} as never)

		expect(container.textContent).toContain('Use the command box to drive tools')
		expect(container.querySelector('[data-testid="palette-command-box"]')).not.toBeNull()
		expect(container.querySelector('[data-testid="palette-keybindings-editor"]')).not.toBeNull()
		expect(container.textContent).toContain('Command...')
		expect(container.textContent).toContain('Key Bindings')
		expect(anarkaiPaletteCommandBox).toHaveBeenCalledWith(
			expect.objectContaining({
				commandBox,
				palette,
				editable: true,
				expanded: true,
				floating: false,
			})
		)
		expect(anarkaiPaletteKeyBindingsEditor).toHaveBeenCalledWith(
			expect.objectContaining({
				palette,
			})
		)
		expect(container.textContent).not.toContain('Theme')
		expect(container.textContent).not.toContain('Time control')
	})

	it('logs the palette json when editing stops', () => {
		const props: DockviewWidgetProps = {
			title: '',
			size: { width: 320, height: 240 },
			params: {},
			context: {},
		}

		stop = latch(container, <ConfigurationWidget {...props} />, {} as never)

		const onEditStop = anarkaiPaletteCommandBox.mock.calls[0]?.[0]?.onEditStop as
			| (() => void)
			| undefined
		expect(onEditStop).toBeTypeOf('function')
		if (!onEditStop) throw new Error('Missing onEditStop callback')
		onEditStop()
		expect(getBrowserPaletteConfigurationJson).toHaveBeenCalledTimes(1)
		expect(consoleLog).toHaveBeenCalledWith('{"top":[],"keyBindings":{}}')
	})
})
