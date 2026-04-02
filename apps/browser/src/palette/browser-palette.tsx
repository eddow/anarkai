import ResourceImage from '@app/components/ResourceImage'
import {
	buildPaletteSelectedActionValues,
	getAppShellBuildableAlveoli,
} from '@app/lib/app-shell-controls'
import type { Configuration } from '@app/lib/globals'
import { configuration, game, interactionMode, uiConfiguration } from '@app/lib/globals'
import browserPaletteDefaultJson from '@app/palette/palette.default.json'
import {
	type AnarkaiPaletteEditorConfigByVariant,
	type AnarkaiPaletteEnumConfig,
	type AnarkaiPaletteItemConfigBase,
	type AnarkaiPaletteSchema,
	type AnarkaiPaletteStarsConfig,
	type AnarkaiThemeMode,
	createAnarkaiPaletteEditors,
} from '@app/ui/anarkai'
import {
	createPaletteKeys,
	Palette,
	type PaletteBorder,
	type PaletteCommandBoxEntry,
	type PaletteCommandBoxModel,
	type PaletteConfig,
	type PaletteEditorContext,
	type PaletteEditorRegistry,
	type PaletteKeyBinding,
	type PaletteToolbarItem,
	paletteCatalogEntries,
	paletteCommandBoxModel,
	paletteCommandEntries,
	palettes,
} from '@sursaut/ui/palette'
import { alveoli as visualAlveoli } from 'engine-pixi/assets/visual-content'
import { effect, reactive, unwrap } from 'mutts'
import {
	tablerFilledAdjustments,
	tablerFilledArrowBigRight,
	tablerFilledFlask,
} from 'pure-glyf/icons'
import type { Game } from 'ssh/game'

export const palettePanelBridge = reactive({
	openConfiguration: () => {},
	openGame: () => {},
	openTest: () => {},
})

const browserPaletteBuildableAlveoli = getAppShellBuildableAlveoli()
const browserPaletteSelectedActionValues = buildPaletteSelectedActionValues(
	browserPaletteBuildableAlveoli,
	(name) => {
		const sprite = visualAlveoli[name]?.sprites?.[0]
		return sprite
			? () => <ResourceImage game={game} sprite={sprite} width={20} height={20} alt={name} />
			: undefined
	}
)

const themeSettingsProxy: { theme: AnarkaiThemeMode } = {
	get theme() {
		return uiConfiguration.darkMode ? 'dark' : 'light'
	},
	set theme(value: AnarkaiThemeMode) {
		uiConfiguration.darkMode = value === 'dark'
	},
}

type BrowserPaletteEditorConfigByVariant = AnarkaiPaletteEditorConfigByVariant & {
	clock: { label?: string; hint?: string }
}

type BrowserPaletteEditorVariant = keyof BrowserPaletteEditorConfigByVariant

const tools = {
	openConfiguration: {
		label: 'Open configuration',
		icon: typeof tablerFilledAdjustments === 'string' ? tablerFilledAdjustments : undefined,
		keywords: ['configuration', 'settings', 'system'],
		get can() {
			return true
		},
		run() {
			palettePanelBridge.openConfiguration()
		},
	},
	openGame: {
		label: 'Open game view',
		icon: typeof tablerFilledArrowBigRight === 'string' ? tablerFilledArrowBigRight : undefined,
		keywords: ['game', 'view', 'play'],
		get can() {
			return true
		},
		run() {
			palettePanelBridge.openGame()
		},
	},
	openTest: {
		label: 'Open multiselect test',
		icon: typeof tablerFilledFlask === 'string' ? tablerFilledFlask : undefined,
		keywords: ['test', 'multiselect', 'flask'],
		get can() {
			return true
		},
		run() {
			palettePanelBridge.openTest()
		},
	},
	timeControl: {
		type: 'number' as const,
		label: 'Speed',
		keywords: ['speed', 'time', 'pause', 'play', 'clock', 'rate'],
		get value() {
			return configuration.timeControl
		},
		set value(next: Configuration['timeControl']) {
			configuration.timeControl = next
		},
		default: 1 as const,
		min: 0,
		max: 3,
		step: 1,
	},
	selectedAction: {
		type: 'enum' as const,
		label: 'Action',
		keywords: ['action', 'tool', 'mode', 'interaction'],
		get value() {
			return interactionMode.selectedAction
		},
		set value(next: string) {
			interactionMode.selectedAction = next
		},
		default: '' as const,
		values: browserPaletteSelectedActionValues,
	},
	theme: {
		type: 'enum' as const,
		label: 'Theme',
		keywords: ['theme', 'dark', 'light', 'appearance'],
		get value() {
			return themeSettingsProxy.theme
		},
		set value(next: AnarkaiThemeMode) {
			themeSettingsProxy.theme = next
		},
		default: 'light' as const,
		values: [
			{ value: 'light' as const, label: 'Light', icon: '☀', keywords: ['light', 'day'] },
			{ value: 'dark' as const, label: 'Dark', icon: '☾', keywords: ['dark', 'night'] },
		],
	},
}

