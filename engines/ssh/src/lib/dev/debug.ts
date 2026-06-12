import { devPreset, reactiveOptions } from 'mutts'
import { type InteractiveLogObject, interactiveLogObject } from 'ssh/game/object'
import type { PlannerFindActionSnapshot } from 'ssh/population/findNextActivity'
import { debugActiveAllocations, getAllocationStats } from 'ssh/storage/guard'
import { namedProfile, type ProfileLevel, type ProfileSink } from './profile.ts'
import {
	captureTraceRow,
	readTraceConsoleParts,
	readTraceConsoleRow,
	readTraceRows,
	type TraceCaptureOptions,
	type TraceLevel,
	type TraceRow,
	type TraceSink,
} from './trace.ts'

/** Default trace channel levels. To disable, delete the key and assign `undefined` to `traceLevels[name]` or call `traces[name]?.setLevel(TraceVerb)`. When a new TraceSink is needed, adding its name here is enough */
export const traceLevels: Record<string, TraceVerb> = {
	vehicle: 'warn',
	npc: 'warn',
	advertising: 'warn',
	allocations: 'warn',
	commitments: 'warn',
	convey: 'log',
	residential: 'warn',
	work: 'warn',
	script: 'warn',
	characterNeeds: 'warn',
	idleDiagnosis: 'warn',
	position: 'warn',
	terrain: 'warn',
	ui: 'warn',
	/** Missing keys, interpolation issues, and other `I18nClient.report` output. */
	i18n: 'warn',
	bay: 'warn',
}

const TERRAIN_PROFILING_ENABLED = false

/** Default profile channel levels. Keep empty for normal play; use `setProfileLevel` or env-gated test setup to enable hot-path profiling. */
export const profileLevels: Record<string, ProfileLevel> = {
	...(TERRAIN_PROFILING_ENABLED
		? {
				terrainGeneration: 'summary' as const,
				terrainProvider: 'summary' as const,
			}
		: {}),
}

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

/**
 * Minimum level recorded by a trace channel.
 *
 * `log` enables every console-like method, `warn` enables warn/assert/error, `assert` enables
 * failed assertions and errors, and `error` enables errors only. Disabled methods are `undefined`,
 * so optional-call trace sites do not evaluate their arguments.
 */
export const traceVerbs = ['log', 'warn', 'assert', 'error'] as const
export type TraceVerb = (typeof traceVerbs)[number]
type TraceConsoleMethod = keyof Pick<
	Console,
	'assert' | 'debug' | 'error' | 'groupCollapsed' | 'groupEnd' | 'info' | 'log' | 'trace' | 'warn'
>

export const DEFAULT_TRACE_LOG_LIFETIME = 300

const TRACE_VERB_RANK: Record<TraceVerb, number> = {
	log: 0,
	warn: 1,
	assert: 2,
	error: 3,
}

const UID_TRACE_KEYS = new Set([
	'uid',
	'vehicleUid',
	'characterUid',
	'operatorUid',
	'ownerUid',
	'targetUid',
	'sourceUid',
	'claimedByUid',
])

function collectTraceLogUids(value: unknown, out: Set<string>): void {
	if (Array.isArray(value)) {
		for (const item of value) collectTraceLogUids(item, out)
		return
	}
	if (!value || typeof value !== 'object') return
	const record = value as Record<string, unknown>
	for (const [key, entry] of Object.entries(record)) {
		if (typeof entry === 'string' && UID_TRACE_KEYS.has(key)) {
			out.add(entry)
			continue
		}
		collectTraceLogUids(entry, out)
	}
}

function traceLogTargets(row: TraceRow): InteractiveLogObject[] {
	const uids = new Set<string>()
	for (const value of row.slice(1)) collectTraceLogUids(value, uids)
	return [...uids]
		.map((uid) => interactiveLogObject(uid))
		.filter((object): object is InteractiveLogObject => !!object)
}

/**
 * Clears all trace hooks. Used by Vitest setup so tests start with fresh `traces.*` sinks.
 * Dev: configure `traceLevels`, call `traces.channel?.setLevel(...)`, or assign a custom sink locally.
 */
export function disconnectAllTraces(): void {
	for (const key in traceLevels) {
		delete traceCache[key]
	}
}

const profileCache: Record<string, ProfileSink | undefined> = {}

export function disconnectAllProfiles(): void {
	for (const key in profileCache) {
		delete profileCache[key]
	}
}

export type NamedTrace = NamedTraceList

export type NamedTraceOptions = TraceCaptureOptions & {
	/** When true, only record into the list array — no `console.*` (for Vitest / headless capture). */
	silent?: boolean
	level?: TraceVerb
	logLifetime?: number
}

export type TraceDiagnosticReporter = (diagnostic: {
	readonly channel: string
	readonly level: TraceLevel
	readonly row: TraceRow
	readonly text: string
}) => void

export type TraceInvariantResult =
	| boolean
	| {
			readonly ok: boolean
			readonly message?: string
			readonly payload?: Record<string, unknown>
	  }

