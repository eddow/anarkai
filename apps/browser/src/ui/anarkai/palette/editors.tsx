import { Button, ButtonGroup, CheckButton, RadioButton } from '@app/ui/anarkai'
import { renderAnarkaiIcon } from '@app/ui/anarkai/icons'
import { document, latch } from '@sursaut/core'
import type {
	PaletteConfig,
	PaletteEditorContext,
	PaletteEditorRegistry,
	PaletteTool,
} from '@sursaut/ui/palette'
import { paletteToolFamily } from '@sursaut/ui/palette'
import { effect, reactive } from 'mutts'
import { Stars } from '../components/Stars'
import { AnarkaiCommandBoxEditor } from './command-box'
import type {
	AnarkaiPaletteChoiceDisplay,
	AnarkaiPaletteEditorConfigByVariant,
	AnarkaiPaletteEditorVariant,
	AnarkaiPaletteEnumConfig,
	AnarkaiPaletteItemConfigBase,
	AnarkaiPaletteSchema,
	AnarkaiPaletteStarsConfig,
	AnarkaiPaletteToolbarItem,
} from './types'

type AnarkaiPaletteEditorOption = {
	label: string
	value: AnarkaiPaletteEditorVariant
}

type AnarkaiPaletteAnyItem = AnarkaiPaletteToolbarItem
type AnarkaiPaletteRunTool = Extract<PaletteTool, { run(): void }>
type AnarkaiPaletteBooleanTool = Extract<PaletteTool, { type: 'boolean' }>
type AnarkaiPaletteNumberTool = Extract<PaletteTool, { type: 'number' }>
type AnarkaiPaletteEnumTool = Extract<PaletteTool, { type: 'enum' }>
type AnarkaiPaletteEnumValue = AnarkaiPaletteEnumTool['values'][number]

const anarkaiPaletteEditorLabels = {
	button: 'Button',
	cycle: 'Cycle',
	commandBox: 'Command box',
	select: 'Select',
	segmented: 'Segmented',
	stars: 'Stars',
	toggle: 'Toggle',
} satisfies Record<AnarkaiPaletteEditorVariant, string>

