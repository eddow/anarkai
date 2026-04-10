import { reactive, root } from 'mutts'
import { Game } from './game'
import { chopSaw as patches } from './game/exampleGames'

export interface Configuration {
	timeControl: 0 | 1 | 2 | 3 | 'pause' | 'play' | 'fast-forward' | 'gonzales'
}

function getDefaultConfiguration(): Configuration {
	return {
		timeControl: 1,
	}
}

export const configuration = reactive<Configuration>(getDefaultConfiguration())
export const debugInfo = reactive<Record<string, unknown>>({})
export const options = {
	stalledMovementScanIntervalMs: 1000 as number | false,
	stalledMovementSettleMs: 1000,
}

let gameSingleton: Game | undefined

function ensureGame(): Game {
	if (!gameSingleton) {
		gameSingleton = root`game`(
			() =>
				new Game(
					{
						terrainSeed: 12,
						characterCount: 3,
						characterRadius: 5,
					},
					patches
				)
		)
	}
	return gameSingleton
}

/**
 * Single global game instance for the main shell (browser or any one-game host).
 * Lazily created on first access so `ssh/globals` can load before `Game` is constructed.
 * Do not create additional named games; multi-game registries are legacy.
 */
export const game: Game = new Proxy({} as Game, {
	get(_, prop) {
		const instance = ensureGame()
		// Receiver must be the reactive `instance`: if it were the outer proxy, Mutts would
		// mis-route sets (e.g. `game.renderer = …`) and proxy invariants would break on read.
		return Reflect.get(instance, prop, instance)
	},
	set(_, prop, value) {
		const instance = ensureGame()
		return Reflect.set(instance, prop, value, instance)
	},
	has(_, prop) {
		return Reflect.has(ensureGame(), prop)
	},
	ownKeys() {
		return Reflect.ownKeys(ensureGame())
	},
	getOwnPropertyDescriptor(_, prop) {
		return Reflect.getOwnPropertyDescriptor(ensureGame(), prop)
	},
})

/**
 * Legacy shape for callers that used `games.game(name)`. The name is ignored; returns {@link game}.
 * Prefer importing `game` directly.
 */
export const games = {
	game(_name?: string) {
		void _name
		return ensureGame()
	},
}

export * from './interactive-state'
