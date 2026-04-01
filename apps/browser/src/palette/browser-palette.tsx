import {
	appShellTimeControls,
	buildPaletteSelectedActionValues,
	getAppShellBuildableAlveoli,
} from '@app/lib/app-shell-controls'
import type { Configuration } from '@app/lib/globals'
import { configuration, game, interactionMode, uiConfiguration } from '@app/lib/globals'
import ResourceImage from '@app/components/ResourceImage'
import {
	type AnarkaiPaletteEditorConfigByVariant,
	type AnarkaiPaletteSchema,
	type AnarkaiThemeMode,
	createAnarkaiPaletteEditors,
} from '@app/ui/anarkai'
import {
	createPaletteKeys,
	Palette,
	type PaletteBorder,
	type PaletteCommandBoxModel,
	type PaletteConfig,
	type PaletteEditorContext,
	type PaletteEditorRegistry,
	type PaletteToolbarItem,
	paletteCatalogEntries,
	paletteCommandBoxModel,
	paletteCommandEntries,
	palettes,
} from '@sursaut/ui/palette'
import { effect, reactive, unwrap } from 'mutts'
import { alveoli as visualAlveoli } from 'engine-pixi/assets/visual-content'
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
		type: 'enum' as const,
		label: 'Speed',
		keywords: ['speed', 'time', 'pause', 'play', 'clock', 'rate'],
		get value() {
			return configuration.timeControl
		},
		set value(next: Configuration['timeControl']) {
			configuration.timeControl = next
		},
		default: 'play' as const,
		values: appShellTimeControls.map((o) => ({
			value: o.value,
			label: o.label,
			icon: typeof o.icon === 'string' ? o.icon : undefined,
		})),
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

type BrowserPaletteToolbarItem<TTool extends string = BrowserPaletteTool> = PaletteToolbarItem<
	TTool,
	keyof BrowserPaletteEditorConfigByVariant,
	BrowserPaletteEditorConfigByVariant[keyof BrowserPaletteEditorConfigByVariant]
>

type BrowserPaletteSchema = AnarkaiPaletteSchema<
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
	const game = _context.scope.clockGame as Game | undefined
	const state = reactive({ time: '--:--' })
	effect`palette:clock`(() => {
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
	run: 'button',
} satisfies NonNullable<PaletteConfig<BrowserPaletteSchema>['editorDefaults']>

const paletteKeys = createPaletteKeys({
	'`': 'openConfiguration',
	g: 'openGame',
	h: 'openTest',
})

function createBrowserPaletteBundle() {
	const palette = new Palette<BrowserPaletteSchema>({
		tools,
		keys: paletteKeys,
		editorDefaults: browserPaletteEditorDefaults,
		editors: browserPaletteEditors,
	})
	const commandBox = paletteCommandBoxModel({
		entries: () =>
			unwrap(palettes.editing) === unwrap(palette)
				? paletteCatalogEntries({ palette })
				: paletteCommandEntries({ palette }),
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

const ideToolbar: BrowserPaletteToolbarItem[] = [
	{
		tool: 'openConfiguration',
		editor: 'button',
		config: {
			label: 'Configuration',
			icon: tablerFilledAdjustments,
			tone: 'neutral' as const,
			hint: 'Open configuration panel',
		},
	},
	{
		tool: 'openGame',
		editor: 'button',
		config: {
			label: 'Game',
			icon: tablerFilledArrowBigRight,
			tone: 'neutral' as const,
			hint: 'Open game panel',
		},
	},
	{
		tool: 'openTest',
		editor: 'button',
		config: {
			label: 'Test',
			icon: tablerFilledFlask,
			tone: 'neutral' as const,
			hint: 'Open test panel',
		},
	},
	{
		editor: 'clock',
		config: { label: 'Clock', hint: 'In-game clock' },
	},
	{
		tool: 'timeControl',
		editor: 'segmented',
		config: {
			label: 'Speed',
			choiceDisplay: 'icon',
			keywords: ['speed', 'pause', 'play', 'time'],
		},
	},
	{
		tool: 'selectedAction',
		editor: 'select',
		config: {
			label: 'Action',
			choiceDisplay: 'both',
			keywords: ['action', 'select', 'build', 'zone'],
		},
	},
	{
		tool: 'theme',
		editor: 'cycle',
		config: { label: 'Theme', choiceDisplay: 'icon', keywords: ['theme', 'dark', 'light'] },
	},
]

export const browserPaletteIdeConfig = {
	top: [[{ space: 1, toolbar: ideToolbar }]],
} satisfies { top: PaletteBorder<BrowserPaletteToolbarItem> }

export type BrowserPaletteBundle = {
	readonly commandBox: PaletteCommandBoxModel
	readonly palette: ReturnType<typeof createBrowserPaletteBundle>['palette']
	readonly PaletteIde: ReturnType<typeof createBrowserPaletteBundle>['PaletteIde']
	dispose(): void
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
