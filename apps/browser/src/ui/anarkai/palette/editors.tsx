import { Button, ButtonGroup, CheckButton, RadioButton } from '@app/ui/anarkai'
import { renderAnarkaiIcon } from '@app/ui/anarkai/icons'
import type {
	PaletteConfig,
	PaletteEditorContext,
	PaletteEditorRegistry,
	PaletteTool,
} from '@sursaut/ui/palette'
import { paletteToolFamily } from '@sursaut/ui/palette'
import { AnarkaiCommandBoxEditor } from './command-box'
import type {
	AnarkaiPaletteChoiceDisplay,
	AnarkaiPaletteEditorConfigByVariant,
	AnarkaiPaletteEditorVariant,
	AnarkaiPaletteEnumConfig,
	AnarkaiPaletteItemConfigBase,
	AnarkaiPaletteSchema,
	AnarkaiPaletteToolbarItem,
} from './types'

type AnarkaiPaletteEditorOption = {
	label: string
	value: AnarkaiPaletteEditorVariant
}

type AnarkaiPaletteAnyItem = AnarkaiPaletteToolbarItem
type AnarkaiPaletteRunTool = Extract<PaletteTool, { run(): void }>
type AnarkaiPaletteBooleanTool = Extract<PaletteTool, { type: 'boolean' }>
type AnarkaiPaletteEnumTool = Extract<PaletteTool, { type: 'enum' }>

const anarkaiPaletteEditorLabels = {
	button: 'Button',
	commandBox: 'Command box',
	select: 'Select',
	segmented: 'Segmented',
	toggle: 'Toggle',
} satisfies Record<AnarkaiPaletteEditorVariant, string>

const anarkaiPaletteEditorDefaults = {
	boolean: 'toggle',
	enum: 'select',
	run: 'button',
} as const satisfies Pick<PaletteConfig<AnarkaiPaletteSchema>, 'editorDefaults'>['editorDefaults']

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
	return typeof value === 'object' && value !== null
}

function itemConfig(
	item: AnarkaiPaletteAnyItem
): AnarkaiPaletteEditorConfigByVariant[AnarkaiPaletteEditorVariant] | undefined {
	return isRecord(item.config)
		? (item.config as AnarkaiPaletteEditorConfigByVariant[AnarkaiPaletteEditorVariant])
		: undefined
}

function ensureItemConfig(
	item: AnarkaiPaletteAnyItem
): AnarkaiPaletteEditorConfigByVariant[AnarkaiPaletteEditorVariant] {
	if (!isRecord(item.config)) item.config = {}
	return item.config as AnarkaiPaletteEditorConfigByVariant[AnarkaiPaletteEditorVariant]
}

function enumConfig(item: AnarkaiPaletteAnyItem): AnarkaiPaletteEnumConfig | undefined {
	const config = itemConfig(item)
	return config ? (config as AnarkaiPaletteEnumConfig) : undefined
}

function itemMeta(item: AnarkaiPaletteAnyItem) {
	const config = itemConfig(item)
	return {
		get icon() {
			return config?.icon
		},
		get hint() {
			return typeof config?.hint === 'string' ? config.hint : undefined
		},
		get label() {
			return typeof config?.label === 'string' ? config.label : (item.tool ?? item.editor)
		},
		get tone() {
			return config?.tone === 'accent' ? 'accent' : 'neutral'
		},
	}
}

function choiceDisplay(item: AnarkaiPaletteAnyItem): AnarkaiPaletteChoiceDisplay {
	const display = enumConfig(item)?.choiceDisplay
	return display === 'icon' || display === 'text' || display === 'both' ? display : 'both'
}

function filteredEnumValues(item: AnarkaiPaletteAnyItem, tool: AnarkaiPaletteEnumTool) {
	const subset = enumConfig(item)?.values
	if (!subset?.length) return tool.values
	const allowed = new Set(subset)
	return tool.values.filter((entry: AnarkaiPaletteEnumTool['values'][number]) =>
		allowed.has(String(entry.value))
	)
}

