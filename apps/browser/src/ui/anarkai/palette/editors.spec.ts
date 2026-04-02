import { document, latch } from '@sursaut/core'
import { reactive } from 'mutts'
import { registerGlyfIconFactory } from 'pure-glyf/sursaut'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createAnarkaiPaletteEditors, paletteToolbarControlTitle } from './editors'
import type { AnarkaiPaletteToolbarItem } from './types'

describe('paletteToolbarControlTitle', () => {
	it('prefers hint over label', () => {
		const item = {
			tool: 'openConfiguration',
			editor: 'button',
			config: { label: 'Configuration', hint: 'Open configuration panel' },
		} satisfies AnarkaiPaletteToolbarItem
		expect(paletteToolbarControlTitle(item)).toBe('Open configuration panel')
	})

	it('falls back to label when hint is absent', () => {
		const item = {
			tool: 'theme',
			editor: 'segmented',
			config: { label: 'Theme' },
		} satisfies AnarkaiPaletteToolbarItem
		expect(paletteToolbarControlTitle(item)).toBe('Theme')
	})

	it('falls back to tool id when label and hint are absent', () => {
		const item = {
			tool: 'openGame',
			editor: 'button',
			config: {},
		} as AnarkaiPaletteToolbarItem
		expect(paletteToolbarControlTitle(item)).toBe('openGame')
	})
})

