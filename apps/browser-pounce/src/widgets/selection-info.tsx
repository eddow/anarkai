import { reactive, effect } from 'mutts'

import type { Game } from 'ssh/game'
import { css } from '@app/lib/css'
import { Character } from 'ssh/population/character'
import { Tile } from 'ssh/board/tile'
import {
	games,
	selectionState,
	mrg,
	unreactiveInfo,
} from '@app/lib/globals'
import type { DockviewWidgetProps, DockviewWidgetScope } from '@pounce'
import CharacterProperties from '../components/CharacterProperties'
import TileProperties from '../components/TileProperties'
import { toWorldCoord } from 'ssh/utils/position' // Added import for GoTo logic
import { Button, ButtonGroup, InfiniteScroll } from '@pounce' // Added import for buttons

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
    padding: 0;
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
	padding: 0;
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
	line-height: 20px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    padding: 0 0.5rem;
}

.selection-info-panel__empty {
	font-size: 0.9rem;
	opacity: 0.75;
    padding: 0;
}
`

const SelectionInfoWidget = (props: DockviewWidgetProps<{ uid?: string }>, scope: DockviewWidgetScope) => {
	const api = (scope as any).panelApi
	console.log('SelectionInfoWidget Rendered with props:', props);
	let game: Game
	try {
		game = games.game('GameX')
	} catch (e) {
		console.warn('SelectionInfoWidget: GameX not found', e)
	}
	scope.setTitle = (title: string) => {
		props.title = title
	}
	const state = reactive({
	get object() {
		const uid = props.params.uid ?? selectionState.selectedUid
		return uid ? game.getObject(uid) : undefined
	},
	get logs() {
		return this.object?.logs ?? []
	},
})




	// TODO: if !shownUid, close this widget

	const pin = () => {
		const uid = selectionState.selectedUid
		api.updateParameters({ uid })
		props.params.uid = uid
		unreactiveInfo.hasLastSelectedInfoPanel = false
	}
	effect(() => {
		props.title = state.object?.title ?? 'Object'
	})

	scope.setTitle = (title: string) => {
		props.title = title
	}
	effect(() => {
		const disposable = scope.dockviewApi!.onDidRemovePanel((panel) => {
			if (panel.id === api.id) {
				// If this panel was the one tracking active selection (not pinned)
				// Reset the flag so selection in game can re-open it.
				if (!props.params.uid) {
					unreactiveInfo.hasLastSelectedInfoPanel = false
				}
			}
		})
		return () => disposable.dispose()
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

	return (
		<div
			class="selection-info-panel"
			onMouseenter={() => {
				if (state.object) mrg.hoveredObject = state.object
			}}
			onMouseleave={() => {
				if (mrg.hoveredObject?.uid === state.object?.uid) {
					mrg.hoveredObject = undefined
				}
			}}
			data-test-object-uid={state.object?.uid}
		>
			<div style="border-bottom: 1px solid var(--app-border); display: flex; justify-content: space-between;">
				<div></div>
				<ButtonGroup>
					<Button if={state.object?.position} aria-label="Go to Object" onClick={goTo}>👁</Button>
					<Button if={!props.params.uid} aria-label="Pin Panel" onClick={pin}>📌</Button>
				</ButtonGroup>
			</div>
			<div if={state.object} class="selection-info-panel__content-wrapper">
				<div class="selection-info-panel__content">
					{state.object instanceof Character ? (
						<CharacterProperties character={state.object} />
					) : state.object instanceof Tile ? (
						<TileProperties tile={state.object} />
					) : (
						<div class="selection-info-panel__summary">
							<h3>{state.object!.title ?? 'Object'}</h3>
							<p>ID: {state.object!.uid}</p>
						</div>
					)}
				</div>
				<div if={state.logs.length > 0}
					class="selection-info-panel__logs"
					role="log"
					data-test-owner-uid={state.object?.uid}
				>
					<div class="selection-info-panel__logs-list">
						<InfiniteScroll
							items={state.logs}
							itemHeight={20}
						>
							{(line) => (
								<div class="selection-info-panel__logs-line" title={line}>
									{line}
								</div>
							)}
						</InfiniteScroll>
					</div>
				</div>
			</div>
			<div else class="selection-info-panel__empty">Select an object in the game view to inspect it.</div>
		</div>
	)
}

export default SelectionInfoWidget
