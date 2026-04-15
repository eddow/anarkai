import { BasicDwelling } from 'ssh/board/content/basic-dwelling'
import type { Game } from 'ssh/game/game'
import type { Character } from 'ssh/population/character'

export function releaseAllHomeReservations(game: Game, character: Character): void {
	game.hex.zoneManager.releaseReservation(character)
	for (const tile of game.hex.tiles) {
		const content = tile.content
		if (content instanceof BasicDwelling) content.releaseHome(character)
	}
}

export function findDwellingReservedBy(
	game: Game,
	character: Character
): BasicDwelling | undefined {
	for (const tile of game.hex.tiles) {
		const content = tile.content
		if (content instanceof BasicDwelling && content.isReservedBy(character)) return content
	}
	return undefined
}
