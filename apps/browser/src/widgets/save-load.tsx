import { css } from '@app/lib/css'
import { game } from '@app/lib/globals'
import { Button, InspectorSection } from '@app/ui/anarkai'
import type { DockviewWidgetProps, DockviewWidgetScope } from '@sursaut/ui/dockview'
import { reactive } from 'mutts'
import type { SaveState } from 'ssh/game'

css`
.save-load-widget {
	display: flex;
	flex-direction: column;
	gap: 0.75rem;
	padding: 0.75rem;
	height: 100%;
	box-sizing: border-box;
	color: var(--ak-text);
}

.save-load-widget__hint {
	margin: 0;
	font-size: 0.88rem;
	line-height: 1.4;
	color: var(--ak-text-muted);
}

.save-load-widget__textarea {
	flex: 1 1 auto;
	min-height: 12rem;
	resize: vertical;
	box-sizing: border-box;
	padding: 0.5rem;
	border: 1px solid var(--ak-border);
	border-radius: 0.35rem;
	background: var(--ak-surface-panel);
	color: var(--ak-text);
	font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
	font-size: 0.78rem;
	line-height: 1.45;
	white-space: pre;
	overflow: auto;
}

.save-load-widget__actions {
	display: flex;
	gap: 0.5rem;
	flex-wrap: wrap;
}

.save-load-widget__status {
	font-size: 0.85rem;
	line-height: 1.4;
	word-break: break-word;
}

.save-load-widget__status.is-ok {
	color: #15803d;
}

.save-load-widget__status.is-error {
	color: #dc2626;
}
`

const SaveLoadWidget = (props: DockviewWidgetProps<Record<string, never>>, scope: DockviewWidgetScope) => {
	void scope
	props.title = 'Save / Load'
	const state = reactive({
		text: '',
		status: '',
		statusKind: 'idle' as 'idle' | 'ok' | 'error',
		loading: false,
	})

	const setStatus = (message: string, kind: 'idle' | 'ok' | 'error' = 'idle') => {
		state.status = message
		state.statusKind = kind
	}

	const save = () => {
		try {
			const snapshot: SaveState = game.saveGameData()
			state.text = JSON.stringify(snapshot, null, 2)
			setStatus(
				`Saved ${snapshot.characters?.length ?? 0} characters, ${
					snapshot.hives?.length ?? 0
				} hives to the text area.`,
				'ok'
			)
		} catch (error) {
			setStatus(`Save failed: ${error instanceof Error ? error.message : String(error)}`, 'error')
		}
	}

	const load = async () => {
		const raw = state.text.trim()
		if (!raw) {
			setStatus('Nothing to load: the text area is empty.', 'error')
			return
		}
		let snapshot: SaveState
		try {
			snapshot = JSON.parse(raw) as SaveState
		} catch (error) {
			setStatus(
				`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
				'error'
			)
			return
		}
		state.loading = true
		setStatus('Loading…')
		try {
			await game.loadGameData(snapshot)
			setStatus('Game loaded.', 'ok')
		} catch (error) {
			setStatus(`Load failed: ${error instanceof Error ? error.message : String(error)}`, 'error')
		} finally {
			state.loading = false
		}
	}

	return (
		<div class="save-load-widget">
			<InspectorSection title="Edit save state">
				<p class="save-load-widget__hint">
					Save copies the live game state into the text area as JSON. Edit it, then Load to
					reload the game from that JSON.
				</p>
				<div class="save-load-widget__actions">
					<Button onClick={save}>Save</Button>
					<Button onClick={load} disabled={state.loading}>
						{state.loading ? 'Loading…' : 'Load'}
					</Button>
				</div>
				<textarea
					class="save-load-widget__textarea"
					placeholder='Click "Save" to capture the game state as JSON…'
					aria-label="Save state JSON"
					spellCheck={false}
					value={state.text}
				/>
				<div
					if={state.status}
					class={[
						'save-load-widget__status',
						state.statusKind === 'ok'
							? 'is-ok'
							: state.statusKind === 'error'
								? 'is-error'
								: undefined,
					]}
				>
					{state.status}
				</div>
			</InspectorSection>
		</div>
	)
}

export default SaveLoadWidget
