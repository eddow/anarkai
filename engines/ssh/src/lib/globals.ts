import { Eventful, reactive, root } from 'mutts'
import { Game, type GameEvents } from './game'
import { chopSaw as patches } from './game/exampleGames'

export interface Configuration {
	timeControl: 'pause' | 'play' | 'fast-forward' | 'gonzales'
}

function getDefaultConfiguration(): Configuration {
	return {
		timeControl: 'play',
	}
}

export const configuration = reactive<Configuration>(getDefaultConfiguration())
export const debugInfo = reactive<Record<string, unknown>>({})

type GamedEvents = {
	[key in keyof GameEvents]: (game: Game, ...args: Parameters<GameEvents[key]>) => void
}
// TODO: find a way to make the whole file root() ?
class Games extends Eventful<GamedEvents> {
	private games = new Map<string, Game>()

	game(name: string) {
		const existing = this.games.get(name)
		if (existing) return existing

		const instance = root(
			() =>
				new Game(
					{
						boardSize: 12,
						terrainSeed: 23,
						characterCount: 3,
						characterRadius: 5,
					},
					patches
				)
		)
		this.games.set(name, instance)
		return instance
	}
}

export const games = new Games()

export * from './interactive-state'
