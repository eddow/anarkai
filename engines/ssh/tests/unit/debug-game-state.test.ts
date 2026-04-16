import { safeDebugValueForDump, summarizeFreightStopForDebug } from 'ssh/debug-game-state'
import { describe, expect, it } from 'vitest'

describe('debug-game-state', () => {
	it('summarizes anchor and zone freight stops into plain data', () => {
		expect(
			summarizeFreightStopForDebug({
				id: 'anchor-stop',
				anchor: {
					kind: 'alveolus',
					hiveName: 'Hive A',
					alveolusType: 'freight_bay',
					coord: [10, -6],
				},
			})
		).toEqual({
			id: 'anchor-stop',
			loadSelection: undefined,
			unloadSelection: undefined,
			kind: 'anchor',
			anchor: {
				hiveName: 'Hive A',
				alveolusType: 'freight_bay',
				coord: { q: 10, r: -6 },
			},
		})

		expect(
			summarizeFreightStopForDebug({
				id: 'zone-stop',
				zone: {
					kind: 'radius',
					center: [11, -7],
					radius: 2,
				},
			})
		).toEqual({
			id: 'zone-stop',
			loadSelection: undefined,
			unloadSelection: undefined,
			kind: 'zone',
			zone: {
				kind: 'radius',
				center: { q: 11, r: -7 },
				radius: 2,
			},
		})
	})

	it('cloneValueForDebugJson marks direct self-cycles', () => {
		const cyclic: { self?: unknown } = {}
		cyclic.self = cyclic
		expect(safeDebugValueForDump(cyclic)).toEqual({ self: '[Circular]' })
	})
})
