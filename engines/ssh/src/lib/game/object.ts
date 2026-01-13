// Library used by Pixi
import EventEmitter from 'eventemitter3'
import { reactive, ReactiveBase, type ScopedCallback, unreactive, unwrap } from 'mutts'
import { namedEffect } from '$lib/debug'
import type { Position } from '../utils/position'
import type { Tile } from './board/tile'
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

// Mixin functions for composition


export function withInteractive<T extends abstract new (...args: any[]) => GameObject>(Base: T) {
	abstract class InteractiveMixin extends Base {
		public readonly uid: string

		/**
		 * Log messages associated with the object. Intended for UI display.
		 */
		public readonly logs: string[] = reactive([])

		constructor(...args: any[]) {
			const [game, uid] = args
			super(...args)
			this.uid = uid
			game.register(this, uid)
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
		abstract readonly position: Position
		abstract readonly tile: Tile

		destroy(): void {
			this.game.unregister(this)
			super.destroy()
		}
	}
	return InteractiveMixin
}

export function withHittable<T extends abstract new (...args: any[]) => GameObject>(Base: T) {
	abstract class HittableMixin extends Base {
		/**
		 * Z-index for hit testing priority. Higher values are tested first.
		 * Default is 0. Objects with higher zIndex will be hit-tested first.
		 */
		public zIndex: number = 0

		constructor(...args: any[]) {
			super(...args)
			this.game.registerHittable(this)
		}

		destroy(): void {
			this.game.unregisterHittable(this)
			super.destroy()
		}

		/**
		 * Test if a world point is inside this interactive object
		 * @param worldX - World X coordinate
		 * @param worldY - World Y coordinate
		 * @param selectedAction - Currently selected action (optional)
		 * @returns true if the point is inside the object
		 */
		abstract hitTest(worldX: number, worldY: number, selectedAction?: string): any
	}
	return HittableMixin
}

export function withTicked<T extends abstract new (...args: any[]) => any>(Base: T) {
	abstract class TickedMixin extends Base {
		constructor(...args: any[]) {
			super(...args)
			this.game.registerTickedObject(this)
		}

		abstract update(deltaSeconds: number): void

		destroy(): void {
			this.game.unregisterTickedObject(this)
			super.destroy()
		}
	}
	return TickedMixin
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

// Type aliases for backward compatibility

export type RenderableContainer = InstanceType<ReturnType<typeof withContainer<typeof GameObject>>>
export type HittableGameObject = InstanceType<ReturnType<typeof withHittable<typeof GameObject>>>
export type InteractiveGameObject = InstanceType<
	ReturnType<typeof withInteractive<typeof GameObject>>
>
export type TickedGameObject = InstanceType<ReturnType<typeof withTicked<typeof GameObject>>>
