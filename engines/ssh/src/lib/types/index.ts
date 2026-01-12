import { scope, type Type, type } from 'arktype'
import { positionTypes } from '$lib/utils/position'
import type { ScriptExecution } from '../game/npcs/scripts'
import { baseGameScope } from './base'
import { gameObjectsModule } from './game-objects'
import { contractDecorator, type Contract } from './contracts'

// Re-export contract runtime helpers
export { checkContract, isContract, registerContract, type Contract } from './contracts'

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

export function contract(...schemasInput: (string | Type | ArkDef)[]) {
	const allStrings = schemasInput.every((s) => typeof s === 'string')
	const validate = allStrings ? contractScope.type(schemasInput as any) : type(schemasInput as any)
	return contractDecorator(validate)
}

export function overloadContract<Args extends any[][]>(...schemasInput: Args) {
	// @ts-expect-error: no proper ArkDef
	return contractDecorator(type.or(...schemasInput))
}

export type ContractType<T> = {
	[K in keyof T]: T[K] extends readonly any[]
		? (...args: any[]) => ScriptExecution
		: T[K] extends object
			? ContractType<T[K]>
			: never
}
