import { css } from '@app/lib/css'
import { showProps } from '@app/lib/follow-selection'
import { isFreightAddStopAction, tryConsumeFreightMapPick } from '@app/lib/freight-map-pick'
import { game, interactionMode, selectionState, validateStoredSelectionState } from '@app/lib/globals'
import { consumePresentationEvents } from '@app/lib/presentation-events'
import type { DockviewWidgetProps, DockviewWidgetScope } from '@sursaut/ui/dockview'
import { PixiGameRenderer } from 'engine-pixi/renderer'
import { effect } from 'mutts'
import type { RoadType } from 'ssh/board/roads'
import { Tile } from 'ssh/board/tile'
import type { GamePresentationEvent, InteractiveGameObject } from 'ssh/game'
import { traces } from 'ssh/dev/debug'
import type { AlveolusType } from 'ssh/types/base'

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
		const alveolusType = action.replace('build:', '') as AlveolusType
		const success = game.applyBuildAction(tile, alveolusType)
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
