import { devPreset, reactiveOptions } from 'mutts'
import type { PlannerFindActionSnapshot } from 'ssh/population/findNextActivity'
import { debugActiveAllocations, getAllocationStats } from 'ssh/storage/guard'
import {
	captureTraceRow,
	readTraceRows,
	type TraceCaptureOptions,
	type TraceLevel,
	type TraceRow,
	type TraceSink,
} from 'ssh/trace'

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

export type TraceVerb = 'log' | 'warn' | 'assert' | 'error'

export const DEFAULT_TRACE_LOG_LIFETIME = 300

const TRACE_VERB_RANK: Record<TraceVerb, number> = {
	log: 0,
	warn: 1,
	assert: 2,
	error: 3,
}

/** Known `traces.*` channels used across the engine. */
const TRACE_CHANNEL_KEYS = [
	'vehicle',
	'npc',
	'advertising',
	'allocations',
	'residential',
	'script',
	'characterNeeds',
	'idleDiagnosis',
] as const

export const traceLevels: Partial<Record<string, TraceVerb>> = {
	vehicle: 'log',
	npc: 'assert',
	advertising: 'assert',
	allocations: 'assert',
	residential: 'assert',
	script: 'assert',
	characterNeeds: 'assert',
	idleDiagnosis: 'assert',
}

/**
 * Clears all trace hooks. Used by Vitest setup so tests start with no `traces.*` output unless a
 * test assigns them. Dev: uncomment lines below or assign `traces.* = console` locally.
 */
export function disconnectAllTraces(): void {
	for (const key of TRACE_CHANNEL_KEYS) {
		delete traceCache[key]
	}
}

export type NamedTrace = NamedTraceList

export type NamedTraceOptions = TraceCaptureOptions & {
	/** When true, only record into the list array — no `console.*` (for Vitest / headless capture). */
	silent?: boolean
	level?: TraceVerb
	logLifetime?: number
}

class NamedTraceList extends Array<TraceRow> implements TraceSink {
	static get [Symbol.species]() {
		return Array
	}

	log?: (...args: unknown[]) => void
	warn?: (...args: unknown[]) => void
	error?: (...args: unknown[]) => void
	debug?: (...args: unknown[]) => void
	info?: (...args: unknown[]) => void
	trace?: (...args: unknown[]) => void
	groupCollapsed?: (...args: unknown[]) => void
	groupEnd?: (...args: unknown[]) => void
	assert?: (condition?: boolean, ...args: unknown[]) => void

	constructor(
		private readonly name: string,
		private readonly options: NamedTraceOptions = {}
	) {
		super()
		this.applyLevel(options.level ?? 'log')
	}

	get heads(): readonly unknown[] {
		return this.map(([_level, head]) => head)
	}

	read(count?: number): string {
		return readTraceRows(this, count)
	}

	private get marker(): string {
		return `<[${this.name}]>`
	}

	setLevel(level: TraceVerb): void {
		this.options.level = level
		this.applyLevel(level)
	}

	private applyLevel(level: TraceVerb): void {
		this.log = this.isEnabled(level, 'log') ? (...args) => this.pushRow('log', args) : undefined
		this.warn = this.isEnabled(level, 'warn') ? (...args) => this.pushRow('warn', args) : undefined
		this.error = this.isEnabled(level, 'error')
			? (...args) => this.pushRow('error', args)
			: undefined
		this.assert = this.isEnabled(level, 'assert')
			? (condition, ...args) => {
					if (!condition) this.pushRow('assert failure', args)
					else if (!this.options.silent) console.assert(condition, this.marker, ...args)
				}
			: undefined
		this.debug = this.isEnabled(level, 'log') ? (...args) => this.pushRow('debug', args) : undefined
		this.info = this.isEnabled(level, 'log') ? (...args) => this.pushRow('info', args) : undefined
		this.trace = this.isEnabled(level, 'log') ? (...args) => this.pushRow('trace', args) : undefined
		this.groupCollapsed = this.isEnabled(level, 'log')
			? (...args) => this.pushRow('log', ['groupCollapsed', ...args])
			: undefined
		this.groupEnd = this.isEnabled(level, 'log')
			? (...args) => this.pushRow('log', ['groupEnd', ...args])
			: undefined
	}

