import { untracked } from 'mutts'

export type ProfileLevel = 'summary' | 'detail' | 'stack'

export type ProfilePayload = unknown
export type ProfilePayloadFactory = () => ProfilePayload
export type ProfilePayloadInput = ProfilePayload | ProfilePayloadFactory
export type ProfileEnd = (payload?: ProfilePayloadInput) => void
export type ProfileBegin = (label: string, payload?: ProfilePayloadInput) => ProfileEnd

export interface ProfileSink {
	begin?: ProfileBegin
	read: () => string
	display: () => string
	reset: () => void
	/**
	 * Set the capture level. When `autoStopSeconds` is provided, the sink arms a timer that, after
	 * that many seconds, logs the summary (`display()`), clears the samples (`reset()`), and disables
	 * capture (`setLevel(undefined)`) — a self-contained "sample for N seconds, then dump + stop".
	 */
	setLevel: (level: ProfileLevel | undefined, autoStopSeconds?: number) => void
	readonly enabled: boolean
	readonly level?: ProfileLevel
	readonly stats: readonly ProfileStatSnapshot[]
}

export interface ProfileStatSnapshot {
	readonly label: string
	readonly parentLabel?: string
	readonly calls: number
	readonly totalMs: number
	readonly averageMs: number
	readonly maxMs: number
	readonly samples: readonly ProfileSample[]
}

export interface ProfileSample {
	readonly durationMs: number
	readonly startPayload?: ProfilePayload
	readonly endPayload?: ProfilePayload
	readonly stack?: string
}

export interface NamedProfileOptions {
	level?: ProfileLevel
	time?: () => number
	slowThresholdMs?: number
	maxSamples?: number
}

type MutableProfileStat = {
	label: string
	parentLabel?: string
	calls: number
	totalMs: number
	maxMs: number
	samples: ProfileSample[]
}

const DEFAULT_MAX_SAMPLES = 10
const DEFAULT_SLOW_THRESHOLD_MS = 1

export class NamedProfile implements ProfileSink {
	begin?: ProfileBegin
	private readonly byKey = new Map<string, MutableProfileStat>()
	private readonly activeLabels: string[] = []
	private currentLevel: ProfileLevel | undefined
	private autoStopTimer: ReturnType<typeof setTimeout> | undefined

	constructor(
		private readonly name: string,
		private readonly options: NamedProfileOptions = {}
	) {
		this.setLevel(options.level)
	}

	get enabled(): boolean {
		return this.begin !== undefined
	}

	get level(): ProfileLevel | undefined {
		return this.currentLevel
	}

	get stats(): readonly ProfileStatSnapshot[] {
		return this.sortedStats().map((stat) => ({
			label: stat.label,
			parentLabel: stat.parentLabel,
			calls: stat.calls,
			totalMs: stat.totalMs,
			averageMs: stat.calls > 0 ? stat.totalMs / stat.calls : 0,
			maxMs: stat.maxMs,
			samples: stat.samples,
		}))
	}

	setLevel(level: ProfileLevel | undefined, autoStopSeconds?: number): void {
		if (this.autoStopTimer !== undefined) {
			clearTimeout(this.autoStopTimer)
			this.autoStopTimer = undefined
		}
		this.currentLevel = level
		this.begin = level ? (label, payload) => this.start(label, payload) : undefined
		if (level !== undefined && autoStopSeconds !== undefined && autoStopSeconds > 0) {
			this.autoStopTimer = setTimeout(() => {
				this.autoStopTimer = undefined
				this.display()
				this.reset()
				this.setLevel(undefined)
			}, autoStopSeconds * 1000)
		}
	}

	reset(): void {
		this.byKey.clear()
		this.activeLabels.length = 0
	}

	read(): string {
		const stats = this.stats
		if (stats.length === 0) return `<[${this.name}]> no profile samples`
		const lines = [`<[${this.name}]> profile (${this.currentLevel ?? 'disabled'})`]
		for (const stat of stats) {
			const prefix = stat.parentLabel ? `${stat.parentLabel} > ${stat.label}` : stat.label
			lines.push(
				`${prefix}: calls=${stat.calls} total=${formatMs(stat.totalMs)} avg=${formatMs(
					stat.averageMs
				)} max=${formatMs(stat.maxMs)}`
			)
			if (this.currentLevel === 'detail' || this.currentLevel === 'stack') {
				for (const sample of stat.samples) {
					lines.push(`  sample ${formatMs(sample.durationMs)}${formatSamplePayload(sample)}`)
					if (sample.stack) {
						lines.push(
							...sample.stack
								.split('\n')
								.slice(1, 5)
								.map((line) => `    ${line.trim()}`)
						)
					}
				}
			}
		}
		return lines.join('\n')
	}

