import { atomic, unreactive } from 'mutts'
import { activityDurations, ponderingFatigueRecovery } from '$assets/constants'
import { goods as goodsCatalog } from '$assets/game-content'
import { assert, namedEffect } from '$lib/debug'
import type { GoodType } from '$lib/types'
import { casing } from '$lib/utils'
import type { Position, Positioned } from '../../utils/position'
import type { Character } from '../population'
import type { ScriptedObject } from './object'
import { lerp } from './utils'

//#region Abstracts

@unreactive
export class Finalized {
	#finished: (() => void)[] = []
	#canceled: (() => void)[] = []
	#final: (() => void)[] = []
	public status: 'pending' | 'finished' | 'canceled' = 'pending'
	final(final: () => void) {
		this.#final.push(final)
		return this
	}
	canceled(canceled: () => void) {
		this.#canceled.push(canceled)
		return this
	}
	finished(finished: () => void) {
		this.#finished.push(finished)
		return this
	}
	@atomic
	cancel() {
		for (const callback of [...this.#canceled, ...this.#final]) callback()
		this.status = 'canceled'
	}
	@atomic
	finish() {
		for (const callback of [...this.#finished, ...this.#final]) callback()
		this.status = 'finished'
	}
}
export abstract class ASingleStep extends Finalized {
	get description(): string | false {
		return casing(this.constructor.name).transform((terms) => {
			const lastTerm = terms.pop()
			assert(lastTerm === 'Step', `${this.constructor.name} does not end with "Step"`)
		}).kebab
	}

	/**
	 * Called each frame to update the step
	 * @param dt Time since last frame
	 * @returns Time remaining after finishing the step, or undefined if the step is not yet finished
	 */
	abstract tick(dt: number): number | undefined
	abstract readonly type: Ssh.ActivityType
}

export class QueueStep<Entity extends ScriptedObject> extends ASingleStep {
	get type() {
		return 'idle' as const
	}
	// TODO: marche à droite
	passed = false
	constructor(
		waiter: Entity,
		queue: Entity[],
		public target: Positioned,
	) {
		super()
		queue.push(waiter)
		const waiting = namedEffect('queue.wait', () => {
			if (queue[0] === waiter) {
				this.finish()
				this.passed = true
				waiting()
			}
		})
	}
	pass() {
		this.passed = true
		this.finish()
	}
	tick(dt: number): number | undefined {
		return this.passed ? dt : undefined
	}
}

export abstract class AEvolutionStep extends ASingleStep {
	constructor(public readonly duration: number) {
		super()
	}
	evolution = 0
	evolve(_evolution: number, _dt: number): void {}
	tick(dt: number): number | undefined {
		this.evolution += dt / this.duration
		if (this.evolution >= 1) {
			this.evolve(1, this.evolution - 1)
			this.finish()
			return (this.evolution - 1) * this.duration
		} else this.evolve(this.evolution, dt / this.duration)
	}
}

export abstract class ALerpStep<T extends number | Positioned> extends AEvolutionStep {
	constructor(
		duration: number,
		public readonly from: T,
		public readonly to: T,
	) {
		super(duration)
	}
	abstract lerp(value: T): void
	evolve(evolution: number): void {
		this.lerp(lerp(this.from, this.to, evolution))
	}
}

//#endregion
//#region Commons
export class MoveToStep extends ALerpStep<Positioned> {
	get description(): string | false {
		return this.givenDescription ?? super.description
	}
	constructor(
		duration: number,
		readonly who: { position: Position },
		to: Positioned,
		readonly type: Ssh.ActivityType = 'walk',
		readonly givenDescription?: string,
	) {
		super(duration, who.position, to)
	}
	lerp(position: Position): void {
		this.who.position = position
	}
}

export class MultiMoveStep extends AEvolutionStep {
	get description(): string | false {
		return this.givenDescription ?? super.description
	}
	constructor(
		duration: number,
		readonly movements: Array<{ who: { position: Position }; from?: Position; to: Positioned }>,
		readonly type: Ssh.ActivityType = 'work',
		readonly givenDescription?: string,
	) {
		super(duration)
		// Capture the starting positions at construction time
		for (const movement of this.movements) {
			movement.from ??= { ...movement.who.position }
		}
	}
	evolve(evolution: number): void {
		// Lerp each movement independently
		for (const movement of this.movements) {
			movement.who.position = lerp(movement.from!, movement.to, evolution) as Position
		}
	}
}

export class DurationStep extends AEvolutionStep {
	get description(): string | false {
		return this.givenDescription
	}
	constructor(
		duration: number,
		readonly type: Ssh.ActivityType,
		readonly givenDescription: string,
	) {
		super(duration)
	}
}

export class WaitForPredicateStep extends ASingleStep {
	get type() {
		return 'idle' as const
	}
	private passed = false
	constructor(
		readonly descriptionText: string,
		predicate: () => boolean,
	) {
		super()
		const stop = namedEffect('waitForPredicate', () => {
			if (predicate()) {
				this.passed = true
				this.finish()
				stop()
			}
		})
	}
	get description(): string | false {
		return this.descriptionText
	}
	tick(dt: number): number | undefined {
		return this.passed ? dt : undefined
	}
}

//#endregion
//#region self-care
export class EatStep extends AEvolutionStep {
	get type() {
		return 'eat' as const
	}
	private readonly feedingValue: number
	constructor(
		readonly character: Character,
		readonly food: GoodType,
	) {
		super(activityDurations.eating)
		assert('feedingValue' in goodsCatalog[food], `Food ${food} has no feeding value`)
		this.feedingValue = goodsCatalog[food].feedingValue as number
		assert(this.character.carry.removeGood(food, 1) === 1, "Didn't have food he is trying to eat")
	}
	evolve(_: number, dt: number): void {
		this.character.hunger = Math.max(0, this.character.hunger - this.feedingValue * dt)
	}
}

export class PonderingStep extends AEvolutionStep {
	get type() {
		return 'rest' as const
	}
	evolve(_: number, dt: number): void {
		this.character.fatigue = Math.max(0, this.character.fatigue - ponderingFatigueRecovery * dt)
	}
	constructor(
		readonly character: Character,
		duration?: number,
	) {
		super(
			duration ??
				lerp(activityDurations.restMin, activityDurations.restMax, character.game.random()),
		)
	}
}

//#endregion
