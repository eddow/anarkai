import { renderAnarkaiIcon } from '@app/ui/anarkai/icons'
import type {
	Palette,
	PaletteCatalogDragPayload,
	PaletteCommandBoxModel,
	PaletteSchema,
	PaletteScope,
} from '@sursaut/ui/palette'
import {
	beginPaletteCatalogInsertDrag,
	handlePaletteCommandBoxInputKeydown,
	handlePaletteCommandChipKeydown,
	PALETTE_CATALOG_DRAG_MIME,
	palettes,
	paletteToolbarItemFromCatalogPayload,
	serializePaletteCatalogDragPayload,
	setPaletteCommandBoxInput,
} from '@sursaut/ui/palette'
import { reactive, unwrap } from 'mutts'
import type { AnarkaiPaletteSchema } from './types'

type AnarkaiPaletteCommandBoxPalette = object

export type AnarkaiPaletteCommandBoxProps = {
	readonly commandBox: PaletteCommandBoxModel
	readonly editable?: boolean
	readonly palette?: AnarkaiPaletteCommandBoxPalette
	readonly icon?: string | JSX.Element
	readonly title?: string
	readonly expanded: boolean
	readonly floating?: boolean
	readonly onInputFocus?: () => void
	readonly onInputBlur?: (event: FocusEvent) => void
	readonly onEscapeOrExecute?: () => void
	readonly onEntryPick?: (entryId: string) => void
	readonly onInputMount?: (input: HTMLInputElement) => void
	readonly onSuggestionPick?: () => void
	readonly onEditStop?: () => void
	readonly selectOnPick?: boolean
}

/** Native tooltip for popover rows: full label plus meta when present (truncation / long rows). */
export function paletteCommandResultTitle(entry: { label: string; meta?: string }): string {
	const meta = entry.meta?.trim()
	return meta ? `${entry.label} — ${meta}` : entry.label
}

export type AnarkaiPaletteScopeExtras = {
	commandBox?: PaletteCommandBoxModel
	commandBoxExpanded?: boolean
	commandBoxEditable?: boolean
	commandBoxFloating?: boolean
	commandBoxIcon?: string | JSX.Element
	commandBoxSelectOnPick?: boolean
	onCommandBoxEntryPick?: (entryId: string) => void
	onCommandBoxEscapeOrExecute?: () => void
	onCommandBoxFocus?: () => void
	onCommandBoxBlur?: (event: FocusEvent) => void
	onCommandBoxInputMount?: (input: HTMLInputElement) => void
	onCommandBoxSuggestionPick?: () => void
}

function paletteCatalogItem(
	palette: AnarkaiPaletteCommandBoxPalette,
	payload: PaletteCatalogDragPayload
) {
	return paletteToolbarItemFromCatalogPayload(
		palette as unknown as Palette<PaletteSchema>,
		payload
	)
}

function beginCatalogInsertDrag(
	palette: AnarkaiPaletteCommandBoxPalette,
	item: ReturnType<typeof paletteToolbarItemFromCatalogPayload>,
	position: { x: number; y: number }
) {
	if (!item) return
	beginPaletteCatalogInsertDrag(palette as unknown as Palette<PaletteSchema>, item, position)
}

