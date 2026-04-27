import { goods as goodsCatalog } from 'engine-rules'
import { atomic, effect, unreactive } from 'mutts'
import type { LooseGood } from 'ssh/board/looseGoods'
import type { Game } from 'ssh/game/game'
import type { Character } from 'ssh/population/character'
import type { Storage } from 'ssh/storage'
import type { GoodType } from 'ssh/types'
import { casing } from 'ssh/utils'
import type { Position, Positioned } from 'ssh/utils/position'
import { activityDurations, needUpdate } from '../../../assets/constants'
import { assert } from '../dev/debug.ts'
import type { ScriptedObject } from './object'
import { lerp } from './utils'

export interface SerializedStep {
	type: string
	[key: string]: any
}

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
		if (this.status !== 'pending') return
		for (const callback of [...this.#finished, ...this.#final]) callback()
		this.status = 'finished'
	}
}
export abstract class ASingleStep extends Finalized {
	/**
	 * When true, finishing successfully makes `tick(dt)` return the full `dt` (no partial consumption).
	 * Another instance of the same kind may legitimately follow in the same frame (e.g. a new queue wait).
	 */
	static readonly fullRemainingOnComplete: boolean = false

	get description(): string | false {
		return casing(this.constructor.name).transform((terms) => {
			const lastTerm = terms.pop()
			assert(lastTerm === 'Step', `${this.constructor.name} does not end with "Step"`)
			return terms
		}).kebab
	}

	/**
	 * Called each frame to update the step
	 * @param dt Time since last frame
	 * @returns Time remaining after finishing the step, or undefined if the step is not yet finished
	 */
	abstract tick(dt: number): number | undefined
	abstract readonly type: Ssh.ActivityType
	abstract serialize(): SerializedStep

	static deserialize(
		game: Game,
		character: Character,
		data: SerializedStep
	): ASingleStep | undefined {
		switch (data.type) {
			case 'QueueStep': {
				// Re-attempt the move to join the queue
				const step = game.hex.moveCharacter(character, data.target)
				if (step && data.passed) step.pass()
				return step
			}
			case 'MoveToStep': {
				const step = new MoveToStep(
					data.duration,
					character,
					data.to,
					data.activityType,
					data.givenDescription
				)
				step.evolution = data.evolution
				// Bypass readonly check for restoration
				;(step as any).from = data.from
				step.lerp(step.from) // Restore initial position state if needed
				return step
			}
			case 'MultiMoveStep': {
				// Assumption: movements are relative to the character or solvable
				// For now, we only support character-centric MultiMoveStep for serialization correctness
				// If `who` is not the character, this might break.
				// However, standard usage usually implies character self-movement.
				const movements = (data.movements as any[]).map((m) => ({
					...m,
					who: character, // Force bind to character for now as we don't serialize 'who' reference
				}))
				const step = new MultiMoveStep(
					data.duration,
					movements,
					data.activityType,
					data.givenDescription
				)
				step.evolution = data.evolution
				return step
			}
			case 'DurationStep': {
				const step = new DurationStep(data.duration, data.activityType, data.givenDescription)
				step.evolution = data.evolution
				return step
			}
			case 'WaitForPredicateStep':
				// Predicates are closures and hard to serialize.
				// Fallback: Return undefined to skip this step, character becomes idle/decides again.
				return undefined
			case 'EatStep': {
				// World-sourced eating cannot be faithfully restored without the consumed good reference.
				console.warn('[EatStep] deserialize skipped (world eat sources not serialized)')
				return undefined
			}
			case 'PonderingStep': {
				const step = new PonderingStep(character, data.duration)
				step.evolution = data.evolution
				return step
			}
			default:
				console.warn(`Unknown step type for deserialization: ${data.type}`)
				return undefined
		}
	}
}

/** Used by scripted object update: skip “useless same-kind step” when completion always passes full dt through. */
export function stepPassesFullRemainingOnComplete(ctor: Function): boolean {
	return (ctor as { fullRemainingOnComplete?: boolean }).fullRemainingOnComplete === true
}

export class QueueStep<Entity extends ScriptedObject> extends ASingleStep {
	static override readonly fullRemainingOnComplete = true

