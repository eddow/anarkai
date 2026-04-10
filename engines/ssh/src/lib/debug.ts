import { debugPreset, devPreset, reactiveOptions } from 'mutts'
import type { PlannerFindActionSnapshot } from 'ssh/population/findNextActivity'
import { debugActiveAllocations, getAllocationStats } from 'ssh/storage/guard'

export function nf<T extends Function>(name: string, fn: T): T {
	Object.defineProperty(fn, 'name', { value: name })
	return fn
}
export class AssertionError extends Error {
	constructor(message: string) {
		super(`Assertion failure: ${message}`)
		this.name = 'AssertionError'
	}
}
export function assert(condition: any, message: string): asserts condition {
	if (!condition) {
		throw new AssertionError(message)
	}
}
export function defined<T>(value: T | undefined, message = 'Value is defined'): T {
	assert(value !== undefined, message)
	return value
}

export const traces: Record<string, typeof console | undefined> = {}

//traces.advertising = console
//traces.allocations = console
//Object.assign(reactiveOptions, debugPreset)
Object.assign(reactiveOptions, devPreset)
reactiveOptions.maxEffectChain = 2000
reactiveOptions.maxEffectReaction = 'throw'
// TODO: comment it for normal functioning (performances killer) - allow it to test discrepancies
reactiveOptions.onMemoizationDiscrepancy = (
	cached: any,
	fresh: any,
	fn: any,
	args: any,
	cause: string
) => {
	console.error(`Memoization discrepancy in method ${fn?.name || 'unknown'}:`, {
		cached,
		fresh,
		host: args?.[0],
		cause,
	})
	debugger
	throw new Error(`Memoization discrepancy: ${cause}`)
}

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
				if (a instanceof Error) return `${a.message}\n${a.stack}`
				try {
					return JSON.stringify(a)
				} catch (_e) {
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
export type LogFn = typeof console.log

export const blackBoxLog = {
	pathFinding: undefined as LogFn | undefined,
	offload: undefined as LogFn | undefined,
	inventory: undefined as LogFn | undefined,
	jobs: undefined as LogFn | undefined,
	behavior: undefined as LogFn | undefined,
	/** Set to `console.log` to print utility-ranked activities from `findNextActivity`. */
	characterNeeds: undefined as LogFn | undefined,
	/** Set to `console.log` to print each `findAction` resolution (ranked utilities vs fallback wander). */
	idleDiagnosis: undefined as LogFn | undefined,
}

/** Structured hook for tests / devtools: assign `traces.characterNeeds = console` */
export function traceNeeds(topic: string, payload: unknown) {
	traces.characterNeeds?.log(topic, payload)
}

export type IdleDiagnosisPayload = PlannerFindActionSnapshot & {
	name?: string
	/** Extra context when `outcome.source === 'fallback-wander'`. */
	note?: string
}

/** Assign `traces.idleDiagnosis = console` and/or `blackBoxLog.idleDiagnosis = console.log` to inspect `findAction`. */
export function traceIdleDiagnosis(payload: IdleDiagnosisPayload) {
	traces.idleDiagnosis?.log('findAction', payload)
	if (blackBoxLog.idleDiagnosis) {
		const ranked = payload.ranked.map((r) => `${r.kind}:${r.utility}`).join(' | ')
		blackBoxLog.idleDiagnosis(
			`[idleDiagnosis] ${payload.name ?? 'character'}`,
			`${payload.outcome.source} → ${payload.outcome.kind} | ${ranked}${payload.note ? ` | ${payload.note}` : ''}`
		)
	}
}

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

// Allocation debugging helpers
export function debugAllocations() {
	if (!traces.allocations) {
		console.warn('Allocation tracing is not enabled. Set traces.allocations = console to enable.')
		return
	}

	const stats = getAllocationStats()
	const active = debugActiveAllocations()

	console.group('🔍 Allocation Debug Report')
	console.log('📊 Stats:', stats)
	console.log(`📝 Active allocations: ${active.length}`)

	if (active.length > 0) {
		console.group('📋 Active allocations details')
		active.forEach((held: any, index: number) => {
			const age = Date.now() - held.createdAt
			console.group(`${index + 1}. ${held.id} (${age}ms old)`)
			console.log('Type:', held.reason?.type || 'unknown')
			console.log('Good Type:', held.reason?.goodType || 'unknown')
			console.log('Provider:', held.reason?.providerName || held.reason?.provider || 'unknown')
			console.log('Demander:', held.reason?.demanderName || held.reason?.demander || 'unknown')
			console.log('Movement ID:', held.reason?.movementId || 'unknown')
			console.log('Created:', new Date(held.createdAt).toISOString())
			console.log('Stack trace:', held.stack)
			console.groupEnd()
		})
		console.groupEnd()
	}

	console.groupEnd()
}

export function findAllocationByMovementId(movementId: string) {
	if (!traces.allocations) {
		console.warn('Allocation tracing is not enabled. Set traces.allocations = console to enable.')
		return
	}

	const active = debugActiveAllocations()

	const found = active.filter((held: any) => held.reason?.movementId === movementId)

	if (found.length === 0) {
		console.log(`No active allocations found for movement ID: ${movementId}`)
		return
	}

	console.group(`🔍 Found ${found.length} allocations for movement: ${movementId}`)
	found.forEach((held: any, index: number) => {
		const age = Date.now() - held.createdAt
		console.group(`${index + 1}. ${held.id} (${age}ms old)`)
		console.log('Type:', held.reason?.type || 'unknown')
		console.log('Good Type:', held.reason?.goodType || 'unknown')
		console.log('Provider:', held.reason?.providerName || held.reason?.provider || 'unknown')
		console.log('Demander:', held.reason?.demanderName || held.reason?.demander || 'unknown')
		console.log('Created:', new Date(held.createdAt).toISOString())
		console.log('Stack trace:', held.stack)
		console.groupEnd()
	})
	console.groupEnd()

	return found
}
