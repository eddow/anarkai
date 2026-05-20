import type {
	FreightLineDefinition,
	FreightNpcTradeStop,
	FreightStop,
	FreightStopAnchorAlveolus,
} from 'ssh/freight/freight-line'
import {
	DEFAULT_GATHER_FREIGHT_RADIUS,
	normalizeFreightLineDefinition,
} from 'ssh/freight/freight-line'
import type { GoodSelectionPolicy } from 'ssh/freight/goods-selection-policy'
import {
	isUnrestrictedGoodsSelectionPolicy,
	normalizeGoodSelectionPolicy,
} from 'ssh/freight/goods-selection-policy'

export type FreightDraftIssueCode = 'no_stops' | 'no_freight_bay_anchor' | 'invalid_zone_radius'

export function freightDraftIssueCodes(line: FreightLineDefinition): FreightDraftIssueCode[] {
	const issues: FreightDraftIssueCode[] = []
	if (line.stops.length === 0) issues.push('no_stops')
	const hasBay = line.stops.some(
		(s) => 'anchor' in s && s.anchor.kind === 'alveolus' && s.anchor.alveolusType === 'freight_bay'
	)
	if (!hasBay) issues.push('no_freight_bay_anchor')
	for (const stop of line.stops) {
		if ('zone' in stop && stop.zone.kind === 'radius') {
			const r = stop.zone.radius
			if (!Number.isFinite(r) || r < 0) {
				issues.push('invalid_zone_radius')
				break
			}
		}
	}
	return issues
}

export function freightDraftSignature(line: FreightLineDefinition): string {
	return JSON.stringify(normalizeFreightLineDefinition(line))
}

export function cloneFreightStop(stop: FreightStop): FreightStop {
	const base = {
		id: stop.id,
		loadSelection: stop.loadSelection,
		unloadSelection: stop.unloadSelection,
		...(stop.minBalanceAfterBuyVp !== undefined
			? { minBalanceAfterBuyVp: stop.minBalanceAfterBuyVp }
			: {}),
	}
	if ('anchor' in stop) {
		const a = stop.anchor
		return {
			...base,
			anchor: {
				kind: 'alveolus',
				hiveName: a.hiveName,
				alveolusType: a.alveolusType,
				coord: [a.coord[0], a.coord[1]] as const,
			},
		}
	}
	if ('trade' in stop) {
		return {
			...base,
			trade: {
				kind: 'settlement',
				settlementId: stop.trade.settlementId,
			},
		}
	}
	const z = stop.zone
	if (z.kind === 'named') {
		return {
			...base,
			zone: {
				kind: 'named',
				zoneId: z.zoneId,
			},
		}
	}
	return {
		...base,
		zone: {
			kind: 'radius',
			center: [z.center[0], z.center[1]] as const,
			radius: z.radius,
		},
	}
}

export function cloneFreightLineDraft(line: FreightLineDefinition): FreightLineDefinition {
	return {
		id: line.id,
		name: line.name,
		...(line.cyclic === true ? { cyclic: true } : {}),
		...(line.minBalanceAfterBuyVp !== undefined
			? { minBalanceAfterBuyVp: line.minBalanceAfterBuyVp }
			: {}),
		stops: line.stops.map((s) => cloneFreightStop(s)),
	}
}

