import type {
	PaletteSchema,
	PaletteToolbarItem,
	PaletteToolbarItemByEditor,
	PaletteTools,
} from '@sursaut/ui/palette'

export type AnarkaiPaletteTone = 'neutral' | 'accent'
export type AnarkaiPaletteChoiceDisplay = 'icon' | 'text' | 'both'

export type AnarkaiPaletteItemConfigBase = {
	icon?: string | JSX.Element | (() => JSX.Element)
	label?: string
	hint?: string
	tone?: AnarkaiPaletteTone
}

export type AnarkaiPaletteEnumConfig = AnarkaiPaletteItemConfigBase & {
	choiceDisplay?: AnarkaiPaletteChoiceDisplay
	/** Subset of tool enum values offered by this slot (order preserved). */
	values?: readonly string[]
	/** Show values whose derived keywords match any of these tokens. */
	acceptedKeywords?: readonly string[]
	keywords?: readonly string[]
}

export type AnarkaiPaletteStarsConfig = AnarkaiPaletteItemConfigBase & {
	after?: string
	before?: string
	inside?: string
	keywords?: readonly string[]
	size?: string
	zeroElement?: string
}

export type AnarkaiPaletteEditorConfigByVariant = {
	button: AnarkaiPaletteItemConfigBase
	cycle: AnarkaiPaletteEnumConfig
	commandBox: AnarkaiPaletteItemConfigBase
	select: AnarkaiPaletteEnumConfig
	segmented: AnarkaiPaletteEnumConfig
	stars: AnarkaiPaletteStarsConfig
	toggle: AnarkaiPaletteItemConfigBase
}

export type AnarkaiPaletteEditorVariant = keyof AnarkaiPaletteEditorConfigByVariant

export type AnarkaiPaletteToolbarItem<TTool extends string = string> = PaletteToolbarItem<
	TTool,
	AnarkaiPaletteEditorVariant,
	AnarkaiPaletteEditorConfigByVariant[AnarkaiPaletteEditorVariant]
>

export type AnarkaiPaletteSchema<
	TTools extends PaletteTools = PaletteTools,
	TEditorConfigs extends Record<string, unknown> = AnarkaiPaletteEditorConfigByVariant,
	TItem extends PaletteToolbarItem<
		keyof TTools & string,
		keyof TEditorConfigs & string,
		TEditorConfigs[keyof TEditorConfigs & string]
	> = PaletteToolbarItemByEditor<TEditorConfigs, keyof TTools & string>,
> = PaletteSchema<TTools, TEditorConfigs, TItem>