const anarkaiPaletteEditorDefaults = {
	boolean: 'toggle',
	enum: 'select',
	number: 'stars',
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

function starsConfig(item: AnarkaiPaletteAnyItem): AnarkaiPaletteStarsConfig | undefined {
	const config = itemConfig(item)
	return config ? (config as AnarkaiPaletteStarsConfig) : undefined
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

/** Native `title` / `el:title` text: item hint, else accessible label (matches `aria-label`). */
export function paletteToolbarControlTitle(item: AnarkaiPaletteAnyItem): string {
	const meta = itemMeta(item)
	return meta.hint ?? meta.label
}

function choiceDisplay(item: AnarkaiPaletteAnyItem): AnarkaiPaletteChoiceDisplay {
	const display = enumConfig(item)?.choiceDisplay
	return display === 'icon' || display === 'text' || display === 'both' ? display : 'both'
}

function normalizeEnumKeyword(value: string): string {
	return value.trim().toLowerCase()
}

function splitEnumWords(value: string): string[] {
	return value
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/[^a-zA-Z0-9]+/g, ' ')
		.split(/\s+/)
		.map((part) => part.trim())
		.filter((part) => part.length > 0)
}

function enumValueKeywords(entry: AnarkaiPaletteEnumValue): string[] {
	const seen = new Set<string>()
	const values: string[] = []
	const push = (source: string | readonly string[] | undefined) => {
		if (!source) return
		const list = typeof source === 'string' ? [source] : source
		for (const value of list) {
			const exact = normalizeEnumKeyword(value)
			if (exact && !seen.has(exact)) {
				seen.add(exact)
				values.push(exact)
			}
			for (const word of splitEnumWords(value)) {
				const normalized = normalizeEnumKeyword(word)
				if (!normalized || seen.has(normalized)) continue
				seen.add(normalized)
				values.push(normalized)
			}
		}
	}
	push(String(entry.value))
	push(entry.label)
	push(entry.categories)
	push(entry.keywords)
	return values
}

function enumAcceptedKeywords(item: AnarkaiPaletteAnyItem): readonly string[] {
	return enumConfig(item)?.acceptedKeywords ?? []
}

function filteredEnumValues(item: AnarkaiPaletteAnyItem, tool: AnarkaiPaletteEnumTool) {
	const acceptedKeywords = enumAcceptedKeywords(item)
	if (acceptedKeywords.length > 0) {
		const allowed = new Set(acceptedKeywords.map((value) => normalizeEnumKeyword(value)))
		return tool.values.filter((entry: AnarkaiPaletteEnumValue) =>
			enumValueKeywords(entry).some((keyword) => allowed.has(keyword))
		)
	}
	const subset = enumConfig(item)?.values
	if (!subset?.length) return tool.values
	const allowed = new Set(subset)
	return tool.values.filter((entry: AnarkaiPaletteEnumValue) => allowed.has(String(entry.value)))
}

function enumValueLabel(entry: AnarkaiPaletteEnumValue): string {
	return entry.label ?? String(entry.value)
}

function enumChoiceParts(
	entry: AnarkaiPaletteEnumValue,
	display: AnarkaiPaletteChoiceDisplay
): {
	icon: string | JSX.Element | undefined
	label: string
	showLabel: boolean
} {
	const label = enumValueLabel(entry)
	const icon =
		display !== 'text'
			? controlIcon(entry.icon ?? (display === 'icon' ? String(entry.value) : undefined))
			: undefined
	return {
		icon,
		label,
		showLabel: display !== 'icon' || icon === undefined,
	}
}

function selectedEnumValue(
	item: AnarkaiPaletteAnyItem,
	tool: AnarkaiPaletteEnumTool
): AnarkaiPaletteEnumValue | undefined {
	const visible = filteredEnumValues(item, tool)
	return (
		visible.find((entry: AnarkaiPaletteEnumValue) => String(entry.value) === String(tool.value)) ??
		visible[0]
	)
}

function enumChoiceTitle(itemTitle: string, entry: AnarkaiPaletteEnumValue): string {
	const label = enumValueLabel(entry)
	return itemTitle === label ? itemTitle : `${itemTitle} — ${label}`
}

function nextEnumValue(
	item: AnarkaiPaletteAnyItem,
	tool: AnarkaiPaletteEnumTool
): AnarkaiPaletteEnumValue | undefined {
	const visible = filteredEnumValues(item, tool)
	if (visible.length === 0) return undefined
	const currentIndex = visible.findIndex(
		(entry: AnarkaiPaletteEnumValue) => String(entry.value) === String(tool.value)
	)
	return visible[(currentIndex >= 0 ? currentIndex + 1 : 0) % visible.length]
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
	if (family === 'number') return [{ value: 'stars', label: anarkaiPaletteEditorLabels.stars }]
	if (family === 'enum')
		return [
			{ value: 'cycle', label: anarkaiPaletteEditorLabels.cycle },
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

function setConfigList(
	item: AnarkaiPaletteAnyItem,
	key: 'acceptedKeywords' | 'keywords' | 'values',
	value: string
) {
	const config = ensureItemConfig(item) as AnarkaiPaletteEnumConfig
	const next = value
		.split(',')
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0)
	config[key] = next.length > 0 ? next : undefined
}

function setStarsConfigText(
	item: AnarkaiPaletteAnyItem,
	key: 'after' | 'before' | 'inside' | 'size' | 'zeroElement',
	value: string
) {
	const config = ensureItemConfig(item) as AnarkaiPaletteStarsConfig
	const next = value.trim()
	config[key] = next.length > 0 ? value : undefined
}

function setStarsConfigKeywords(item: AnarkaiPaletteAnyItem, value: string) {
	const config = ensureItemConfig(item) as AnarkaiPaletteStarsConfig
	const next = value
		.split(',')
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0)
	config.keywords = next.length > 0 ? next : undefined
}

function controlIcon(
	icon: string | JSX.Element | (() => JSX.Element) | undefined
): JSX.Element | undefined {
	if (!icon) return undefined
	return renderAnarkaiIcon(icon, { class: 'ak-palette-rendered-icon' }) ?? undefined
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

function EnumChoicePreview(props: {
	entry: AnarkaiPaletteEnumValue
	display: AnarkaiPaletteChoiceDisplay
}) {
	const parts = enumChoiceParts(props.entry, props.display)
	return (
		<span class="ak-palette-choice">
			<span if={parts.icon} class="ak-palette-choice__icon">
				{parts.icon}
			</span>
			<span if={parts.showLabel} class="ak-palette-choice__label">
				{parts.label}
			</span>
		</span>
	)
}

function CurrentEnumChoicePreview(props: {
	entry: () => AnarkaiPaletteEnumValue
	display: () => AnarkaiPaletteChoiceDisplay
}) {
	const view = {
		get parts() {
			return enumChoiceParts(props.entry(), props.display())
		},
	}
	return (
		<span class="ak-palette-choice">
			<span if={view.parts.icon} class="ak-palette-choice__icon">
				{view.parts.icon}
			</span>
			<span if={view.parts.showLabel} class="ak-palette-choice__label">
				{view.parts.label}
			</span>
		</span>
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
			<ConfigRow
				label="Editor"
				description={
					props.tool && paletteToolFamily(props.tool) === 'enum'
						? 'Toolbar control shape (e.g. dropdown vs segmented). Does not set the live value.'
						: undefined
				}
			>
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

/** Enum EE: editor shape and options only — not the live tool value (that comes from the app / tool binding). */
function EnumInspectorConfigure(props: {
	readonly context: PaletteEditorContext<
		AnarkaiPaletteEnumTool,
		AnarkaiPaletteAnyItem,
		AnarkaiPaletteSchema
	>
}) {
	return (
		<div class="ak-palette-config-stack">
			<EnumConfigurator
				item={props.context.item as AnarkaiPaletteAnyItem}
				tool={props.context.tool}
			/>
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
			<ConfigRow
				label="Accepted keywords"
				description="Show values whose keywords or id parts match any of these tokens."
			>
				<input
					value={config?.acceptedKeywords?.join(', ') ?? ''}
					placeholder={Array.from(
						new Set(
							props.tool.values.flatMap((entry: AnarkaiPaletteEnumValue) =>
								enumValueKeywords(entry)
							)
						)
					).join(', ')}
					update:value={(value: string) => setConfigList(props.item, 'acceptedKeywords', value)}
				/>
			</ConfigRow>
			<ConfigRow label="Item keywords">
				<input
					value={config?.keywords?.join(', ') ?? ''}
					placeholder="layout, theme"
					update:value={(value: string) => setConfigList(props.item, 'keywords', value)}
				/>
			</ConfigRow>
		</div>
	)
}

function NumberInspectorConfigure(props: {
	readonly context: PaletteEditorContext<
		AnarkaiPaletteNumberTool,
		AnarkaiPaletteAnyItem,
		AnarkaiPaletteSchema
	>
}) {
	return (
		<div class="ak-palette-config-stack">
			<StarsConfigurator item={props.context.item as AnarkaiPaletteAnyItem} tool={props.context.tool} />
		</div>
	)
}

function StarsConfigurator(props: { item: AnarkaiPaletteAnyItem; tool: AnarkaiPaletteNumberTool }) {
	const config = starsConfig(props.item)
	return (
		<div class="ak-palette-config-stack">
			<BaseConfigurator item={props.item} tool={props.tool} />
			<ConfigRow label="Filled glyph" description="Rendered literally, e.g. ▶">
				<input
					value={config?.before ?? ''}
					placeholder="▶"
					update:value={(value: string) => setStarsConfigText(props.item, 'before', value)}
				/>
			</ConfigRow>
			<ConfigRow label="Empty glyph" description="Rendered literally, e.g. ▷">
				<input
					value={config?.after ?? ''}
					placeholder="▷"
					update:value={(value: string) => setStarsConfigText(props.item, 'after', value)}
				/>
			</ConfigRow>
			<ConfigRow label="Zero glyph" description="Rendered before the first slot for pause">
				<input
					value={config?.zeroElement ?? ''}
					placeholder="⏸"
					update:value={(value: string) => setStarsConfigText(props.item, 'zeroElement', value)}
				/>
			</ConfigRow>
			<ConfigRow label="Size" description="CSS font-size value">
				<input
					value={config?.size ?? ''}
					placeholder="1rem"
					update:value={(value: string) => setStarsConfigText(props.item, 'size', value)}
				/>
			</ConfigRow>
			<ConfigRow label="Item keywords">
				<input
					value={config?.keywords?.join(', ') ?? ''}
					placeholder="speed, time, play"
					update:value={(value: string) => setStarsConfigKeywords(props.item, value)}
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
	const title = paletteToolbarControlTitle(context.item as AnarkaiPaletteAnyItem)
	return icon ? (
		<Button ariaLabel={meta.label} el:title={title} icon={icon} onClick={context.tool.run} />
	) : (
		<Button ariaLabel={meta.label} el:title={title} onClick={context.tool.run}>
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
	const title = paletteToolbarControlTitle(context.item as AnarkaiPaletteAnyItem)
	return (
		<CheckButton
			checked={context.tool.value}
			ariaLabel={meta.label}
			el:title={title}
			icon={controlIcon(meta.icon ?? (context.tool.value ? '●' : '○'))}
		>
			{meta.label}
		</CheckButton>
	)
}

function StarsEditor(
	context: PaletteEditorContext<AnarkaiPaletteNumberTool, AnarkaiPaletteAnyItem, AnarkaiPaletteSchema>
) {
	const item = context.item as AnarkaiPaletteAnyItem
	const config = starsConfig(item)
	const title = paletteToolbarControlTitle(item)
	const meta = itemMeta(item)
	const minimum = Math.ceil(context.tool.min ?? 0)
	const maximum = Math.max(minimum, Math.floor(context.tool.max ?? 3))
	return (
		<div class="ak-palette-stars-field" role="group" aria-label={meta.label} title={title}>
			<Stars
				maximum={maximum}
				value={context.tool.value}
				size={config?.size ?? '1rem'}
				before={config?.before ?? '▶'}
				inside={config?.inside ?? config?.before ?? '▶'}
				after={config?.after ?? '▷'}
				zeroElement={minimum <= 0 ? (config?.zeroElement ?? '⏸') : undefined}
				onChange={(value) => {
					if (typeof value !== 'number') return
					context.tool.value = Math.min(maximum, Math.max(minimum, Math.round(value)))
				}}
			/>
		</div>
	)
}

function SelectEditor(
	context: PaletteEditorContext<AnarkaiPaletteEnumTool, AnarkaiPaletteAnyItem, AnarkaiPaletteSchema>
) {
	const item = context.item as AnarkaiPaletteAnyItem
	const meta = itemMeta(item)
	const title = paletteToolbarControlTitle(item)
	const ui = reactive({
		left: 0,
		open: false,
		top: 0,
		width: 0,
	})
	let trigger: HTMLButtonElement | undefined
	const syncPopup = () => {
		if (!trigger) return
		const rect = trigger.getBoundingClientRect()
		const nextWidth = Math.max(rect.width, 160)
		const estimatedHeight = Math.min(view.values.length, 8) * 36 + 8
		const spaceBelow = window.innerHeight - rect.bottom
		ui.width = nextWidth
		ui.left = rect.left
		ui.top =
			spaceBelow >= estimatedHeight ? rect.bottom + 4 : Math.max(8, rect.top - estimatedHeight - 4)
	}
	const view = {
		get open() {
			return ui.open
		},
		get popupStyle() {
			return {
				left: `${ui.left}px`,
				top: `${ui.top}px`,
				width: `${ui.width}px`,
			}
		},
		get values() {
			return filteredEnumValues(item, context.tool)
		},
		get display() {
			return choiceDisplay(item)
		},
		get selected() {
			return (
				selectedEnumValue(item, context.tool) ?? {
					value: context.tool.value,
					label: String(context.tool.value),
				}
			)
		},
	}
	effect`anarkai-palette-select-popup`(() => {
		if (!view.open) return
		syncPopup()
		const host = document.createElement('div')
		document.body.appendChild(host)
		const stopLatch = latch(
			host,
			<div class="ak-palette-select-field__overlay" onClick={() => (ui.open = false)}>
				<div
					class="ak-palette-select-field__popup"
					style={view.popupStyle}
					onClick={(event: Event) => event.stopPropagation()}
				>
					<ul class="ak-palette-select-field__list">
						<for each={view.values}>
							{(entry: AnarkaiPaletteEnumValue) => (
								<li class="ak-palette-select-field__item">
									<button
										type="button"
										class={[
											'ak-palette-select-field__option',
											String(entry.value) === String(context.tool.value)
												? 'is-selected'
												: undefined,
										]}
										aria-pressed={
											String(entry.value) === String(context.tool.value) ? 'true' : 'false'
										}
										title={enumChoiceTitle(title, entry)}
										onClick={() => {
											context.tool.value = entry.value
											ui.open = false
											trigger?.focus()
										}}
									>
										<EnumChoicePreview entry={entry} display={view.display} />
									</button>
								</li>
							)}
						</for>
					</ul>
				</div>
			</div>
		)
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return
			ui.open = false
			trigger?.focus()
		}
		const onLayout = () => syncPopup()
		window.addEventListener('resize', onLayout)
		window.addEventListener('scroll', onLayout, true)
		window.addEventListener('keydown', onKey)
		return () => {
			window.removeEventListener('resize', onLayout)
			window.removeEventListener('scroll', onLayout, true)
			window.removeEventListener('keydown', onKey)
			stopLatch()
			host.remove()
		}
	})
	return (
		<div class="ak-palette-select-field">
			<span if={meta.icon} class="ak-palette-select-field__icon">
				{renderAnarkaiIcon(meta.icon)}
			</span>
			<button
				this={trigger}
				type="button"
				class={['ak-palette-select-field__trigger', view.open ? 'is-open' : undefined]}
				aria-expanded={view.open ? 'true' : 'false'}
				title={title}
				onClick={() => {
					if (!view.open) syncPopup()
					ui.open = !ui.open
				}}
			>
				<span class="ak-palette-select-field__current">
					<CurrentEnumChoicePreview entry={() => view.selected} display={() => view.display} />
				</span>
				<span class="ak-palette-select-field__chevron" aria-hidden="true">
					▾
				</span>
			</button>
		</div>
	)
}

function CycleEditor(
	context: PaletteEditorContext<AnarkaiPaletteEnumTool, AnarkaiPaletteAnyItem, AnarkaiPaletteSchema>
) {
	const item = context.item as AnarkaiPaletteAnyItem
	const ui = reactive({ previewReady: false })
	let button: HTMLButtonElement | undefined
	let preview: HTMLElement | undefined
	let stopPreview: (() => void) | undefined
	const view = {
		get current() {
			return (
				selectedEnumValue(item, context.tool) ?? {
					value: context.tool.value,
					label: String(context.tool.value),
				}
			)
		},
		get currentParts() {
			return enumChoiceParts(this.current, choiceDisplay(item))
		},
		get next() {
			return nextEnumValue(item, context.tool)
		},
		get nextValue() {
			return this.next?.value
		},
		get title() {
			const base = paletteToolbarControlTitle(item)
			const current = enumValueLabel(this.current)
			const next = this.next ? enumValueLabel(this.next) : current
			return next === current ? `${base} — ${current}` : `${base} — ${current} → ${next}`
		},
	}
	const syncButton = (entry: AnarkaiPaletteEnumValue = view.current) => {
		const parts = enumChoiceParts(entry, choiceDisplay(item))
		if (button) {
			button.title = view.title
			button.setAttribute('aria-label', enumValueLabel(entry))
			if (parts.showLabel) delete button.dataset.iconOnly
			else button.dataset.iconOnly = 'true'
		}
		if (preview) {
			stopPreview?.()
			stopPreview = latch(
				preview,
				<EnumChoicePreview entry={entry} display={choiceDisplay(item)} />
			)
		}
	}
	effect`anarkai-palette-cycle-button`(() => {
		if (!ui.previewReady || !button) return
		syncButton()
	})
	return (
		<button
			this={button}
			type="button"
			class={['ak-control-button', 'ak-button']}
			onClick={() => {
				const next = view.next
				if (!next) return
				context.tool.value = next.value
				syncButton(next)
			}}
		>
			<span
				use={(element: HTMLElement) => {
					preview = element
					ui.previewReady = true
					return () => {
						stopPreview?.()
						stopPreview = undefined
					}
				}}
			/>
		</button>
	)
}

function SegmentedEditor(
	context: PaletteEditorContext<AnarkaiPaletteEnumTool, AnarkaiPaletteAnyItem, AnarkaiPaletteSchema>
) {
	const item = context.item as AnarkaiPaletteAnyItem
	const itemTip = paletteToolbarControlTitle(item)
	const view = {
		get values() {
			return filteredEnumValues(item, context.tool)
		},
		get display() {
			return choiceDisplay(item)
		},
	}
	return (
		<ButtonGroup roleFilter="radio">
			<for each={view.values}>
				{(entry: AnarkaiPaletteEnumValue) =>
					(() => {
						const parts = enumChoiceParts(entry, view.display)
						const segmentTitle = enumChoiceTitle(itemTip, entry)
						return parts.icon && !parts.showLabel ? (
							<RadioButton
								value={entry.value}
								group={context.tool.value}
								ariaLabel={parts.label}
								el:title={segmentTitle}
								icon={parts.icon}
							/>
						) : (
							<RadioButton
								value={entry.value}
								group={context.tool.value}
								ariaLabel={parts.label}
								el:title={segmentTitle}
								icon={parts.icon}
							>
								{parts.label}
							</RadioButton>
						)
					})()
				}
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
		number: {
			stars: {
				editor: StarsEditor,
				configure: (context) => (
					<NumberInspectorConfigure
						context={
							context as PaletteEditorContext<
								AnarkaiPaletteNumberTool,
								AnarkaiPaletteAnyItem,
								AnarkaiPaletteSchema
							>
						}
					/>
				),
				flags: { footprint: 'horizontal' },
			},
		},
		enum: {
			cycle: {
				editor: CycleEditor,
				configure: (context) => (
					<EnumInspectorConfigure
						context={
							context as PaletteEditorContext<
								AnarkaiPaletteEnumTool,
								AnarkaiPaletteAnyItem,
								AnarkaiPaletteSchema
							>
						}
					/>
				),
				flags: { footprint: 'horizontal' },
			},
			select: {
				editor: SelectEditor,
				configure: (context) => (
					<EnumInspectorConfigure
						context={
							context as PaletteEditorContext<
								AnarkaiPaletteEnumTool,
								AnarkaiPaletteAnyItem,
								AnarkaiPaletteSchema
							>
						}
					/>
				),
				flags: { footprint: 'horizontal' },
			},
			segmented: {
				editor: SegmentedEditor,
				configure: (context) => (
					<EnumInspectorConfigure
						context={
							context as PaletteEditorContext<
								AnarkaiPaletteEnumTool,
								AnarkaiPaletteAnyItem,
								AnarkaiPaletteSchema
							>
						}
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
	cycle: anarkaiPaletteEditors.enum?.cycle,
	commandBox: anarkaiPaletteEditors.item?.commandBox,
	select: anarkaiPaletteEditors.enum?.select,
	segmented: anarkaiPaletteEditors.enum?.segmented,
	stars: anarkaiPaletteEditors.number?.stars,
	toggle: anarkaiPaletteEditors.boolean?.toggle,
} satisfies Record<AnarkaiPaletteEditorVariant, unknown>
