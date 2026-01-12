export class SimulationLoop {
	private running = false
	private lastTime = 0
	private callbacks = new Set<(loop: SimulationLoop) => void>()
	public elapsedMS = 0

	constructor() {}

	public start() {
		if (this.running) return
		this.running = true
		this.lastTime = performance.now()
		this.tick()
	}

	public stop() {
		this.running = false
	}

	public add(callback: (loop: SimulationLoop) => void) {
		this.callbacks.add(callback)
	}

	public remove(callback: (loop: SimulationLoop) => void) {
		this.callbacks.delete(callback)
	}

	public update(deltaMS: number) {
		this.elapsedMS = deltaMS
		for (const cb of this.callbacks) {
			cb(this)
		}
	}

	private tick = () => {
		if (!this.running) return
		const now = performance.now()
		this.elapsedMS = now - this.lastTime
		this.lastTime = now

		for (const cb of this.callbacks) {
			cb(this)
		}

		if (typeof requestAnimationFrame !== 'undefined') {
			requestAnimationFrame(this.tick)
		} else {
			setTimeout(this.tick, 16.6)
		}
	}
}