describe('createAnarkaiPaletteEditors enum editors', () => {
	beforeAll(() => {
		registerGlyfIconFactory()
	})

	afterEach(() => {
		document.body.innerHTML = ''
	})

	it('renders the select editor as an icon-capable popup picker', () => {
		const root = document.createElement('div')
		document.body.appendChild(root)
		const item = {
			tool: 'theme',
			editor: 'select',
			config: { label: 'Theme', choiceDisplay: 'both' },
		} satisfies AnarkaiPaletteToolbarItem
		const tool = reactive({
			type: 'enum' as const,
			value: 'light',
			default: 'light',
			values: [
				{
					value: 'light',
					label: 'Light',
					icon: 'pure-glyf-icon glyf-tabler-filled-sun-high',
				},
				{
					value: 'dark',
					label: 'Dark',
					icon: 'pure-glyf-icon glyf-tabler-filled-moon',
				},
			],
		})
		const editor = createAnarkaiPaletteEditors().enum?.select?.editor
		const stop = latch(
			root,
			editor?.({
				item: item as never,
				tool,
				scope: {} as never,
				flags: {},
			})
		)

		expect(root.querySelector('select')).toBeNull()
		expect(root.querySelector('.ak-palette-select-field__trigger')).not.toBeNull()
		expect(root.querySelector('.ak-palette-select-field__trigger .pure-glyf-icon')).not.toBeNull()

		const trigger = root.querySelector('.ak-palette-select-field__trigger') as HTMLButtonElement
		trigger.click()

		expect(document.body.querySelector('.ak-palette-select-field__popup')).not.toBeNull()

		const darkOption = document.body.querySelectorAll(
			'.ak-palette-select-field__option'
		)[1] as HTMLButtonElement
		darkOption.click()

		expect(tool.value).toBe('dark')
		expect(document.body.querySelector('.ak-palette-select-field__popup')).toBeNull()

		stop?.()
		root.remove()
	})

	it('renders segmented enum choices with icon buttons', () => {
		const root = document.createElement('div')
		document.body.appendChild(root)
		const item = {
			tool: 'theme',
			editor: 'segmented',
			config: { label: 'Theme', choiceDisplay: 'icon' },
		} satisfies AnarkaiPaletteToolbarItem
		const tool = {
			type: 'enum' as const,
			value: 'light',
			default: 'light',
			values: [
				{
					value: 'light',
					label: 'Light',
					icon: 'pure-glyf-icon glyf-tabler-filled-sun-high',
				},
				{
					value: 'dark',
					label: 'Dark',
					icon: 'pure-glyf-icon glyf-tabler-filled-moon',
				},
			],
		}
		const editor = createAnarkaiPaletteEditors().enum?.segmented?.editor
		const stop = latch(
			root,
			editor?.({
				item: item as never,
				tool,
				scope: {} as never,
				flags: {},
			})
		)

		expect(root.querySelectorAll('.ak-radio-button .pure-glyf-icon').length).toBe(2)

		stop?.()
		root.remove()
	})

	it('filters enum choices by accepted keywords derived from value ids', () => {
		const root = document.createElement('div')
		document.body.appendChild(root)
		const item = {
			tool: 'selectedAction',
			editor: 'segmented',
			config: { label: 'Action', choiceDisplay: 'text', acceptedKeywords: ['build'] },
		} satisfies AnarkaiPaletteToolbarItem
		const tool = {
			type: 'enum' as const,
			value: 'build:house',
			default: '',
			values: [
				{ value: '', label: 'Select' },
				{ value: 'build:house', label: 'Build house' },
				{ value: 'build:engineer', label: 'Build engineer' },
				{ value: 'zone:residential', label: 'Residential' },
			],
		}
		const editor = createAnarkaiPaletteEditors().enum?.segmented?.editor
		const stop = latch(
			root,
			editor?.({
				item: item as never,
				tool,
				scope: {} as never,
				flags: {},
			})
		)

		const labels = Array.from(root.querySelectorAll('.ak-radio-button')).map(
			(node) => node.textContent ?? ''
		)
		expect(labels).toEqual(['Build house', 'Build engineer'])

		stop?.()
		root.remove()
	})

	it('cycles enum values with the cycle editor', () => {
		const root = document.createElement('div')
		document.body.appendChild(root)
		const item = {
			tool: 'theme',
			editor: 'cycle',
			config: { label: 'Theme', choiceDisplay: 'icon' },
		} satisfies AnarkaiPaletteToolbarItem
		const tool = {
			type: 'enum' as const,
			value: 'light',
			default: 'light',
			values: [
				{ value: 'light', label: 'Light', icon: '☀' },
				{ value: 'dark', label: 'Dark', icon: '☾' },
			],
		}
		const editor = createAnarkaiPaletteEditors().enum?.cycle?.editor
		const stop = latch(
			root,
			editor?.({
				item: item as never,
				tool,
				scope: {} as never,
				flags: {},
			})
		)

		const button = root.querySelector('.ak-button') as HTMLButtonElement
		expect(root.textContent).toContain('☀')
		button.click()
		expect(tool.value).toBe('dark')
		expect(root.textContent).toContain('☾')
		button.click()
		expect(tool.value).toBe('light')
		expect(root.textContent).toContain('☀')

		stop?.()
		root.remove()
	})

	it('renders numeric stars editor with a zero pause state', () => {
		const root = document.createElement('div')
		document.body.appendChild(root)
		const item = {
			tool: 'timeControl',
			editor: 'stars',
			config: { label: 'Speed', before: '▶', after: '▷', zeroElement: '⏸' },
		} satisfies AnarkaiPaletteToolbarItem
		const tool = reactive({
			type: 'number' as const,
			value: 2,
			default: 1,
			min: 0,
			max: 3,
			step: 1,
		})
		const editor = createAnarkaiPaletteEditors().number?.stars?.editor
		const stop = latch(
			root,
			editor?.({
				item: item as never,
				tool,
				scope: {} as never,
				flags: {},
			})
		)

		const glyphs = Array.from(root.querySelectorAll('.ak-stars__item')).map(
			(node) => node.textContent ?? ''
		)
		expect(glyphs).toEqual(['⏸', '▶', '▶', '▷'])

		const stars = Array.from(root.querySelectorAll('.ak-stars__item')) as HTMLSpanElement[]
		stars[0]?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
		expect(tool.value).toBe(0)
		stars[3]?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
		expect(tool.value).toBe(3)

		stop?.()
		root.remove()
	})
})