function editorOptions(
	item: AnarkaiPaletteAnyItem,
	tool: PaletteTool | undefined
): readonly AnarkaiPaletteEditorOption[] {
	if (!item.tool) return [{ value: 'commandBox', label: anarkaiPaletteEditorLabels.commandBox }]
	if (!tool) return []
	const family = paletteToolFamily(tool)
	if (family === 'run') return [{ value: 'button', label: anarkaiPaletteEditorLabels.button }]
	if (family === 'boolean') return [{ value: 'toggle', label: anarkaiPaletteEditorLabels.toggle }]
	if (family === 'enum')
		return [
			{ value: 'select', label: anarkaiPaletteEditorLabels.select },
			{ value: 'segmented', label: anarkaiPaletteEditorLabels.segmented },
		]
	return []
}

function setConfigText(item: AnarkaiPaletteAnyItem, key: 'label' | 'hint', value: string) {
	const config = ensureItemConfig(item) as AnarkaiPaletteItemConfigBase
	config[key] = value
}

function setConfigIcon(item: AnarkaiPaletteAnyItem, value: string) {
	const config = ensureItemConfig(item) as AnarkaiPaletteItemConfigBase
	config.icon = value
}

function setConfigTone(item: AnarkaiPaletteAnyItem, value: string) {
	const config = ensureItemConfig(item) as AnarkaiPaletteItemConfigBase
	config.tone = value === 'accent' ? 'accent' : 'neutral'
}

function setConfigChoiceDisplay(item: AnarkaiPaletteAnyItem, value: string) {
	const config = ensureItemConfig(item) as AnarkaiPaletteEnumConfig
	config.choiceDisplay = value === 'icon' || value === 'text' || value === 'both' ? value : 'both'
}

function setConfigList(item: AnarkaiPaletteAnyItem, key: 'values' | 'keywords', value: string) {
	const config = ensureItemConfig(item) as AnarkaiPaletteEnumConfig
	const next = value
		.split(',')
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0)
	config[key] = next.length > 0 ? next : undefined
}

function controlIcon(icon: string | JSX.Element | undefined): string | JSX.Element | undefined {
	if (!icon) return undefined
	return typeof icon === 'string' ? (renderAnarkaiIcon(icon) ?? undefined) : icon
}

function ConfigRow(props: { label: string; description?: string; children?: JSX.Children }) {
	return (
		<div class="ak-palette-config-row">
			<div class="ak-palette-config-key">
				<strong>{props.label}</strong>
				<span if={props.description}>{props.description}</span>
			</div>
			<div class="ak-palette-config-value">{props.children}</div>
		</div>
	)
}

function BaseConfigurator(props: { item: AnarkaiPaletteAnyItem; tool: PaletteTool | undefined }) {
	const meta = itemMeta(props.item)
	return (
		<div class="ak-palette-config-table">
			<ConfigRow label="Label">
				<input
					value={meta.label}
					update:value={(value: string) => setConfigText(props.item, 'label', value)}
				/>
			</ConfigRow>
			<ConfigRow label="Icon" description="Glyf class or glyph.">
				<input
					value={typeof meta.icon === 'string' ? meta.icon : ''}
					placeholder="bolt or ☀"
					update:value={(value: string) => setConfigIcon(props.item, value)}
				/>
			</ConfigRow>
			<ConfigRow label="Hint">
				<input
					value={meta.hint ?? ''}
					update:value={(value: string) => setConfigText(props.item, 'hint', value)}
				/>
			</ConfigRow>
			<ConfigRow label="Editor">
				<select
					value={props.item.editor}
					update:value={(value: string) => {
						if (value in anarkaiPaletteEditorLabels) {
							props.item.editor = value as AnarkaiPaletteEditorVariant
						}
					}}
				>
					<for each={editorOptions(props.item, props.tool)}>
						{(option: AnarkaiPaletteEditorOption) => (
							<option value={option.value}>{option.label}</option>
						)}
					</for>
				</select>
			</ConfigRow>
			<ConfigRow label="Tone">
				<select
					value={meta.tone}
					update:value={(value: string) => setConfigTone(props.item, value)}
				>
					<option value="neutral">Neutral</option>
					<option value="accent">Accent</option>
				</select>
			</ConfigRow>
		</div>
	)
}

