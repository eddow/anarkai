import { scope, type Type, type } from 'arktype'
import { positionTypes } from '$lib/utils/position'
import type { ScriptExecution } from '../game/npcs/scripts'
import { baseGameScope } from './base'
import { gameObjectsModule } from './game-objects'

// ============================================================
// Contract Registry - FIRST for initialization order
// ============================================================
const contractRegistry = new WeakSet<(args: any[]) => any>()

export function isContract(validate: (args: any[]) => any) {
	return contractRegistry.has(validate)
}

export function registerContract(validate: (args: any[]) => any) {
	contractRegistry.add(validate)
	return validate
}

// Re-export base scope (foundation types)
export {
	ActivityType,
	AlveolusType,
	baseGameScope,
	baseGameTypes,
	DepositType,
	Goods,
	GoodType,
	Job,
	JobType,
	Needs,
	NeedType,
	PickupPlan,
	Plan,
	TerrainType,
	TransferPlan,
	WorkPlan,
} from './base'

// ============================================================
// Unified Game Scope
// ============================================================
export const gameScope = scope({
	...baseGameScope.export(), // Already includes TransferPlan, PickupPlan, WorkPlan, Plan!
	...positionTypes,
})

export const gameTypes = gameScope.export()

// Contract scope includes game objects (AFTER gameScope is defined!)
export const contractScope = scope({
	...gameScope.export(),
	...gameObjectsModule,
})

// ============================================================
// Contract Decorator System
// ============================================================
export type ArkDef = Parameters<typeof type>[0]

function contractDecorator(validate: (args: any[]) => any) {
	return (_target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
		const originalMethod = descriptor.value
		descriptor.value = registerContract(function contractValidator(this: any, ...args: any[]) {
			const validationResult = validate(args)
			if (validationResult instanceof type.errors) {
				throw new Error(`Validation failed for ${propertyKey}: ${validationResult.summary}`)
			}
			return originalMethod.apply(this, args)
		})
		return descriptor
	}
}

export function contract(...schemasInput: (string | Type | ArkDef)[]) {
	const allStrings = schemasInput.every((s) => typeof s === 'string')
	const validate = allStrings ? contractScope.type(schemasInput as any) : type(schemasInput as any)
	return contractDecorator(validate)
}

export function overloadContract<Args extends any[][]>(...schemasInput: Args) {
	// @ts-expect-error: no proper ArkDef
	return contractDecorator(type.or(...schemasInput))
}

export type Contract = readonly string[] | { [K: string]: Contract }

export type ContractType<T> = {
	[K in keyof T]: T[K] extends readonly any[]
		? (...args: any[]) => ScriptExecution
		: T[K] extends object
			? ContractType<T[K]>
			: never
}
