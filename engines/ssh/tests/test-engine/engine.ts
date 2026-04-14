import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { reactiveOptions, reset } from 'mutts'
import type { Game, GameGenerationOptions, SaveState } from 'ssh/game'
import { setupEnvironment } from './environment'
import { loadStandardMocks } from './mocks'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export class TestEngine {
	public game!: Game
	private options?: GameGenerationOptions
	private firstReactiveBatchError: unknown
	private previousReactiveErrorHandler = reactiveOptions.error

	constructor(options?: GameGenerationOptions) {
		this.options = options
		setupEnvironment()
		loadStandardMocks()
	}

	/**
	 * Waits for the game to be fully loaded (including dynamic imports like Hive)
	 */
	public async init() {
		this.firstReactiveBatchError = undefined
		this.previousReactiveErrorHandler = reactiveOptions.error
		reactiveOptions.error = (...args: any[]) => {
			this.previousReactiveErrorHandler?.(...args)
			if (
				this.firstReactiveBatchError === undefined &&
				args[0] === '[reactive] Root batch failure before broken state:'
			) {
				this.firstReactiveBatchError = args[1]
			}
		}
		// Dynamic import to allow mocks to apply
		const { Game } = await import('ssh/game')
		this.game = new Game(this.options)
		await this.game.loaded
		this.game.ticker.stop()
	}

	/**
	 * Loads a scenario state into the game.
	 * Use this to setup the test board.
	 */
	public loadScenario(scenario: Partial<SaveState>) {
		if (!this.game) {
			throw new Error('TestEngine.init() must be awaited before loadScenario()')
		}
		// Ensure generationOptions are present
		const fullScenario = {
			...scenario,
			generationOptions: scenario.generationOptions ??
				this.options ?? { terrainSeed: 1234, characterCount: 0 },
		} as SaveState
		if (fullScenario.namedConfigurations) {
			this.game.configurationManager.deserialize(fullScenario.namedConfigurations)
		}
		this.game.hex.reset()
		this.game.population.deserialize([])
		this.game.generate(fullScenario.generationOptions, fullScenario, fullScenario)
		if (fullScenario.population) {
			this.game.population.deserialize(fullScenario.population)
		}
	}

	/**
	 * Advances ticked objects and the game's virtual clock (mirrors the essentials of
	 * `Game.tickerCallback` while the Pixi ticker stays stopped in tests).
	 *
	 * @param seconds Total time to advance
	 * @param tickRate Delta seconds per step (default 0.1s)
	 */
	public tick(seconds: number, tickRate: number = 0.1) {
		let elapsed = 0
		// Avoid infinite loop if seconds is huge, but usually fine
		while (elapsed < seconds) {
			this.step(tickRate)
			if (this.firstReactiveBatchError) throw this.firstReactiveBatchError
			elapsed += tickRate
		}
	}

	/**
	 * Executes a single simulation step.
	 * accesses the private tickedObjects of the game to update them.
	 */
	private step(delta: number) {
		this.game.clock.virtualTime += delta
		// Access private tickedObjects via type assertion
		const objects = (this.game as any).tickedObjects as Set<{
			update(dt: number): void
		}>
		// console.log(`Step ${delta}: ${objects.size} ticked objects`);
		for (const object of objects) {
			// Skip destroyed objects
			if ('destroyed' in object && (object as any).destroyed) continue
			object.update(delta)
		}
	}

	/**
	 * Helper to spawn a character at a specific location
	 */
	public spawnCharacter(name: string, coord: { q: number; r: number }) {
		return this.game.population.createCharacter(name, coord)
	}

	public loadScript(filename: string) {
		// Assuming ./assets/scripts structure relative to package root
		// engines/ssh/assets/scripts
		const scriptPath = path.resolve(__dirname, '../../assets/scripts', filename)
		return fs.readFileSync(scriptPath, 'utf-8')
	}

	public async destroy() {
		if (!this.game) {
			reactiveOptions.error = this.previousReactiveErrorHandler
			reset()
			return
		}
		const flushTeardown = async () => {
			await Promise.resolve()
			await new Promise((resolve) => setTimeout(resolve, 0))
			await new Promise((resolve) => setTimeout(resolve, 0))
		}
		await flushTeardown()
		try {
			this.game.population.deserialize([])
			this.game.hex.reset()
			this.game.destroy()
		} catch (error) {
			if (this.firstReactiveBatchError) throw this.firstReactiveBatchError
			if (!(error instanceof Error) || !error.message.includes('Reactive system is broken')) {
				throw error
			}
		} finally {
			await flushTeardown()
			reactiveOptions.error = this.previousReactiveErrorHandler
			reset()
		}
	}
}
