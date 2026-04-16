import type { ExecutionState } from 'npc-script'
import { ScriptExecution } from './scripts'

/** Human-readable kind for the value returned from `ScriptExecution.run` (npc-script executor). */
export function summarizeScriptRunValueKind(value: unknown): string {
	if (value === undefined) return 'undefined'
	if (value === null) return 'null'
	if (value instanceof ScriptExecution) return `ScriptExecution(${value.name})`
	if (typeof value !== 'object') return typeof value
	const ctor = (value as { constructor?: { name?: string } }).constructor
	if (ctor?.name) return ctor.name
	return typeof value
}

/** High-signal, JSON-safe fields from a `WorkPlan`-like `jobPlan` (script local). */
export function summarizeJobPlanForDiagnostics(
	jobPlan: unknown
): Record<string, unknown> | undefined {
	if (jobPlan === null || typeof jobPlan !== 'object') return undefined
	const j = jobPlan as Record<string, unknown>
	const job = j.job
	if (typeof job !== 'string') return undefined
	const out: Record<string, unknown> = { job }
	const copyIfPrimitive = (key: string, v: unknown) => {
		if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null) {
			out[key] = v
		}
	}
	copyIfPrimitive('vehicleUid', j.vehicleUid)
	copyIfPrimitive('lineId', j.lineId)
	copyIfPrimitive('stopId', j.stopId)
	copyIfPrimitive('goodType', j.goodType)
	copyIfPrimitive('quantity', j.quantity)
	copyIfPrimitive('dockEnter', j.dockEnter)
	copyIfPrimitive('type', j.type)
	return out
}

/**
 * Reads `work.npcs` `goWork(jobPlan, path)` locals from the innermost stack frame (initial parameters).
 */
export function goWorkLocalsFromExecutionState(
	state: ExecutionState | undefined
): { jobPlan?: Record<string, unknown>; pathLen?: number } | undefined {
	const vars = state?.stack?.[0]?.scope?.variables as Record<string, unknown> | undefined
	if (!vars) return undefined
	const jobPlan = summarizeJobPlanForDiagnostics(vars.jobPlan)
	const path = vars.path
	const pathLen = Array.isArray(path) ? path.length : undefined
	if (jobPlan === undefined && pathLen === undefined) return undefined
	return {
		...(jobPlan !== undefined ? { jobPlan } : {}),
		...(pathLen !== undefined ? { pathLen } : {}),
	}
}

/** Shallow, JSON-friendly summary of a pending `ScriptExecution` for infinite-fail diagnostics. */
export function summarizeScriptExecutionForInfiniteFail(
	exec: ScriptExecution
): Record<string, unknown> {
	const base: Record<string, unknown> = {
		scriptModule: exec.script.name,
		executionName: exec.name,
		hasState: exec.state !== undefined,
	}
	if (exec.name === 'work.goWork') {
		const locals = goWorkLocalsFromExecutionState(exec.state)
		if (locals !== undefined) Object.assign(base, locals)
	}
	return base
}

export interface NpcSubjectSnapshot {
	name?: string
	uid?: string
	tile?: { q: number; r: number }
}

export function npcSubjectSnapshot(subject: object): NpcSubjectSnapshot {
	const o = subject as {
		name?: unknown
		uid?: unknown
		tile?: { position: { q: number; r: number } }
	}
	const name = typeof o.name === 'string' ? o.name : undefined
	const uid = typeof o.uid === 'string' ? o.uid : undefined
	const p = o.tile?.position
	const tile =
		p && typeof p.q === 'number' && typeof p.r === 'number' ? { q: p.q, r: p.r } : undefined
	return { name, uid, tile }
}

export function plannerSnapshotsFromSubject(
	subject: object
): { lastPlannerSnapshot?: unknown; lastWorkPlannerSnapshot?: unknown } | undefined {
	const c = subject as {
		lastPlannerSnapshot?: unknown
		lastWorkPlannerSnapshot?: unknown
	}
	const out: { lastPlannerSnapshot?: unknown; lastWorkPlannerSnapshot?: unknown } = {}
	if ('lastPlannerSnapshot' in c && c.lastPlannerSnapshot !== undefined) {
		out.lastPlannerSnapshot = c.lastPlannerSnapshot
	}
	if ('lastWorkPlannerSnapshot' in c && c.lastWorkPlannerSnapshot !== undefined) {
		out.lastWorkPlannerSnapshot = c.lastWorkPlannerSnapshot
	}
	return Object.keys(out).length > 0 ? out : undefined
}

export interface InfiniteFailLoopEntry {
	name: string
	type: string
	valueKind: string
}

export function loopEntriesForNpcTrace(
	loopCount: ReadonlyArray<{ name: string; type: string; value: unknown }>,
	tail: number
): InfiniteFailLoopEntry[] {
	const slice = loopCount.slice(-tail)
	return slice.map((e) => ({
		name: e.name,
		type: e.type,
		valueKind: summarizeScriptRunValueKind(e.value),
	}))
}
