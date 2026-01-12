import { Container, FederatedPointerEvent } from 'pixi.js'
import type { GameObject } from 'ssh/src/lib/game/object'
import type { ScopedCallback } from 'mutts'
import { mrg } from 'ssh/src/lib/interactive-state'
import type { PixiGameRenderer } from '../renderer'


/**
 * Base class for all visual representations of game objects.
 * Manages the connection between the Logic Object (GameObject) and the Visual Object (Pixi Container).
 */
export abstract class VisualObject<T extends GameObject = GameObject> {
	/** The root container for this visual object */
	public readonly view: Container
    /** Cleanups callbacks for reactive watchers */
	protected cleanups: ScopedCallback[] = []

    constructor(public readonly object: T, protected renderer: PixiGameRenderer) {
		this.view = new Container()
        // Link the visual object back to the logic object for interaction handling
        ;(this.view as any)._logicObject = object

        this.setupInteraction()
	}

	/**
	 * Sets up reactive bindings to the logic object.
     * Should be called after construction or when attached to the scene.
	 */
	public abstract bind(): void

    /**
     * Configures PIXI interaction events to sync with game state
     */
    protected setupInteraction() {
        // By default, visuals are not interactive. Subclasses should set `eventMode` on specific children
        // or we can set it here if we assume the container is hit-testable (needs hitArea or children)
        this.view.eventMode = 'static'
        
        this.view.on('pointerover', (e: FederatedPointerEvent) => {
            // Stop propagation to avoid hovering tiles underneath when over a unit?
            // Usually yes for units/buildings.
            e.stopPropagation()
            mrg.hoveredObject = this.object as any
        })
        
        this.view.on('pointerout', (e: FederatedPointerEvent) => {
            if (mrg.hoveredObject === (this.object as any)) {
                mrg.hoveredObject = undefined
            }
        })
        
        this.view.on('pointertap', (e: FederatedPointerEvent) => {
             // Dispatch click event to the Game model
             // The UI (Vue) listens to this event to handle selection
             this.renderer.game.clickObject(e, this.object as any)
             e.stopPropagation()
        })
    }

	/**
	 * Cleans up all reactive bindings and destroys the Pixi container.
	 */
	public dispose() {
		this.cleanups.forEach((cleanup) => cleanup())
		this.cleanups = []
		this.view.destroy({ children: true })
	}

    /**
     * Helper to register a reactive cleanup
     */
    protected register(cleanup: ScopedCallback) {
        this.cleanups.push(cleanup)
    }
}
