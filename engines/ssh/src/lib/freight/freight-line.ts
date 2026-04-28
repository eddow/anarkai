import { defaultGatherFreightRadius } from 'engine-rules'
import type { Tile } from 'ssh/board/tile'
import type { Game } from 'ssh/game'
import type { InspectorSelectableObject } from 'ssh/game/object'
import type { AlveolusType, GoodType } from 'ssh/types'
import type { AxialCoord, Positioned } from 'ssh/utils'
import { toAxialCoord } from 'ssh/utils/position'
import type { GoodSelectionPolicy } from './goods-selection-policy'
import {
	evaluateGoodSelectionPolicy,
	isUnrestrictedGoodsSelectionPolicy,
	listGoodTypesMatchingSelectionPolicy,
	normalizeGoodSelectionPolicy,
} from './goods-selection-policy'

/**
 * @file Freight routes for `engines/ssh`: ordered {@link FreightLineDefinition.stops}, route segments,
 * and helpers for gather/distribute runtime vs inspector. Each {@link FreightStop} has optional
 * `loadSelection` / `unloadSelection` and exactly one of `anchor` | `zone`. Gather/distribute segments
 * are inferred from geometry only. See `docs/freight-lines.md`.
 *
 * In segment loops use {@link gatherSegmentAllowsGoodTypeForSegment} / {@link distributeSegmentAllowsGoodTypeForSegment}
 * with the active segment; {@link freightLineAllowsGoodType} is for UI summaries only.
 */

export type {
	GoodSelectionEffect,
	GoodSelectionGoodRule,
	GoodSelectionPolicy,
	GoodSelectionTagMatch,
	GoodSelectionTagRule,
} from './goods-selection-policy'

/** @deprecated Prefer explicit route presets; kept for editor / hive UI call sites. */
export type FreightLineMode = 'gather' | 'distribute'

export type FreightLineStopAlveolusType = AlveolusType | 'gather'

export interface FreightStopAnchorAlveolus {
	readonly kind: 'alveolus'
	readonly hiveName: string
	readonly alveolusType: FreightLineStopAlveolusType
	readonly coord: readonly [number, number]
}

/** Bay tile anchor for a route step (same shape as the legacy alveolus anchor). */
export type FreightBayAnchor = FreightStopAnchorAlveolus

export type FreightStopAnchor = FreightStopAnchorAlveolus

export interface FreightZoneDefinitionRadius {
	readonly kind: 'radius'
	readonly center: readonly [number, number]
	readonly radius: number
}

export type FreightZoneDefinition = FreightZoneDefinitionRadius

/** One route step: optional load/unload goods policies at a bay anchor or radius zone. */
export type FreightStop = {
	readonly id: string
	readonly loadSelection?: GoodSelectionPolicy
	readonly unloadSelection?: GoodSelectionPolicy
} & ({ readonly anchor: FreightBayAnchor } | { readonly zone: FreightZoneDefinition })

export interface FreightLineDefinition {
	readonly id: string
	readonly name: string
	readonly stops: ReadonlyArray<FreightStop>
}

export const DEFAULT_GATHER_FREIGHT_RADIUS = defaultGatherFreightRadius
export const FREIGHT_LINE_UID_PREFIX = 'freight-line:'

export function freightLineStopHiveName(hiveName?: string): string {
	return hiveName ?? ''
}

export function freightLineDisplayHiveName(hiveName?: string): string {
	const trimmed = hiveName?.trim()
	return trimmed ? trimmed : 'Hive'
}

export function freightLineStationLabel(
	stop: Pick<FreightStopAnchorAlveolus, 'hiveName' | 'coord'>
): string {
	return `${freightLineDisplayHiveName(stop.hiveName)} (${stop.coord[0]}, ${stop.coord[1]})`
}

export function canonicalFreightLineStopAlveolusType(
	alveolusType: FreightLineStopAlveolusType
): AlveolusType {
	return alveolusType === 'gather' ? 'freight_bay' : alveolusType
}

export interface SyntheticFreightLineObject extends InspectorSelectableObject {
	readonly kind: 'freight-line'
	readonly line: FreightLineDefinition
	readonly lineId: string
	readonly tile?: Tile
}

export function freightLineUid(id: string): string {
	return `${FREIGHT_LINE_UID_PREFIX}${encodeURIComponent(id)}`
}

export function isFreightLineUid(uid: string): boolean {
	return uid.startsWith(FREIGHT_LINE_UID_PREFIX)
}