export function newFreightStopId(): string {
	return `stop-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

function freightStopDraftBase(stop: FreightStop) {
	return {
		id: stop.id,
		loadSelection: stop.loadSelection,
		unloadSelection: stop.unloadSelection,
		...(stop.minBalanceAfterBuyVp !== undefined
			? { minBalanceAfterBuyVp: stop.minBalanceAfterBuyVp }
			: {}),
	}
}

export function addFreightDraftStop(
	line: FreightLineDefinition,
	insertIndex: number,
	stop?: FreightStop
): FreightLineDefinition {
	const stops = [...line.stops]
	const placeholderAnchor: FreightStopAnchorAlveolus = {
		kind: 'alveolus',
		hiveName: '',
		alveolusType: 'freight_bay',
		coord: [0, 0] as const,
	}
	const fresh: FreightStop = {
		id: newFreightStopId(),
		anchor: placeholderAnchor,
	}
	stops.splice(insertIndex, 0, stop ?? fresh)
	return { ...line, stops }
}

export function removeFreightDraftStop(
	line: FreightLineDefinition,
	index: number
): FreightLineDefinition {
	return { ...line, stops: line.stops.filter((_, i) => i !== index) }
}

export function moveFreightDraftStop(
	line: FreightLineDefinition,
	from: number,
	to: number
): FreightLineDefinition {
	if (from === to) return line
	const stops = [...line.stops]
	const [item] = stops.splice(from, 1)
	if (!item) return line
	stops.splice(to, 0, item)
	return { ...line, stops }
}

export function setFreightDraftStopKindAnchor(
	line: FreightLineDefinition,
	index: number,
	anchor?: FreightStopAnchorAlveolus
): FreightLineDefinition {
	const stops = line.stops.map((s, i) => {
		if (i !== index) return s
		const base = freightStopDraftBase(s)
		const nextAnchor: FreightStopAnchorAlveolus =
			anchor ??
			({
				kind: 'alveolus',
				hiveName: '',
				alveolusType: 'freight_bay',
				coord: [0, 0] as const,
			} satisfies FreightStopAnchorAlveolus)
		return { ...base, anchor: nextAnchor }
	})
	return { ...line, stops }
}

export function setFreightDraftStopKindZone(
	line: FreightLineDefinition,
	index: number,
	center: readonly [number, number],
	radius: number
): FreightLineDefinition {
	const stops = line.stops.map((s, i) => {
		if (i !== index) return s
		const base = freightStopDraftBase(s)
		return {
			...base,
			zone: {
				kind: 'radius' as const,
				center: [center[0], center[1]] as const,
				radius,
			},
		}
	})
	return { ...line, stops }
}

export function setFreightDraftStopKindNamedZone(
	line: FreightLineDefinition,
	index: number,
	zoneId: string
): FreightLineDefinition {
	const stops = line.stops.map((s, i) => {
		if (i !== index) return s
		const base = freightStopDraftBase(s)
		return {
			...base,
			zone: {
				kind: 'named' as const,
				zoneId,
			},
		}
	})
	return { ...line, stops }
}

export function setFreightDraftStopKindTrade(
	line: FreightLineDefinition,
	index: number,
	trade: FreightNpcTradeStop
): FreightLineDefinition {
	const stops = line.stops.map((s, i) => {
		if (i !== index) return s
		const base = freightStopDraftBase(s)
		return {
			...base,
			trade,
		}
	})
	return { ...line, stops }
}

export function setFreightDraftStopTradeSettlementId(
	line: FreightLineDefinition,
	index: number,
	settlementId: string
): FreightLineDefinition {
	const stops = line.stops.map((s, i) => {
		if (i !== index) return s
		if (!('trade' in s)) return s
		return {
			...s,
			trade: {
				kind: 'settlement' as const,
				settlementId,
			},
		}
	})
	return { ...line, stops }
}

export function setFreightDraftStopNamedZoneId(
	line: FreightLineDefinition,
	index: number,
	zoneId: string
): FreightLineDefinition {
	const stops = line.stops.map((s, i) => {
		if (i !== index) return s
		if (!('zone' in s) || s.zone.kind !== 'named') return s
		return {
			...s,
			zone: {
				kind: 'named' as const,
				zoneId,
			},
		}
	})
	return { ...line, stops }
}

export function applyFreightDraftBayAnchor(
	line: FreightLineDefinition,
	index: number,
	anchor: FreightStopAnchorAlveolus
): FreightLineDefinition {
	const stops = line.stops.map((s, i) => {
		if (i !== index) return s
		const base = freightStopDraftBase(s)
		return { ...base, anchor }
	})
	return { ...line, stops }
}

export function applyFreightDraftZoneCenter(
	line: FreightLineDefinition,
	index: number,
	center: readonly [number, number]
): FreightLineDefinition {
	const stops = line.stops.map((s, i) => {
		if (i !== index) return s
		if (!('zone' in s) || s.zone.kind !== 'radius') return s
		return {
			...s,
			zone: {
				kind: 'radius' as const,
				center: [center[0], center[1]] as const,
				radius: s.zone.radius,
			},
		}
	})
	return { ...line, stops }
}

export function setFreightDraftStopZoneRadius(
	line: FreightLineDefinition,
	index: number,
	radius: number
): FreightLineDefinition {
	const stops = line.stops.map((s, i) => {
		if (i !== index) return s
		if (!('zone' in s) || s.zone.kind !== 'radius') return s
		return {
			...s,
			zone: {
				kind: 'radius' as const,
				center: [s.zone.center[0], s.zone.center[1]] as const,
				radius,
			},
		}
	})
	return { ...line, stops }
}

export function setFreightDraftStopLoadSelection(
	line: FreightLineDefinition,
	index: number,
	policy: GoodSelectionPolicy | undefined
): FreightLineDefinition {
	const stops = line.stops.map((s, i) => {
		if (i !== index) return s
		const normalized = policy ? normalizeGoodSelectionPolicy(policy) : undefined
		const next =
			normalized && !isUnrestrictedGoodsSelectionPolicy(normalized) ? normalized : undefined
		return { ...s, loadSelection: next }
	})
	return { ...line, stops }
}

export function setFreightDraftStopUnloadSelection(
	line: FreightLineDefinition,
	index: number,
	policy: GoodSelectionPolicy | undefined
): FreightLineDefinition {
	const stops = line.stops.map((s, i) => {
		if (i !== index) return s
		const normalized = policy ? normalizeGoodSelectionPolicy(policy) : undefined
		const next =
			normalized && !isUnrestrictedGoodsSelectionPolicy(normalized) ? normalized : undefined
		return { ...s, unloadSelection: next }
	})
	return { ...line, stops }
}

export function setFreightDraftStopMinBalanceAfterBuyVp(
	line: FreightLineDefinition,
	index: number,
	value: number | undefined
): FreightLineDefinition {
	const stops = line.stops.map((s, i) => {
		if (i !== index) return s
		if (value === undefined) {
			const { minBalanceAfterBuyVp: _unused, ...rest } = s
			return rest
		}
		return { ...s, minBalanceAfterBuyVp: Math.max(0, Math.floor(value)) }
	})
	return { ...line, stops }
}

export function defaultZoneCenterFromAnchorSwitch(
	line: FreightLineDefinition,
	index: number
): readonly [number, number] {
	const stop = line.stops[index]
	if (stop && 'anchor' in stop && stop.anchor.kind === 'alveolus') {
		return [stop.anchor.coord[0], stop.anchor.coord[1]] as const
	}
	return [0, 0] as const
}

export function defaultZoneRadiusForNewZone(line: FreightLineDefinition, index: number): number {
	const stop = line.stops[index]
	if (stop && 'zone' in stop && stop.zone.kind === 'radius') return stop.zone.radius
	return DEFAULT_GATHER_FREIGHT_RADIUS
}
