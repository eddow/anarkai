import { Game, type GameGenerationOptions, type GamePatches, type SaveState } from 'ssh/game'
import { configuration } from 'ssh/globals'
import { vi } from 'vitest'

/** Same cap as `Game` ticker: larger `elapsedMS` skips the tick entirely. */
const maxElapsedMsForTick = 500

export type ViabilityContext = {
	game: Game
	/** Concatenated `console.error` lines recorded during the run (including forwarded output). */
	errors: string[]
	/** `game.clock.virtualTime` after the run. */
	virtualTime: number
}

export type ViabilitySetup = {
	generation: GameGenerationOptions
	/** Passed to `new Game(..., patches)`. Ignored if `loadSave` runs and replaces the world. */
	patches?: GamePatches
	/**
	 * After `await game.loaded` and `game.ticker.stop()`.
	 * Call `game.loadGameData(save)` here to start from a saved snapshot (use empty/minimal `patches` in the constructor if needed).
	 */
	afterLoad?: (ctx: { game: Game }) => void | Promise<void>
}

export type ViabilityRunOptions = {
	/** Target simulated duration in virtual seconds (default: 300 ≈ five in‑game minutes at play speed). */
	virtualSeconds?: number
	/**
	 * Synthetic `elapsedMS` passed to the game ticker each iteration.
	 * Must be ≤ {@link maxElapsedMsForTick} or ticks are skipped by the engine.
	 */
	tickElapsedMs?: number
	/** Substrings that must not appear in any captured `console.error` line. */
	forbiddenErrorSubstrings?: string[]
}

function formatConsoleArgs(args: unknown[]): string {
	return args
		.map((a) => {
			if (typeof a === 'string') return a
			if (a instanceof Error) return `${a.message}\n${a.stack ?? ''}`
			try {
				return JSON.stringify(a)
			} catch {
				return String(a)
			}
		})
		.join(' ')
}

const defaultForbidden = ['Action infinite fail:'] as const

/**
 * Headless runner: advances the real game ticker (clock + all ticked objects) until
 * `game.clock.virtualTime` reaches the target. Captures `console.error` so tests can
 * assert on deadlocks like `selfCare.goEat` immediate re‑selection.
 *
 * Typical pattern:
 * ```ts
 * await runViabilityScenario(
 *   { generation: { ... }, patches: { ... }, afterLoad: ({ game }) => { ... } },
 *   ({ game, errors, virtualTime }) => {
 *     expect(errors.join('\n')).not.toMatch(/Action infinite fail/)
 *     expect(game.population.character('…').hunger).toBeLessThan(0.2)
 *   },
 *   { virtualSeconds: 300 }
 * )
 * ```
 */
export async function runViabilityScenario(
	setup: ViabilitySetup,
	check: (ctx: ViabilityContext) => void | Promise<void>,
	runOpts?: ViabilityRunOptions
): Promise<ViabilityContext> {
	const virtualSeconds = runOpts?.virtualSeconds ?? 300
	let tickElapsedMs = runOpts?.tickElapsedMs ?? 250
	if (tickElapsedMs > maxElapsedMsForTick) {
		tickElapsedMs = maxElapsedMsForTick
	}

	const forbidden = [...defaultForbidden, ...(runOpts?.forbiddenErrorSubstrings ?? [])]

	const savedTimeControl = configuration.timeControl
	configuration.timeControl = 1

	const errors: string[] = []
	const originalError = console.error
	const spy = vi
		.spyOn(console, 'error')
		.mockImplementation((...args: Parameters<typeof console.error>) => {
			const line = formatConsoleArgs(args)
			errors.push(line)
			originalError.apply(console, args)
		})

	let game: Game | undefined
	try {
		game = new Game(setup.generation, setup.patches ?? {})
		await game.loaded
		game.ticker.stop()
		await setup.afterLoad?.({ game })

		const running = game
		const tickerCallback = (
			running as Game & { tickerCallback: (loop: { elapsedMS: number }) => void }
		).tickerCallback

		while (running.clock.virtualTime < virtualSeconds) {
			tickerCallback({ elapsedMS: tickElapsedMs })
		}

		for (const sub of forbidden) {
			const hit = errors.find((line) => line.includes(sub))
			if (hit) {
				throw new Error(
					`Viability run captured forbidden console.error (${JSON.stringify(sub)}): ${hit.slice(0, 500)}`
				)
			}
		}

		const ctx: ViabilityContext = {
			game: running,
			errors,
			virtualTime: running.clock.virtualTime,
		}
		await check(ctx)
		return ctx
	} finally {
		spy.mockRestore()
		configuration.timeControl = savedTimeControl
		game?.destroy()
	}
}

/**
 * Build a minimal {@link SaveState} from generation + patches for `game.loadGameData`.
 * Population must still be deserialized separately if you use `afterLoad` to spawn actors.
 */
export function patchesToSaveState(
	generation: GameGenerationOptions,
	patches: GamePatches
): SaveState {
	return {
		...patches,
		population: [],
		generationOptions: generation,
	}
}