export function freightLineIdFromUid(uid: string): string | undefined {
	if (!isFreightLineUid(uid)) return undefined
	const encoded = uid.slice(FREIGHT_LINE_UID_PREFIX.length)
	return encoded ? decodeURIComponent(encoded) : undefined
}

export function freightStopAnchorMatchesAlveolus(
	anchor: FreightStopAnchor,
	alveolus: {
		hive?: { name?: string } | null
		name: string
		tile?: { position: Positioned } | null
	}
): boolean {
	if (anchor.kind !== 'alveolus') return false
	const tile = alveolus.tile
	if (!tile) return false
	const coord = toAxialCoord(tile.position)
	if (!coord) return false
	const hiveName = freightLineStopHiveName(alveolus.hive?.name)
	return (
		anchor.hiveName === hiveName &&
		canonicalFreightLineStopAlveolusType(anchor.alveolusType) ===
			canonicalFreightLineStopAlveolusType(alveolus.name as FreightLineStopAlveolusType) &&
		anchor.coord[0] === coord.q &&
		anchor.coord[1] === coord.r
	)
}

export function freightLineMatchesStop(
	line: FreightLineDefinition,
	args: { hiveName: string; alveolusType: FreightLineStopAlveolusType; q: number; r: number }
): boolean {
	const normalized = normalizeFreightLineDefinition(line)
	return normalized.stops.some((stop) => {
		if (!('anchor' in stop)) return false
		const anchor = stop.anchor
		if (anchor.kind !== 'alveolus') return false
		return (
			anchor.hiveName === args.hiveName &&
			canonicalFreightLineStopAlveolusType(anchor.alveolusType) ===
				canonicalFreightLineStopAlveolusType(args.alveolusType) &&
			anchor.coord[0] === args.q &&
			anchor.coord[1] === args.r
		)
	})
}

export function findFreightLineById(
	lines: Iterable<FreightLineDefinition>,
	id: string
): FreightLineDefinition | undefined {
	for (const line of lines) {
		if (line.id === id) return normalizeFreightLineDefinition(line)
	}
	return undefined
}

export function findFreightLineByUid(
	lines: Iterable<FreightLineDefinition>,
	uid: string
): FreightLineDefinition | undefined {
	const id = freightLineIdFromUid(uid)
	return id ? findFreightLineById(lines, id) : undefined
}

function normalizeBayAnchor(anchor: FreightBayAnchor): FreightBayAnchor {
	return {
		kind: 'alveolus',
		hiveName: freightLineStopHiveName(anchor.hiveName),
		alveolusType: canonicalFreightLineStopAlveolusType(anchor.alveolusType),
		coord: [Math.floor(anchor.coord[0]), Math.floor(anchor.coord[1])] as const,
	}
}

function normalizeRadiusZone(zone: FreightZoneDefinitionRadius): FreightZoneDefinitionRadius {
	return {
		kind: 'radius',
		center: [Math.floor(zone.center[0]), Math.floor(zone.center[1])] as const,
		radius: Math.max(0, Math.floor(zone.radius)),
	}
}

function normalizeOptionalSelectionPolicy(
	policy: GoodSelectionPolicy | undefined
): GoodSelectionPolicy | undefined {
	if (!policy) return undefined
	const normalized = normalizeGoodSelectionPolicy(policy)
	return isUnrestrictedGoodsSelectionPolicy(normalized) ? undefined : normalized
}

function normalizeFreightStop(stop: FreightStop, index: number): FreightStop {
	const id = stop.id?.trim().length ? stop.id : `stop-${index}`
	const loadSelection = normalizeOptionalSelectionPolicy(stop.loadSelection)
	const unloadSelection = normalizeOptionalSelectionPolicy(stop.unloadSelection)
	if ('anchor' in stop) {
		return { id, loadSelection, unloadSelection, anchor: normalizeBayAnchor(stop.anchor) }
	}
	return {
		id,
		loadSelection,
		unloadSelection,
		zone: normalizeRadiusZone(stop.zone),
	}
}

/** Indices into {@link FreightLineDefinition.stops} for one gather segment: zone `load` then bay `unload`. */
export interface FreightGatherRouteSegment {
	readonly loadStopIndex: number
	readonly unloadStopIndex: number
}

/**
 * Radius zone stop followed by a bay anchor at the **same** coordinates (gather path).
 * Zone→anchor pairs with different centers are not gather (e.g. distribute unload radius → next bay).
 */
