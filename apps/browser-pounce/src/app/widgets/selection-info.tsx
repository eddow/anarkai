import { effect, reactive, watch } from 'mutts'

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
import { Button, Toolbar } from 'pounce-ui/src'
import { toWorldCoord } from '@ssh/lib/utils/position'

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
			props.api?.setTitle('Selection')
			return
		}
		const object = game.getObject(uid)
		state.object = object
		props.api?.setTitle(object?.title ?? 'Selection')
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

	const goTo = () => {
		if (!state.object || !state.object.position) return
		const coord = toWorldCoord(state.object.position)
		if (!coord) return

		const renderer = game.renderer as any
		if (!renderer || !renderer.world || !renderer.app) return

		const { screen } = renderer.app
		const { world } = renderer
		const scale = world.scale.x

		world.position.x = screen.width / 2 - coord.x * scale
		world.position.y = screen.height / 2 - coord.y * scale
	}

	const pin = () => {
		if (!state.object || !props.api) return
		const uid = state.object.uid

		registerObjectInfoPanel(uid, `pinned:${uid}`)

		// Improve: The Vue version closes the current panel using props.api.close(),
		// but here we might want to just let the Dockview logic handle it or 
		// if this is the dynamic panel, we might want to keep it open but switch it to pinned?
		// Actually, the Vue logic closes the dynamic 'info' panel, forcing the user to open a new one
		// or effectively "converting" it.
		// In browser-pounce `ensurePanel` checks for existing.
		// If we want to Spawn a NEW window, we should add a new panel.

		const dock = props.api.group?.dockview
		if (dock) {
			dock.addPanel({
				id: `pinned:${uid}`,
				component: 'selection-info',
				params: { uid },
				floating: { width: 300, height: 400 } // Default to floating for pinned
			})
		}

		props.api.close?.()
		// If we were the main panel, clear it so a new one can spawn
		if (selectionState.panelId === props.api.id) {
			selectionState.panelId = undefined
		}
	}

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
			<Toolbar>
				<div style="flex: 1; font-weight: 500; font-size: 0.9em; padding-left: 0.5rem;">
					{state.object?.title ?? 'Selection'}
				</div>
				{state.object && (
					<>
						<Button icon="mdi:eye" aria-label="Go to Object" onClick={goTo} />
						{!state.isPinned && (
							<Button icon="mdi:pin" aria-label="Pin Panel" onClick={pin} />
						)}
					</>
				)}
			</Toolbar>

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