export function AnarkaiPaletteCommandBox(props: AnarkaiPaletteCommandBoxProps) {
	let input: HTMLInputElement | undefined
	const paletteState = palettes as {
		editing?: object
	}
	const edition = {
		get checked() {
			const palette = props.palette
			return Boolean(palette && unwrap(paletteState.editing) === unwrap(palette))
		},
		toggle() {
			const palette = props.palette
			if (!palette) return
			if (edition.checked) {
				paletteState.editing = undefined
				props.onEditStop?.()
				return
			}
			paletteState.editing = palette
		},
	}

	return (
		<div
			class={[
				'ak-palette-command-box',
				props.expanded ? 'is-expanded' : undefined,
				props.floating ? 'is-floating' : undefined,
			]}
		>
			<div class="ak-palette-command-box__shell" title={props.title}>
				<button
					if={props.editable && props.palette}
					type="button"
					class={[
						'ak-control-button',
						'ak-palette-command-box__edit',
						edition.checked ? 'is-active' : undefined,
					]}
					aria-label="Toggle palette editing"
					aria-pressed={edition.checked ? 'true' : 'false'}
					title="Toggle palette editing"
					onClick={() => edition.toggle()}
				>
					✎
				</button>
				<span else class="ak-palette-command-box__icon">
					{renderAnarkaiIcon(props.icon ?? '⌘')}
				</span>
				<div class="ak-palette-command-box__tokens">
					<for each={props.commandBox.categories.active}>
						{(category: string) => (
							<button
								type="button"
								class="ak-palette-command-box__token"
								title={`Filter by category: ${category}`}
								onClick={() => props.commandBox.categories.toggle(category)}
								onKeydown={(event) =>
									handlePaletteCommandChipKeydown({
										commandBox: props.commandBox,
										event,
										token: category,
										type: 'category',
									})
								}
							>
								#{category}
							</button>
						)}
					</for>
					<for each={props.commandBox.keywords.tokens}>
						{(token: { keyword: string }) => (
							<button
								type="button"
								class="ak-palette-command-box__token"
								title={`Remove keyword: ${token.keyword}`}
								onClick={() => props.commandBox.keywords.removeToken(token.keyword)}
								onKeydown={(event) =>
									handlePaletteCommandChipKeydown({
										commandBox: props.commandBox,
										event,
										token: token.keyword,
									})
								}
							>
								{token.keyword}
							</button>
						)}
					</for>
					<input
						this={input}
						class="ak-palette-command-box__input"
						use={() => {
							if (input) props.onInputMount?.(input)
						}}
						value={props.commandBox.input.value}
						placeholder={props.commandBox.input.placeholder}
						onInput={(event) => setPaletteCommandBoxInput(props.commandBox, event)}
						onFocus={() => props.onInputFocus?.()}
						onBlur={(event) => props.onInputBlur?.(event)}
						onKeydown={(event) => {
							const handled = handlePaletteCommandBoxInputKeydown({
								commandBox: props.commandBox,
								event,
								onAfterExecute: () => {
									if (!props.selectOnPick) props.onEscapeOrExecute?.()
								},
							})
							if (handled && event.key === 'Enter' && props.selectOnPick) {
								const entry = props.commandBox.selection.item
								if (entry) props.onEntryPick?.(entry.id)
							}
							if (event.key === 'Escape') props.onEscapeOrExecute?.()
							return handled
						}}
					/>
				</div>
			</div>
			<div if={props.expanded} class="ak-palette-command-box__popover">
				<for
					each={props.commandBox.results.slice(
						0,
						edition.checked ? Math.min(props.commandBox.results.length, 24) : 6
					)}
				>
					{(entry: {
						id: string
						icon?: string
						label: string
						meta?: string
						can?: boolean
						catalogDrag?: PaletteCatalogDragPayload
					}) => {
						const resultClass = [
							'ak-palette-command-box__result',
							props.commandBox.selection.item?.id === entry.id ? 'is-selected' : undefined,
							edition.checked ? 'is-catalog' : undefined,
						]
						const titleText = paletteCommandResultTitle(entry)
						const startCatalogDrag = (event: DragEvent) => {
							const palette = props.palette
							const payload = entry.catalogDrag ?? {
								kind: 'spec' as const,
								spec: entry.id,
							}
							const serialized = serializePaletteCatalogDragPayload(payload)
							event.dataTransfer?.setData(PALETTE_CATALOG_DRAG_MIME, serialized)
							event.dataTransfer?.setData('text/plain', entry.id)
							if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy'
							if (palette && event.dataTransfer) {
								const item = paletteCatalogItem(palette, payload)
								beginCatalogInsertDrag(palette, item, {
									x: event.clientX,
									y: event.clientY,
								})
							}
							const row = event.currentTarget
							if (row instanceof HTMLElement && event.dataTransfer) {
								const ghost = row.cloneNode(true) as HTMLElement
								ghost.style.cssText =
									'position:fixed;left:-9999px;top:0;pointer-events:none;opacity:0.92;max-width:min(90vw,22rem);'
								document.body.appendChild(ghost)
								event.dataTransfer.setDragImage(ghost, event.offsetX, event.offsetY)
								queueMicrotask(() => ghost.remove())
							}
						}
						const attachCatalogDrag = (node: Node | readonly Node[]) => {
							const el = node instanceof HTMLElement ? node : undefined
							if (!el) return
							el.draggable = true
							const listener = (event: DragEvent) => {
								startCatalogDrag(event)
							}
							el.addEventListener('dragstart', listener)
							return () => {
								el.removeEventListener('dragstart', listener)
								el.draggable = false
							}
						}
						const inner = (
							<>
								<span class="ak-palette-command-box__result-icon">
									{renderAnarkaiIcon(entry.icon)}
								</span>
								<span class="ak-palette-command-box__result-label">{entry.label}</span>
								<span if={entry.meta} class="ak-palette-command-box__result-meta">
									{entry.meta}
								</span>
							</>
						)
						if (edition.checked) {
							return (
								<div
									role="button"
									tabIndex={0}
									class={resultClass}
									title={titleText}
									use={attachCatalogDrag}
									onClick={() => {
										props.commandBox.select(entry.id)
									}}
									onKeydown={(event: KeyboardEvent) => {
										if (event.key === 'Enter' || event.key === ' ') {
											event.preventDefault()
											props.commandBox.select(entry.id)
										}
									}}
								>
									{inner}
								</div>
							)
						}
						return (
							<button
								type="button"
								class={resultClass}
								title={titleText}
								disabled={entry.can === false}
								onClick={() => {
									if (props.selectOnPick) {
										props.commandBox.select(entry.id)
										props.onEntryPick?.(entry.id)
										return
									}
									props.commandBox.execute(entry.id)
									props.onEscapeOrExecute?.()
								}}
							>
								{inner}
							</button>
						)
					}}
				</for>
			</div>
		</div>
	)
}