const _gatherSegmentCache = new WeakMap<FreightLineDefinition, FreightGatherRouteSegment[]>()

export function findGatherRouteSegments(line: FreightLineDefinition): FreightGatherRouteSegment[] {
	const cached = _gatherSegmentCache.get(line)
	if (cached) return cached
	const out: FreightGatherRouteSegment[] = []
	for (let i = 0; i < line.stops.length - 1; i++) {
		const zoneStop = line.stops[i]
		const anchorStop = line.stops[i + 1]
		if (!zoneStop || !anchorStop) continue
		if (!('zone' in zoneStop) || zoneStop.zone.kind !== 'radius') continue
		if (!('anchor' in anchorStop) || anchorStop.anchor.kind !== 'alveolus') continue
		const z = zoneStop.zone.center
		const c = anchorStop.anchor.coord
		if (z[0] !== c[0] || z[1] !== c[1]) continue
		out.push({ loadStopIndex: i, unloadStopIndex: i + 1 })
	}
	_gatherSegmentCache.set(line, out)
	return out
}

/** Indices into {@link FreightLineDefinition.stops} for one distribute segment: bay `load` then `unload` (anchor and/or zone on unload). */
export interface FreightDistributeRouteSegment {
	readonly loadStopIndex: number
	readonly unloadStopIndex: number
}

/**
 * Bay anchor stop followed by unload at an anchor and/or radius zone (distribute path).
 * Skips the bay anchor that **ends** a gather segment (zone→anchor at the same tile), since that
 * stop is not a distribute pickup.
 */
export function findDistributeRouteSegments(
	line: FreightLineDefinition
): FreightDistributeRouteSegment[] {
	const gatherUnloadIndices = new Set(
		findGatherRouteSegments(line).map((segment) => segment.unloadStopIndex)
	)
	const out: FreightDistributeRouteSegment[] = []
	for (let i = 0; i < line.stops.length - 1; i++) {
		if (gatherUnloadIndices.has(i)) continue
		const loadStop = line.stops[i]
		const unloadStop = line.stops[i + 1]
		if (!loadStop || !unloadStop) continue
		if (!('anchor' in loadStop)) continue
		if (!('anchor' in unloadStop) && !('zone' in unloadStop)) continue
		out.push({
			loadStopIndex: i,
			unloadStopIndex: i + 1,
		})
	}
	return out
}

/** Normalizes ids, anchors, zones, and goods policies. Call when persisting or replacing a line. */
export function normalizeFreightLineDefinition(line: FreightLineDefinition): FreightLineDefinition {
	return {
		id: line.id,
		name: line.name,
		stops: line.stops.map((stop, index) => normalizeFreightStop(stop, index)),
	}
}

export function findFreightLineForStop(
	lines: Iterable<FreightLineDefinition>,
	alveolus: { hive: { name?: string }; name: string; tile: { position: Positioned } }
): FreightLineDefinition | undefined {
	return findFreightLinesForStop(lines, alveolus)[0]
}

export function findFreightLinesForStop(
	lines: Iterable<FreightLineDefinition>,
	alveolus: { hive: { name?: string }; name: string; tile: { position: Positioned } }
): FreightLineDefinition[] {
	const matches: FreightLineDefinition[] = []
	for (const line of lines) {
		const normalized = normalizeFreightLineDefinition(line)
		if (
			normalized.stops.some(
				(stop) => 'anchor' in stop && freightStopAnchorMatchesAlveolus(stop.anchor, alveolus)
			)
		) {
			matches.push(normalized)
		}
	}
	return matches
}

export function findFreightLinesForStopAndRoute(
	lines: Iterable<FreightLineDefinition>,
	alveolus: { hive: { name?: string }; name: string; tile: { position: Positioned } },
	predicate: (line: FreightLineDefinition) => boolean
): FreightLineDefinition[] {
	return findFreightLinesForStop(lines, alveolus).filter(predicate)
}

function lineTouchesGatherRoute(
	line: FreightLineDefinition,
	alveolus: { hive: { name?: string }; name: string; tile: { position: Positioned } }
): boolean {
	const segments = findGatherRouteSegments(line)
	if (segments.length === 0) return false
	return segments.some((segment) => {
		const loadStop = line.stops[segment.loadStopIndex]
		const unloadStop = line.stops[segment.unloadStopIndex]
		if (!loadStop || !unloadStop) return false
		return (
			('anchor' in loadStop && freightStopAnchorMatchesAlveolus(loadStop.anchor, alveolus)) ||
			('anchor' in unloadStop && freightStopAnchorMatchesAlveolus(unloadStop.anchor, alveolus))
		)
	})
}

