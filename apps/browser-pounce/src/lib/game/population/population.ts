import { type AxialCoord, toAxialCoord } from '$lib/utils'
import { type RandGenerator, uuid } from '$lib/utils/numbers'
import type { Game } from '../game'
import { GameObject, withContainer, withHittable } from '../object'
import { Character } from './character'

export class Population extends withContainer(withHittable(GameObject)) {
	private characters: Map<string, Character> = new Map()

	public characterGen: RandGenerator
	constructor(public readonly game: Game) {
		super(game)
		this.characterGen = game.lcg('characterGen')
		this.zIndex = 1 // Foreground layer - characters should be hit-tested first
	}

	hitTest(worldX: number, worldY: number, selectedAction?: string): any {
		if (selectedAction && selectedAction !== 'select') return false
		const coord = toAxialCoord({ x: worldX, y: worldY })
		// Check if any character is hit
		for (const character of this.characters.values()) {
			if (character.hitTest(coord, selectedAction)) return character
		}
		return false
	}

	// Create a new character
	createCharacter(name: string, coord: AxialCoord): Character {
		// Generate a proper UUID for the character
		const characterUid = uuid(this.characterGen)
		const character = new Character(this.game, characterUid, name, coord)
		this.characters.set(characterUid, character)
		this.add(character)
		return character
	}

	// Remove a character
	removeCharacter(name: string): boolean {
		const character = this.characters.get(name)
		if (character) {
			this.characters.delete(name)
			this.delete(character)
			return true
		}
		return false
	}
	get nbrFree(): number {
		return Array.from(this.characters.values()).reduce(
			(acc, character) => (character.assignedAlveolus === undefined ? acc + 1 : acc),
			0,
		)
	}
}