export type TraceInvariantCheck = (...args: unknown[]) => TraceInvariantResult

export type TraceInvariantMap = Record<string, TraceInvariantCheck>

const traceInvariantRegistry: Record<string, TraceInvariantMap | undefined> = {}

let traceDiagnosticReporter: TraceDiagnosticReporter | undefined
let traceTimeSource: (() => number | undefined) | undefined

export function setTraceDiagnosticReporter(reporter: TraceDiagnosticReporter | undefined): void {
	traceDiagnosticReporter = reporter
}

export function setTraceTimeSource(source: (() => number | undefined) | undefined): () => void {
	traceTimeSource = source
	return () => {
		if (traceTimeSource === source) traceTimeSource = undefined
	}
}

export function registerTraceInvariants(channel: string, invariants: TraceInvariantMap): void {
	traceInvariantRegistry[channel] = {
		...(traceInvariantRegistry[channel] ?? {}),
		...invariants,
	}
	const existing = traceCache[channel]
	if (existing instanceof NamedTraceList) existing.refreshInvariantSink()
}

/**
 * Array-backed trace sink.
 *
 * Use `namedTrace('vehicle', { silent: true })` in tests to collect rows without console output.
 * Without `silent`, each stored row is also forwarded as a collapsed console group headed by
 * `<[name]> event`, with the captured payload inside.
 */
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
	invariant?: Record<string, (...args: unknown[]) => void>

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

	/** Convenience for DevTools: prints `read(count)` with `console.log`. */
	display(count?: number): void {
		console.log(this.read(count))
	}

	reset(): void {
		this.splice(0, this.length)
	}

	private get marker(): string {
		return `<[${this.name}]>`
	}

	setLevel(level: TraceVerb): void {
		this.options.level = level
		this.applyLevel(level)
	}

	private applyLevel(level: TraceVerb): void {
		this.log = this.isEnabled(level, 'log')
			? (...args) => this.pushRow('log', 'log', args)
			: undefined
		this.warn = this.isEnabled(level, 'warn')
			? (...args) => this.pushRow('warn', 'warn', args)
			: undefined
		this.error = this.isEnabled(level, 'error')
			? (...args) => this.pushRow('error', 'error', args)
			: undefined
		this.assert = this.isEnabled(level, 'assert')
			? (condition, ...args) => {
					if (!condition) this.pushRow('assert failure', 'assert', args)
				}
			: undefined
		this.debug = this.isEnabled(level, 'log')
			? (...args) => this.pushRow('debug', 'debug', args)
			: undefined
		this.info = this.isEnabled(level, 'log')
			? (...args) => this.pushRow('info', 'info', args)
			: undefined
		this.trace = this.isEnabled(level, 'log')
			? (...args) => this.pushRow('trace', 'trace', args)
			: undefined
		this.groupCollapsed = this.isEnabled(level, 'log')
			? (...args) => this.pushRow('log', 'groupCollapsed', ['groupCollapsed', ...args])
			: undefined
		this.groupEnd = this.isEnabled(level, 'log')
			? (...args) => this.pushRow('log', 'groupEnd', ['groupEnd', ...args])
			: undefined
		this.refreshInvariantSink()
	}

	refreshInvariantSink(): void {
		const invariants = traceInvariantRegistry[this.name]
		if (!this.assert || !invariants || Object.keys(invariants).length === 0) {
			this.invariant = undefined
			return
		}
		this.invariant = Object.fromEntries(
			Object.entries(invariants).map(([id, check]) => [
				id,
				(...args: unknown[]) => {
					const result = check(...args)
					const ok = typeof result === 'boolean' ? result : result.ok
					if (ok) return
					const message =
						typeof result === 'boolean'
							? `[invariant] ${this.name}.${id}`
							: (result.message ?? `[invariant] ${this.name}.${id}`)
					const payload =
						typeof result === 'boolean'
							? { invariant: `${this.name}.${id}` }
							: {
									invariant: `${this.name}.${id}`,
									...result.payload,
								}
					this.assert?.(false, message, payload)
				},
			])
		)
	}

	private isEnabled(current: TraceVerb, verb: TraceVerb): boolean {
		return TRACE_VERB_RANK[current] <= TRACE_VERB_RANK[verb]
	}

	private pushRow(
		level: TraceLevel,
		consoleMethod: TraceConsoleMethod,
		args: readonly unknown[]
	): void {
		const row = captureTraceRow(level, args, {
			...this.options,
			time: this.options.time ?? traceTimeSource,
		})
		this.pruneExpiredRows(row.time)
		this.push(row)
		if (level === 'warn' || level === 'error' || level === 'assert failure') {
			traceDiagnosticReporter?.({
				channel: this.name,
				level,
				row,
				text: readTraceConsoleRow(row),
			})
		}
		for (const object of traceLogTargets(row)) {
			object.logAbout(row, readTraceConsoleRow(row))
		}
		if (!this.options.silent) this.writeConsole(consoleMethod, row)
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

	private writeConsole(consoleMethod: TraceConsoleMethod, row: TraceRow): void {
		const { title, body } = readTraceConsoleParts(row)
		const groupTitle = title ? `${this.marker} ${title}` : this.marker
		switch (consoleMethod) {
			case 'groupEnd':
				console.groupEnd()
				return
			case 'groupCollapsed':
				console.groupCollapsed(groupTitle)
				if (body) console.log(body)
				return
		}
		console.groupCollapsed(groupTitle)
		try {
			if (!body) return
			switch (consoleMethod) {
				case 'warn':
					console.warn(body)
					break
				case 'error':
					console.error(body)
					break
				case 'debug':
					console.debug(body)
					break
				case 'info':
					console.info(body)
					break
				case 'trace':
					console.trace(body)
					break
				case 'assert':
					console.assert(false, body)
					break
				default:
					console.log(body)
			}
		} finally {
			console.groupEnd()
		}
	}
}

