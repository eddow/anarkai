import { css } from '@app/lib/css'
import { game, mrg, selectionState, unreactiveInfo } from '@app/lib/globals'
import { InspectorSection, Panel } from '@app/ui/anarkai'
import type { DockviewWidgetProps, DockviewWidgetScope } from '@sursaut/ui/dockview'
import { effect } from 'mutts'
import { Tile } from 'ssh/board/tile'
import { Character } from 'ssh/population/character'
import { toWorldCoord } from 'ssh/utils/position'
import CharacterProperties from '../components/CharacterProperties'
import TileProperties from '../components/TileProperties'
import type { SelectionInfoContext, SelectionInfoTool } from './selection-info-tab'

css`
.selection-info-panel {
	display: flex;
	flex-direction: column;
	gap: 0;
	height: 100%;
	color: var(--ak-text);
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
	padding: 0;
	overflow-y: auto;
	display: flex;
	flex-direction: column;
	resize: vertical;
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

const SelectionInfoWidget = (
	props: DockviewWidgetProps<{ uid?: string }, SelectionInfoContext>,
	scope: DockviewWidgetScope
) => {
	const api = (scope as any).panelApi
	scope.setTitle = (title: string) => {
		props.title = title
	}
	const current = {
		get uid() {
			return props.params.uid ?? selectionState.selectedUid
		},
		get object() {
			const uid = this.uid
			return uid ? game.getObject(uid) : undefined
		},
		get logs() {
			return this.object?.logs ?? []
		},
	}

	const pin = () => {
		const uid = selectionState.selectedUid
		if (!uid) return
		api.updateParameters({ uid })
		props.params.uid = uid
		props.context.tools = (props.context.tools ?? []).filter(
			(tool) => tool.ariaLabel !== 'Pin Panel'
		)
		unreactiveInfo.hasLastSelectedInfoPanel = false
	}

	const goTo = () => {
		const object = current.object
		if (!object?.position) return
		const coord = toWorldCoord(object.position)
		if (!coord) return

		const renderer = game.renderer as any
		if (!renderer || !renderer.world || !renderer.app) return

		const { screen } = renderer.app
		const { world } = renderer
		const scale = world.scale.x

		world.position.x = screen.width / 2 - coord.x * scale
		world.position.y = screen.height / 2 - coord.y * scale
	}

	effect`selection-info:title`(() => {
		props.title = current.object?.title ?? 'Object'
	})

	effect`selection-info:tools`(() => {
		const tools: SelectionInfoTool[] = []
		if (current.object?.position) {
			tools.push({
				ariaLabel: 'Go to Object',
				icon: '👁',
				onClick: goTo,
			})
		}
		if (!props.params.uid) {
			tools.push({
				ariaLabel: 'Pin Panel',
				icon: '📌',
				onClick: pin,
			})
		}
		props.context.tools = tools
		return () => {
			if (props.context.tools === tools) props.context.tools = []
		}
	})
	effect`selection-info:panel-cleanup`(() => {
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

	return (
		<div
			class="selection-info-panel"
			onMouseenter={() => {
				const object = current.object
				if (object) mrg.hoveredObject = object
			}}
			onMouseleave={() => {
				if (mrg.hoveredObject?.uid === current.object?.uid) {
					mrg.hoveredObject = undefined
				}
			}}
			data-test-object-uid={current.object?.uid}
		>
			<div if={current.object} class="selection-info-panel__content-wrapper">
				<div class="selection-info-panel__content">
					{current.object instanceof Character ? (
						<CharacterProperties character={current.object as Character} />
					) : current.object instanceof Tile ? (
						<TileProperties tile={current.object as Tile} />
					) : (
						<InspectorSection
							class="selection-info-panel__summary"
							title={current.object!.title ?? 'Object'}
						>
							<p>ID: {current.object!.uid}</p>
						</InspectorSection>
					)}
				</div>
				<InspectorSection
					if={current.logs.length}
					title="Logs"
					class="selection-info-panel__logs-section"
				>
					<Panel
						class="selection-info-panel__logs"
						el:role="log"
						el:data-test-owner-uid={current.object?.uid}
					>
						<div class="selection-info-panel__logs-list">
							<for each={current.logs}>
								{(line) => (
									<div class="selection-info-panel__logs-line" title={line}>
										{line}
									</div>
								)}
							</for>
						</div>
					</Panel>
				</InspectorSection>
			</div>
			<div else class="selection-info-panel__empty">
				Select an object in the game view to inspect it.
			</div>
		</div>
	)
}

export default SelectionInfoWidget
