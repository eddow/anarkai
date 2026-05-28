import { css } from '@app/lib/css'
import { showProps } from '@app/lib/follow-selection'
import { isFreightAddStopAction, tryConsumeFreightMapPick } from '@app/lib/freight-map-pick'
import {
	game,
	hivePlanPlacementState,
	interactionMode,
	mrg,
	selectionState,
	validateStoredSelectionState,
} from '@app/lib/globals'
import { consumePresentationEvents } from '@app/lib/presentation-events'
import type { DockviewWidgetProps, DockviewWidgetScope } from '@sursaut/ui/dockview'
import { PixiGameRenderer } from 'engine-pixi/renderer'
import { effect } from 'mutts'
import type { RoadType } from 'ssh/board/roads'
import { Tile } from 'ssh/board/tile'
import { traces } from 'ssh/dev/debug'
import type { GamePresentationEvent, InteractiveGameObject } from 'ssh/game'
import type { AlveolusType } from 'ssh/types/base'
import { toAxialCoord } from 'ssh/utils/position'

css`
	.dockview-widget--game {
		width: 100%;
		height: 100%;
		background-color: var(--app-bg);
	}
`

export default function GameWidget(
	props: DockviewWidgetProps<Record<string, never>>,
	scope: DockviewWidgetScope
) {
	const dock = scope?.dockviewApi
	const api = (scope as any).panelApi
	let container: HTMLElement | undefined
	let gameView: PixiGameRenderer | undefined
	const containerId = `game-container-${api?.id ?? Math.random().toString(36).substr(2, 9)}`

	const handleProjectSelection = (object: InteractiveGameObject) => {
		showProps(object, dock)
	}

	const handleBuildingAction = (_event: MouseEvent, object: InteractiveGameObject) => {
		if (!(object instanceof Tile)) return false

		const tile = object
		const action = interactionMode.selectedAction
		// Parse variantId from action string: "build:pile#wood.extra" -> alveolusType="pile", variantId="wood.extra"
		const raw = action.slice('build:'.length)
		const hashIdx = raw.indexOf('#')
		const alveolusType = (hashIdx >= 0 ? raw.slice(0, hashIdx) : raw) as AlveolusType
		const variantId = hashIdx >= 0 ? raw.slice(hashIdx + 1) : undefined
		const success = game.applyBuildAction(tile, alveolusType, variantId)
		return Boolean(success)
	}

	const handleZoningAction = (_event: MouseEvent, object: InteractiveGameObject) => {
		if (!(object instanceof Tile)) return false
		const tile = object
		const action = interactionMode.selectedAction
		const zoneType = action.replace('zone:', '')
		return game.applyZoneAction(tile, zoneType)
	}

	const handleZoningDrag = (tiles: Tile[]) => {
		const action = interactionMode.selectedAction
		const zoneType = action.replace('zone:', '')
		for (const tile of tiles) {
			if (tile.canInteract(action)) game.applyZoneAction(tile, zoneType)
		}
	}

	const handleRoadDrag = (tiles: Tile[], roadType: RoadType) => {
		return game.applyRoadTrace(tiles, roadType)
	}

	const handleHivePlanPlacement = (_event: MouseEvent, object: InteractiveGameObject) => {
		if (!(object instanceof Tile)) return false
		const planId = interactionMode.selectedAction.slice('hive-plan:'.length)
		const anchor = toAxialCoord(object.position)
		if (!anchor) return false
		const preview = game.previewHivePlanPlacement(planId, anchor, hivePlanPlacementState.rotation)
		if (!preview) {
			hivePlanPlacementState.lastMessage = 'Plan is not available.'
			return false
		}
		if (!preview.valid) {
			const blocked = preview.cells.find((cell) => !cell.valid)
			hivePlanPlacementState.lastMessage = blocked?.reason ?? 'Plan does not fit here.'
			return false
		}
		const success = game.applyHivePlanPlacement(
			planId,
			anchor,
			hivePlanPlacementState.rotation
		)
		hivePlanPlacementState.lastMessage = success ? 'Plan placed.' : 'Plan does not fit here.'
		return success
	}

	const gameEvents = {
		objectClick(event: MouseEvent, object: InteractiveGameObject) {
			if (event.button !== 0) return
			const selectedBeforeFreightPick = selectionState.selectedUid
			if (tryConsumeFreightMapPick(game, object, event)) {
				selectionState.selectedUid = selectedBeforeFreightPick
				return
			}
			const action = interactionMode.selectedAction
			if (isFreightAddStopAction(action)) return
			if (action.startsWith('build:')) {
				const applied = handleBuildingAction(event, object)
				if (applied && !event.shiftKey) interactionMode.selectedAction = ''
				return
			}
			if (action.startsWith('hive-plan:')) {
				const applied = handleHivePlanPlacement(event, object)
				if (applied && !event.shiftKey) interactionMode.selectedAction = ''
				return
			}
			if (action.startsWith('zone:')) {
				const applied = handleZoningAction(event, object)
				if (applied && !event.shiftKey) interactionMode.selectedAction = ''
				return
			}
			handleProjectSelection(object)
		},
		objectDrag(tiles: Tile[], event: unknown) {
			if (!interactionMode.selectedAction.startsWith('zone:')) return
			handleZoningDrag(tiles)
			const shift =
				event !== null &&
				typeof event === 'object' &&
				'shiftKey' in event &&
				Boolean((event as { shiftKey: boolean }).shiftKey)
			if (!shift) interactionMode.selectedAction = ''
		},
		roadDrag(tiles: Tile[], roadType: RoadType, event: unknown) {
			if (!interactionMode.selectedAction.startsWith('road:')) return
			const applied = handleRoadDrag(tiles, roadType)
			if (!applied) return
			const shift =
				event !== null &&
				typeof event === 'object' &&
				'shiftKey' in event &&
				Boolean((event as { shiftKey: boolean }).shiftKey)
			if (!shift) interactionMode.selectedAction = ''
		},
		presentationEvents(events: readonly GamePresentationEvent[]) {
			consumePresentationEvents(events)
		},
	}

	props.title = 'Game'

	effect`game:events`(() => {
		game.on(gameEvents)
		return () => game.off(gameEvents)
	})

	effect`game:hive-plan-rotation-keys`(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (!interactionMode.selectedAction.startsWith('hive-plan:')) return
			if (event.key !== 'r' && event.key !== 'R' && event.key !== 'q' && event.key !== 'Q') return
			event.preventDefault()
			const delta = event.key === 'q' || event.key === 'Q' ? -1 : 1
			hivePlanPlacementState.rotation = (hivePlanPlacementState.rotation + delta + 6) % 6
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	})

	effect`game:hive-plan-hover-preview`(() => {
		const action = interactionMode.selectedAction
		if (!action.startsWith('hive-plan:')) {
			game.emit('dragPreviewClear')
			return
		}
		const hovered = mrg.hoveredObject
		if (!(hovered instanceof Tile)) {
			game.emit('dragPreviewClear')
			return
		}
		const anchor = toAxialCoord(hovered.position)
		if (!anchor) {
			game.emit('dragPreviewClear')
			return
		}
		const planId = action.slice('hive-plan:'.length)
		const preview = game.previewHivePlanPlacement(planId, anchor, hivePlanPlacementState.rotation)
		if (!preview) {
			game.emit('dragPreviewClear')
			return
		}
		const tiles = preview.cells.map((cell) => cell.tile).filter((tile): tile is Tile => !!tile)
		game.emit('dragPreview', tiles, preview.valid ? '' : 'none')
		hivePlanPlacementState.lastMessage = preview.valid
			? 'Click to place the plan.'
			: (preview.cells.find((cell) => !cell.valid)?.reason ?? 'Plan does not fit here.')
		return () => game.emit('dragPreviewClear')
	})

	const initView = (el: HTMLElement) => {
		traces.ui.log?.('game-widget.init-view')
		if (container || gameView) return

		container = el
		let isMounted = true
		let resizeObserver: ResizeObserver | undefined

		const setupResizer = () => {
			if (!container) return
			resizeObserver = new ResizeObserver((entries) => {
				requestAnimationFrame(() => {
					if (!isMounted) return
					for (const entry of entries) {
						if (entry.target === container && gameView?.app?.renderer) {
							const { width, height } = entry.contentRect
							if (width > 0 && height > 0) {
								gameView.resize(width, height)
							}
						}
					}
				})
			})
			resizeObserver.observe(container)
		}

		// Wait for game to load before creating view to ensure content is ready.
		traces.ui.log?.('game-widget.await-loaded')
		game.loaded
			.then(() => {
				if (!isMounted) return
				traces.ui.log?.('game-widget.loaded')
				if (container && !gameView) {
					try {
						traces.ui.log?.('game-widget.mount-renderer', { containerId })
						gameView = new PixiGameRenderer(game, container)
						traces.ui.log?.('game-widget.renderer-created', { containerId })

						// Fit camera to player content (if any)
						gameView.fitViewToContent()

						if (dock) validateStoredSelectionState(dock)

						setupResizer()
					} catch (e) {
						traces.ui.error?.('game-widget.renderer-create-failed', { error: e })
					}
				}
			})
			.catch((err) => {
				if (!isMounted) return
				traces.ui.error?.('game-widget.loaded-failed', { error: err })
				// Try to initialize anyway if it's just a gameStart glitch
				if (!game.renderer && container) {
					traces.ui.warn?.('game-widget.emergency-renderer-init')
					try {
						gameView = new PixiGameRenderer(game, container)
						// Fit camera to player content (if any)
						gameView.fitViewToContent()
						setupResizer()
					} catch (e) {
						traces.ui.error?.('game-widget.emergency-renderer-failed', { error: e })
					}
				}
			})

		return () => {
			isMounted = false
			traces.ui.log?.('game-widget.unmount-renderer', { containerId })
			resizeObserver?.disconnect()
			gameView?.destroy()
			gameView = undefined
			container = undefined
		}
	}

	if (import.meta.hot) {
		import.meta.hot.accept(() => {
			if (gameView) {
				void gameView.reload()
			}
		})
	}

	return <div class="dockview-widget dockview-widget--game" use={initView} />
}
