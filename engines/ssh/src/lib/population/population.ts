import { debugObjectId } from 'ssh/dev/debug-object-id'
import type { Game } from 'ssh/game/game'
import { GameObject, withContainer, withHittable } from 'ssh/game/object'
import { type AxialCoord, toAxialCoord } from 'ssh/utils'
import type { RandGenerator } from 'ssh/utils/numbers'
import { Character } from './character'

export class Population extends withContainer(withHittable(GameObject)) {
	public characterGen: RandGenerator
	constructor(public readonly game: Game) {
		super(game)
		this.characterGen = game.lcg('characterGen')
		this.zIndex = 1 // Foreground layer - characters should be hit-tested first
	}

	hitTest(worldX: number, worldY: number, selectedAction?: string): any {
		if (selectedAction && selectedAction !== 'select') return false
		const coord = toAxialCoord({ x: worldX, y: worldY })
		for (const character of this.children) {
			if (character instanceof Character && character.hitTest(coord, selectedAction))
				return character
		}
		return false
	}

	createCharacter(name: string, coord: AxialCoord): Character {
		return this.game.withObjectRegistrationBatch(() => {
			const character = new Character(this.game, name, coord)
			this.add(character)
			this.game.invalidateWorkPlanning('population.create')
			return character
		})
	}

	get nbrFree(): number {
		let count = 0
		for (const c of this.children) {
			if (c instanceof Character && c.assignedAlveolus === undefined) count++
		}
		return count
	}

	[Symbol.iterator]() {
		const children = this.children
		return iterateChildCharacters(children)
	}
}

function* iterateChildCharacters(children: Set<GameObject>): Generator<Character> {
	for (const child of children) {
		if (child instanceof Character) yield child
	}
}