export function commandBoxScopeExtras<TSchema extends AnarkaiPaletteSchema>(
	scope: PaletteScope<TSchema>
): AnarkaiPaletteScopeExtras {
	return scope as PaletteScope<TSchema> & AnarkaiPaletteScopeExtras
}

export function AnarkaiCommandBoxEditor(context: {
	scope: PaletteScope<AnarkaiPaletteSchema>
	item: unknown
}) {
	const extras = commandBoxScopeExtras(context.scope)
	const commandBox = extras.commandBox
	const ui = reactive({ focused: false })
	let root: HTMLDivElement | undefined
	if (!commandBox) return <div>Provide `scope.commandBox`.</div>
	return (
		<div this={root}>
			<AnarkaiPaletteCommandBox
				commandBox={commandBox}
				editable={extras.commandBoxEditable}
				palette={
					context.scope.palette as AnarkaiPaletteCommandBoxPalette | undefined
				}
				icon={extras.commandBoxIcon ?? '⌘'}
				expanded={extras.commandBoxExpanded ?? ui.focused}
				floating={extras.commandBoxFloating ?? true}
				selectOnPick={extras.commandBoxSelectOnPick}
				onEntryPick={extras.onCommandBoxEntryPick}
				onSuggestionPick={extras.onCommandBoxSuggestionPick}
				onInputMount={extras.onCommandBoxInputMount}
				onEscapeOrExecute={() => {
					ui.focused = false
					extras.onCommandBoxEscapeOrExecute?.()
				}}
				onInputFocus={() => {
					ui.focused = true
					extras.onCommandBoxFocus?.()
				}}
				onInputBlur={(event) => {
					const next = event.relatedTarget instanceof Node ? event.relatedTarget : undefined
					if (next && root?.contains(next)) return
					ui.focused = false
					extras.onCommandBoxBlur?.(event)
				}}
			/>
		</div>
	)
}
