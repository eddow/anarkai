import type { AxialCoord } from 'ssh/utils'
import { axial } from 'ssh/utils'

export interface GameplayFrontierRequest {
	center: AxialCoord
	radius: number
	maxBatchSize?: number
}

interface GameplayFrontierControllerOptions {
	hasMaterializedTile(coord: AxialCoord): boolean
	materialize(coords: AxialCoord[]): Promise<void>
}

export class GameplayFrontierController {
	private readonly pending = new Map<string, AxialCoord>()
	private readonly inFlight = new Set<string>()
	private drainPromise: Promise<boolean> | undefined
	private currentBatchLimit = Number.POSITIVE_INFINITY

	constructor(private readonly options: GameplayFrontierControllerOptions) {}

	request(request: GameplayFrontierRequest): Promise<boolean> {
		const candidates = [...axial.allTiles(request.center, request.radius)]
			.filter((coord) => !this.options.hasMaterializedTile(coord))
			.filter((coord) => {
				const key = axial.key(coord)
				return !this.pending.has(key) && !this.inFlight.has(key)
			})
			.sort((a, b) => axial.distance(a, request.center) - axial.distance(b, request.center))

		const limited =
			request.maxBatchSize !== undefined
				? candidates.slice(0, Math.max(0, request.maxBatchSize))
				: candidates

		if (request.maxBatchSize !== undefined) {
			this.currentBatchLimit = Math.min(this.currentBatchLimit, Math.max(0, request.maxBatchSize))
		}

		for (const coord of limited) {
			this.pending.set(axial.key(coord), coord)
		}

		if (limited.length === 0) {
			return this.drainPromise ?? Promise.resolve(false)
		}

		this.drainPromise ??= this.drain()
		return this.drainPromise
	}

	private async drain() {
		let generated = false
		try {
			while (this.pending.size > 0) {
				const batchEntries = [...this.pending.entries()].slice(0, this.currentBatchLimit)
				if (batchEntries.length === 0) break
				const batch = batchEntries.map(([key, coord]) => ({ key, coord }))
				for (const [key] of batchEntries) this.pending.delete(key)
				for (const { key } of batch) this.inFlight.add(key)
				try {
					await this.options.materialize(batch.map(({ coord }) => coord))
					generated = true
				} finally {
					for (const { key } of batch) this.inFlight.delete(key)
				}
			}
			return generated
		} finally {
			if (this.pending.size === 0) {
				this.currentBatchLimit = Number.POSITIVE_INFINITY
			}
			this.drainPromise = undefined
		}
	}
}
