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
	appState,
	unreactiveInfo,
} from '@app/lib/globals'
import CharacterProperties from '../components/CharacterProperties'
import TileProperties from '../components/TileProperties'
import { toWorldCoord } from '@ssh/lib/utils/position' // Added import for GoTo logic
import { Button, ButtonGroup } from 'pounce-ui/src' // Added import for buttons
import { mdiEye, mdiPin, mdiPencil } from 'pure-glyf/icons'

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
		params: { uid?: string }
		api: any
		title: string
		size: { width: number; height: number }
	},
	scope: any
) => {
	console.log('SelectionInfoWidget Rendered with props:', props);
	let game: any
	try {
		game = games.game('GameX')
	} catch (e) {
		console.warn('SelectionInfoWidget: GameX not found', e)
	}

	const state = reactive({
		object: undefined as InteractiveGameObject | undefined,
		logs: [] as string[],
	})

	const logsRef: { value: HTMLElement | undefined } = { value: undefined }

	let stopLogs: (() => void) | undefined
	// TODO: if !shownUid, close this widget

	effect(() => {
		const shownUid = props.params.uid ?? selectionState.selectedUid
		state.object = shownUid ? game.getObject(shownUid) : undefined
	})

	const pin = () => {
		props.params.uid = selectionState.selectedUid
		unreactiveInfo.hasLastSelectedInfoPanel = false
	}
	scope.setTitle = (title: string) => {
		props.title = title
	}

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
		if (!state.object?.position) return
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
			<div style="padding: 0.5rem; border-bottom: 1px solid var(--app-border); display: flex; justify-content: space-between;">
				<div></div>
				<ButtonGroup>
					<Button if={state.object?.position} icon={mdiEye} aria-label="Go to Object" onClick={goTo} />
					<Button if={!props.params.uid} icon={mdiPin} aria-label="Pin Panel" onClick={pin} />
					<Button icon={mdiPencil} aria-label="Debug Set Title" onClick={() => scope.setTitle('Debug Title')} />
				</ButtonGroup>
			</div>
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