function lineTouchesDistributeRoute(
	line: FreightLineDefinition,
	alveolus: { hive: { name?: string }; name: string; tile: { position: Positioned } }
): boolean {
	const segments = findDistributeRouteSegments(line)
	if (segments.length === 0) return false
	return segments.some((segment) => {
		const loadStop = line.stops[segment.loadStopIndex]
		const unloadStop = line.stops[segment.unloadStopIndex]
		if (!loadStop || !unloadStop) return false
		return (
			('anchor' in loadStop && freightStopAnchorMatchesAlveolus(loadStop.anchor, alveolus)) ||
			('anchor' in unloadStop && freightStopAnchorMatchesAlveolus(unloadStop.anchor, alveolus))
		)
	})
}

/** Freight lines with a gather route segment touching this alveolus stop (order preserved). */
export function findGatherFreightLines(
	lines: Iterable<FreightLineDefinition>,
	alveolus: { hive: { name?: string }; name: string; tile: { position: Positioned } }
): FreightLineDefinition[] {
	return findFreightLinesForStopAndRoute(lines, alveolus, (line) =>
		lineTouchesGatherRoute(line, alveolus)
	)
}

/** Freight lines with a distribute route segment touching this alveolus stop (order preserved). */
export function findDistributeFreightLines(
	lines: Iterable<FreightLineDefinition>,
	alveolus: { hive: { name?: string }; name: string; tile: { position: Positioned } }
): FreightLineDefinition[] {
	return findFreightLinesForStopAndRoute(lines, alveolus, (line) =>
		lineTouchesDistributeRoute(line, alveolus)
	)
}

export function findGatherFreightLine(
	lines: Iterable<FreightLineDefinition>,
	alveolus: { hive: { name?: string }; name: string; tile: { position: Positioned } }
): FreightLineDefinition | undefined {
	return findGatherFreightLines(lines, alveolus)[0]
}

export function findDistributeFreightLine(
	lines: Iterable<FreightLineDefinition>,
	alveolus: { hive: { name?: string }; name: string; tile: { position: Positioned } }
): FreightLineDefinition | undefined {
	return findDistributeFreightLines(lines, alveolus)[0]
}

function goodsPolicyFromLoadStop(
	line: FreightLineDefinition,
	loadStopIndex: number
): GoodSelectionPolicy | undefined {
	const stop = line.stops[loadStopIndex]
	if (!stop) return undefined
	return stop.loadSelection ? normalizeGoodSelectionPolicy(stop.loadSelection) : undefined
}

/** Resolves the goods selection from the first gather segment's load stop (editor/summary). */
export function resolveGatherFreightGoodsSelectionPolicy(
	line: FreightLineDefinition | undefined
): GoodSelectionPolicy | undefined {
	if (!line) return undefined
	for (const segment of findGatherRouteSegments(line)) {
		const policy = goodsPolicyFromLoadStop(line, segment.loadStopIndex)
		if (policy) return policy
	}
	return undefined
}

/** Resolves the goods selection from the first distribute segment's load stop (editor/summary). */
export function resolveDistributeFreightGoodsSelectionPolicy(
	line: FreightLineDefinition | undefined
): GoodSelectionPolicy | undefined {
	if (!line) return undefined
	for (const segment of findDistributeRouteSegments(line)) {
		const policy = goodsPolicyFromLoadStop(line, segment.loadStopIndex)
		if (policy) return policy
	}
	return undefined
}

export function gatherSelectableGoodTypes(
	line: FreightLineDefinition | undefined,
	hiveNeedTypes: readonly GoodType[]
): GoodType[] {
	const policy = resolveGatherFreightGoodsSelectionPolicy(line)
	if (!policy || isUnrestrictedGoodsSelectionPolicy(policy)) return [...hiveNeedTypes]
	return listGoodTypesMatchingSelectionPolicy(policy)
}

export function distributeLinesAllowGoodType(
	lines: readonly FreightLineDefinition[],
	good: GoodType
): boolean {
	if (lines.length === 0) return true
	return lines.some((line) => distributeSegmentAllowsGoodType(line, good))
}

