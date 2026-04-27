import { unreactive, untracked } from 'mutts'

export type TraceLevel = 'log' | 'warn' | 'error' | 'debug' | 'info' | 'trace' | 'assert failure'

export type TraceScalar = string | number | boolean | null | undefined

export type TraceValue = TraceScalar | TraceValue[] | { readonly [key: string]: TraceValue }

export const traceProjection = Symbol('traceProjection')

export type TraceRow = [TraceLevel, ...TraceValue[]] & {
	readonly time?: number
}

/**
 * Console-like trace recorder used by `traces.*` channels.
 *
 * Trace methods are optional on purpose: a disabled level is represented by an undefined method, so
 * call sites can write `traces.vehicle.log?.('event', payload)` and avoid building `payload` when
 * `log` is gated off. Implementations must still expose `read()` and `display()` so every configured
 * sink can be inspected from tests or DevTools.
 */
export type TraceSink = Partial<
	Pick<
		Console,
		'assert' | 'debug' | 'error' | 'groupCollapsed' | 'groupEnd' | 'info' | 'log' | 'trace' | 'warn'
	>
> & {
	readonly heads?: readonly unknown[]
	read: (count?: number) => string
	display: (count?: number) => void
}

export type TraceConsoleRow = {
	readonly title: string
	readonly body: string
}

export type TraceCaptureOptions = {
	/** Maximum recursive depth for plain objects/arrays before `[MaxDepth]` is emitted. */
	readonly maxDepth?: number
	/** Maximum array items captured per array before a truncation marker is appended. */
	readonly maxArrayLength?: number
	/** Maximum own enumerable keys captured per plain object before `$truncated` is emitted. */
	readonly maxObjectKeys?: number
	/** Optional clock used for row retention and `@t=...` rendering. */
	readonly time?: () => number | undefined
}

type UnknownRecord = Record<PropertyKey, unknown>

type ProjectionContext = {
	readonly options: Required<Omit<TraceCaptureOptions, 'time'>>
	readonly runtimeRefs: WeakMap<object, string>
	readonly plainStack: WeakSet<object>
	nextGeneratedRef: number
}

type RuntimeProjection = {
	readonly ref: string
	readonly body: UnknownRecord
}

const DEFAULT_TRACE_OPTIONS: Required<Omit<TraceCaptureOptions, 'time'>> = {
	maxDepth: 5,
	maxArrayLength: 20,
	maxObjectKeys: 30,
}

const FORBIDDEN_GRAPH_KEYS = new Set<PropertyKey>(['board', 'game', 'hex', 'hive', 'population'])

export function captureTraceRow(
	level: TraceLevel,
	args: readonly unknown[],
	options: TraceCaptureOptions = {}
): TraceRow {
	const time = options.time?.()
	const projected = untracked`trace.capture`(() => {
		const ctx: ProjectionContext = {
			options: {
				maxDepth: options.maxDepth ?? DEFAULT_TRACE_OPTIONS.maxDepth,
				maxArrayLength: options.maxArrayLength ?? DEFAULT_TRACE_OPTIONS.maxArrayLength,
				maxObjectKeys: options.maxObjectKeys ?? DEFAULT_TRACE_OPTIONS.maxObjectKeys,
			},
			runtimeRefs: new WeakMap(),
			plainStack: new WeakSet(),
			nextGeneratedRef: 1,
		}
		return args.map((arg) => projectTraceValue(arg, ctx, 0))
	})
	const row: TraceRow = [level, ...projected]
	if (time !== undefined) {
		Object.defineProperty(row, 'time', { value: time, enumerable: false })
	}
	return row
}

/**
 * Renders stored rows as compact YAML-like text for copy/paste diagnostics.
 *
 * The optional `count` selects the last `count` rows, matching `TraceSink.read(count)`.
 */
export function readTraceRows(rows: readonly TraceRow[], count?: number): string {
	const selected = count === undefined ? rows : rows.slice(Math.max(0, rows.length - count))
	return selected.map((row) => renderRow(row)).join('\n\n')
}

/** Renders a single row in the same title/body shape used inside forwarded console groups. */
export function readTraceConsoleRow(row: TraceRow): string {
	const { title, body } = readTraceConsoleParts(row)
	return body ? `${title}\n${body}` : title
}