/**
 * Creates a named trace sink.
 *
 * Typical usage:
 * `traces.vehicle = namedTrace('vehicle', { silent: true })` for isolated capture, or let the
 * `traces` proxy create configured sinks from `traceLevels`.
 */
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
	return namedTrace(name, { level })
}

/**
 * Lazy trace registry keyed by channel name.
 *
 * Reading `traces.vehicle` creates a `namedTrace('vehicle', { level })` when `traceLevels.vehicle`
 * is configured. Call sites should optional-call the method, e.g.
 * `traces.vehicle.log?.('vehicleJob.selected', { vehicleUid })`.
 */
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

function createConfiguredProfile(name: string): ProfileSink {
	return namedProfile(name, { level: profileLevels[name] })
}

export function setProfileLevel(
	name: string,
	...levelArg: [] | [ProfileLevel | undefined]
): ProfileSink {
	const nextLevel = levelArg.length === 0 ? 'summary' : levelArg[0]
	if (nextLevel === undefined) {
		delete profileLevels[name]
		const existing = profileCache[name]
		if (existing) {
			existing.setLevel(undefined)
			return existing
		}
		const next = namedProfile(name)
		profileCache[name] = next
		return next
	}
	profileLevels[name] = nextLevel
	const existing = profileCache[name]
	if (existing) {
		existing.setLevel(nextLevel)
		return existing
	}
	const next = namedProfile(name, { level: nextLevel })
	profileCache[name] = next
	return next
}

/**
 * Lazy profiling registry keyed by channel name.
 *
 * Unlike `traces`, reading a disabled profile channel still returns a sink object so call sites can
 * write `profile.proposedJobs.begin?.(...)` without guarding `profile.proposedJobs` itself.
 */
export const profile = new Proxy(profileCache, {
	get(target, property, receiver) {
		if (typeof property !== 'string') return Reflect.get(target, property, receiver)
		if (property in target) return target[property]
		const sink = createConfiguredProfile(property)
		target[property] = sink
		return sink
	},
	set(target, property, value, receiver) {
		if (typeof property !== 'string') return Reflect.set(target, property, value, receiver)
		if (value === undefined) delete target[property]
		else target[property] = value as ProfileSink
		return true
	},
	deleteProperty(target, property) {
		if (typeof property === 'string') delete target[property]
		return true
	},
}) as Record<string, ProfileSink>

type ConsoleTrapElement = {
	id: string
	style: { display: string }
	setAttribute(name: string, value: string): void
}

type ConsoleTrapDocument = {
	getElementById(id: string): unknown
	createElement(tagName: string): ConsoleTrapElement
	body: { appendChild(element: ConsoleTrapElement): void }
}

type BrowserDebugGlobal = typeof globalThis & {
	traces?: typeof traces
	profile?: typeof profile
	window?: unknown
	document?: ConsoleTrapDocument
	addEventListener?: (type: string, listener: (event: ConsoleTrapEvent) => void) => void
}

type ConsoleTrapEvent = {
	reason?: unknown
	error?: unknown
	message?: string
}

const browserGlobal = globalThis as BrowserDebugGlobal

if (browserGlobal.window !== undefined) {
	browserGlobal.traces = traces
	browserGlobal.profile = profile
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
	if (browserGlobal.window === undefined) return
	const document = browserGlobal.document
	if (!document || document.getElementById('console-trap')) return

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
	browserGlobal.addEventListener?.('unhandledrejection', (event) => {
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
	browserGlobal.addEventListener?.('error', (event) => {
		errors.push({
			type: 'uncaughterror',
			message:
				event.error instanceof Error
					? (event.error.stack ?? event.error.message)
					: (event.message ?? ''),
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

/** Structured hook for tests / devtools: use `traces.characterNeeds?.setLevel('log')`. */
export function traceNeeds(topic: string, payload: unknown) {
	traces.characterNeeds.log?.(topic, payload)
}

export type IdleDiagnosisPayload = PlannerFindActionSnapshot & {
	name?: string
	/** Extra context when `outcome.source === 'fallback-wander'`. */
	note?: string
}

/** Use `traces.idleDiagnosis?.setLevel('log')` and/or `blackBoxLog.idleDiagnosis = console.log` to inspect `findAction`. */
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