/** True when the gather segment's load policy allows the good (use in segment loops). */
export function gatherSegmentAllowsGoodTypeForSegment(
	line: FreightLineDefinition,
	segment: FreightGatherRouteSegment,
	good: GoodType
): boolean {
	const policy = goodsPolicyFromLoadStop(line, segment.loadStopIndex)
	if (!policy || isUnrestrictedGoodsSelectionPolicy(policy)) return true
	return evaluateGoodSelectionPolicy(policy, good) === 'allow'
}

/** True when any gather segment's load policy allows the good (broad / non-runtime). */
export function gatherSegmentAllowsGoodType(
	line: FreightLineDefinition | undefined,
	good: GoodType
): boolean {
	if (!line) return true
	for (const segment of findGatherRouteSegments(line)) {
		if (gatherSegmentAllowsGoodTypeForSegment(line, segment, good)) return true
	}
	return findGatherRouteSegments(line).length === 0
}

/** True when the distribute segment's load policy allows the good (use in segment loops). */
export function distributeSegmentAllowsGoodTypeForSegment(
	line: FreightLineDefinition,
	segment: FreightDistributeRouteSegment,
	good: GoodType
): boolean {
	const policy = goodsPolicyFromLoadStop(line, segment.loadStopIndex)
	if (!policy || isUnrestrictedGoodsSelectionPolicy(policy)) return true
	return evaluateGoodSelectionPolicy(policy, good) === 'allow'
}

/** True when any distribute segment's load policy allows the good (broad / non-runtime). */
export function distributeSegmentAllowsGoodType(
	line: FreightLineDefinition | undefined,
	good: GoodType
): boolean {
	if (!line) return true
	for (const segment of findDistributeRouteSegments(line)) {
		if (distributeSegmentAllowsGoodTypeForSegment(line, segment, good)) return true
	}
	return findDistributeRouteSegments(line).length === 0
}

export function gatherLineAcceptsProducedGood(
	line: FreightLineDefinition | undefined,
	hiveNeeds: Partial<Record<GoodType, unknown>>,
	good: GoodType
): boolean {
	if (!(good in hiveNeeds)) return false
	return gatherSegmentAllowsGoodType(line, good)
}

export function freightLineUsesGoodsSelectionPolicy(
	line: FreightLineDefinition | undefined
): boolean {
	if (!line) return false
	for (const stop of line.stops) {
		for (const raw of [stop.loadSelection, stop.unloadSelection]) {
			const policy = raw ? normalizeGoodSelectionPolicy(raw) : undefined
			if (policy && !isUnrestrictedGoodsSelectionPolicy(policy)) return true
		}
	}
	return false
}

/**
 * True when **any** segment on the line (gather or distribute) allows the good.
 * Use only for UI summaries; runtime paths should use the segment-specific variants.
 */
export function freightLineAllowsGoodType(
	line: FreightLineDefinition | undefined,
	good: GoodType
): boolean {
	if (!line) return true
	return gatherSegmentAllowsGoodType(line, good) || distributeSegmentAllowsGoodType(line, good)
}

/** True when `pathLength` satisfies the distribute-segment radius constraint.  Takes a specific segment. */
export function distributeSegmentWithinRadius(
	line: FreightLineDefinition,
	segment: FreightDistributeRouteSegment,
	pathLength: number
): boolean {
	const unload = line.stops[segment.unloadStopIndex]
	if (!unload) return true
	if (!('zone' in unload) || unload.zone.kind !== 'radius') return true
	return pathLength <= unload.zone.radius
}

/** Resolves the bay tile for a specific distribute segment. */
export function distributeSegmentBayTile(
	game: Game,
	line: FreightLineDefinition,
	segment: FreightDistributeRouteSegment
): Tile | undefined {
	const load = line.stops[segment.loadStopIndex]
	if (!load || !('anchor' in load)) return undefined
	const anchor = load.anchor
	if (anchor.kind !== 'alveolus') return undefined
	return game.hex.getTile({ q: anchor.coord[0], r: anchor.coord[1] })
}

export function gatherLoadRadiusForLineAtStop(
	line: FreightLineDefinition | undefined,
	alveolus: { hive: { name?: string }; name: string; tile: { position: Positioned } }
): number | undefined {
	if (!line) return undefined
	for (const segment of findGatherRouteSegments(line)) {
		const loadStop = line.stops[segment.loadStopIndex]
		const unloadStop = line.stops[segment.unloadStopIndex]
		if (!loadStop || !('zone' in loadStop)) continue
		if (!unloadStop || !('anchor' in unloadStop)) continue
		if (!freightStopAnchorMatchesAlveolus(unloadStop.anchor, alveolus)) continue
		const zone = loadStop.zone
		if (zone.kind === 'radius') return zone.radius
	}
	return undefined
}

