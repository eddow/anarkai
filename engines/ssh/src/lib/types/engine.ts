export interface GameRenderer {
	/**
	 * Initialize the renderer into the target element.
	 */
	initialize(element: HTMLElement): Promise<void>
	
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
        camera: { x: number, y: number }
    }
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
