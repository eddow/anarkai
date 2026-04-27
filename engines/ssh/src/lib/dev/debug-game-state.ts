import { unwrap } from 'mutts'
import type { ExecutionState } from 'npc-script'
import type {
	FreightLineDefinition,
	FreightStop,
	SyntheticFreightLineObject,
} from 'ssh/freight/freight-line'
import type { Game } from 'ssh/game/game'
import type { InspectorSelectableObject, InteractiveGameObject } from 'ssh/game/object'
import {
	goWorkLocalsFromExecutionState,
	summarizeScriptExecutionForInfiniteFail,
} from 'ssh/npcs/npc-diagnostics'
import type { ScriptExecution } from 'ssh/npcs/scripts'
import { Character } from 'ssh/population/character'
import { VehicleEntity } from 'ssh/population/vehicle/entity'
import {
	isVehicleLineService,
	isVehicleMaintenanceService,
	type VehicleService,
} from 'ssh/population/vehicle/vehicle'
import { type Positioned, toAxialCoord } from 'ssh/utils/position'

export interface BuildGameDebugDumpOptions {
	selectedUid?: string
	includeSaveState?: boolean
	logsTail?: number
}

export interface DebugCoord {
	q: number
	r: number
}

function coordSnapshot(position: Positioned | undefined): DebugCoord | undefined {
	const coord = position ? toAxialCoord(position) : undefined
	if (!coord) return undefined
	return { q: Math.round(coord.q), r: Math.round(coord.r) }
}

const DEFAULT_DEBUG_CLONE_MAX_DEPTH = 48

function isProbablyGameLike(value: object): boolean {
	const v = value as Record<string, unknown>
	return (
		typeof v.hex === 'object' &&
		v.hex !== null &&
		typeof v.population === 'object' &&
		v.population !== null &&
		typeof v.vehicles === 'object' &&
		v.vehicles !== null
	)
}

/**
 * Deep-clone arbitrary runtime graphs into JSON-safe plain data without using
 * `JSON.stringify` on reactive / host graphs (Mutts `Eventful.emit` proxies can throw
 * when enumerated by the native JSON walker).
 */
export function cloneValueForDebugJson(
	value: unknown,
	options: { maxDepth?: number } = {}
): unknown {
	const maxDepth = options.maxDepth ?? DEFAULT_DEBUG_CLONE_MAX_DEPTH
	const memo = new WeakMap<object, unknown>()
	const visiting = new Set<object>()

	const walk = (input: unknown, depth: number): unknown => {
		if (input === undefined) return undefined
		if (input === null) return null
		if (typeof input === 'string' || typeof input === 'number' || typeof input === 'boolean')
			return input
		if (typeof input === 'bigint') return `${input}n`
		if (typeof input === 'symbol') return String(input)
		if (typeof input === 'function') {
			return `[Function ${(input as Function).name || 'anonymous'}]`
		}
		if (depth > maxDepth) return '[MaxDepth]'

		const raw = typeof input === 'object' ? unwrap(input as object) : input
		if (raw === null || typeof raw !== 'object') return raw

		if (visiting.has(raw)) return '[Circular]'
		const memoized = memo.get(raw)
		if (memoized !== undefined) return memoized
		if (raw instanceof Date) return raw.toISOString()

		if (raw instanceof Character) {
			const stub = { kind: 'Character', uid: raw.uid, name: raw.name }
			memo.set(raw, stub)
			return stub
		}
		if (raw instanceof VehicleEntity) {
			const stub = { kind: 'VehicleEntity', uid: raw.uid, vehicleType: raw.vehicleType }
			memo.set(raw, stub)
			return stub
		}

		if (Array.isArray(raw)) {
			const out: unknown[] = []
			memo.set(raw, out)
			visiting.add(raw)
			try {
				for (const item of raw) out.push(walk(item, depth + 1))
			} finally {
				visiting.delete(raw)
			}
			return out
		}

		if (isProbablyGameLike(raw)) {
			const stub = { kind: 'Game', note: 'omitted: reactive host graph' }
			memo.set(raw, stub)
			return stub
		}

		const out: Record<string, unknown> = {}
		memo.set(raw, out)
		visiting.add(raw)
		try {
			const keys = Object.keys(raw as object)
			for (const key of keys) {
				let prop: unknown
				try {
					prop = (raw as Record<string, unknown>)[key]
				} catch (error) {
					out[key] = {
						readError: error instanceof Error ? error.message : String(error),
					}
					continue
				}
				out[key] = walk(prop, depth + 1)
			}
		} finally {
			visiting.delete(raw)
		}
		return out
	}

	return walk(value, 0)
}