export function implicitGatherFreightLinesFromHivePatches(
	hives: ReadonlyArray<{
		name?: string
		alveoli: ReadonlyArray<{ coord: readonly [number, number]; alveolus: string }>
	}>
): FreightLineDefinition[] {
	const out: FreightLineDefinition[] = []
	for (const hive of hives) {
		const hiveName = freightLineStopHiveName(hive.name)
		const displayHiveName = freightLineDisplayHiveName(hive.name)
		for (const a of hive.alveoli) {
			if (a.alveolus !== 'gather' && a.alveolus !== 'freight_bay') continue
			const id = `${displayHiveName}:implicit-gather:${a.coord[0]},${a.coord[1]}`
			const coord = [Math.floor(a.coord[0]), Math.floor(a.coord[1])] as const
			const anchor: FreightStopAnchorAlveolus = {
				kind: 'alveolus',
				hiveName,
				alveolusType: 'freight_bay',
				coord,
			}
			out.push({
				id,
				name: `${displayHiveName} (${a.coord[0]}, ${a.coord[1]}) gather`,
				stops: [
					{
						id: 'implicit-gather-load',
						zone: {
							kind: 'radius',
							center: coord,
							radius: DEFAULT_GATHER_FREIGHT_RADIUS,
						},
					},
					{
						id: 'implicit-gather-unload',
						anchor,
					},
				],
			})
		}
	}
	return out
}

export function isImplicitGatherFreightLineId(lineId: string): boolean {
	return lineId.includes(':implicit-gather:')
}

export type FreightBayStopAlveolus = {
	readonly hive: { name?: string }
	readonly name: string
	readonly tile: { position: Positioned }
}

/**
 * New explicit line from a freight bay: gather is zone-load then bay-unload; distribute defaults to
 * bay-load then bay-unload at the same tile (no unload zone), so delivery distance is unconstrained
 * until `applyDistributeDeliveryRadiusFromEditor` adds a radius zone on the unload step.
 */
export function createExplicitFreightLineDraftForFreightBay(
	alveolus: FreightBayStopAlveolus,
	mode: FreightLineMode
): FreightLineDefinition | undefined {
	if (alveolus.name !== 'freight_bay') return undefined
	const coord = toAxialCoord(alveolus.tile.position)
	if (!coord) return undefined
	const hiveName = freightLineStopHiveName(alveolus.hive.name)
	const displayName = freightLineDisplayHiveName(alveolus.hive.name)
	const unique = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
	const id = `${displayName}:explicit:${coord.q},${coord.r}:${mode}:${unique}`
	const axialCoord = [coord.q, coord.r] as const
	const anchor: FreightStopAnchorAlveolus = {
		kind: 'alveolus',
		hiveName,
		alveolusType: 'freight_bay',
		coord: axialCoord,
	}
	const name =
		mode === 'gather'
			? `${displayName} (${coord.q}, ${coord.r}) gather`
			: `${displayName} (${coord.q}, ${coord.r}) distribute`
	const draft: FreightLineDefinition =
		mode === 'gather'
			? {
					id,
					name,
					stops: [
						{
							id: 'explicit-gather-load',
							zone: {
								kind: 'radius',
								center: axialCoord,
								radius: DEFAULT_GATHER_FREIGHT_RADIUS,
							},
						},
						{
							id: 'explicit-gather-unload',
							anchor,
						},
					],
				}
			: {
					id,
					name,
					stops: [
						{
							id: 'explicit-distribute-load',
							anchor,
						},
						{
							id: 'explicit-distribute-unload',
							anchor,
						},
					],
				}
	return normalizeFreightLineDefinition(draft)
}

/**
 * Display-only: returns the bay tile for the first route segment on the line,
 * for inspector anchoring and hoverObject.  Runtime delivery should use
 * `distributeSegmentBayTile` with the chosen segment instead.
 */
