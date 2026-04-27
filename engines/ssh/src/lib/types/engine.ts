import type { AxialCoord } from 'ssh/utils'

export interface GameRenderer {
	/**
	 * Initialize the renderer into the target element.
	 */
	/** View host (e.g. browser element); kept opaque so the engine does not depend on DOM types. */
	initialize(element: unknown): Promise<void>

	/**
	 * Clean up all resources.
	 */
	destroy(): void

	/**
	 * Resize the viewport.
	 */
	resize(width: number, height: number): void

	getTexture(spec: string): any

	/**
	 * Reload/Re-initialize the renderer (e.g. for HMR).
	 */
	reload(): Promise<void>

	/**
	 * Optional access to view state for logic that needs it (e.g. culling).
	 * Ideally logic shouldn't need this, but good for practical pragmatism.
	 */
	viewState?: {
		zoom: number
		camera: { x: number; y: number }
	}

	/**
	 * Optional: sector-baked terrain/resources (e.g. Pixi) should refresh for this tile/world.
	 */
	invalidateTerrain?(coord?: AxialCoord): void

	/**
	 * Optional: stronger invalidation (e.g. clear caches) for terraforming-scale changes.
	 */
	invalidateTerrainHard?(coord?: AxialCoord): void
}

export interface InputAdapter {
	/**
	 * Start listening for inputs.
	 */
	start(): void

	/**
	 * Stop listening for inputs.
	 */
	stop(): void
}