	private isEnabled(current: TraceVerb, verb: TraceVerb): boolean {
		return TRACE_VERB_RANK[current] <= TRACE_VERB_RANK[verb]
	}

	private pushRow(level: TraceLevel, args: readonly unknown[]): void {
		const row = captureTraceRow(level, args, this.options)
		this.pruneExpiredRows(row.time)
		this.push(row)
		if (!this.options.silent) this.writeConsole(level, args)
	}

	private pruneExpiredRows(now: number | undefined): void {
		if (now === undefined) return
		const lifetime = this.options.logLifetime ?? DEFAULT_TRACE_LOG_LIFETIME
		const cutoff = now - lifetime
		let removeCount = 0
		while (removeCount < this.length) {
			const time = this[removeCount]?.time
			if (typeof time !== 'number' || time >= cutoff) break
			removeCount++
		}
		if (removeCount > 0) this.splice(0, removeCount)
	}

	private writeConsole(level: TraceLevel, args: readonly unknown[]): void {
		switch (level) {
			case 'warn':
				console.warn(this.marker, ...args)
				break
			case 'error':
				console.error(this.marker, ...args)
				break
			case 'debug':
				console.debug(this.marker, ...args)
				break
			case 'info':
				console.info(this.marker, ...args)
				break
			case 'trace':
				console.trace(this.marker, ...args)
				break
			case 'assert failure':
				console.assert(false, this.marker, ...args)
				break
			default:
				console.log(this.marker, ...args)
		}
	}
}

/** Creates a trace sink that records calls on array indices (for tests / devtools). */
export function namedTrace(name: string, options?: NamedTraceOptions) {
	return new NamedTraceList(name, options)
}

const traceCache: Record<string, TraceSink | undefined> = {}

function configuredTraceLevel(name: string): TraceVerb | undefined {
	return traceLevels[name]
}

function createConfiguredTrace(name: string): TraceSink | undefined {
	const level = configuredTraceLevel(name)
	if (!level) return undefined
	return namedTrace(name, { silent: true, level })
}

export function setTraceLevel(
	name: string,
	...levelArg: [] | [TraceVerb | undefined]
): TraceSink | undefined {
	const nextLevel = levelArg.length === 0 ? 'assert' : levelArg[0]
	if (nextLevel === undefined) {
		delete traceLevels[name]
		delete traceCache[name]
		return undefined
	}
	traceLevels[name] = nextLevel
	const existing = traceCache[name]
	if (existing instanceof NamedTraceList) {
		existing.setLevel(nextLevel)
		return existing
	}
	const next = namedTrace(name, { silent: true, level: nextLevel })
	traceCache[name] = next
	return next
}

export const traces = new Proxy(traceCache, {
	get(target, property, receiver) {
		if (typeof property !== 'string') return Reflect.get(target, property, receiver)
		if (property in target) return target[property]
		const trace = createConfiguredTrace(property)
		if (trace) target[property] = trace
		return trace
	},
	set(target, property, value, receiver) {
		if (typeof property !== 'string') return Reflect.set(target, property, value, receiver)
		if (value === undefined) delete target[property]
		else target[property] = value as TraceSink
		return true
	},
	deleteProperty(target, property) {
		if (typeof property === 'string') delete target[property]
		return true
	},
}) as Record<string, TraceSink>

if (typeof window !== 'undefined') {
	// @ts-expect-error - for use in devtools
	window.traces = traces
}

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
	traces.characterNeeds.log?.(topic, payload)
}

export type IdleDiagnosisPayload = PlannerFindActionSnapshot & {
	name?: string
	/** Extra context when `outcome.source === 'fallback-wander'`. */
	note?: string
}

/** Assign `traces.idleDiagnosis = console` and/or `blackBoxLog.idleDiagnosis = console.log` to inspect `findAction`. */
export function traceIdleDiagnosis(payload: IdleDiagnosisPayload) {
	traces.idleDiagnosis.log?.('findAction', payload)
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