	get type() {
		return 'idle' as const
	}
	// TODO: marche à droite
	passed = false
	constructor(
		waiter: Entity,
		queue: Entity[],
		public target: Positioned
	) {
		super()
		queue.push(waiter)
		const waiting = effect`queue.wait`(() => {
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
	serialize(): SerializedStep {
		return {
			type: 'QueueStep',
			target: this.target,
			passed: this.passed,
		}
	}
}

export abstract class AEvolutionStep extends ASingleStep {
	constructor(public readonly duration: number) {
		if (duration <= 0) debugger
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
		public readonly to: T
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
		readonly givenDescription?: string
	) {
		super(duration, who.position, to)
	}
	lerp(position: Positioned): void {
		this.who.position = 'position' in position ? position.position : position
	}
	serialize(): SerializedStep {
		return {
			type: 'MoveToStep',
			duration: this.duration,
			evolution: this.evolution,
			to: this.to,
			from: this.from,
			activityType: this.type,
			givenDescription: this.givenDescription,
		}
	}
}

export class MultiMoveStep extends AEvolutionStep {
	get description(): string | false {
		return this.givenDescription ?? super.description
	}
	constructor(
		duration: number,
		readonly movements: Array<{
			who: { position: Position }
			from?: Position
			to: Positioned
		}>,
		readonly type: Ssh.ActivityType = 'work',
		readonly givenDescription?: string,
		private readonly beforeEvolve?: () => void
	) {
		super(duration)
		// Capture the starting positions at construction time
		for (const movement of this.movements) {
			movement.from ??= { ...movement.who.position }
		}
	}
	evolve(evolution: number): void {
		this.beforeEvolve?.()
		if (this.status !== 'pending') return
		// Lerp each movement independently
		for (const movement of this.movements) {
			movement.who.position = lerp(movement.from!, movement.to, evolution) as Position
		}
	}
	serialize(): SerializedStep {
		return {
			type: 'MultiMoveStep',
			duration: this.duration,
			evolution: this.evolution,
			movements: this.movements.map((m) => ({
				from: m.from,
				to: m.to,
				// omit 'who' as it's runtime ref
			})),
			activityType: this.type,
			givenDescription: this.givenDescription,
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
		readonly givenDescription: string
	) {
		super(duration)
	}
	serialize(): SerializedStep {
		return {
			type: 'DurationStep',
			duration: this.duration,
			evolution: this.evolution,
			activityType: this.type,
			givenDescription: this.givenDescription,
		}
	}
}

export class WaitForPredicateStep extends ASingleStep {
	static override readonly fullRemainingOnComplete = true

	get type() {
		return 'idle' as const
	}
	private passed = false
	constructor(
		readonly descriptionText: string,
		private readonly predicate: () => boolean
	) {
		super()
	}
	get description(): string | false {
		return this.descriptionText
	}
	tick(dt: number): number | undefined {
		if (!this.passed && this.predicate()) {
			this.passed = true
			this.finish()
		}
		return this.passed ? dt : undefined
	}
	serialize(): SerializedStep {
		return {
			type: 'WaitForPredicateStep',
			descriptionText: this.descriptionText,
		}
	}
}

//#endregion
//#region self-care

/** Eat from loose goods or tile storage (not character carry). Food is committed at step start. */
export type EatWorldSource =
	| { kind: 'loose'; looseGood: LooseGood }
	| { kind: 'storage'; storage: Storage }

export class EatStep extends AEvolutionStep {
	get type() {
		return 'eat' as const
	}
	private readonly satiationStrength: number
	private lastEvolution = 0
	constructor(
		readonly character: Character,
		readonly food: GoodType,
		source: EatWorldSource
	) {
		super(activityDurations.eating)
		assert('satiationStrength' in goodsCatalog[food], `Food ${food} has no satiation strength`)
		this.satiationStrength = goodsCatalog[food].satiationStrength as number
		if (source.kind === 'loose') {
			source.looseGood.allocate('eat').fulfill()
		} else {
			source.storage.reserve({ [food]: 1 }, 'eat').fulfill()
		}
	}
	evolve(evolution: number): void {
		const delta = Math.max(0, evolution - this.lastEvolution)
		this.lastEvolution = evolution
		this.character.hunger = needUpdate(this.character.hunger, -1, this.satiationStrength * delta)
	}
	serialize(): SerializedStep {
		return {
			type: 'EatStep',
			food: this.food,
			evolution: this.evolution,
			duration: this.duration,
		}
	}
}

export class PonderingStep extends AEvolutionStep {
	get type() {
		return 'rest' as const
	}
	constructor(
		readonly character: Character,
		duration?: number
	) {
		super(
			duration ??
				lerp(activityDurations.restMin, activityDurations.restMax, character.game.random())
		)
	}
	serialize(): SerializedStep {
		return {
			type: 'PonderingStep',
			duration: this.duration,
			evolution: this.evolution,
		}
	}
}

//#endregion