function EnumConfigurator(props: { item: AnarkaiPaletteAnyItem; tool: AnarkaiPaletteEnumTool }) {
	const config = enumConfig(props.item)
	return (
		<div class="ak-palette-config-stack">
			<BaseConfigurator item={props.item} tool={props.tool} />
			<ConfigRow label="Choice display">
				<select
					value={choiceDisplay(props.item)}
					update:value={(value: string) => setConfigChoiceDisplay(props.item, value)}
				>
					<option value="both">Icon + text</option>
					<option value="icon">Icon only</option>
					<option value="text">Text only</option>
				</select>
			</ConfigRow>
			<ConfigRow label="Allowed values">
				<input
					value={config?.values?.join(', ') ?? ''}
					placeholder={props.tool.values
						.map((entry: AnarkaiPaletteEnumTool['values'][number]) => String(entry.value))
						.join(', ')}
					update:value={(value: string) => setConfigList(props.item, 'values', value)}
				/>
			</ConfigRow>
			<ConfigRow label="Keywords">
				<input
					value={config?.keywords?.join(', ') ?? ''}
					placeholder="layout, theme"
					update:value={(value: string) => setConfigList(props.item, 'keywords', value)}
				/>
			</ConfigRow>
		</div>
	)
}

function ButtonEditor(
	context: PaletteEditorContext<AnarkaiPaletteRunTool, AnarkaiPaletteAnyItem, AnarkaiPaletteSchema>
) {
	const meta = itemMeta(context.item as AnarkaiPaletteAnyItem)
	const icon = controlIcon(meta.icon)
	return icon ? (
		<Button ariaLabel={meta.label} icon={icon} onClick={context.tool.run} />
	) : (
		<Button ariaLabel={meta.label} onClick={context.tool.run}>
			{meta.label}
		</Button>
	)
}

function ToggleEditor(
	context: PaletteEditorContext<
		AnarkaiPaletteBooleanTool,
		AnarkaiPaletteAnyItem,
		AnarkaiPaletteSchema
	>
) {
	const meta = itemMeta(context.item as AnarkaiPaletteAnyItem)
	return (
		<CheckButton
			checked={context.tool.value}
			ariaLabel={meta.label}
			icon={controlIcon(meta.icon ?? (context.tool.value ? '●' : '○'))}
		>
			{meta.label}
		</CheckButton>
	)
}

function SelectEditor(
	context: PaletteEditorContext<AnarkaiPaletteEnumTool, AnarkaiPaletteAnyItem, AnarkaiPaletteSchema>
) {
	const meta = itemMeta(context.item as AnarkaiPaletteAnyItem)
	const view = {
		get values() {
			return filteredEnumValues(context.item as AnarkaiPaletteAnyItem, context.tool)
		},
		get display() {
			return choiceDisplay(context.item as AnarkaiPaletteAnyItem)
		},
	}
	return (
		<label class="ak-palette-select-field">
			<span if={meta.icon} class="ak-palette-select-field__icon">
				{renderAnarkaiIcon(meta.icon)}
			</span>
			<select
				value={context.tool.value}
				update:value={(value: string) => {
					context.tool.value = value
				}}
			>
				<for each={view.values}>
					{(entry: AnarkaiPaletteEnumTool['values'][number]) => (
						<option value={String(entry.value)}>
							{view.display === 'icon'
								? (entry.icon ?? entry.label ?? String(entry.value))
								: view.display === 'text'
									? (entry.label ?? String(entry.value))
									: [entry.icon, entry.label ?? String(entry.value)].filter(Boolean).join(' ')}
						</option>
					)}
				</for>
			</select>
		</label>
	)
}

