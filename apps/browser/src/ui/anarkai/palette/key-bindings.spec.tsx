import { document, latch } from '@sursaut/core'
import {
	createPaletteKeys,
	Palette,
	type PaletteConfig,
	type PaletteKeyBinding,
} from '@sursaut/ui/palette'
import { afterEach, describe, expect, it } from 'vitest'
import { AnarkaiPaletteKeyBindingsEditor } from './key-bindings'

const testEntries = [
	{ id: 'openConfiguration', label: 'Open configuration', meta: '`', run() {} },
	{ id: 'openGame', label: 'Open game view', meta: 'G', run() {} },
	{ id: 'openTest', label: 'Open multiselect test', meta: 'H', run() {} },
]

function testPalette(bindings: PaletteKeyBinding = { G: 'openGame' }) {
	return new Palette({
		tools: {
			openConfiguration: {
				label: 'Open configuration',
				get can() {
					return true
				},
				run() {},
			},
			openGame: {
				label: 'Open game view',
				get can() {
					return true
				},
				run() {},
			},
			openTest: {
				label: 'Open multiselect test',
				get can() {
					return true
				},
				run() {},
			},
		},
		keys: createPaletteKeys(bindings),
	} satisfies PaletteConfig)
}

describe('AnarkaiPaletteKeyBindingsEditor', () => {
	let container: HTMLElement
	let stop: (() => void) | undefined

	afterEach(() => {
		stop?.()
		stop = undefined
		container?.remove()
		document.body.innerHTML = ''
	})

	it('renders existing key bindings from the palette registry', () => {
		container = document.createElement('div')
		document.body.appendChild(container)
		const palette = testPalette({ G: 'openGame', H: 'openTest' })

		stop = latch(
			container,
			<AnarkaiPaletteKeyBindingsEditor palette={palette} entries={testEntries} />
		)

		const captureButtons = Array.from(
			container.querySelectorAll('[data-role="palette-keybinding-capture"]')
		) as HTMLButtonElement[]
		expect(captureButtons.map((button) => button.textContent?.trim())).toEqual(['G', 'H'])

		const commandFields = Array.from(
			container.querySelectorAll('[data-role="palette-keybinding-command"]')
		) as HTMLSelectElement[]
		expect(commandFields.map((field) => field.value)).toEqual(['openGame', 'openTest'])
	})

	it('captures a new normalized shortcut and updates the live palette keys', () => {
		container = document.createElement('div')
		document.body.appendChild(container)
		const palette = testPalette()

		stop = latch(
			container,
			<AnarkaiPaletteKeyBindingsEditor palette={palette} entries={testEntries} />
		)

		const addButton = container.querySelector(
			'[data-role="palette-keybinding-add"]'
		) as HTMLButtonElement | null
		expect(addButton).not.toBeNull()
		addButton?.click()

		const captureButtons = Array.from(
			container.querySelectorAll('[data-role="palette-keybinding-capture"]')
		) as HTMLButtonElement[]
		const capture = captureButtons.at(-1)
		expect(capture).toBeDefined()
		capture?.click()
		capture?.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: 'k',
				ctrlKey: true,
				bubbles: true,
				cancelable: true,
			})
		)

		expect(palette.keys.bindings['Ctrl+K']).toBe('openConfiguration')
		expect(
			palette.keys.resolve(
				new KeyboardEvent('keydown', {
					key: 'k',
					ctrlKey: true,
				})
			)
		).toBe('openConfiguration')
	})

	it('captures the literal browser spacebar event as Space', () => {
		container = document.createElement('div')
		document.body.appendChild(container)
		const palette = testPalette()

		stop = latch(
			container,
			<AnarkaiPaletteKeyBindingsEditor palette={palette} entries={testEntries} />
		)

		const addButton = container.querySelector(
			'[data-role="palette-keybinding-add"]'
		) as HTMLButtonElement | null
		expect(addButton).not.toBeNull()
		addButton?.click()

		const captureButtons = Array.from(
			container.querySelectorAll('[data-role="palette-keybinding-capture"]')
		) as HTMLButtonElement[]
		const capture = captureButtons.at(-1)
		expect(capture).toBeDefined()
		capture?.click()
		capture?.dispatchEvent(
			new KeyboardEvent('keydown', {
				key: ' ',
				bubbles: true,
				cancelable: true,
			})
		)

		expect(palette.keys.bindings.Space).toBe('openConfiguration')
		const refreshedCaptureButtons = Array.from(
			container.querySelectorAll('[data-role="palette-keybinding-capture"]')
		) as HTMLButtonElement[]
		expect(refreshedCaptureButtons.at(-1)?.textContent?.trim()).toBe('Space')
	})

	it('rebinds an existing shortcut to another command', () => {
		container = document.createElement('div')
		document.body.appendChild(container)
		const palette = testPalette({ G: 'openGame' })

		stop = latch(
			container,
			<AnarkaiPaletteKeyBindingsEditor palette={palette} entries={testEntries} />
		)

		const commandField = container.querySelector(
			'[data-role="palette-keybinding-command"]'
		) as HTMLSelectElement | null
		expect(commandField).not.toBeNull()
		if (!commandField) return
		commandField.value = 'openTest'
		commandField.dispatchEvent(new Event('change', { bubbles: true }))

		expect(palette.keys.bindings.G).toBe('openTest')
		expect(
			palette.keys.resolve(
				new KeyboardEvent('keydown', {
					key: 'g',
				})
			)
		).toBe('openTest')
	})
})
