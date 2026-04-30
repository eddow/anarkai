import type { GoodType } from 'ssh/types'

type Constructor<T extends object = object> = abstract new (...args: never[]) => T

/**
 * Mixin that adds game-content definition support to a class.
 * Call {@link assignGameContent} from the subclass constructor after `super(...)`.
 */
export function GcClassed<T extends object, Base extends Constructor = Constructor>(
	baseCtor?: Base
) {
	const ResolvedBase = (baseCtor ?? (Object as unknown as Base)) as Constructor

	return class GcClassedMixin extends ResolvedBase {
		readonly definition!: T
		readonly resourceName!: string

		get name(): string {
			return this.resourceName
		}

		/** Must run once per instance, after `super`, to attach catalog metadata. */
		protected assignGameContent(def: T, resourceName: string): void {
			Object.defineProperty(this, 'definition', {
				value: def,
				enumerable: true,
				writable: false,
				configurable: true,
			})
			Object.defineProperty(this, 'resourceName', {
				value: resourceName,
				enumerable: true,
				writable: false,
				configurable: true,
			})
			// Mirror catalog fields on the instance (same idea as former prototype assign).
			// Copy only known keys — never blindly `Object.assign` arbitrary enumerables onto runtime objects
			// (would clobber `hive`, `tile`, etc. if present or introduced later).
			const candidate = def as object
			if (
				typeof candidate === 'object' &&
				candidate !== null &&
				'preparationTime' in candidate &&
				'action' in candidate &&
				'workTime' in candidate
			) {
				const alveolusDef = candidate as Ssh.AlveolusDefinition
				Object.assign(this as object, {
					preparationTime: alveolusDef.preparationTime,
					action: alveolusDef.action,
					workTime: alveolusDef.workTime,
					...(alveolusDef.construction !== undefined
						? { construction: alveolusDef.construction }
						: {}),
				})
				return
			}

			if (
				typeof candidate === 'object' &&
				candidate !== null &&
				'maxAmount' in candidate &&
				!('action' in candidate)
			) {
				Object.assign(this as object, candidate as Ssh.DepositDefinition)
				return
			}

			Object.assign(this as object, candidate)
		}
	} as unknown as abstract new (
		...args: any[]
	) => InstanceType<Base> &
		T & {
			readonly definition: T
			readonly resourceName: string
			readonly name: string
		}
}

export function multiplyGoodsQty(record: Partial<Record<GoodType, number>>, multiplier: number) {
	return Object.fromEntries(
		Object.entries(record).map(([goodType, quantity]) => [goodType, quantity * multiplier])
	)
}
