import {
	appShellTimeControls,
	buildPaletteSelectedActionValues,
	getAppShellBuildableAlveoli,
} from '@app/lib/app-shell-controls'
import type { Configuration } from '@app/lib/globals'
import { configuration, interactionMode, uiConfiguration } from '@app/lib/globals'
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
	type PaletteConfig,
	type PaletteCommandBoxModel,
	type PaletteEditorContext,
	type PaletteEditorRegistry,
	type PaletteToolbarItem,
	paletteCommandBoxModel,
	paletteCommandEntries,
} from '@sursaut/ui/palette'
import { effect, reactive } from 'mutts'
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
	browserPaletteBuildableAlveoli
)

const themeSettingsProxy: { theme: AnarkaiThemeMode } = {
	get theme() {
		return uiConfiguration.darkMode ? 'dark' : 'light'
	},
	set theme(value: AnarkaiThemeMode) {
		uiConfiguration.darkMode = value === 'dark'
	},
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
		<div class="app-palette-clock" title="In-game clock">
			<span>{state.time}</span>
		</div>
	)
}

type BrowserPaletteEditorConfigByVariant = AnarkaiPaletteEditorConfigByVariant & {
	clock: { label?: string }
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
		label: 'Time',
		keywords: ['time', 'pause', 'play', 'speed', 'clock'],
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
} satisfies PaletteEditorRegistry<BrowserPaletteSchema>

const browserPaletteEditorDefaults = {
	enum: 'select',
	run: 'button',
} satisfies NonNullable<PaletteConfig<BrowserPaletteSchema>['editorDefaults']>

const paletteKeys = createPaletteKeys({
	',': 'openConfiguration',
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
		entries: paletteCommandEntries({ palette }),
		placeholder: 'Command...',
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
	{ editor: 'clock', config: { label: 'Clock' } },
	{
		tool: 'timeControl',
		editor: 'segmented',
		config: {
			label: 'Time',
			choiceDisplay: 'icon',
			keywords: ['time', 'pause', 'play'],
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
		editor: 'segmented',
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