function SegmentedEditor(
	context: PaletteEditorContext<AnarkaiPaletteEnumTool, AnarkaiPaletteAnyItem, AnarkaiPaletteSchema>
) {
	const view = {
		get values() {
			return filteredEnumValues(context.item as AnarkaiPaletteAnyItem, context.tool)
		},
		get display() {
			return choiceDisplay(context.item as AnarkaiPaletteAnyItem)
		},
	}
	return (
		<ButtonGroup roleFilter="radio">
			<for each={view.values}>
				{(entry: AnarkaiPaletteEnumTool['values'][number]) => (
					(() => {
						const icon =
							view.display !== 'text'
								? controlIcon(
										entry.icon ?? (view.display === 'icon' ? String(entry.value) : undefined)
									)
								: undefined
						const label = entry.label ?? String(entry.value)
						return view.display === 'icon' && icon ? (
							<RadioButton
								value={entry.value}
								group={context.tool.value}
								ariaLabel={label}
								icon={icon}
							/>
						) : (
							<RadioButton
								value={entry.value}
								group={context.tool.value}
								ariaLabel={label}
								icon={icon}
							>
								{label}
							</RadioButton>
						)
					})()
				)}
			</for>
		</ButtonGroup>
	)
}

export function createAnarkaiPaletteEditors(): PaletteEditorRegistry<AnarkaiPaletteSchema> {
	return {
		boolean: {
			toggle: {
				editor: ToggleEditor,
				configure: (context) => (
					<BaseConfigurator item={context.item as AnarkaiPaletteAnyItem} tool={context.tool} />
				),
				flags: { footprint: 'square' },
			},
		},
		enum: {
			select: {
				editor: SelectEditor,
				configure: (context) => (
					<EnumConfigurator
						item={context.item as AnarkaiPaletteAnyItem}
						tool={context.tool as AnarkaiPaletteEnumTool}
					/>
				),
				flags: { footprint: 'horizontal' },
			},
			segmented: {
				editor: SegmentedEditor,
				configure: (context) => (
					<EnumConfigurator
						item={context.item as AnarkaiPaletteAnyItem}
						tool={context.tool as AnarkaiPaletteEnumTool}
					/>
				),
				flags: { footprint: 'free' },
			},
		},
		run: {
			button: {
				editor: ButtonEditor,
				configure: (context) => (
					<BaseConfigurator item={context.item as AnarkaiPaletteAnyItem} tool={context.tool} />
				),
				flags: { footprint: 'horizontal' },
			},
		},
		item: {
			commandBox: {
				editor: AnarkaiCommandBoxEditor,
				configure: (context) => (
					<BaseConfigurator item={context.item as AnarkaiPaletteAnyItem} tool={undefined} />
				),
				flags: { footprint: 'horizontal' },
			},
		},
	}
}

export function createAnarkaiPalettePreset(): Pick<
	PaletteConfig<AnarkaiPaletteSchema>,
	'editors' | 'editorDefaults'
> {
	return {
		editors: createAnarkaiPaletteEditors(),
		editorDefaults: anarkaiPaletteEditorDefaults,
	}
}

export const anarkaiPaletteEditors = createAnarkaiPaletteEditors()
export const anarkaiPalettePreset = createAnarkaiPalettePreset()

export const anarkaiPaletteEditorSpecs = {
	button: anarkaiPaletteEditors.run?.button,
	commandBox: anarkaiPaletteEditors.item?.commandBox,
	select: anarkaiPaletteEditors.enum?.select,
	segmented: anarkaiPaletteEditors.enum?.segmented,
	toggle: anarkaiPaletteEditors.boolean?.toggle,
} satisfies Record<AnarkaiPaletteEditorVariant, unknown>
