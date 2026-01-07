<script lang="ts">
import { getDockviewContext } from 'dockview-svelte/src'
import { onDestroy, onMount } from 'svelte'
import type { Readable, Writable } from 'svelte/store'
import { GameView, type InteractiveGameObject } from '$lib/game'
import { Tile } from '$lib/game/board/tile'
import {
	games,
	getObjectInfoPanelId,
	interactionMode,
	selectionState,
	validateStoredSelectionState,
} from '$lib/globals.svelte'
import { T } from '$lib/i18n'
import type { AlveolusType } from '$lib/types/base'

const { addDock, api } = getDockviewContext()

// Helper function to handle selection info display
function showSelectionInfo(object: InteractiveGameObject) {
	// Check for existing object-info panel for this specific object
	const objectInfoPanelId = getObjectInfoPanelId(object.uid)
	if (objectInfoPanelId) {
		const objectInfoPanel = api?.getPanel(objectInfoPanelId)
		if (objectInfoPanel) {
			// Focus the object-info panel for this object
			objectInfoPanel.focus()
			return
		}
	}

	// Update global selected object
	selectionState.selectedUid = object.uid

	// Handle selection-info panel (generalist)
	if (selectionState.panelId) {
		const selectionInfoPanel = api?.getPanel(selectionState.panelId)
		if (selectionInfoPanel) {
			// Focus existing selection-info panel - it will update content via global state
			selectionInfoPanel.focus()
		}
	} else {
		// Create new selection-info panel
		addDock(
			'selection-info',
			{},
			{
				floating: true,
			},
		)
	}
}
let {
	size,
	game: gameName,
	title,
}: {
	size: Readable<{ width: number; height: number }>
	game: string
	title: Writable<string>
} = $props()

$effect(() => {
	title.set($T.game.gameTitle({ game: gameName }))
})

const game = games.game(gameName)
let gameView = $state<GameView | undefined>(undefined)
$effect(() =>
	size.subscribe((size) => {
		if (gameView) {
			if (gameView.pixi?.renderer) gameView.pixi.renderer.resize(size.width, size.height)
		}
	}),
)
//@ts-expect-error
window.dob = size

let container = $state<HTMLDivElement>()

onMount(() => {
	// Remove the canvas from wherever it might be
	gameView = new GameView(game, container!)

	// Validate stored selection state
	validateStoredSelectionState(api)
})

onDestroy(() => {
	// Clean up PixiJS resources when component is destroyed
	if (gameView) {
		gameView.destroy()
	}
})

// Handle HMR reloads
if (import.meta.hot) {
	import.meta.hot.accept(() => {
		// Reload the entire PixiJS infrastructure on HMR
		if (gameView) {
			gameView.reload()
		}
	})
}

const gameEvents = {
	objectClick(event: MouseEvent, object: InteractiveGameObject) {
		if (event.button === 0) {
			// Check if we're in building mode
			if (interactionMode.selectedAction.startsWith('build:')) {
				const applied = handleBuildingAction(event, object)
				if (applied && !event.shiftKey) interactionMode.selectedAction = ''
			} else if (interactionMode.selectedAction.startsWith('zone:')) {
				const applied = handleZoningAction(event, object)
				if (applied && !event.shiftKey) interactionMode.selectedAction = ''
			} else {
				// Default behavior: show selection info
				showSelectionInfo(object)
			}
		}
	},
	objectDrag(tiles: Tile[], event: MouseEvent) {
		// Handle drag events for zoning
		if (interactionMode.selectedAction.startsWith('zone:')) {
			handleZoningDrag(tiles)
			if (!event.shiftKey) {
				interactionMode.selectedAction = ''
			}
		}
	},
}

function handleBuildingAction(_event: MouseEvent, object: InteractiveGameObject): boolean {
	// Only allow building on hex tiles
	if (!(object instanceof Tile)) return false

	const tile = object as Tile
	const action = interactionMode.selectedAction

	// Extract alveolus type from action (e.g., "build:sawmill" -> "sawmill")
	const alveolusType = action.replace('build:', '') as AlveolusType

	// Use the tile's build method
	const success = tile.build(alveolusType)
	return !!success
}

function handleZoningAction(_event: MouseEvent, object: InteractiveGameObject): boolean {
	// Only allow zoning on hex tiles
	if (!(object instanceof Tile)) return false

	const tile = object as Tile
	const action = interactionMode.selectedAction

	// Extract zone type from action (e.g., "zone:residential" -> "residential", "zone:none" -> "none")
	const zoneType = action.replace('zone:', '')

	if (zoneType === 'none') {
		tile.zone = undefined
	} else {
		tile.zone = zoneType as any
	}
	return true
}

function handleZoningDrag(tiles: Tile[]) {
	const action = interactionMode.selectedAction
	const zoneType = action.replace('zone:', '')

	for (const tile of tiles) {
		// Only zone tiles that can be zoned (UnBuiltLand, not Alveolus)
		if (tile.content?.canInteract?.(action)) {
			if (zoneType === 'none') {
				tile.zone = undefined
			} else {
				tile.zone = zoneType as any
			}
		}
	}
}

$effect(() => {
	game.on(gameEvents)

	return () => game.off(gameEvents)
})
</script>

<div bind:this={container} style="width: 100%; height: 100%;"></div>
