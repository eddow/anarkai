import { normalizeFreightLineDefinition } from 'ssh/freight/freight-line'
import { describe, expect, it } from 'vitest'
import {
	addFreightDraftStop,
	applyFreightDraftBayAnchor,
	cloneFreightLineDraft,
	freightDraftIssueCodes,
	moveFreightDraftStop,
	removeFreightDraftStop,
} from './freight-line-draft'

describe('freight-line-draft', () => {
	const sample = normalizeFreightLineDefinition({
		id: 'line-1',
		name: 'Line 1',
		stops: [
			{
				id: 'z1',
				zone: { kind: 'radius', center: [1, 2], radius: 3 },
			},
			{
				id: 'b1',
				anchor: {
					kind: 'alveolus',
					hiveName: 'H',
					alveolusType: 'freight_bay',
					coord: [1, 2],
				},
			},
		],
	})

	it('flags structural validation issues', () => {
		expect(freightDraftIssueCodes(sample)).toEqual([])
		expect(
			freightDraftIssueCodes(
				normalizeFreightLineDefinition({
					id: 'x',
					name: 'X',
					stops: [],
				})
			)
		).toContain('no_stops')
		expect(
			freightDraftIssueCodes(
				normalizeFreightLineDefinition({
					id: 'x',
					name: 'X',
					stops: [
						{
							id: 'only-zone',
							zone: { kind: 'radius', center: [0, 0], radius: 1 },
						},
					],
				})
			)
		).toContain('no_freight_bay_anchor')
	})

	it('supports stop list edits without mutating the source line', () => {
		const draft = cloneFreightLineDraft(sample)
		const withExtra = addFreightDraftStop(draft, draft.stops.length)
		expect(withExtra.stops.length).toBe(sample.stops.length + 1)
		expect(sample.stops.length).toBe(2)

		const removed = removeFreightDraftStop(withExtra, 0)
		expect(removed.stops.length).toBe(withExtra.stops.length - 1)

		const moved = moveFreightDraftStop(removed, 0, 1)
		expect(moved.stops[1]?.id).toBe(removed.stops[0]?.id)
	})

	it('applies bay anchors onto a stop', () => {
		const draft = cloneFreightLineDraft(sample)
		const next = applyFreightDraftBayAnchor(draft, 0, {
			kind: 'alveolus',
			hiveName: 'Hive',
			alveolusType: 'freight_bay',
			coord: [9, 8] as const,
		})
		expect('anchor' in next.stops[0]!).toBe(true)
	})
})
