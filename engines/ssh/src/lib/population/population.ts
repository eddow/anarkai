import type { Game } from 'ssh/game/game'
import { GameObject, withContainer } from 'ssh/game/object'
import { type AxialCoord } from 'ssh/utils'
import type { RandGenerator } from 'ssh/utils/numbers'
import { Character } from './character'

export class Population extends withContainer(GameObject) {
	public characterGen: RandGenerator
	constructor(public readonly game: Game) {
		super(game)
		this.characterGen = game.lcg('characterGen')
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