type BrowserPaletteTool = keyof typeof tools & string

export type BrowserPaletteToolbarItem<TTool extends string = BrowserPaletteTool> =
	PaletteToolbarItem<
		TTool,
		keyof BrowserPaletteEditorConfigByVariant,
		BrowserPaletteEditorConfigByVariant[keyof BrowserPaletteEditorConfigByVariant]
	>

export type BrowserPaletteSchema = AnarkaiPaletteSchema<
	typeof tools,
	BrowserPaletteEditorConfigByVariant,
	BrowserPaletteToolbarItem
>

function clockPaletteTitle(item: BrowserPaletteToolbarItem): string {
	const c = item.config
	if (c && typeof c === 'object') {
		const hint = 'hint' in c && typeof c.hint === 'string' ? c.hint : undefined
		const label = 'label' in c && typeof c.label === 'string' ? c.label : undefined
		if (hint) return hint
		if (label) return label
	}
	return item.tool ?? item.editor
}

function ClockPaletteEditor(
	_context: PaletteEditorContext<undefined, BrowserPaletteToolbarItem, BrowserPaletteSchema>
) {
	const view = {
		get game() {
			return _context.scope.clockGame as Game | undefined
		},
	}
	const state = reactive({ time: '--:--' })
	effect`palette:clock`(() => {
		const game = view.game
		if (!game) {
			state.time = '--:--'
			return
		}
		const seconds = Math.floor(game.clock.virtualTime)
		const minutes = Math.floor(seconds / 60)
		const displaySeconds = seconds % 60
		state.time = `${minutes.toString().padStart(2, '0')}:${displaySeconds.toString().padStart(2, '0')}`
	})
	return (
		<div class="app-palette-clock" title={clockPaletteTitle(_context.item)}>
			<span>{state.time}</span>
		</div>
	)
}

const anarkaiEditors = createAnarkaiPaletteEditors()
const browserPaletteEditors = {
	...(anarkaiEditors as PaletteEditorRegistry<BrowserPaletteSchema>),
	item: {
		...((anarkaiEditors.item ?? {}) as NonNullable<
			PaletteEditorRegistry<BrowserPaletteSchema>['item']
		>),
		clock: {
			editor: ClockPaletteEditor,
			flags: { footprint: 'horizontal' as const },
		},
	},
} as PaletteEditorRegistry<BrowserPaletteSchema>

const browserPaletteEditorDefaults = {
	enum: 'select',
	number: 'stars',
	run: 'button',
} satisfies NonNullable<PaletteConfig<BrowserPaletteSchema>['editorDefaults']>

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function browserPaletteDefaultError(message: string): never {
	throw new Error(`Invalid browser palette default config: ${message}`)
}

function parseStringArray(value: unknown, field: string): string[] | undefined {
	if (value === undefined) return undefined
	if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
		browserPaletteDefaultError(`${field} must be an array of strings`)
	}
	return [...value]
}

function parseBrowserPaletteEditorVariant(value: unknown): BrowserPaletteEditorVariant {
	if (
		value === 'button' ||
		value === 'commandBox' ||
		value === 'cycle' ||
		value === 'select' ||
		value === 'segmented' ||
		value === 'stars' ||
		value === 'toggle' ||
		value === 'clock'
	)
		return value
	browserPaletteDefaultError(`unknown editor "${String(value)}"`)
}

