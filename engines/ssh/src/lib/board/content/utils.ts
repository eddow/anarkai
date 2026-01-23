import { reactive } from 'mutts'
import type { GoodType } from '$lib/types'

type Ctor<T extends object = any> = new (...args: any[]) => T

export function GcClass<BaseCtor extends Ctor<any>>(
	Base: (def: any) => BaseCtor | undefined,
	name: string,
	def: any,
): BaseCtor | undefined {
	const BaseClass = Base(def)
	if (!BaseClass) return undefined
	class Sub extends BaseClass {
		constructor(...args: any[]) {
			super(...args)
			// TODO: This is a hack that shoud not be necessary
			// Force reactivity for all game-content generated classes
			// biome-ignore lint/correctness/noConstructorReturn: Required for reactivity
			return reactive(this)
		}
		static resourceName = name
	}
	Object.defineProperties(Sub, { name: { value: `${Base.name}<${name}>` } })
	Object.assign(Sub.prototype, def)
	// Expose a helpful debug label for instances
	try {
		Object.defineProperties(Sub.prototype, {
			[Symbol.toStringTag]: { value: `${Base.name}<${name}>`, configurable: true },
			[Symbol.for('nodejs.util.inspect.custom')]: {
				// eslint-disable-next-line @typescript-eslint/no-unused-vars
				value(this: unknown, _depth?: number, _options?: unknown, _inspect?: unknown) {
					return `${Base.name}<${name}>`
				},
				configurable: true,
			},
		})
	} catch {
		// Best-effort; ignore environments where symbols are not configurable
	}
	return Sub as unknown as BaseCtor
}

export function GcClasses<
	BaseCtor extends Ctor<any>,
	Entries extends Record<string, any> = Record<string, any>,
>(Base: (def: any) => BaseCtor | undefined, entries: Entries) {
	return Object.fromEntries(
		Object.entries(entries).map(([name, def]) => [name, GcClass(Base, name, def)]),
	) as { [K in keyof Entries]: BaseCtor & Entries[K] }
}

/**
 * Mixin that adds game-content definition support to a class
 * @param Base - Optional base class to extend (defaults to Object)
 * @returns A class that extends Base and includes definition/name properties
 */
export function GcClassed<
	T extends object,
	Base extends abstract new (
		...args: any[]
	) => any = typeof Object,
>(Base: Base = Object as any) {
	return class extends (Base as any) {
		get name() {
			// @ts-expect-error
			return this.constructor.resourceName
		}
	} as any as abstract new (
		...args: any[]
	) => InstanceType<Base> & T & { readonly name: string }
}

export function multiplyGoodsQty(record: Partial<Record<GoodType, number>>, multiplier: number) {
	return Object.fromEntries(
		Object.entries(record).map(([goodType, quantity]) => [goodType, quantity * multiplier]),
	)
}