	/** Log the profile summary AND return it, so DevTools renders the string inline (return value). */
	display(): string {
		const text = this.read()
		console.log(text)
		return text
	}

	private start(label: string, payload?: ProfilePayloadInput): ProfileEnd {
		const parentLabel = this.activeLabels.at(-1)
		const startMs = this.now()
		const startPayload = this.capturePayload(payload)
		this.activeLabels.push(label)
		let closed = false
		return (endPayloadInput?: ProfilePayloadInput) => {
			if (closed) return
			closed = true
			const endMs = this.now()
			const endPayload = this.capturePayload(endPayloadInput)
			const durationMs = Math.max(0, endMs - startMs)
			this.closeActiveLabel(label)
			this.record(label, parentLabel, durationMs, startPayload, endPayload)
		}
	}

	private record(
		label: string,
		parentLabel: string | undefined,
		durationMs: number,
		startPayload?: ProfilePayload,
		endPayload?: ProfilePayload
	): void {
		const key = `${parentLabel ?? ''}\u0000${label}`
		let stat = this.byKey.get(key)
		if (!stat) {
			stat = { label, parentLabel, calls: 0, totalMs: 0, maxMs: 0, samples: [] }
			this.byKey.set(key, stat)
		}
		stat.calls++
		stat.totalMs += durationMs
		stat.maxMs = Math.max(stat.maxMs, durationMs)
		if (this.shouldCaptureSample(durationMs)) {
			stat.samples.push({
				durationMs,
				startPayload,
				endPayload,
				stack: this.currentLevel === 'stack' ? new Error().stack : undefined,
			})
			const maxSamples = this.options.maxSamples ?? DEFAULT_MAX_SAMPLES
			if (stat.samples.length > maxSamples) stat.samples.splice(0, stat.samples.length - maxSamples)
		}
	}

	private shouldCaptureSample(durationMs: number): boolean {
		if (this.currentLevel !== 'detail' && this.currentLevel !== 'stack') return false
		return durationMs >= (this.options.slowThresholdMs ?? DEFAULT_SLOW_THRESHOLD_MS)
	}

	private closeActiveLabel(label: string): void {
		const last = this.activeLabels.pop()
		if (last === label) return
		const idx = this.activeLabels.lastIndexOf(label)
		if (idx >= 0) this.activeLabels.splice(idx, 1)
	}

	private capturePayload(input: ProfilePayloadInput | undefined): ProfilePayload | undefined {
		if (input === undefined) return undefined
		return untracked`profile.payload`(() =>
			typeof input === 'function' ? (input as ProfilePayloadFactory)() : input
		)
	}

	private sortedStats(): MutableProfileStat[] {
		return [...this.byKey.values()].sort((a, b) => {
			if (b.totalMs !== a.totalMs) return b.totalMs - a.totalMs
			return statDisplayKey(a).localeCompare(statDisplayKey(b))
		})
	}

	private now(): number {
		const custom = this.options.time?.()
		if (custom !== undefined) return custom
		return globalThis.performance?.now?.() ?? Date.now()
	}
}

export function namedProfile(name: string, options?: NamedProfileOptions): ProfileSink {
	return new NamedProfile(name, options)
}

function statDisplayKey(stat: Pick<MutableProfileStat, 'label' | 'parentLabel'>): string {
	return stat.parentLabel ? `${stat.parentLabel} > ${stat.label}` : stat.label
}

function formatMs(ms: number): string {
	return `${ms.toFixed(3)}ms`
}

function formatSamplePayload(sample: ProfileSample): string {
	const parts: string[] = []
	if (sample.startPayload !== undefined) parts.push(`start=${formatPayload(sample.startPayload)}`)
	if (sample.endPayload !== undefined) parts.push(`end=${formatPayload(sample.endPayload)}`)
	return parts.length ? ` ${parts.join(' ')}` : ''
}

function formatPayload(payload: ProfilePayload): string {
	if (payload === undefined) return 'undefined'
	if (payload === null) return 'null'
	if (typeof payload === 'string') return JSON.stringify(payload)
	if (typeof payload === 'number' || typeof payload === 'boolean') return String(payload)
	if (typeof payload === 'function') return '[function]'
	try {
		const json = JSON.stringify(payload)
		// `JSON.stringify` returns `undefined` (not throw) for circular refs, `Map`/`Set` etc. —
		// fall back to a stable descriptor instead of emitting "undefined" / "[object Object]".
		return json !== undefined ? json : describeObject(payload)
	} catch {
		return describeObject(payload)
	}
}

/** Stable, non-throwing descriptor for payloads that can't be JSON-serialized (proxies, circular). */
function describeObject(value: object): string {
	try {
		const keys = Object.keys(value)
		return keys.length ? `{${keys.join(',')}}` : String(value)
	} catch {
		return '[object]'
	}
}