function parseBrowserPaletteTool(value: unknown): BrowserPaletteTool {
	if (typeof value === 'string' && value in tools) return value as BrowserPaletteTool
	browserPaletteDefaultError(`unknown tool "${String(value)}"`)
}

function parseBrowserPaletteItemConfig(value: unknown): BrowserPaletteToolbarItem['config'] {
	if (value === undefined) return undefined
	if (!isRecord(value)) browserPaletteDefaultError('item config must be an object')
	const next: Partial<
		BrowserPaletteEditorConfigByVariant['clock'] &
			AnarkaiPaletteItemConfigBase &
			AnarkaiPaletteEnumConfig &
			AnarkaiPaletteStarsConfig
	> = {}
	if (value.label !== undefined) {
		if (typeof value.label !== 'string') browserPaletteDefaultError('config.label must be a string')
		next.label = value.label
	}
	if (value.icon !== undefined) {
		if (typeof value.icon !== 'string') browserPaletteDefaultError('config.icon must be a string')
		next.icon = value.icon
	}
	if (value.hint !== undefined) {
		if (typeof value.hint !== 'string') browserPaletteDefaultError('config.hint must be a string')
		next.hint = value.hint
	}
	if (value.tone !== undefined) {
		if (value.tone !== 'accent' && value.tone !== 'neutral') {
			browserPaletteDefaultError('config.tone must be "accent" or "neutral"')
		}
		next.tone = value.tone
	}
	if (value.choiceDisplay !== undefined) {
		if (
			value.choiceDisplay !== 'both' &&
			value.choiceDisplay !== 'icon' &&
			value.choiceDisplay !== 'text'
		) {
			browserPaletteDefaultError('config.choiceDisplay must be "both", "icon", or "text"')
		}
		next.choiceDisplay = value.choiceDisplay
	}
	const keywords = parseStringArray(value.keywords, 'config.keywords')
	if (keywords) next.keywords = keywords
	const acceptedKeywords = parseStringArray(value.acceptedKeywords, 'config.acceptedKeywords')
	if (acceptedKeywords) next.acceptedKeywords = acceptedKeywords
	const values = parseStringArray(value.values, 'config.values')
	if (values) next.values = values
	if (value.before !== undefined) {
		if (typeof value.before !== 'string')
			browserPaletteDefaultError('config.before must be a string')
		next.before = value.before
	}
	if (value.after !== undefined) {
		if (typeof value.after !== 'string') browserPaletteDefaultError('config.after must be a string')
		next.after = value.after
	}
	if (value.inside !== undefined) {
		if (typeof value.inside !== 'string')
			browserPaletteDefaultError('config.inside must be a string')
		next.inside = value.inside
	}
	if (value.zeroElement !== undefined) {
		if (typeof value.zeroElement !== 'string') {
			browserPaletteDefaultError('config.zeroElement must be a string')
		}
		next.zeroElement = value.zeroElement
	}
	if (value.size !== undefined) {
		if (typeof value.size !== 'string') browserPaletteDefaultError('config.size must be a string')
		next.size = value.size
	}
	return next
}

function parseBrowserPaletteToolbarItem(value: unknown): BrowserPaletteToolbarItem {
	if (!isRecord(value)) browserPaletteDefaultError('toolbar item must be an object')
	const editor = parseBrowserPaletteEditorVariant(value.editor)
	const config = parseBrowserPaletteItemConfig(value.config)
	if (value.tool === undefined) return { editor, config }
	return {
		tool: parseBrowserPaletteTool(value.tool),
		editor,
		config,
	}
}

