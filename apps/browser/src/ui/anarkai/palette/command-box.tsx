import { renderAnarkaiIcon } from '@app/ui/anarkai/icons'
import type { PaletteCommandBoxModel, PaletteSchema, PaletteScope } from '@sursaut/ui/palette'
import {
	handlePaletteCommandBoxInputKeydown,
	handlePaletteCommandChipKeydown,
	palettes,
	setPaletteCommandBoxInput,
} from '@sursaut/ui/palette'
import { reactive, unwrap } from 'mutts'
import type { AnarkaiPaletteSchema } from './types'

export type AnarkaiPaletteCommandBoxProps<TSchema extends PaletteSchema = AnarkaiPaletteSchema> = {
	readonly commandBox: PaletteCommandBoxModel
	readonly editable?: boolean
	readonly palette?: NonNullable<PaletteScope<TSchema>['palette']>
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
	readonly selectOnPick?: boolean
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

export function AnarkaiPaletteCommandBox<TSchema extends PaletteSchema = AnarkaiPaletteSchema>(
	props: AnarkaiPaletteCommandBoxProps<TSchema>
) {
	let input: HTMLInputElement | undefined
	const paletteState = palettes as {
		editing?: NonNullable<PaletteScope<TSchema>['palette']>
	}
	const edition = {
		get checked() {
			const palette = props.palette
			return Boolean(palette && unwrap(paletteState.editing) === unwrap(palette))
		},
		toggle() {
			const palette = props.palette
			if (!palette) return
			paletteState.editing = edition.checked ? undefined : palette
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
				<for each={props.commandBox.results.slice(0, 6)}>
					{(entry: { id: string; icon?: string; label: string; meta?: string; can?: boolean }) => (
						<button
							type="button"
							class={[
								'ak-palette-command-box__result',
								props.commandBox.selection.item?.id === entry.id ? 'is-selected' : undefined,
							]}
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
							<span class="ak-palette-command-box__result-icon">
								{renderAnarkaiIcon(entry.icon)}
							</span>
							<span class="ak-palette-command-box__result-label">{entry.label}</span>
							<span if={entry.meta} class="ak-palette-command-box__result-meta">
								{entry.meta}
							</span>
						</button>
					)}
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
					context.scope.palette as
						| NonNullable<PaletteScope<AnarkaiPaletteSchema>['palette']>
						| undefined
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
