import { effect, reactive, watch, untracked } from 'mutts'

import type { InteractiveGameObject } from '@ssh/lib/game'
import { css } from '@app/lib/css'
import { Character } from '@ssh/lib/game/population/character'
import { Tile } from '@ssh/lib/game/board/tile'
import {
	games,
	registerObjectInfoPanel,
	selectionState,
	unregisterObjectInfoPanel,
	mrg,
} from '@app/lib/globals'
import CharacterProperties from '../components/CharacterProperties'
import TileProperties from '../components/TileProperties'

css`
.selection-info-panel {
	display: flex;
	flex-direction: column;
	gap: 0;
	height: 100%;
	color: var(--toolbar-text);
	box-sizing: border-box;
    background-color: var(--app-bg);
}

.selection-info-panel__content-wrapper {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 1rem;
    gap: 1rem;
    overflow-y: auto;
}

.selection-info-panel__summary h3 {
	margin: 0 0 0.35rem;
	font-size: 1.1rem;
	font-weight: 600;
}

.selection-info-panel__summary p {
	margin: 0;
	font-size: 0.9rem;
	opacity: 0.8;
}

.selection-info-panel__logs {
	flex: 1;
	min-height: 5rem;
	border: 1px solid var(--app-border);
	border-radius: 0.65rem;
	padding: 0.75rem;
	overflow-y: auto;
	background: rgba(15, 23, 42, 0.08);
    display: flex;
    flex-direction: column;
	resize: vertical;
}

.dark .selection-info-panel__logs {
	background: rgba(148, 163, 184, 0.12);
}

.selection-info-panel__logs-line {
	font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
	font-size: 0.8rem;
	line-height: 1.4;
    word-break: break-all;
    white-space: pre-wrap;
}

.selection-info-panel__empty {
	font-size: 0.9rem;
	opacity: 0.75;
    padding: 1rem;
}
`

const SelectionInfoWidget = (
	props: {
		params?: { uid?: string }
		api: any
		title: string
		size: { width: number; height: number }
	},
) => {
	const game = games.game('GameX')
	const state = reactive({
		object: undefined as InteractiveGameObject | undefined,
		logs: [] as string[],
		isPinned: false,
	})

	const logsRef: { value: HTMLElement | undefined } = { value: undefined }

	let stopLogs: (() => void) | undefined

	const fallbackPanelId = props.api?.id ?? 'selection-info'

	effect(() => {
		const pinnedUid = props.params?.uid
		state.isPinned = Boolean(pinnedUid)
		if (pinnedUid) {
			registerObjectInfoPanel(pinnedUid, fallbackPanelId)
			return () => {
				unregisterObjectInfoPanel(pinnedUid)
			}
		}
		selectionState.panelId = fallbackPanelId
		return () => {
			if (selectionState.panelId === fallbackPanelId) selectionState.panelId = undefined
		}
	})

	effect(() => {
		const uid = props.params?.uid ?? selectionState.selectedUid
		if (!uid) {
			state.object = undefined
			state.logs = []
			// Use untracked to avoid cycle if setTitle triggers re-evaluation of props
			untracked(() => props.api?.setTitle('Selection'))
			return
		}
		const object = game.getObject(uid)
		state.object = object
		untracked(() => props.api?.setTitle(object?.title ?? 'Selection'))
	})

	effect(() => {
		stopLogs?.()
		const object = state.object
		if (!object) {
			state.logs = []
			stopLogs = undefined
			return
		}
		stopLogs = watch(object.logs, (entries: string[]) => {
			state.logs = [...entries]
			// Scroll to bottom
			setTimeout(() => {
				if (logsRef.value) {
					logsRef.value.scrollTop = logsRef.value.scrollHeight
				}
			}, 10)
		})
		return () => {
			stopLogs?.()
			stopLogs = undefined
		}
	})

	// Sync state to parameters for HeaderActions
	effect(() => {
		if (!props.api) return
		const object = state.object
		const isPinned = state.isPinned

		// Update parameters without triggering a re-render loop if possible
		// We only need to update when these change
		const currentParams = props.api.params || {}

		// Check if we need update
		const hasPosition = object?.position != null
		if (currentParams.uid !== object?.uid || currentParams.isPinned !== isPinned || currentParams.hasPosition !== hasPosition) {
			props.api.updateParameters({
				uid: object?.uid,
				isPinned,
				hasPosition
			})
		}
	})

	const simulateEnter = () => {
		if (state.object) {
			mrg.hoveredObject = state.object
		}
	}

	const simulateLeave = () => {
		if (mrg.hoveredObject?.uid === state.object?.uid) {
			mrg.hoveredObject = undefined
		}
	}

	const attachHoverHandlers = (el: HTMLElement) => {
		el.addEventListener('mouseenter', simulateEnter)
		el.addEventListener('mouseleave', simulateLeave)
		return () => {
			el.removeEventListener('mouseenter', simulateEnter)
			el.removeEventListener('mouseleave', simulateLeave)
		}
	}

	return (
		<div
			class="selection-info-panel"
			use={attachHoverHandlers}
		>
			{state.object ? (
				<div class="selection-info-panel__content-wrapper">
					<div class="selection-info-panel__content">
						{state.object instanceof Character ? (
							<CharacterProperties character={state.object} />
						) : state.object instanceof Tile ? (
							<TileProperties tile={state.object} />
						) : (
							<div class="selection-info-panel__summary">
								<h3>{state.object.title ?? 'Object'}</h3>
								<p>ID: {state.object.uid}</p>
							</div>
						)}
					</div>
					{state.logs.length > 0 && (
						<div
							class="selection-info-panel__logs"
							role="log"
							use={(el: any) => logsRef.value = el}
						>
							{state.logs.map((line) => (
								<div class="selection-info-panel__logs-line">
									{line}
								</div>
							))}
						</div>
					)}
				</div>
			) : (
				<div class="selection-info-panel__empty">Select an object in the game view to inspect it.</div>
			)}
		</div>
	)
}

export default SelectionInfoWidget
