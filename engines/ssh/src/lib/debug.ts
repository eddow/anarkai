import { effect, enableDevTools, reactiveOptions } from 'mutts'

export function nf<T extends Function>(name: string, fn: T): T {
	Object.defineProperty(fn, 'name', { value: name })
	return fn
}
export function namedEffect(name: string, fn: () => void): () => void {
	return effect(nf(name, fn))
}
export class AssertionError extends Error {
	constructor(message: string) {
		super(`Assertion failure: ${message}`)
		this.name = 'AssertionError'
	}
}
export function assert(condition: any, message: string): asserts condition {
	if (!condition) throw new AssertionError(message)
}
export function defined<T>(value: T | undefined, message = 'Value is defined'): T {
	assert(value !== undefined, message)
	return value
}

export const traces: Record<string, typeof console | undefined> = {}

//traces.advertising = console
const debugMutts = false
if (debugMutts) {
	reactiveOptions.chain = (targets: Function[], caller?: Function) => {
		console.log(
			caller
				? `${caller.name} -> ${targets.map((t) => t.name).join(' -> ')}`
				: `-> ${targets.map((t) => t.name).join(' -> ')}`,
		)
	}
	reactiveOptions.beginChain = (targets: Function[]) => {
		console.groupCollapsed(`${targets.map((t) => t.name).join(' -> ')}`)
	}
	reactiveOptions.endChain = () => {
		console.groupEnd()
	}
	reactiveOptions.skipRunningEffect = (effect: Function, chain: Function[]) => {
		console.log(
			`Skipping running effect: ${chain.map((t) => t.name).join(' -> ')} -> ${effect.name}`,
		)
	}
}
reactiveOptions.maxEffectChain = 2000
reactiveOptions.maxEffectReaction = 'throw'
// Disable requestAnimationFrame zone patching: ensures callbacks run without a parent effect context
// (does not disable the function itself, just the reactivity engine context propagation)
reactiveOptions.zones.requestAnimationFrame = false
enableDevTools()

export function initConsoleTrap() {
	if (typeof window === 'undefined') return
	if (document.getElementById('console-trap')) return

	const errors: { type: string; message: string }[] = []
	const trap = document.createElement('div')
	trap.id = 'console-trap'
	trap.style.display = 'none'
	trap.setAttribute('data-errors', '[]')
	document.body.appendChild(trap)

	const originalError = console.error
	const originalWarn = console.warn

	const update = () => {
		trap.setAttribute('data-errors', JSON.stringify(errors))
	}

	function serializeArgs(args: any[]) {
		return args
			.map((a) => {
				if (typeof a === 'string') return a
				if (a instanceof Error) return a.message + '\n' + a.stack
				try {
					return JSON.stringify(a)
				} catch (e) {
					return String(a)
				}
			})
			.join(' ')
	}

	console.error = (...args: any[]) => {
		originalError.apply(console, args)
		errors.push({ type: 'error', message: serializeArgs(args) })
		update()
	}

	console.warn = (...args: any[]) => {
		originalWarn.apply(console, args)
		errors.push({ type: 'warning', message: serializeArgs(args) })
		update()
	}

	// Capture unhandled promise rejections
	window.addEventListener('unhandledrejection', (event) => {
		errors.push({
			type: 'unhandledrejection',
			message:
				event.reason instanceof Error
					? (event.reason.stack ?? event.reason.message)
					: String(event.reason),
		})
		update()
	})

	// Capture uncaught exceptions
	window.addEventListener('error', (event) => {
		errors.push({
			type: 'uncaughterror',
			message:
				event.error instanceof Error ? (event.error.stack ?? event.error.message) : event.message,
		})
		update()
	})
}

// Black Box Logging System
export type LogFn = typeof console.log;

export const blackBoxLog = {
	pathFinding: undefined as LogFn | undefined,
	offload: undefined as LogFn | undefined,
	inventory: undefined as LogFn | undefined,
	jobs: undefined as LogFn | undefined,
	behavior: undefined as LogFn | undefined,
};

export function logGroup(logger: LogFn | undefined | false, label: string, body: () => void) {
	if (logger) {
		console.group(label)
		try {
			body()
		} finally {
			console.groupEnd()
		}
	}
}
