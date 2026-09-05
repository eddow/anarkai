import {
	type BoundingBox,
	boundingBoxesOverlap,
	ClaimIndex,
	type ProjectClaimChange,
	projectBoundingBox,
	projectClaimKeys,
	projectClaims,
} from 'ssh/board/claim-index'
import type { Project } from 'ssh/project'
import { describe, expect, it, vi } from 'vitest'

const project = (overrides: Partial<Project> = {}): Project =>
	({
		name: 'P',
		stage: 'working',
		entries: [],
		roads: [],
		demolitions: [],
		roadDemolitions: [],
		sourcing: {},
		validationProgress: {
			workSecondsApplied: 0,
			workSecondsRequired: 0,
			requiredGoods: {},
			deliveredGoods: {},
		},
		knownnessFingerprint: '',
		...overrides,
	}) as Project

const mockGame = () => ({ emit: vi.fn() }) as never

describe('projectClaims', () => {
	it('derives tiles, demolitions, road borders and road anchors', () => {
		const p = project({
			name: 'A',
			entries: [{ coord: [1, 0], alveolusType: 'pile' }],
			demolitions: [[2, 0]],
			roads: [{ coord: [0.5, 0], type: 'path' }],
			roadDemolitions: [{ coord: [1.5, 0], type: 'path' }],
		})

		expect(projectClaimKeys(p)).toEqual(new Set(['t:1,0', 't:2,0', 'r:0.5,0', 't:0,0', 'r:1.5,0']))

		const kinds = new Map(projectClaims(p).map((claim) => [claim.key, claim.kind]))
		expect(kinds.get('t:1,0')).toBe('tile')
		expect(kinds.get('t:2,0')).toBe('tile')
		expect(kinds.get('r:0.5,0')).toBe('road')
		expect(kinds.get('t:0,0')).toBe('anchor')
		expect(kinds.get('r:1.5,0')).toBe('road')
	})

	it('computes a bounding box and overlaps disjoint boxes', () => {
		const box = projectBoundingBox(
			projectClaims(project({ entries: [{ coord: [3, -2], alveolusType: 'pile' }] }))
		)
		expect(box).toEqual({ minQ: 3, maxQ: 3, minR: -2, maxR: -2 })

		const far: BoundingBox = { minQ: 10, maxQ: 10, minR: 10, maxR: 10 }
		expect(boundingBoxesOverlap(box, far)).toBe(false)
		expect(boundingBoxesOverlap(box, box)).toBe(true)
		expect(boundingBoxesOverlap(box, { minQ: 3, maxQ: 3, minR: -2, maxR: -2 })).toBe(true)
	})
})

describe('ClaimIndex', () => {
	it('allocates on sync and releases on archive', () => {
		const game = mockGame()
		const index = new ClaimIndex(game)

		const first = project({ name: 'First', entries: [{ coord: [0, 0], alveolusType: 'pile' }] })

		index.sync(first)
		expect(index.boundsFor(first)).toEqual({ minQ: 0, maxQ: 0, minR: 0, maxR: 0 })

		// Archiving the first project releases its claim.
		first.stage = 'archived'
		index.sync(first)
		expect(index.boundsFor(first)).toBeUndefined()
	})

	it('emits a projectClaims event with bounding boxes on change', () => {
		const game = mockGame()
		const index = new ClaimIndex(game)
		const p = project({ name: 'A', entries: [{ coord: [1, 0], alveolusType: 'pile' }] })

		index.sync(p)
		const changes = (game.emit as ReturnType<typeof vi.fn>).mock
			.calls[0]?.[1] as ProjectClaimChange[]
		expect(changes).toHaveLength(1)
		expect(changes[0].kind).toBe('allocated')
		expect(changes[0].cells).toEqual([[1, 0]])
		expect(changes[0].bounds).toEqual({ minQ: 1, maxQ: 1, minR: 0, maxR: 0 })

		// No change → no emit, no version bump.
		const before = index.version.versionOf()
		index.sync(p)
		expect(index.version.versionOf()).toBe(before)
	})

	it('rebuilds from projects and filters by bounding box', () => {
		const game = mockGame()
		const index = new ClaimIndex(game)
		const near = project({ name: 'Near', entries: [{ coord: [0, 0], alveolusType: 'pile' }] })
		const far = project({ name: 'Far', entries: [{ coord: [20, 20], alveolusType: 'pile' }] })

		index.rebuild([near, far])

		// A box around the near project dismisses the far one.
		const nearBox = index.boundsFor(near)!
		expect(index.projectsOverlapping(nearBox)).toContain(near)
		expect(index.projectsOverlapping(nearBox)).not.toContain(far)
	})
})
