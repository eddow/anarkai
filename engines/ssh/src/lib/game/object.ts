// Library used by Pixi
import EventEmitter from 'eventemitter3'
import { ReactiveBase, reactive, unreactive, unwrap } from 'mutts'
import type { Tile } from 'ssh/board/tile'
import type { Position } from 'ssh/utils/position'
import type { Game } from './game'

// All pixi objects extend this `EventEmitter` and should be unreactive
unreactive(EventEmitter)

// Base game object class
export abstract class GameObject extends ReactiveBase {
	constructor(
		public readonly game: Game,
		..._args: any[]
	) {
		super()
	}
	public destroyed: boolean = false
	/** Convenience random using the owning game's RNG */
	random(max?: number, min?: number) {
		return this.game.random(max, min)
	}
	destroy() {
		this.destroyed = true
	}
}

export interface InteractiveLogObject {
	readonly logs: string[]
	logAbout(topic: unknown, ...args: unknown[]): void
}

const interactiveLogObjects = new WeakSet<InteractiveLogObject>()

export function isInteractiveLogObject(value: unknown): value is InteractiveLogObject {
	return (
		typeof value === 'object' &&
		value !== null &&
		interactiveLogObjects.has(value as InteractiveLogObject)
	)
}

function registerInteractiveLogObject(object: InteractiveLogObject): void {
	interactiveLogObjects.add(object)
}

function unregisterInteractiveLogObject(object: InteractiveLogObject): void {
	interactiveLogObjects.delete(object)
}

// Mixin functions for composition

export function withInteractive<T extends abstract new (...args: any[]) => GameObject>(Base: T) {
	abstract class InteractiveMixin extends Base {
		/**
		 * Log messages associated with the object. Intended for UI display.
		 */
		public readonly logs: string[] = reactive([])

		constructor(...args: any[]) {
			const game = args[0] as Game
			super(...args)
			registerInteractiveLogObject(this)
			game.enqueueInteractiveRegistration?.(this)
		}

		lastTopic: any | undefined = undefined
		logAbout(topic: any, ...args: any[]) {
			let line: string
			try {
				line = args.map((a) => a.toString()).join(' ')
			} catch {
				// Fallback if JSON serialization fails
				line = String(args)
			}
			if (topic !== undefined && unwrap(this.lastTopic) === unwrap(topic)) {
				this.logs[this.logs.length - 1] = line
			} else {
				this.logs.push(line)
			}
			this.lastTopic = topic
		}

		/**
		 * Append a log line to this object's logs
		 */
		log(...args: any[]) {
			this.logAbout(undefined, ...args)
		}

		abstract canInteract(action: string): boolean
		abstract readonly title: string
		abstract readonly debugInfo?: Record<string, any>
		abstract readonly position: Position | undefined
		abstract readonly tile: Tile

		destroy(): void {
			unregisterInteractiveLogObject(this)
			this.game.enqueueInteractiveUnregistration?.(this)
			super.destroy()
		}
	}
	return InteractiveMixin
}

export function withContainer<T extends abstract new (...args: any[]) => GameObject>(Base: T) {
	abstract class ContainerMixin extends Base {
		children = new Set<GameObject>()

		add(child: GameObject): this {
			this.children.add(child)
			return this
		}

		delete(child: GameObject): boolean {
			child.destroy()
			return this.children.delete(child)
		}

		has(child: GameObject): boolean {
			return this.children.has(child)
		}

		clear(): void {
			for (const child of this.children) child.destroy()
			this.children.clear()
		}

		destroy(): void {
			this.clear()
			super.destroy()
		}
	}
	return ContainerMixin
}

export type InteractiveGameObject = InstanceType<
	ReturnType<typeof withInteractive<typeof GameObject>>
>

export interface InspectorSelectableObject {
	readonly title: string
	readonly game: Game
	readonly logs: readonly string[]
	readonly position?: Position
	readonly hoverObject?: InteractiveGameObject
}

export function resolveSelectableHoverObject(
	object: InspectorSelectableObject | InteractiveGameObject | undefined
): InteractiveGameObject | undefined {
	if (!object) return undefined
	return 'canInteract' in object ? object : object.hoverObject
}