export function safeDebugValueForDump(value: unknown): unknown {
	if (value === undefined) return undefined
	try {
		return cloneValueForDebugJson(value)
	} catch (error) {
		return {
			serializationError: error instanceof Error ? error.message : String(error),
			stringValue: String(value),
		}
	}
}

export function stringifyDebugValue(value: unknown): string {
	return JSON.stringify(cloneValueForDebugJson(value), null, 2)
}

function summarizeExecutionStateForDebug(state: ExecutionState | undefined): unknown {
	if (!state) return undefined
	return {
		goWorkLocals: goWorkLocalsFromExecutionState(state),
		state: cloneValueForDebugJson(state),
	}
}

function stepExecutorSnapshot(
	step:
		| {
				constructor: { name: string }
				status?: unknown
				description?: unknown
				serialize(): unknown
		  }
		| undefined
) {
	if (!step) return undefined
	return {
		type: step.constructor.name,
		status: safeDebugValueForDump(step.status),
		description: safeDebugValueForDump(step.description),
		serialized: safeDebugValueForDump(step.serialize()),
	}
}

function runningScriptSnapshot(script: ScriptExecution) {
	return {
		...summarizeScriptExecutionForInfiniteFail(script),
		state: summarizeExecutionStateForDebug(script.state),
	}
}

function logsTail(logs: readonly string[], count: number): string[] {
	return [...logs.slice(-count)]
}

function summarizeCharacterForDebug(character: Character, tailCount: number) {
	return {
		kind: 'character' as const,
		uid: character.uid,
		name: character.name,
		position: coordSnapshot(character.position),
		tile: coordSnapshot(character.tile.position),
		driving: character.driving,
		operatedVehicleUid: character.operates?.uid,
		assignedAlveolusCoord: coordSnapshot(character.assignedAlveolus?.tile.position),
		activeTransportStock: safeDebugValueForDump(character.carry?.stock ?? {}),
		actionDescription: [...character.actionDescription],
		runningScripts: character.runningScripts.map(runningScriptSnapshot),
		stepExecutor: stepExecutorSnapshot(character.stepExecutor),
		planner: {
			lastPlannerSnapshot: safeDebugValueForDump(character.lastPlannerSnapshot),
			lastWorkPlannerSnapshot: safeDebugValueForDump(character.lastWorkPlannerSnapshot),
		},
		logs: logsTail(character.logs, tailCount),
	}
}

function summarizeVehicleServiceForDebug(service: VehicleService) {
	if (isVehicleLineService(service)) {
		return {
			kind: 'line' as const,
			lineId: service.line.id,
			stopId: service.stop.id,
			docked: service.docked,
			operatorUid: service.operator?.uid,
		}
	}
	if (isVehicleMaintenanceService(service)) {
		return {
			kind: 'maintenance' as const,
			maintenanceKind: service.kind,
			target: coordSnapshot(service.targetCoord),
			operatorUid: service.operator?.uid,
			...(service.kind === 'loadFromBurden'
				? { looseGood: safeDebugValueForDump(service.looseGood) }
				: {}),
		}
	}
	return {
		kind: 'bare' as const,
		operatorUid: service.operator?.uid,
	}
}

function summarizeVehicleForDebug(vehicle: VehicleEntity, tailCount: number) {
	return {
		kind: 'vehicle' as const,
		uid: vehicle.uid,
		vehicleType: vehicle.vehicleType,
		position: coordSnapshot(vehicle.position),
		tile: coordSnapshot(vehicle.tile.position),
		servedLineIds: vehicle.servedLines.map((line) => line.id),
		service: vehicle.service ? summarizeVehicleServiceForDebug(vehicle.service) : undefined,
		storage: safeDebugValueForDump(vehicle.storage.stock),
		logs: logsTail(vehicle.logs, tailCount),
	}
}