/** Splits a row into a collapsed console group title and an indented payload body. */
export function readTraceConsoleParts(row: TraceRow): TraceConsoleRow {
	const [titleLine, ...bodyLines] = renderRow(row).split('\n')
	const [level] = row
	const levelPrefix = `${level} `
	const title = titleLine?.startsWith(levelPrefix)
		? titleLine.slice(levelPrefix.length)
		: titleLine === level
			? ''
			: (titleLine ?? '')
	return {
		title,
		body: bodyLines.join('\n'),
	}
}

function projectTraceValue(value: unknown, ctx: ProjectionContext, depth: number): TraceValue {
	if (value === null) return null
	if (value === undefined) return 'undefined'
	if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
		return value
	}
	if (typeof value === 'bigint') return `${value}n`
	if (typeof value === 'symbol')
		return value.description ? `Symbol(${value.description})` : 'Symbol()'
	if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`
	if (!isObject(value)) return String(value)

	const raw = unwrapTraceObject(value)
	const customProjection = projectCustomTrace(raw, ctx)
	if (customProjection) return projectRuntimeProjection(raw, customProjection, ctx, depth)

	const runtimeProjection = projectKnownRuntimeObject(raw, ctx)
	if (runtimeProjection) return projectRuntimeProjection(raw, runtimeProjection, ctx, depth)

	if (Array.isArray(raw)) return projectArray(raw, ctx, depth)
	if (isPlainRecord(raw)) return projectPlainRecord(raw, ctx, depth)

	return projectUnprojected(raw)
}

function projectArray(
	value: readonly unknown[],
	ctx: ProjectionContext,
	depth: number
): TraceValue {
	if (depth >= ctx.options.maxDepth) return '[MaxDepth]'
	const projected = value
		.slice(0, ctx.options.maxArrayLength)
		.map((item) => projectTraceValue(item, ctx, depth + 1))
	if (value.length > ctx.options.maxArrayLength) {
		projected.push(`[Truncated ${value.length - ctx.options.maxArrayLength} items]`)
	}
	return projected
}

function projectPlainRecord(value: object, ctx: ProjectionContext, depth: number): TraceValue {
	if (depth >= ctx.options.maxDepth) return '[MaxDepth]'
	if (ctx.plainStack.has(value)) return '[Circular]'
	ctx.plainStack.add(value)
	try {
		const record = value as UnknownRecord
		const out: Record<string, TraceValue> = {}
		const keys = Object.keys(record).slice(0, ctx.options.maxObjectKeys)
		for (const key of keys) {
			if (FORBIDDEN_GRAPH_KEYS.has(key)) continue
			out[key] = projectTraceValue(record[key], ctx, depth + 1)
		}
		const keyCount = Object.keys(record).length
		if (keyCount > ctx.options.maxObjectKeys) {
			out.$truncated = `${keyCount - ctx.options.maxObjectKeys} keys`
		}
		return out
	} finally {
		ctx.plainStack.delete(value)
	}
}

function projectRuntimeProjection(
	raw: object,
	projection: RuntimeProjection,
	ctx: ProjectionContext,
	depth: number
): TraceValue {
	const existingRef = ctx.runtimeRefs.get(raw)
	if (existingRef) return { $ref: existingRef }
	ctx.runtimeRefs.set(raw, projection.ref)
	const projected = projectPlainRecord(projection.body, ctx, depth) as Record<string, TraceValue>
	return {
		$anchor: projection.ref,
		...projected,
	}
}

function projectCustomTrace(raw: object, ctx: ProjectionContext): RuntimeProjection | undefined {
	const record = raw as UnknownRecord
	if (traceProjection in record) {
		return projectCustomTraceValue(raw, record[traceProjection], ctx)
	}
	if (typeof record.toTrace !== 'function') return undefined
	try {
		return projectCustomTraceValue(raw, record.toTrace.call(raw), ctx)
	} catch (error) {
		return {
			ref: generatedRef('TraceObject', raw, ctx),
			body: {
				$type: constructorName(raw),
				$traceError: error instanceof Error ? error.message : String(error),
			},
		}
	}
}

function projectCustomTraceValue(
	raw: object,
	traced: unknown,
	ctx: ProjectionContext
): RuntimeProjection {
	if (!isObject(traced) || Array.isArray(traced)) {
		return {
			ref: generatedRef('TraceObject', raw, ctx),
			body: { $type: constructorName(raw), value: traced },
		}
	}
	const body = traced as UnknownRecord
	return {
		ref:
			traceRefFromBody(body) ?? generatedRef(String(body.$type ?? constructorName(raw)), raw, ctx),
		body,
	}
}

function projectKnownRuntimeObject(
	raw: object,
	ctx: ProjectionContext
): RuntimeProjection | undefined {
	const record = raw as UnknownRecord
	if (isTrackedMovementRecord(record)) return projectTrackedMovement(record, ctx)
	if (isFreightLineRecord(record)) return projectFreightLine(record)
	if (isFreightStopRecord(record)) return projectFreightStop(record)
	return undefined
}

function projectTrackedMovement(record: UnknownRecord, ctx: ProjectionContext): RuntimeProjection {
	return {
		ref: `Movement:${ctx.nextGeneratedRef++}`,
		body: {
			$type: 'Movement',
			goodType: stringValue(record.goodType),
			from: traceCoord(record.from),
			path: pathSummary(record.path),
			claimed: booleanValue(record.claimed),
			claimedByUid: isObject(record.claimedBy)
				? stringValue((record.claimedBy as UnknownRecord).uid)
				: undefined,
			provider: partySummary(record.provider),
			demander: partySummary(record.demander),
		},
	}
}

function projectFreightLine(record: UnknownRecord): RuntimeProjection {
	const id = stringValue(record.id) ?? 'unknown'
	return {
		ref: `FreightLine:${id}`,
		body: {
			$type: 'FreightLine',
			id,
			name: stringValue(record.name),
			stops: Array.isArray(record.stops) ? record.stops.length : undefined,
		},
	}
}

function projectFreightStop(record: UnknownRecord): RuntimeProjection {
	const id = stringValue(record.id) ?? 'unknown'
	return {
		ref: `FreightStop:${id}`,
		body: {
			$type: 'FreightStop',
			id,
			anchor: freightAnchorSummary(record.anchor),
			zone: freightZoneSummary(record.zone),
			loadSelection: selectionSummary(record.loadSelection),
			unloadSelection: selectionSummary(record.unloadSelection),
		},
	}
}

function projectUnprojected(raw: object): TraceValue {
	return {
		$unprojected: constructorName(raw),
	}
}

function renderRow(row: TraceRow): string {
	const [level, first, ...rest] = row
	const suffix = row.time === undefined ? '' : ` @t=${formatScalar(row.time)}`
	const head = typeof first === 'string' ? ` ${first}` : ''
	const lines = [`${level}${head}${suffix}`]
	const values = typeof first === 'string' ? rest : [first, ...rest]
	if (values.length === 1 && isEntryObject(values[0])) {
		for (const [key, value] of Object.entries(values[0])) {
			lines.push(...renderValue(value, 1, key))
		}
		return lines.join('\n')
	}
	for (const value of values) {
		lines.push(...renderValue(value, 1, undefined))
	}
	return lines.join('\n')
}

function renderValue(value: TraceValue, indent: number, key: string | undefined): string[] {
	const prefix = '\t'.repeat(indent)
	if (isTraceScalar(value)) {
		return [`${prefix}${key ? `${key}: ` : '- '}${formatScalar(value)}`]
	}
	if (Array.isArray(value)) {
		const head = key ? `${prefix}${key}:` : `${prefix}-`
		if (value.length === 0) return [`${head} []`]
		return [head, ...value.flatMap((item) => renderValue(item, indent + 1, undefined))]
	}
	const ref = typeof value.$ref === 'string' ? value.$ref : undefined
	if (ref) return [`${prefix}${key ? `${key}: ` : '- '}${`*${ref}`}`]
	const anchor = typeof value.$anchor === 'string' ? value.$anchor : undefined
	const entries = Object.entries(value).filter(([entryKey]) => entryKey !== '$anchor')
	const head = `${prefix}${key ? `${key}:` : '-'}${anchor ? ` &${anchor}` : ''}`
	if (entries.length === 0) return [head]
	return [
		head,
		...entries.flatMap(([entryKey, entryValue]) => renderValue(entryValue, indent + 1, entryKey)),
	]
}

function isTraceScalar(value: TraceValue): value is TraceScalar {
	return (
		value === null || value === undefined || ['string', 'number', 'boolean'].includes(typeof value)
	)
}

function isEntryObject(
	value: TraceValue | undefined
): value is { readonly [key: string]: TraceValue } {
	return (
		isObject(value) &&
		!Array.isArray(value) &&
		typeof (value as UnknownRecord).$anchor !== 'string' &&
		typeof (value as UnknownRecord).$ref !== 'string'
	)
}

function formatScalar(value: TraceScalar): string {
	if (value === undefined) return 'undefined'
	if (typeof value === 'string') {
		return /^[\w./:-]+$/.test(value) ? value : JSON.stringify(value)
	}
	return String(value)
}

function traceRefFromBody(body: UnknownRecord): string | undefined {
	const type = stringValue(body.$type) ?? stringValue(body.type)
	const uid = stringValue(body.uid) ?? stringValue(body.id)
	return type && uid ? `${type}:${uid}` : undefined
}

function generatedRef(type: string, raw: object, ctx: ProjectionContext): string {
	const uid = stringValue((raw as UnknownRecord).uid) ?? stringValue((raw as UnknownRecord).id)
	return uid ? `${type}:${uid}` : `${type}:${ctx.nextGeneratedRef++}`
}

function unwrapTraceObject(value: object): object {
	try {
		const raw = unreactive(value)
		return isObject(raw) ? raw : value
	} catch {
		return value
	}
}

function isObject(value: unknown): value is object {
	return (typeof value === 'object' || typeof value === 'function') && value !== null
}

function isPlainRecord(value: object): boolean {
	const prototype = Object.getPrototypeOf(value)
	return prototype === Object.prototype || prototype === null
}

function constructorName(value: object): string {
	return value.constructor?.name || 'Object'
}

function isTrackedMovementRecord(record: UnknownRecord): boolean {
	return (
		typeof record.goodType === 'string' &&
		'from' in record &&
		Array.isArray(record.path) &&
		'provider' in record &&
		'demander' in record &&
		'allocations' in record
	)
}

function isFreightLineRecord(record: UnknownRecord): boolean {
	return typeof record.id === 'string' && Array.isArray(record.stops)
}

function isFreightStopRecord(record: UnknownRecord): boolean {
	return typeof record.id === 'string' && ('anchor' in record || 'zone' in record)
}

function traceCoord(value: unknown): TraceValue {
	if (Array.isArray(value) && typeof value[0] === 'number' && typeof value[1] === 'number') {
		return [value[0], value[1]]
	}
	if (!isObject(value)) return 'undefined'
	const record = value as UnknownRecord
	if (typeof record.q === 'number' && typeof record.r === 'number') return [record.q, record.r]
	if (typeof record.x === 'number' && typeof record.y === 'number') {
		return { x: roundTraceNumber(record.x), y: roundTraceNumber(record.y) }
	}
	return 'unknown'
}

function pathSummary(value: unknown): TraceValue {
	if (!Array.isArray(value)) return 'undefined'
	const first = value[0]
	const last = value[value.length - 1]
	return {
		length: value.length,
		from: first ? traceCoord(first) : undefined,
		to: last ? traceCoord(last) : undefined,
	}
}

function partySummary(value: unknown): TraceValue {
	if (!isObject(value)) return 'undefined'
	const record = value as UnknownRecord
	return {
		$type: constructorName(record),
		uid: stringValue(record.uid),
		name: stringValue(record.name),
		coord: traceCoord(record.position),
	}
}

function freightAnchorSummary(value: unknown): TraceValue {
	if (!isObject(value)) return 'undefined'
	const record = value as UnknownRecord
	return {
		coord: traceCoord(record.coord ?? record.position),
		hiveName: stringValue(record.hiveName),
	}
}

function freightZoneSummary(value: unknown): TraceValue {
	if (!isObject(value)) return 'undefined'
	const record = value as UnknownRecord
	return {
		coord: traceCoord(record.coord ?? record.center),
		radius: numberValue(record.radius),
	}
}

function selectionSummary(value: unknown): TraceValue {
	if (!isObject(value)) return 'undefined'
	const record = value as UnknownRecord
	return {
		goods: Array.isArray(record.goods) ? record.goods.map(String) : undefined,
		mode: stringValue(record.mode),
	}
}

function stringValue(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined
}

function numberValue(value: unknown): number | undefined {
	return typeof value === 'number' ? roundTraceNumber(value) : undefined
}

function booleanValue(value: unknown): boolean | undefined {
	return typeof value === 'boolean' ? value : undefined
}

function roundTraceNumber(value: number): number {
	return Math.round(value * 1000) / 1000
}
