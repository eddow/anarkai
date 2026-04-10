import type { Application, Container, FederatedPointerEvent, FederatedWheelEvent } from 'pixi.js'
import { Tile } from 'ssh/board/tile'
import type { Game } from 'ssh/game/game'
import type { InteractiveGameObject } from 'ssh/game/object'
import { interactionMode, mrg, setHoveredObject } from 'ssh/interactive-state'

/**
 * Bridges Pixi interactions to Logic interactions.
 */
export class InteractionManager {
	private isPanning: boolean = false
	private dragStartTile: Tile | undefined
	private lastPosition: { x: number; y: number } = { x: 0, y: 0 }

	constructor(
		private readonly app: Application,
		private readonly game: Game
	) {}

	/**
	 * Sets up global stage listeners to capture events bubbling from visual objects.
	 */
	public setup() {
		this.app.stage.eventMode = 'static'
		this.app.stage.hitArea = this.app.screen

		// Bind pointer events
		this.app.stage.on('pointerdown', this.onPointerDown)
		this.app.stage.on('pointermove', this.onPointerMove)
		this.app.stage.on('pointerup', this.onPointerUp)
		this.app.stage.on('pointerupoutside', this.onPointerUp)
		this.app.stage.on('wheel', this.onWheel)

		// Prevent context menu on canvas to allow right-click for cancel
		this.app.canvas.addEventListener('contextmenu', this.onContextMenu)

		// Center camera initially (rough guess)
		const renderer = this.game.renderer as any
		if (renderer?.world) {
			const world = renderer.world as Container
			world.position.set(this.app.screen.width / 2, this.app.screen.height / 2)
		}
	}

	public teardown() {
		if (!this.app.stage) return
		this.app.stage.off('pointerdown', this.onPointerDown)
		this.app.stage.off('pointermove', this.onPointerMove)
		this.app.stage.off('pointerup', this.onPointerUp)
		this.app.stage.off('pointerupoutside', this.onPointerUp)
		this.app.stage.off('wheel', this.onWheel)
		this.app.canvas.removeEventListener('contextmenu', this.onContextMenu)
	}

	private onContextMenu = (e: Event) => {
		e.preventDefault()
		if (this.dragStartTile) {
			this.game.emit('dragPreviewClear')
			this.dragStartTile = undefined
		}
	}

	/**
	 * Get the current zone type from the selected action
	 */
	private getCurrentZoneType(): string {
		const action = interactionMode.selectedAction
		if (action.startsWith('zone:')) {
			return action.replace('zone:', '')
		}
		return ''
	}
	/**
	 * Calculate the parallelogram tiles where start and end are ALWAYS the acute (60°) corners.
	 *
	 * By normalizing so p1.q <= p2.q (or if equal, p1.r <= p2.r), we reduce 6 sextants to 3 cases.
	 */
	private getParallelogramTiles(
		start: { q: number; r: number },
		end: { q: number; r: number }
	): Tile[] {
		const tiles: Tile[] = []

		// Normalize: ensure p1.q <= p2.q (if equal, p1.r <= p2.r)
		let p1 = start
		let p2 = end
		if (p1.q > p2.q || (p1.q === p2.q && p1.r > p2.r)) {
			;[p1, p2] = [p2, p1]
		}

		const dq = p2.q - p1.q // Always >= 0 after normalization
		const dr = p2.r - p1.r

		// With dq >= 0, we only have 3 cases based on dr
		let v1: { q: number; r: number }
		let v2: { q: number; r: number }
		let a: number
		let b: number

		if (dr >= 0) {
			// Case 1: Moving right and down (or horizontal right)
			// Use +q and +r directions
			v1 = { q: 1, r: 0 }
			v2 = { q: 0, r: 1 }
			a = dq
			b = dr
		} else if (dq >= -dr) {
			// Case 2: Moving right and up, but more right than up
			// |dq| >= |dr|, use +q and -s directions: (1,0) and (1,-1)
			v1 = { q: 1, r: 0 }
			v2 = { q: 1, r: -1 }
			// (dq, dr) = a×(1,0) + b×(1,-1) = (a+b, -b)
			b = -dr
			a = dq - b
		} else {
			// Case 3: Moving right and up, but more up than right
			// |dr| > |dq|, use -r and +s directions: (0,-1) and (1,-1)
			v1 = { q: 0, r: -1 }
			v2 = { q: 1, r: -1 }
			// (dq, dr) = a×(0,-1) + b×(1,-1) = (b, -a-b)
			// So: b = dq, -a-b = dr → a = -dr - b = -dr - dq
			b = dq
			a = -dr - dq
		}

		// Fill the parallelogram by iterating along v1 and v2
		for (let i = 0; i <= a; i++) {
			for (let j = 0; j <= b; j++) {
				const q = p1.q + i * v1.q + j * v2.q
				const r = p1.r + i * v1.r + j * v2.r
				const tile = this.game.hex.getTile({ q, r })
				if (tile) tiles.push(tile)
			}
		}

		return tiles
	}

	/**
	 * Get the tile under of a global position using the hex board's hit test.
	 */
	private getTileAtPosition(globalPos: { x: number; y: number }): Tile | undefined {
		const renderer = this.game.renderer as any
		if (!renderer?.world) return undefined

		const world = renderer.world as Container
		const localPos = world.toLocal(globalPos)

		// Use the hex board's hitTest which converts to axial coords
		const hit = this.game.hex.hitTest(localPos.x, localPos.y)
		if (hit instanceof Tile) return hit
		return undefined
	}

