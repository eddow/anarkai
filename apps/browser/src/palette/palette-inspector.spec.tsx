import { document, latch } from '@sursaut/core'
import { reactive } from 'mutts'
import { registerGlyfIconFactory } from 'pure-glyf/sursaut'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@app/lib/globals', () => ({
	configuration: reactive({
		timeControl: 1 as 0 | 1 | 2 | 3,
	}),
	interactionMode: reactive({ selectedAction: '' }),
	uiConfiguration: reactive({ darkMode: false }),
}))

vi.mock('ssh/assets/game-content', () => ({
	alveoli: {
		house: { construction: true },
		decor: {},
	},
}))

import { disposeBrowserPalette, getBrowserPalette } from './browser-palette'
import { BrowserPaletteInspectorBody } from './palette-inspector'

describe('BrowserPaletteInspectorBody', () => {
	beforeAll(() => {
		registerGlyfIconFactory()
	})

	afterEach(() => {
		disposeBrowserPalette()
		document.body.innerHTML = ''
	})

	it('renders identity and configurator for a run tool item', () => {
		const { palette } = getBrowserPalette()
		const item = {
			tool: 'openConfiguration' as const,
			editor: 'button' as const,
			config: { label: 'Configuration', hint: 'Open panel' },
		}
		const tool = palette.tool('openConfiguration')
		const root = document.createElement('div')
		document.body.appendChild(root)
		const stop = latch(
			root,
			<BrowserPaletteInspectorBody palette={palette} item={item} tool={tool} region="top" />
		)
		expect(root.textContent).toContain('Configuration')
		expect(root.textContent).toContain('openConfiguration')
		expect(root.textContent).toContain('button')
		expect(root.textContent).toContain('Label')
		stop?.()
		root.remove()
	})
})
