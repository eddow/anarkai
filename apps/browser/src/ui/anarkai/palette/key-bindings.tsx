import {
	createPaletteKeys,
	normalizePaletteKeystroke,
	type PaletteCommandBoxEntry,
	type PaletteKeyBinding,
	type PaletteKeys,
	paletteKeystrokeFromEvent,
} from '@sursaut/ui/palette'
import { reactive, untracked } from 'mutts'

type AnarkaiPaletteKeyBindingRow = {
	readonly id: string
	readonly keystroke: string
	readonly commandId: string
}

type AnarkaiPaletteKeyBindingsTarget = {
	readonly keys: PaletteKeys
}

export type AnarkaiPaletteKeyBindingsEditorProps = {
	readonly palette: AnarkaiPaletteKeyBindingsTarget
	readonly entries?: readonly PaletteCommandBoxEntry[] | (() => readonly PaletteCommandBoxEntry[])
	readonly emptyLabel?: string
}

let nextAnarkaiPaletteKeyBindingRowId = 0

function nextBindingRowId(): string {
	nextAnarkaiPaletteKeyBindingRowId += 1
	return `palette-keybinding-${nextAnarkaiPaletteKeyBindingRowId}`
}

function rowsFromBindings(bindings: PaletteKeyBinding): AnarkaiPaletteKeyBindingRow[] {
	return Object.entries(bindings)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([keystroke, commandId]) => ({
			id: nextBindingRowId(),
			keystroke,
			commandId,
		}))
}

function replacePaletteBindings(
	palette: AnarkaiPaletteKeyBindingsTarget,
	rows: readonly AnarkaiPaletteKeyBindingRow[]
): void {
	const nextBindings: PaletteKeyBinding = {}
	for (const row of rows) {
		if (!row.keystroke || !row.commandId) continue
		nextBindings[row.keystroke] = row.commandId
	}
	const normalized = createPaletteKeys(nextBindings).bindings
	const target = palette.keys.bindings as PaletteKeyBinding
	for (const keystroke of Object.keys(target)) delete target[keystroke]
	Object.assign(target, normalized)
}

function capturedKeystroke(event: KeyboardEvent): string | undefined {
	if (event.key === 'Tab') return undefined
	if (event.key === 'Backspace' || event.key === 'Delete') return ''
	if (['Alt', 'Control', 'Meta', 'Shift'].includes(event.key)) return undefined
	return paletteKeystrokeFromEvent(event)
}

export function AnarkaiPaletteKeyBindingsEditor(props: AnarkaiPaletteKeyBindingsEditorProps) {
	const view = {
		get commands() {
			const source = props.entries
			if (typeof source === 'function') return source()
			return source ?? []
		},
		commandLabel(commandId: string) {
			const entry = this.commands.find((candidate) => candidate.id === commandId)
			return entry ? (entry.meta ? `${entry.label} - ${entry.meta}` : entry.label) : commandId
		},
		get emptyLabel() {
			return props.emptyLabel ?? 'No palette commands available.'
		},
		get hasCommands() {
			return this.commands.length > 0
		},
	}
	const state = reactive({
		recordingRowId: '',
		rows: untracked`anarkai-palette-keybindings-init`(() =>
			rowsFromBindings(props.palette.keys.bindings)
		),
	})
	const syncRows = () => {
		state.rows = untracked`anarkai-palette-keybindings-sync`(() =>
			rowsFromBindings(props.palette.keys.bindings)
		)
	}
	const commitRows = () => {
		replacePaletteBindings(props.palette, state.rows)
		syncRows()
	}
	const setRowCommand = (rowId: string, commandId: string) => {
		state.rows = state.rows.map((row) => (row.id === rowId ? { ...row, commandId } : { ...row }))
		commitRows()
	}
	const setRowKeystroke = (rowId: string, keystroke: string) => {
		const normalized = keystroke ? normalizePaletteKeystroke(keystroke) : ''
		state.rows = state.rows
			.filter(
				(row) =>
					row.id === rowId ||
					normalized.length === 0 ||
					normalizePaletteKeystroke(row.keystroke) !== normalized
			)
			.map((row) => (row.id === rowId ? { ...row, keystroke: normalized } : { ...row }))
		state.recordingRowId = ''
		commitRows()
	}
	const addRow = () => {
		const firstCommand = view.commands[0]
		if (!firstCommand) return
		state.rows = [
			...state.rows.map((row) => ({ ...row })),
			{
				id: nextBindingRowId(),
				keystroke: '',
				commandId: firstCommand.id,
			},
		]
	}
	const removeRow = (rowId: string) => {
		state.rows = state.rows.filter((row) => row.id !== rowId).map((row) => ({ ...row }))
		if (state.recordingRowId === rowId) state.recordingRowId = ''
		commitRows()
	}
	return (
		<div class="ak-palette-keybindings">
			<p class="ak-palette-keybindings__hint">
				Click a shortcut row, then press the keys you want to bind.
			</p>
			<p if={!view.hasCommands} class="ak-palette-keybindings__empty">
				{view.emptyLabel}
			</p>
			<p if={view.hasCommands && state.rows.length === 0} class="ak-palette-keybindings__empty">
				No key bindings yet.
			</p>
			<div if={view.hasCommands} class="ak-palette-keybindings__list">
				<for each={state.rows}>
					{(row: AnarkaiPaletteKeyBindingRow) => (
						<div class="ak-palette-keybindings__row">
							<button
								type="button"
								class={[
									'ak-palette-keybindings__capture',
									state.recordingRowId === row.id ? 'is-recording' : undefined,
								]}
								data-role="palette-keybinding-capture"
								title={view.commandLabel(row.commandId)}
								onClick={() => {
									state.recordingRowId = state.recordingRowId === row.id ? '' : row.id
								}}
								onBlur={() => {
									if (state.recordingRowId === row.id) state.recordingRowId = ''
								}}
								onKeydown={(event: KeyboardEvent) => {
									const keystroke = capturedKeystroke(event)
									if (keystroke === undefined) return
									event.preventDefault()
									event.stopPropagation()
									setRowKeystroke(row.id, keystroke)
								}}
							>
								{state.recordingRowId === row.id
									? 'Press shortcut...'
									: row.keystroke || 'Press shortcut'}
							</button>
							<select
								class="ak-palette-keybindings__command"
								data-role="palette-keybinding-command"
								value={row.commandId}
								onChange={(event: Event) => {
									const target = event.currentTarget
									if (!(target instanceof HTMLSelectElement)) return
									setRowCommand(row.id, target.value)
								}}
							>
								<for each={view.commands}>
									{(entry: PaletteCommandBoxEntry) => (
										<option value={entry.id}>
											{entry.meta ? `${entry.label} - ${entry.meta}` : entry.label}
										</option>
									)}
								</for>
							</select>
							<button
								type="button"
								class="ak-palette-keybindings__remove"
								data-role="palette-keybinding-remove"
								aria-label={`Remove ${row.keystroke || 'new'} binding`}
								onClick={() => removeRow(row.id)}
							>
								×
							</button>
						</div>
					)}
				</for>
			</div>
			<button
				type="button"
				class="ak-palette-keybindings__add"
				data-role="palette-keybinding-add"
				disabled={!view.hasCommands}
				onClick={() => addRow()}
			>
				Add binding
			</button>
		</div>
	)
}
