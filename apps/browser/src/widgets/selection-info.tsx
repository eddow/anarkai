import { css } from '@app/lib/css'
import {
	clearFollowSelectionPanel,
	registerPinnedInspectorPanel,
	unregisterPinnedInspectorPanel,
} from '@app/lib/follow-selection'
import { game, mrg, selectionState } from '@app/lib/globals'
import { InspectorSection, Panel } from '@app/ui/anarkai'
import type { DockviewWidgetProps, DockviewWidgetScope } from '@sursaut/ui/dockview'
import { effect } from 'mutts'
import { Tile } from 'ssh/board/tile'
import {
	freightLineIdFromUid,
	isFreightLineUid,
	type SyntheticFreightLineObject,
} from 'ssh/freight/freight-line'
import type { InspectorSelectableObject, InteractiveGameObject } from 'ssh/game/object'
import { resolveSelectableHoverObject } from 'ssh/game/object'
import {
	hiveInspectorTitle,
	isHiveUid,
	resolveHiveFromAnchorTile,
	type SyntheticHiveObject,
} from 'ssh/hive'
import { isHoveredObject, setHoveredObject } from 'ssh/interactive-state'
import { Character } from 'ssh/population/character'
import { toWorldCoord } from 'ssh/utils/position'
import CharacterProperties from '../components/CharacterProperties'
import FreightLineProperties from '../components/FreightLineProperties'
import HiveProperties from '../components/HiveProperties'
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
	let isPanelHovered = false
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
	const resolvePanelTitle = () => {
		const object = current.object
		if (!object) return 'Object'
		const uid = current.uid
		if (!uid) return object.title ?? 'Object'

		if (isFreightLineUid(uid)) {
			const lineId = freightLineIdFromUid(uid)
			const lines = game.freightLines
			const line =
				lineId && Array.isArray(lines) ? lines.find((entry) => entry.id === lineId) : undefined
			if (line) {
				const modeLabel = line.mode[0].toUpperCase() + line.mode.slice(1)
				return `${line.name} (${modeLabel})`
			}
		}

		if (
			isHiveUid(uid) &&
			'anchorTileUid' in object &&
			game.objects &&
			typeof game.objects.get === 'function'
		) {
			const hive = resolveHiveFromAnchorTile(game, object.anchorTileUid)
			return hiveInspectorTitle(hive)
		}

		return object.title ?? 'Object'
	}

	const pin = () => {
		const uid = selectionState.selectedUid
		if (!uid) return
		api.updateParameters({ uid })
		props.params.uid = uid
		registerPinnedInspectorPanel(api.id, uid)
		props.context.tools = (props.context.tools ?? []).filter(
			(tool) => tool.ariaLabel !== 'Pin Panel'
		)
		clearFollowSelectionPanel(api.id)
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
		selectionState.titleVersion
		props.title = resolvePanelTitle()
	})

	effect`selection-info:hovered-object`(() => {
		const hoverObject = resolveSelectableHoverObject(
			current.object as InspectorSelectableObject | InteractiveGameObject | undefined
		)
		props.context.hoveredObject = hoverObject
		if (isPanelHovered && hoverObject) {
			setHoveredObject(hoverObject)
		}
		return () => {
			if (props.context.hoveredObject === hoverObject) {
				props.context.hoveredObject = undefined
			}
			if (isPanelHovered && isHoveredObject(hoverObject)) {
				mrg.hoveredObject = undefined
			}
		}
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
	effect`selection-info:pinned-panel-registration`(() => {
		const uid = props.params.uid
		if (!uid) return
		registerPinnedInspectorPanel(api.id, uid)
		return () => unregisterPinnedInspectorPanel(api.id, uid)
	})
	effect`selection-info:panel-cleanup`(() => {
		const disposable = scope.dockviewApi!.onDidRemovePanel((panel) => {
			if (panel.id === api.id) {
				unregisterPinnedInspectorPanel(api.id, props.params.uid)
				// If this panel was the one tracking active selection (not pinned)
				// Reset the flag so selection in game can re-open it.
				if (!props.params.uid) {
					clearFollowSelectionPanel(api.id)
				}
			}
		})
		return () => disposable.dispose()
	})

	const attachHoverTracking = (element: HTMLElement) => {
		const handleMove = () => {
			isPanelHovered = true
			const hoverObject = resolveSelectableHoverObject(
				current.object as InspectorSelectableObject | InteractiveGameObject | undefined
			)
			if (hoverObject) setHoveredObject(hoverObject)
		}
		const handleLeave = () => {
			isPanelHovered = false
			const hoverObject = resolveSelectableHoverObject(
				current.object as InspectorSelectableObject | InteractiveGameObject | undefined
			)
			if (isHoveredObject(hoverObject)) {
				mrg.hoveredObject = undefined
			}
		}

		element.addEventListener('mousemove', handleMove)
		element.addEventListener('mouseleave', handleLeave)

		return () => {
			element.removeEventListener('mousemove', handleMove)
			element.removeEventListener('mouseleave', handleLeave)
		}
	}

	return (
		<div
			class="selection-info-panel"
			use={attachHoverTracking}
			data-test-object-uid={current.object?.uid}
		>
			<div if={current.object} class="selection-info-panel__content-wrapper">
				<div class="selection-info-panel__content">
					{current.object instanceof Character ? (
						<CharacterProperties character={current.object as Character} />
					) : current.object instanceof Tile ? (
						<TileProperties tile={current.object as Tile} />
					) : current.object && isFreightLineUid(current.object.uid) ? (
						<FreightLineProperties lineObject={current.object as SyntheticFreightLineObject} />
					) : current.object && isHiveUid(current.object.uid) ? (
						<HiveProperties hiveObject={current.object as SyntheticHiveObject} />
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
