import { type FederatedPointerEvent, type FederatedWheelEvent, type Application, type Container } from 'pixi.js'
import type { Game } from 'ssh/src/lib/game/game'
import type { InteractiveGameObject } from 'ssh/src/lib/game/object'

/**
 * Bridges Pixi interactions to Logic interactions.
 */
export class InteractionManager {
    private isDragging: boolean = false
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
        
        // Center camera initially (rough guess)
         if (this.game.renderer && 'world' in this.game.renderer) {
             const world = (this.game.renderer as any).world as Container
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
    }

    private onPointerDown = (e: FederatedPointerEvent) => {
        // Middle Mouse Button (1) -> Always Pan
        if (e.button === 1) {
            this.isDragging = true
            this.lastPosition = { x: e.global.x, y: e.global.y }
            return
        }

        // Other buttons (Left/Right)
        // If clicking a game object, don't drag camera (unless it's background)
        const object = this.findLogicObject(e.target)
        if (object) {
            // Forward commands to game
            // If the object is interactive, we can simulate a click
            if ('canInteract' in object) {
                 this.game.simulateObjectClick(object as InteractiveGameObject, e.nativeEvent as MouseEvent)
            }
        } else {
            // Start Drag (Left/Right click on background)
            this.isDragging = true
            this.lastPosition = { x: e.global.x, y: e.global.y }
        }
    }

    private onPointerMove = (e: FederatedPointerEvent) => {
        if (this.isDragging) {
            const dx = e.global.x - this.lastPosition.x
            const dy = e.global.y - this.lastPosition.y
            
            const renderer = this.game.renderer as any
            if (renderer && renderer.world) {
                renderer.world.position.x += dx
                renderer.world.position.y += dy
            }
            
            this.lastPosition = { x: e.global.x, y: e.global.y }
        }
    }

    private onPointerUp = (e: FederatedPointerEvent) => {
        this.isDragging = false
    }

    private onWheel = (e: FederatedWheelEvent) => {
        const renderer = this.game.renderer as any
        if (!renderer || !renderer.world) return

        const world = renderer.world as Container
        const scaleFactor = 1.1
        const direction = e.deltaY > 0 ? 1 / scaleFactor : scaleFactor; // Zoom in or out

        // Scale relative to mouse position
        // 1. Convert mouse to world space
        // This is simplified, can improve with actual matrix transform if needed
        const localPos = world.toLocal(e.global);

        world.scale.x *= direction;
        world.scale.y *= direction;

        // 2. Adjust position to keep mouse over same world point
        // worldPos = (elementPos - containerPos) / scale
        // newContainerPos = elementPos - (worldPos * newScale)
        
        world.position.x = e.global.x - localPos.x * world.scale.x;
        world.position.y = e.global.y - localPos.y * world.scale.y;
    }

    /**
     * Traverses up the display tree to find a container bound to a logic object.
     */
    private findLogicObject(target: any): InteractiveGameObject | undefined {
        let current = target
        while (current) {
            if (current._logicObject) {
                return current._logicObject as InteractiveGameObject
            }
            current = current.parent
        }
        return undefined
    }
}
