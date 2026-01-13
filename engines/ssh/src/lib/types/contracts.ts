import { type } from 'arktype'

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
	return (_target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
		const originalMethod = descriptor.value
		descriptor.value = registerContract(function contractValidator(this: any, ...args: any[]) {
			checkContract(validate, args, propertyKey)
			return originalMethod.apply(this, args)
		})
		Object.defineProperty(descriptor.value, 'name', { value: propertyKey })
		return descriptor
	}
}

export type Contract = readonly string[] | { [K: string]: Contract }
