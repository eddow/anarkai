import { effect } from 'mutts'

import type { InteractiveGameObject } from '@ssh/lib/game'
import { css } from '@app/lib/css'
import { PixiGameRenderer } from 'engine-pixi/src/renderer'
import { Tile } from '@ssh/lib/game/board/tile'
import {
	games,
	interactionMode,
	selectionState,
	validateStoredSelectionState,
} from '@app/lib/globals'
import type { AlveolusType } from '@ssh/lib/types/base'

css`
	.dockview-widget--game {
		width: 100%;
		height: 100%;
		background-color: var(--app-bg);
	}
`

export default function GameWidget(props: {
	params: { game: string }
	container: HTMLElement
	api?: any
}, scope: { api: any }) {
	const dock = scope?.api
	const gameName = props.params?.game ?? 'GameX'
	const game = games.game(gameName)
	let container: HTMLElement | undefined
	let gameView: PixiGameRenderer | undefined
	const containerId = `game-container-${props.api?.id ?? Math.random().toString(36).substr(2, 9)}`

	const handleProjectSelection = (object: InteractiveGameObject) => {
		selectionState.selectedUid = object.uid
		const panelId = (selectionState.panelId && !selectionState.panelId.startsWith('pinned:'))
			? selectionState.panelId
			: 'selection-info'


		if (!dock) return

		const existing = dock.getPanel?.(panelId)
		if (existing) {
			existing.focus?.()
			// Don't update params here - dynamic panel listens to selectionState
			return
		}

		// Ensure we don't accidentally reuse a pinned ID for dynamic usage
		const targetId = panelId.startsWith('pinned:') ? 'selection-info' : panelId

		const panel = dock.addPanel?.({
			id: targetId,
			component: 'selection-info',
			headerRight: 'selection-actions',
			params: {}, // Empty params ensures dynamic mode
			floating: {
				width: 400,
				height: 600,
			},
		})
		if (panel) {
			selectionState.panelId = panel.id
			panel.focus?.()
		}
	}

	const handleBuildingAction = (_event: MouseEvent, object: InteractiveGameObject) => {
		if (!(object instanceof Tile)) return false

		const tile = object
		const action = interactionMode.selectedAction
		const alveolusType = action.replace('build:', '') as AlveolusType
		const success = tile.build(alveolusType)
		return Boolean(success)
	}

	const handleZoningAction = (_event: MouseEvent, object: InteractiveGameObject) => {
		if (!(object instanceof Tile)) return false
		const tile = object
		const action = interactionMode.selectedAction
		const zoneType = action.replace('zone:', '')
		if (zoneType === 'none') tile.zone = undefined
		else tile.zone = zoneType as any
		return true
	}

	const handleZoningDrag = (tiles: Tile[]) => {
		const action = interactionMode.selectedAction
		const zoneType = action.replace('zone:', '')
		for (const tile of tiles) {
			if (tile.content?.canInteract?.(action)) {
				if (zoneType === 'none') tile.zone = undefined
				else tile.zone = zoneType as any
			}
		}
	}

	const gameEvents = {
		objectClick(event: MouseEvent, object: InteractiveGameObject) {
			if (event.button !== 0) return
			const action = interactionMode.selectedAction
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
		objectDrag(tiles: Tile[], event: MouseEvent) {
			if (!interactionMode.selectedAction.startsWith('zone:')) return
			handleZoningDrag(tiles)
			if (!event.shiftKey) interactionMode.selectedAction = ''
		},
	}

	props.api?.setTitle?.('Game')

	effect(() => {
		game.on(gameEvents)
		return () => game.off(gameEvents)
	})

	const initView = (el: HTMLElement) => {
		console.log('GameWidget: initView called')
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

		// Wait for game to load before creating view to ensure content is ready
		console.log('GameWidget: awaiting game.loaded')
		game.loaded.then(() => {
			if (!isMounted) return
			console.log('GameWidget: game loaded')
			if (!props.api) return // check if destroyed
			if (container && !gameView) {
				try {
					console.log(`[GameWidget] Mounting PixiGameRenderer to ${containerId}`)
					gameView = new PixiGameRenderer(game, container)
					console.log('GameWidget: PixiGameRenderer created', gameView)

					if (dock) validateStoredSelectionState(dock)

					setupResizer()
				} catch (e) {
					console.error("Failed to create PixiGameRenderer", e)
				}
			}
		}).catch(err => {
			if (!isMounted) return
			console.error('[GameWidget] game.loaded failed:', err)
			// Try to initialize anyway if it's just a gameStart glitch
			if (!game.renderer && container) {
				console.log('[GameWidget] Attempting emergency Pixi initialization...')
				try {
					gameView = new PixiGameRenderer(game, container)
					setupResizer()
				} catch (e) {
					console.error("Emergency initialization failed", e)
				}
			}
		})

		return () => {
			isMounted = false
			console.log(`[GameWidget] Unmounting PixiGameRenderer from ${containerId}`)
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

	return (
		<div
			class="dockview-widget dockview-widget--game"
			use={initView}
		/>
	)
}