export function summarizeFreightStopForDebug(stop: FreightStop) {
	const base = {
		id: stop.id,
		loadSelection: safeDebugValueForDump(stop.loadSelection),
		unloadSelection: safeDebugValueForDump(stop.unloadSelection),
	}
	if ('anchor' in stop) {
		return {
			...base,
			kind: 'anchor' as const,
			anchor: {
				hiveName: stop.anchor.hiveName,
				alveolusType: stop.anchor.alveolusType,
				coord: { q: stop.anchor.coord[0], r: stop.anchor.coord[1] },
			},
		}
	}
	return {
		...base,
		kind: 'zone' as const,
		zone: {
			kind: stop.zone.kind,
			center: { q: stop.zone.center[0], r: stop.zone.center[1] },
			radius: stop.zone.radius,
		},
	}
}

function summarizeFreightLineForDebug(line: FreightLineDefinition) {
	return {
		id: line.id,
		name: line.name,
		stops: line.stops.map(summarizeFreightStopForDebug),
	}
}

function isInteractiveGameObject(value: unknown): value is InteractiveGameObject {
	return (
		!!value &&
		typeof value === 'object' &&
		'uid' in value &&
		'title' in value &&
		'logs' in value &&
		'canInteract' in value
	)
}

function isInspectorSelectableObject(value: unknown): value is InspectorSelectableObject {
	return (
		!!value &&
		typeof value === 'object' &&
		'uid' in value &&
		'title' in value &&
		'logs' in value &&
		'game' in value
	)
}

function isSyntheticFreightLineObject(value: unknown): value is SyntheticFreightLineObject {
	return isInspectorSelectableObject(value) && 'kind' in value && value.kind === 'freight-line'
}

function summarizeSelectedObjectForDebug(selected: unknown, tailCount: number) {
	if (!selected) return undefined
	if (selected instanceof Character) return summarizeCharacterForDebug(selected, tailCount)
	if (selected instanceof VehicleEntity) return summarizeVehicleForDebug(selected, tailCount)
	if (isSyntheticFreightLineObject(selected)) {
		return {
			kind: 'freight-line' as const,
			uid: selected.uid,
			title: selected.title,
			lineId: selected.lineId,
			line: summarizeFreightLineForDebug(selected.line),
			logs: logsTail(selected.logs, tailCount),
		}
	}
	if (isInteractiveGameObject(selected)) {
		return {
			kind: selected.constructor.name,
			uid: selected.uid,
			title: selected.title,
			position: coordSnapshot(selected.position),
			tile: coordSnapshot(selected.tile.position),
			debugInfo: safeDebugValueForDump(selected.debugInfo),
			logs: logsTail(selected.logs, tailCount),
		}
	}
	if (isInspectorSelectableObject(selected)) {
		return {
			kind: 'selectable' as const,
			uid: selected.uid,
			title: selected.title,
			position: coordSnapshot(selected.position),
			logs: logsTail(selected.logs, tailCount),
		}
	}
	return safeDebugValueForDump(selected)
}

export function buildGameDebugDump(game: Game, options: BuildGameDebugDumpOptions = {}) {
	const logsCount = options.logsTail ?? 12
	const selected = options.selectedUid ? game.getObject(options.selectedUid) : undefined
	return {
		clock: { virtualTime: game.clock.virtualTime },
		generationOptions: safeDebugValueForDump(game.generationOptions),
		selectedUid: options.selectedUid,
		selected: summarizeSelectedObjectForDebug(selected, logsCount),
		characters: [...game.population].map((character) =>
			summarizeCharacterForDebug(character, logsCount)
		),
		vehicles: [...game.vehicles].map((vehicle) => summarizeVehicleForDebug(vehicle, logsCount)),
		freightLines: game.freightLines.map(summarizeFreightLineForDebug),
		saveState: options.includeSaveState ? game.saveGameData() : undefined,
	}
}