function parseBrowserPaletteDefaults(source: unknown): {
	top: PaletteBorder<BrowserPaletteToolbarItem>
	keyBindings: PaletteKeyBinding
} {
	if (!isRecord(source)) browserPaletteDefaultError('root must be an object')
	if (!Array.isArray(source.top)) browserPaletteDefaultError('top must be an array of tracks')
	const top: PaletteBorder<BrowserPaletteToolbarItem> = source.top.map((track, trackIndex) => {
		if (!Array.isArray(track)) {
			browserPaletteDefaultError(`top[${trackIndex}] must be an array of sections`)
		}
		return track.map((section, sectionIndex) => {
			if (!isRecord(section)) {
				browserPaletteDefaultError(`top[${trackIndex}][${sectionIndex}] must be an object`)
			}
			if (typeof section.space !== 'number') {
				browserPaletteDefaultError(`top[${trackIndex}][${sectionIndex}].space must be a number`)
			}
			if (!Array.isArray(section.toolbar)) {
				browserPaletteDefaultError(`top[${trackIndex}][${sectionIndex}].toolbar must be an array`)
			}
			return {
				space: section.space,
				toolbar: section.toolbar.map(parseBrowserPaletteToolbarItem),
			}
		})
	})
	if (!isRecord(source.keyBindings)) browserPaletteDefaultError('keyBindings must be an object')
	const keyBindings: PaletteKeyBinding = {}
	for (const [keystroke, command] of Object.entries(source.keyBindings)) {
		if (typeof command !== 'string') {
			browserPaletteDefaultError(`keyBindings.${keystroke} must be a string`)
		}
		keyBindings[keystroke] = command
	}
	return { top, keyBindings }
}

const browserPaletteDefaults = parseBrowserPaletteDefaults(browserPaletteDefaultJson)

export const browserPaletteDefaultKeyBindings: PaletteKeyBinding = structuredClone(
	browserPaletteDefaults.keyBindings
)

const browserPaletteKeys = createPaletteKeys(browserPaletteDefaultKeyBindings)

function createBrowserPaletteBundle() {
	const palette = new Palette<BrowserPaletteSchema>({
		tools,
		keys: browserPaletteKeys,
		editorDefaults: browserPaletteEditorDefaults,
		editors: browserPaletteEditors,
	})
	const commandBox = paletteCommandBoxModel({
		entries: (): readonly PaletteCommandBoxEntry[] =>
			unwrap(palettes.editing) === unwrap(palette)
				? (paletteCatalogEntries({ palette }) as unknown as readonly PaletteCommandBoxEntry[])
				: (paletteCommandEntries({ palette }) as unknown as readonly PaletteCommandBoxEntry[]),
		placeholder: 'Command...',
		enterAction: () => (unwrap(palettes.editing) === unwrap(palette) ? 'select' : 'execute'),
	})
	return {
		commandBox,
		palette,
		PaletteIde: palette.Ide,
		dispose() {
			palette.dispose()
		},
	}
}

export const browserPaletteIdeConfig = {
	top: structuredClone(browserPaletteDefaults.top),
} satisfies { top: PaletteBorder<BrowserPaletteToolbarItem> }

export type BrowserPaletteBundle = {
	readonly commandBox: PaletteCommandBoxModel
	readonly palette: ReturnType<typeof createBrowserPaletteBundle>['palette']
	readonly PaletteIde: ReturnType<typeof createBrowserPaletteBundle>['PaletteIde']
	dispose(): void
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

function browserPaletteJsonValue(value: unknown): JsonValue | undefined {
	if (
		value === null ||
		typeof value === 'string' ||
		typeof value === 'number' ||
		typeof value === 'boolean'
	)
		return value
	if (Array.isArray(value)) {
		return value
			.map((entry) => browserPaletteJsonValue(entry))
			.filter((entry): entry is JsonValue => entry !== undefined)
	}
	if (typeof value !== 'object') return undefined
	const entries = Object.entries(value)
	const next: { [key: string]: JsonValue } = {}
	for (const [key, entry] of entries) {
		const serialized = browserPaletteJsonValue(entry)
		if (serialized !== undefined) next[key] = serialized
	}
	return next
}

export function getBrowserPaletteConfigurationJson(): string {
	const { palette } = getBrowserPalette()
	return JSON.stringify(
		{
			top: browserPaletteJsonValue(browserPaletteIdeConfig.top),
			keyBindings: browserPaletteJsonValue(palette.keys.bindings) ?? {},
		},
		null,
		2
	)
}

let browserPaletteBundle: BrowserPaletteBundle | undefined

export function getBrowserPalette(): BrowserPaletteBundle {
	if (!browserPaletteBundle) {
		browserPaletteBundle = createBrowserPaletteBundle()
	}
	return browserPaletteBundle
}

export function disposeBrowserPalette(): void {
	browserPaletteBundle?.dispose()
	browserPaletteBundle = undefined
}