	private onPointerDown = (e: FederatedPointerEvent) => {
		// Middle Mouse Button (1) -> Always Pan
		if (e.button === 1) {
			this.isPanning = true
			this.lastPosition = { x: e.global.x, y: e.global.y }
			return
		}

		// Left button only for tile selection
		if (e.button !== 0) return

		// Left click
		const object = this.findLogicObject(e.target)

		if (object instanceof Tile) {
			// Start potential tile drag
			this.dragStartTile = object
		} else if (object && 'canInteract' in object) {
			// Non-tile interactive object - click immediately
			this.game.simulateObjectClick(object, e.nativeEvent as MouseEvent)
		} else {
			// No visual logic target: fall back to board hit-test so tiles remain
			// interactable when ground is rendered by TerrainVisual.
			const tile = this.getTileAtPosition(e.global)
			if (tile) {
				this.dragStartTile = tile
			} else {
				// Background click - start panning
				this.isPanning = true
				this.lastPosition = { x: e.global.x, y: e.global.y }
			}
		}
	}

	private onPointerMove = (e: FederatedPointerEvent) => {
		if (this.isPanning) {
			mrg.hoveredObject = undefined
			const dx = e.global.x - this.lastPosition.x
			const dy = e.global.y - this.lastPosition.y

			const renderer = this.game.renderer as any
			if (renderer?.world) {
				renderer.world.position.x += dx
				renderer.world.position.y += dy
			}

			this.lastPosition = { x: e.global.x, y: e.global.y }
		} else if (this.dragStartTile) {
			setHoveredObject(this.dragStartTile)
			// Tile drag in progress - emit preview
			const currentTile = this.getTileAtPosition(e.global)
			if (currentTile && currentTile !== this.dragStartTile) {
				const start = this.dragStartTile.position as { q: number; r: number }
				const end = currentTile.position as { q: number; r: number }
				const tiles = this.getParallelogramTiles(start, end)
				const zoneType = this.getCurrentZoneType()
				this.game.emit('dragPreview', tiles, zoneType)
			} else if (!currentTile || currentTile === this.dragStartTile) {
				// Clear preview if back to start tile or off-board
				this.game.emit('dragPreviewClear')
			}
		} else {
			const object = this.findLogicObject(e.target)
			if (object) {
				setHoveredObject(object)
				return
			}
			setHoveredObject(this.getTileAtPosition(e.global))
		}
	}

	private onPointerUp = (e: FederatedPointerEvent) => {
		this.isPanning = false

		if (this.dragStartTile) {
			const endTile = this.getTileAtPosition(e.global)

			// Clear any preview
			this.game.emit('dragPreviewClear')

			if (endTile && endTile !== this.dragStartTile) {
				// Drag completed - calculate parallelogram and emit
				const start = this.dragStartTile.position as { q: number; r: number }
				const end = endTile.position as { q: number; r: number }
				const tiles = this.getParallelogramTiles(start, end)
				this.game.emit('objectDrag', tiles, e.nativeEvent as MouseEvent)
			} else if (endTile === this.dragStartTile) {
				// Click on same tile
				this.game.simulateObjectClick(this.dragStartTile, e.nativeEvent as MouseEvent)
			}

			this.dragStartTile = undefined
		}

		if (!this.dragStartTile) {
			const object = this.findLogicObject(e.target)
			setHoveredObject(object ?? this.getTileAtPosition(e.global))
		}
	}

	static readonly MIN_SCALE = 0.15
	static readonly MAX_SCALE = 4.0

	private onWheel = (e: FederatedWheelEvent) => {
		const renderer = this.game.renderer as any
		if (!renderer || !renderer.world) return

		const world = renderer.world as Container
		const scaleFactor = 1.1
		const direction = e.deltaY > 0 ? 1 / scaleFactor : scaleFactor

		const newScale = Math.max(
			InteractionManager.MIN_SCALE,
			Math.min(InteractionManager.MAX_SCALE, world.scale.x * direction)
		)
		if (newScale === world.scale.x) return

		const localPos = world.toLocal(e.global)
		world.scale.set(newScale)
		world.position.x = e.global.x - localPos.x * newScale
		world.position.y = e.global.y - localPos.y * newScale
	}

	/**
	 * Traverses up the display tree to find a container bound to a logic object.
	 * Skips objects that report they cannot interact.
	 */
	private findLogicObject(target: any): InteractiveGameObject | undefined {
		let current = target
		const action = interactionMode.selectedAction

		while (current) {
			const logicObject = current._logicObject as InteractiveGameObject | undefined
			if (logicObject) {
				// With no selected action, default hover/click should still resolve to the
				// underlying logic object even if canInteract('') is false.
				if (!action) {
					return logicObject
				}
				// If an action is selected, only return objects that accept it.
				if (logicObject.canInteract && logicObject.canInteract(action)) {
					return logicObject
				}
				// If it has _logicObject but canInteract returns false, we implicitly skip it
				// effectively treating it as transparent to interaction
			}
			current = current.parent
		}
		return undefined
	}
}
