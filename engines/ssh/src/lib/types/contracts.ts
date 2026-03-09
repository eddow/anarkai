import { type } from 'arktype'
import { decorator } from 'mutts'

// ============================================================
// Contract Registry
// ============================================================
const contractRegistry = new WeakSet<(args: any[]) => any>()

export function isContract(validate: (args: any[]) => any) {
	return contractRegistry.has(validate)
}

export function registerContract(validate: (args: any[]) => any) {
	contractRegistry.add(validate)
	return validate
}

// Helper for consistent validation error handling
export function checkContract(validate: (args: any[]) => any, args: any[], name: string) {
	const result = validate(args)
	if (result instanceof type.errors)
		throw new Error(`Validation failed for ${name}: ${result.summary}`)
	return result
}

export function contractDecorator(validate: (args: any[]) => any) {
	return decorator({
		method(original, _target, name) {
			return registerContract(function contractValidator(this: any, ...args: any[]) {
				checkContract(validate, args, String(name))
				return original.apply(this, args)
			})
		},
	})
}

export type Contract = readonly string[] | { [K: string]: Contract }