export function getFreightLinePrimaryTile(
	game: Game,
	line: FreightLineDefinition
): Tile | undefined {
	for (const seg of findDistributeRouteSegments(line)) {
		const load = line.stops[seg.loadStopIndex]
		if (load && 'anchor' in load && load.anchor.kind === 'alveolus') {
			const anchor = load.anchor
			return game.hex.getTile({ q: anchor.coord[0], r: anchor.coord[1] })
		}
	}
	for (const seg of findGatherRouteSegments(line)) {
		const unload = line.stops[seg.unloadStopIndex]
		if (unload && 'anchor' in unload && unload.anchor.kind === 'alveolus') {
			const anchor = unload.anchor
			return game.hex.getTile({ q: anchor.coord[0], r: anchor.coord[1] })
		}
	}
	for (const stop of line.stops) {
		if ('anchor' in stop && stop.anchor.kind === 'alveolus') {
			const anchor = stop.anchor
			return game.hex.getTile({ q: anchor.coord[0], r: anchor.coord[1] })
		}
	}
	return undefined
}

export function freightLineSummary(line: FreightLineDefinition): string {
	const hasGather = findGatherRouteSegments(line).length > 0
	const hasDistribute = findDistributeRouteSegments(line).length > 0
	if (hasGather && hasDistribute) return 'Gather + distribute'
	if (hasGather) return 'Gather'
	if (hasDistribute) return 'Distribute'
	return 'Freight'
}

export function createSyntheticFreightLineObject(
	game: Game,
	line: FreightLineDefinition
): SyntheticFreightLineObject {
	const tile = getFreightLinePrimaryTile(game, line)
	const summaryLabel = freightLineSummary(line)
	return {
		kind: 'freight-line',
		uid: freightLineUid(line.id),
		title: `${line.name} (${summaryLabel})`,
		game,
		line,
		lineId: line.id,
		tile,
		position: tile?.position,
		logs: [],
		hoverObject: tile,
	}
}

export function freightLineGoodsSelectionForEditor(
	line: FreightLineDefinition
): GoodSelectionPolicy {
	const gatherPolicy = resolveGatherFreightGoodsSelectionPolicy(line)
	const distributePolicy = resolveDistributeFreightGoodsSelectionPolicy(line)
	const preferred = gatherPolicy ?? distributePolicy
	if (!preferred || isUnrestrictedGoodsSelectionPolicy(preferred)) {
		return {
			goodRules: [],
			tagRules: [],
			defaultEffect: 'allow',
		}
	}
	return preferred
}

export function applyFreightLineGoodsSelectionFromEditor(
	line: FreightLineDefinition,
	policy: GoodSelectionPolicy
): FreightLineDefinition {
	const normalized = normalizeGoodSelectionPolicy(policy)
	const unrestricted = isUnrestrictedGoodsSelectionPolicy(normalized)
	const nextStops = line.stops.map((stop) => ({ ...stop }))

	const gatherSeg = findGatherRouteSegments(line)[0]
	if (gatherSeg) {
		const stop = nextStops[gatherSeg.loadStopIndex]
		if (stop && 'zone' in stop) {
			nextStops[gatherSeg.loadStopIndex] = {
				...stop,
				loadSelection: unrestricted ? undefined : normalized,
			}
			return normalizeFreightLineDefinition({ ...line, stops: nextStops })
		}
	}

	const distSeg = findDistributeRouteSegments(line)[0]
	if (distSeg) {
		const stop = nextStops[distSeg.loadStopIndex]
		if (stop && 'anchor' in stop) {
			nextStops[distSeg.loadStopIndex] = {
				...stop,
				loadSelection: unrestricted ? undefined : normalized,
			}
			return normalizeFreightLineDefinition({ ...line, stops: nextStops })
		}
	}

	return normalizeFreightLineDefinition(line)
}

export function applyGatherRadiusFromEditor(
	line: FreightLineDefinition,
	radius: number | undefined
): FreightLineDefinition {
	const gatherSeg = findGatherRouteSegments(line)[0]
	if (!gatherSeg) return normalizeFreightLineDefinition(line)
	const nextStops = line.stops.map((stop) => ({ ...stop }))
	const stop = nextStops[gatherSeg.loadStopIndex]
	if (!stop || !('zone' in stop) || stop.zone.kind !== 'radius') {
		return normalizeFreightLineDefinition(line)
	}
	const nextRadius =
		radius === undefined || !Number.isFinite(radius)
			? DEFAULT_GATHER_FREIGHT_RADIUS
			: Math.max(0, Math.floor(radius))
	const zoneCenter = stop.zone.center
	nextStops[gatherSeg.loadStopIndex] = {
		...stop,
		zone: { kind: 'radius', center: zoneCenter, radius: nextRadius },
	}
	return normalizeFreightLineDefinition({ ...line, stops: nextStops })
}

