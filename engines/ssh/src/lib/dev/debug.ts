import { devPreset, reactiveOptions } from 'mutts'
import { type InteractiveLogObject, isInteractiveLogObject } from 'ssh/game/object'
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
import { isWatched, onWatchChange, unwatch, watch, watchCount } from './watch.ts'

export type { TraceSink }

const defaultTraceLevel = 'debug'
/** Default trace channel levels. To disable, delete the key and assign `undefined` to `traceLevels[name]` or call `traces.<entityless>[name]?.setLevel(TraceVerb)`. When a new TraceSink is needed, adding its name here is enough. Attached/hybrid channels are callable (`traces.vehicle(v)`); their backing sink is shared, so `setLevel` via any subject view applies channel-wide. */
export const traceLevels: Record<string, TraceVerb> = {
	vehicle: defaultTraceLevel,
	npc: defaultTraceLevel,
	queue: defaultTraceLevel,
	advertising: defaultTraceLevel,
	allocations: defaultTraceLevel,
	commitments: defaultTraceLevel,
	convey: defaultTraceLevel,
	residential: defaultTraceLevel,
	commercial: defaultTraceLevel,
	work: defaultTraceLevel,
	script: defaultTraceLevel,
	scriptEngine: defaultTraceLevel,
	characterNeeds: defaultTraceLevel,
	idleDiagnosis: defaultTraceLevel,
	position: defaultTraceLevel,
	terrain: defaultTraceLevel,
	ui: defaultTraceLevel,
	/** Missing keys, interpolation issues, and other `I18nClient.report` output. */
	i18n: defaultTraceLevel,
	bay: defaultTraceLevel,
	forwardProbe: defaultTraceLevel,
	identityProbe: defaultTraceLevel,
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

/**
 * Fatal assertion with TypeScript narrowing. Prefer the channel-scoped form
 * `traces.<channel>.assert?.(condition, message, payload?)`, which records an
 * `assert failure` row on the channel and then throws `AssertionError` when
 * the channel's `assert` verb is enabled — and skips evaluating the condition
 * entirely when disabled. This bare helper is the same throw without a trace
 * row, kept for contexts with no channel (tests, pure utils) and for
 * `defined()` below.
 *
 * NOTE: TypeScript only narrows on assertion calls whose target is a plain
 * identifier or `this`-free property chain rooted in an explicitly-typed
 * name (TS2775). `traces.<channel>.assert?.(...)` does NOT narrow because
 * `traces` is an untyped `Proxy` record. Keep using the bare `assert(...)`
 * wherever narrowing is needed; use `traces.<channel>.assert?.(...)` for
 * level-gated recording + throwing without narrowing.
 * 
 * @todo unreference this assertion to use traces only
 */
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
 * failed assertions and errors, and `error` enables errors only. `debug` acts as `warn` in general
 * but as `log` for watched subjects (see `traceFor`). Disabled methods are `undefined`, so
 * optional-call trace sites do not evaluate their arguments.
 *
 * `assert` is fatal: when enabled it records the failure row and throws
 * `AssertionError`; when disabled the method is `undefined` and `?.` skips
 * evaluating the condition entirely (use `error` + explicit throw for checks
 * that must fire regardless of level). All default channel levels are
 * `warn`, so `traces.<channel>(subject).assert?.(...)` evaluates unless a channel is
 * explicitly muted or raised to `error`.
 */
export const traceVerbs = ['log', 'debug', 'warn', 'assert', 'error'] as const
export type TraceVerb = (typeof traceVerbs)[number]
type TraceConsoleMethod = keyof Pick<
	Console,
	'assert' | 'debug' | 'error' | 'groupCollapsed' | 'groupEnd' | 'info' | 'log' | 'trace' | 'warn'
>

export const DEFAULT_TRACE_LOG_LIFETIME = 300

const TRACE_VERB_RANK: Record<TraceVerb, number> = {
	log: 0,
	debug: 1,
	warn: 1,
	assert: 2,
	error: 3,
}

function collectTraceLogObjects(
	value: unknown,
	out: Set<InteractiveLogObject>,
	seen?: Set<object>
): void {
	if (!seen) seen = new Set()
	if (isInteractiveLogObject(value)) {
		out.add(value)
		return
	}
	if (Array.isArray(value)) {
		for (const item of value) collectTraceLogObjects(item, out, seen)
		return
	}
	if (!value || typeof value !== 'object') return
	if (seen.has(value as object)) return
	seen.add(value as object)
	const record = value as Record<string, unknown>
	for (const entry of Object.values(record)) {
		collectTraceLogObjects(entry, out, seen)
	}
}
/**
 * Clears all trace hooks. Used by Vitest setup so tests start with fresh `traces.*` sinks.
 * Dev: configure `traceLevels`, call `traces.<entityless>channel?.setLevel(...)`, or assign a custom sink locally.
 */
export function disconnectAllTraces(): void {
	traceDebugArmed = false
	for (const key in traceLevels) {
		delete traceCache[key]
	}
	for (const key of Object.keys(traceAccessorCache)) {
		delete traceAccessorCache[key]
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
	/** Level-gated: `undefined` when the channel level disables the `assert` verb, so `?.` skips evaluating the condition. When enabled, records an `assert failure` row and throws `AssertionError`. */
	assert?: (condition: unknown, ...args: unknown[]) => void
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

	/** Current channel level (defaults to `log` when unset). */
	get level(): TraceVerb {
		return this.options.level ?? 'log'
	}

	private applyLevel(level: TraceVerb): void {
		this.log = this.isEnabled(level, 'log') ? (...args) => this.pushRow('log', 'log', args) : undefined
		this.warn = this.isEnabled(level, 'warn')
			? (...args) => this.pushRow('warn', 'warn', args)
			: undefined
		this.error = this.isEnabled(level, 'error')
			? (...args) => this.pushRow('error', 'error', args)
			: undefined
		this.assert = this.isEnabled(level, 'assert')
			? (condition, ...args) => {
					if (condition) return
					this.pushRow('assert failure', 'assert', args)
					const message =
						typeof args[0] === 'string' && args[0].length > 0
							? args[0]
							: `[${this.name}] assertion failed`
					throw new AssertionError(message)
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

	/**
	 * Subject-bound view for `traceFor`. Only the `debug` verb is subject-dependent:
	 * a watched subject is upgraded to full `log`-level methods (its `log` is defined),
	 * while an unwatched subject keeps the warn-level sink (`log` stays `undefined`, so
	 * `?.` short-circuits without evaluating arguments). Every other level is uniform,
	 * so the live sink is returned unchanged.
	 */
	forSubject(subject: unknown): TraceSink {
		const level = this.options.level ?? 'log'
		if (level !== 'debug' || !isWatched(subject)) return this
		const self = this
		return {
			log: (...args) => self.pushRow('log', 'log', args),
			warn: self.warn,
			error: self.error,
			assert: self.assert,
			debug: (...args) => self.pushRow('debug', 'debug', args),
			info: (...args) => self.pushRow('info', 'info', args),
			trace: (...args) => self.pushRow('trace', 'trace', args),
			groupCollapsed: (...args) =>
				self.pushRow('log', 'groupCollapsed', ['groupCollapsed', ...args]),
			groupEnd: (...args) => self.pushRow('log', 'groupEnd', ['groupEnd', ...args]),
			get heads() {
				return self.heads
			},
			read: (count) => self.read(count),
			display: (count) => self.display(count),
			reset: () => self.reset(),
			setLevel: (level) => self.setLevel(level),
		}
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
		// Collect log targets from raw args before they are projected
		const logObjects = new Set<InteractiveLogObject>()
		for (const arg of args) collectTraceLogObjects(arg, logObjects)
		for (const object of logObjects) {
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

/**
 * Whether trace channels are currently "debug-armed": while any subject is watched,
 * every configured channel is raised to `debug` so watched entities log at full detail
 * (unwatched entities keep `warn`-level behaviour — see `forSubject`). This is what makes
 * the per-entity debug toggle in the property widget actually surface logs: watching an
 * object arms the channels, so its `log` becomes defined.
 */
let traceDebugArmed = false

function configuredTraceLevel(name: string): TraceVerb | undefined {
	const level = traceLevels[name]
	if (level === undefined) return undefined
	return traceDebugArmed ? 'debug' : level
}

function createConfiguredTrace(name: string): TraceSink | undefined {
	const level = configuredTraceLevel(name)
	if (!level) return undefined
	return namedTrace(name, { level })
}

function armTraceDebug(): void {
	if (traceDebugArmed) return
	traceDebugArmed = true
	for (const name in traceLevels) {
		const sink = traceCache[name]
		if (sink instanceof NamedTraceList) sink.setLevel('debug')
	}
}

function disarmTraceDebug(): void {
	if (!traceDebugArmed) return
	traceDebugArmed = false
	for (const name in traceLevels) {
		const sink = traceCache[name]
		if (sink instanceof NamedTraceList) sink.setLevel(traceLevels[name])
	}
}

// Raise channels to `debug` while any subject is watched; restore on release.
onWatchChange(() => {
	if (watchCount() > 0) armTraceDebug()
	else disarmTraceDebug()
})

/**
 * Channel classification for the subject-aware `traces.*` API.
 *
 * - `attached`: the trace always describes one watchable entity; the subject is a
 *   compulsory positional argument — `traces.vehicle(vehicle).log?.(...)`.
 * - `hybrid`: the trace is about one of several possible entities; the subject is a
 *   named bag — `traces.convey({ alveolus }).log?.(...)`.
 * - `entityless`: no single entity to watch; plain sink — `traces.queue.log?.(...)`.
 */
export type TraceChannelKind = 'attached' | 'hybrid' | 'entityless'

/** Subject bag for hybrid channels (`convey`, `work`). Provide whichever fields are in scope. */
export type HybridTraceSubject = {
	readonly vehicle?: unknown
	readonly character?: unknown
	readonly alveolus?: unknown
	readonly tile?: unknown
}

const attachedTraceChannels = new Set(['vehicle', 'position', 'npc', 'script'])
const hybridTraceChannels = new Set(['convey', 'work'])

/** Classify a channel for the subject-aware `traces.*` API. Unknown channels are entity-less. */
export function traceChannelKind(channel: string): TraceChannelKind {
	if (attachedTraceChannels.has(channel)) return 'attached'
	if (hybridTraceChannels.has(channel)) return 'hybrid'
	return 'entityless'
}

/** Resolve the watch-filter subject for a hybrid named-bag argument. */
function hybridTraceSubject(bag: HybridTraceSubject | unknown): unknown {
	if (!bag || typeof bag !== 'object') return bag
	const record = bag as Record<string, unknown>
	return record.vehicle ?? record.character ?? record.alveolus ?? record.tile ?? bag
}

export type AttachedTraceAccessor = ((subject: unknown) => TraceSink) & TraceSink
export type HybridTraceAccessor = ((subject: HybridTraceSubject) => TraceSink) & TraceSink

const traceAccessorCache: Record<string, AttachedTraceAccessor | HybridTraceAccessor | undefined> =
	{}

function attachedTraceAccessor(channel: string): AttachedTraceAccessor {
	const cached = traceAccessorCache[channel] as AttachedTraceAccessor | undefined
	if (cached) return cached
	// Eagerly create the backing sink BEFORE the Proxy exists, so the `get`
	// trap below can never re-enter this factory (which would recurse:
	// factory → Proxy → get → underlyingTraceSink → createConfiguredTrace …
	// is safe, but `get` → factory → `get` → factory is not).
	const sink = underlyingTraceSink(channel)
	const call = (subject: unknown) => traceFor(channel, subject)
	const accessor = new Proxy(call, {
		get(target, property, receiver) {
			// `Reflect.get` on the raw function target: `name`/`length`/`prototype`
			// live there. Anything else falls through to the backing sink.
			// NOTE: never `Reflect.get(sink, ...)` with the proxy as receiver —
			// `NamedTraceList` getters (`heads`) would re-enter this trap.
			// NOTE: `in` on a Proxy triggers the `has` trap — check the raw
			// function target with `Reflect.getOwnPropertyDescriptor` instead.
			if (Reflect.getOwnPropertyDescriptor(target, property) !== undefined)
				return Reflect.get(target, property, receiver)
			if (typeof property === 'symbol') return undefined
			// `then` must stay undefined so `await traces.vehicle` never treats
			// the accessor as a thenable (which would recurse via traceFor).
			if (property === 'then') return undefined
			if (!sink) return undefined
			const value = (sink as Record<PropertyKey, unknown>)[property]
			return typeof value === 'function' ? value.bind(sink) : value
		},
		set(_target, property, value) {
			if (sink) Reflect.set(sink as object, property as string, value)
			return true
		},
		has(_target, property) {
			if (property === 'name' || property === 'then') return true
			return sink
				? Reflect.getOwnPropertyDescriptor(sink as object, property) !== undefined
				: false
		},
	}) as AttachedTraceAccessor
	traceAccessorCache[channel] = accessor
	return accessor
}

function hybridTraceAccessor(channel: string): HybridTraceAccessor {
	const cached = traceAccessorCache[channel] as HybridTraceAccessor | undefined
	if (cached) return cached
	// Eager sink (see attachedTraceAccessor): the `get` trap must never
	// re-enter this factory.
	const sink = underlyingTraceSink(channel)
	const call = (subject: HybridTraceSubject) =>
		traceFor(channel, hybridTraceSubject(subject))
	const accessor = new Proxy(call, {
		get(target, property, receiver) {
			if (Reflect.getOwnPropertyDescriptor(target, property) !== undefined)
				return Reflect.get(target, property, receiver)
			if (typeof property === 'symbol') return undefined
			// `then` must stay undefined so `await traces.convey` never treats
			// the accessor as a thenable (which would recurse via traceFor).
			if (property === 'then') return undefined
			if (!sink) return undefined
			const value = (sink as Record<PropertyKey, unknown>)[property]
			return typeof value === 'function' ? value.bind(sink) : value
		},
		set(_target, property, value) {
			if (sink) Reflect.set(sink as object, property as string, value)
			return true
		},
		has(_target, property) {
			if (property === 'name' || property === 'then') return true
			return sink
				? Reflect.getOwnPropertyDescriptor(sink as object, property) !== undefined
				: false
		},
	}) as HybridTraceAccessor
	traceAccessorCache[channel] = accessor
	return accessor
}

/** Read the underlying sink for `channel` without going through the callable proxy. */
function underlyingTraceSink(channel: string): TraceSink | undefined {
	// NOTE: never read via `traces[channel]` here — `traces` is a Proxy whose
	// `get` trap calls the accessor factories, which call back into this
	// function. Always go through `traceCache` directly.
	if (channel in traceCache) return traceCache[channel]
	const trace = createConfiguredTrace(channel)
	if (trace) traceCache[channel] = trace
	return trace
}

/**
 * Lazy trace registry keyed by channel name.
 *
 * Entity-attached channels (`vehicle`, `position`, `npc`, `script`) are callable with a
 * compulsory subject — `traces.vehicle(vehicle).log?.(...)` — delegating to `traceFor`.
 * Hybrid channels (`convey`, `work`) take a named subject bag — `traces.convey({ alveolus })`.
 * Entity-less channels stay a plain `TraceSink` — `traces.queue.log?.(...)`.
 *
 * `assert` follows the same rule: `traces.vehicle(vehicle).assert?.(cond, msg)` skips
 * evaluating the condition when the channel's `assert` verb is disabled.
 *
 * Tests can still assign a backing sink (`traces.vehicle = collector`); the callable
 * accessors resolve through it via `traceFor`, and `delete traces.vehicle` clears it.
 */
export const traces = new Proxy(traceCache, {
	get(target, property, receiver) {
		if (typeof property !== 'string') return Reflect.get(target, property, receiver)
		// The `traces` proxy target IS `traceCache`: `in` checks and reads below
		// must use `target`, never the proxy itself, or the `get` trap recurses.
		const kind = traceChannelKind(property)
		if (kind === 'attached') return attachedTraceAccessor(property)
		if (kind === 'hybrid') return hybridTraceAccessor(property)
		if (property in target) return target[property]
		const trace = createConfiguredTrace(property)
		if (trace) target[property] = trace
		return trace
	},
	set(target, property, value, receiver) {
		if (typeof property !== 'string') return Reflect.set(target, property, value, receiver)
		if (value === undefined) {
			delete target[property]
			delete traceAccessorCache[property]
			return true
		}
		target[property] = value as TraceSink
		// Drop the cached callable so the next read re-resolves through the new sink.
		delete traceAccessorCache[property]
		return true
	},
	deleteProperty(target, property) {
		if (typeof property === 'string') {
			delete target[property]
			delete traceAccessorCache[property]
		}
		return true
	},
}) as Record<string, TraceSink> & {
	vehicle: AttachedTraceAccessor
	position: AttachedTraceAccessor
	npc: AttachedTraceAccessor
	script: AttachedTraceAccessor
	convey: HybridTraceAccessor
	work: HybridTraceAccessor
}

/**
 * A sink whose console-like methods are all `undefined`, so `?.` and
 * `if (sink.log)` guards short-circuit without evaluating payload builders.
 * Returned by {@link traceFor} when a channel is not configured.
 */
const MUTED_TRACE: TraceSink = {
	read: () => '',
	display: () => {},
	reset: () => {},
	setLevel: () => {},
}

/**
 * Resolve a trace channel against the per-entity watch filter.
 *
 * At the `debug` verb, `traceFor(channel, subject)` returns a view whose `log`
 * (and friends) are enabled only for watched subjects — watched entities log at
 * full detail while everyone else keeps `warn`-level behaviour with `log`
 * `undefined` (its argument expressions never evaluated). Any other level returns
 * the live channel sink unchanged:
 *
 * ```ts
 * traceFor('vehicle', vehicle).log?.('vehicleJob.dock.check', { ... })
 * ```
 */
export function traceFor(channel: string, subject: unknown): TraceSink {
	const sink = underlyingTraceSink(channel)
	if (!sink) return MUTED_TRACE
	if (sink instanceof NamedTraceList) return sink.forSubject(subject)
	return sink
}

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
	watch?: typeof watch
	unwatch?: typeof unwatch
	traceFor?: typeof traceFor
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
	browserGlobal.watch = watch
	browserGlobal.unwatch = unwatch
	browserGlobal.traceFor = traceFor
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