export function applyDistributeDeliveryRadiusFromEditor(
	line: FreightLineDefinition,
	radius: number | undefined
): FreightLineDefinition {
	const distSeg = findDistributeRouteSegments(line)[0]
	if (!distSeg) return normalizeFreightLineDefinition(line)
	const nextStops = line.stops.map((stop) => ({ ...stop }))
	const load = line.stops[distSeg.loadStopIndex]
	if (!load || !('anchor' in load)) return normalizeFreightLineDefinition(line)
	const loadAnchor = load.anchor
	if (loadAnchor.kind !== 'alveolus') return normalizeFreightLineDefinition(line)
	const center = loadAnchor.coord

	if (radius === undefined || !Number.isFinite(radius)) {
		nextStops[distSeg.unloadStopIndex] = {
			id: line.stops[distSeg.unloadStopIndex]?.id ?? 'distribute-unload',
			anchor: loadAnchor,
		}
	} else {
		const r = Math.max(0, Math.floor(radius))
		nextStops[distSeg.unloadStopIndex] = {
			id: line.stops[distSeg.unloadStopIndex]?.id ?? 'distribute-unload',
			zone: { kind: 'radius', center, radius: r },
		}
	}
	return normalizeFreightLineDefinition({ ...line, stops: nextStops })
}

export function rebuildFreightLineRoutePreset(
	line: FreightLineDefinition,
	mode: FreightLineMode
): FreightLineDefinition {
	const primaryStop = line.stops.find((s) => 'anchor' in s)
	const primary = primaryStop && 'anchor' in primaryStop ? primaryStop.anchor : undefined
	if (primary?.kind !== 'alveolus') return normalizeFreightLineDefinition(line)
	const selection = freightLineGoodsSelectionForEditor(line)
	const draft = createExplicitFreightLineDraftForFreightBay(
		{
			hive: { name: primary.hiveName },
			name: 'freight_bay',
			tile: { position: { q: primary.coord[0], r: primary.coord[1] } },
		},
		mode
	)
	if (!draft) return normalizeFreightLineDefinition(line)
	const merged: FreightLineDefinition = {
		...draft,
		id: line.id,
		name: line.name,
		stops: draft.stops.map((stop) => {
			const isGatherLoad = mode === 'gather' && 'zone' in stop
			const isDistributeLoad = mode === 'distribute' && 'anchor' in stop
			if (!isGatherLoad && !isDistributeLoad) return stop
			if (!selection || isUnrestrictedGoodsSelectionPolicy(selection)) return stop
			return { ...stop, loadSelection: selection }
		}),
	}
	return normalizeFreightLineDefinition(merged)
}

export function freightLineEditorRoutePreset(
	line: FreightLineDefinition
): FreightLineMode | undefined {
	if (findGatherRouteSegments(line).length > 0 && findDistributeRouteSegments(line).length === 0)
		return 'gather'
	if (findDistributeRouteSegments(line).length > 0 && findGatherRouteSegments(line).length === 0)
		return 'distribute'
	return undefined
}

export function freightLineEditorGatherRadius(line: FreightLineDefinition): number | undefined {
	const seg = findGatherRouteSegments(line)[0]
	if (!seg) return undefined
	const load = line.stops[seg.loadStopIndex]
	if (!load || !('zone' in load) || load.zone.kind !== 'radius') return undefined
	return load.zone.radius
}

export function freightLineEditorDistributeRadius(line: FreightLineDefinition): number | undefined {
	const seg = findDistributeRouteSegments(line)[0]
	if (!seg) return undefined
	const unload = line.stops[seg.unloadStopIndex]
	if (!unload || !('zone' in unload) || unload.zone.kind !== 'radius') return undefined
	return unload.zone.radius
}

/** Coordinates that should be materialized when bootstrapping from patches (anchors + zone centers). */
export function collectFreightLineBootstrapCoords(line: FreightLineDefinition): AxialCoord[] {
	const normalized = normalizeFreightLineDefinition(line)
	const out: AxialCoord[] = []
	for (const stop of normalized.stops) {
		if ('anchor' in stop && stop.anchor.kind === 'alveolus') {
			const anchor = stop.anchor
			out.push({ q: anchor.coord[0], r: anchor.coord[1] })
		}
		if ('zone' in stop && stop.zone.kind === 'radius') {
			const zone = stop.zone
			out.push({ q: zone.center[0], r: zone.center[1] })
		}
	}
	return out
}
