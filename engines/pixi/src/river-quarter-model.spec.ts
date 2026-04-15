import type {
	TerrainHydrologyDirection,
	TerrainHydrologyEdgeSample,
	TerrainHydrologySample,
	TerrainRiverFlowSample,
} from 'ssh/game/terrain-provider'
import type { TerrainType } from 'ssh/types'
import { cartesian } from 'ssh/utils'
import { describe, expect, it } from 'vitest'

import {
	buildRiverTileNode,
	classifyRiverTerminalSummary,
	computeRiverBakeMonotoneHalfOuterMap,
	halfDrageaSampledFillPolygonWorld,
	isInsideRiverCenterZone,
	riverBranchOwnershipIndexAtWorld,
	riverMonotoneRenderHalfOuter,
	tileKeyForCoord,
} from './river-quarter-model'

const tileSize = 30

function edge(width: number, depth: number): TerrainHydrologyEdgeSample {
	return { flux: 1, width, depth }
}

describe('tileKeyForCoord', () => {
	it('matches axial.key', () => {
		expect(tileKeyForCoord({ q: 2, r: -1 })).toBe('2,-1')
	})
})

describe('computeRiverBakeMonotoneHalfOuterMap', () => {
	it('never shrinks half-width along downstream flow edges in the bake set', () => {
		const tileSize = 30
		const wide = edge(8, 0.5)
		const narrow = edge(0.08, 0.5)
		const NO_UP: readonly TerrainHydrologyDirection[] = []
		const DIR0: readonly TerrainHydrologyDirection[] = [0]
		const DIR3: readonly TerrainHydrologyDirection[] = [3]

		const terrainTiles = new Map<string, { hydrology?: TerrainHydrologySample }>()
		terrainTiles.set('0,0', {
			hydrology: {
				isChannel: true,
				edges: { 0: wide, 3: narrow },
				riverFlow: {
					upstreamDirections: NO_UP,
					downstreamDirections: DIR0,
					rankFromSource: 0,
					rankToSea: 4,
					tileRole: 'through',
				},
			},
		})
		terrainTiles.set('1,0', {
			hydrology: {
				isChannel: true,
				edges: { 3: narrow },
				riverFlow: {
					upstreamDirections: DIR3,
					downstreamDirections: NO_UP,
					rankFromSource: 1,
					rankToSea: 0,
					tileRole: 'inlandTerminal',
				},
			},
		})

		const coords = [
			{ q: 0, r: 0 },
			{ q: 1, r: 0 },
		]
		const wm = computeRiverBakeMonotoneHalfOuterMap(coords, tileSize, terrainTiles)
		const a = wm.get('0,0')!
		const b = wm.get('1,0')!
		expect(b).toBeGreaterThanOrEqual(a - 1e-9)
	})
})

describe('riverMonotoneRenderHalfOuter', () => {
	it('increases outer half-width as rankFromSource advances for a fixed raw cap', () => {
		const tileSize = 30
		const raw = 12
		const nearSource = riverMonotoneRenderHalfOuter(
			tileSize,
			{
				upstreamDirections: [],
				downstreamDirections: [0],
				rankFromSource: 0,
				rankToSea: 12,
				tileRole: 'source',
			},
			raw
		)
		const downstream = riverMonotoneRenderHalfOuter(
			tileSize,
			{
				upstreamDirections: [3],
				downstreamDirections: [0],
				rankFromSource: 10,
				rankToSea: 2,
				tileRole: 'through',
			},
			raw
		)
		expect(downstream).toBeGreaterThan(nearSource)
	})
})

describe('classifyRiverTerminalSummary', () => {
	it('classifies single land edge as source', () => {
		expect(
			classifyRiverTerminalSummary({
				directions: [0],
				terrain: 'grass',
				neighborTerrain: () => 'grass',
				maxEdgeWidth: 3,
			})
		).toBe('source')
	})

	it('classifies narrow water neighbor as lake', () => {
		expect(
			classifyRiverTerminalSummary({
				directions: [0],
				terrain: 'grass',
				neighborTerrain: (d) => (d === 0 ? 'water' : 'grass'),
				maxEdgeWidth: 2,
			})
		).toBe('lake')
	})

	it('classifies wide water neighbor as mouth', () => {
		expect(
			classifyRiverTerminalSummary({
				directions: [0],
				terrain: 'grass',
				neighborTerrain: (d) => (d === 0 ? 'water' : 'grass'),
				maxEdgeWidth: 5,
			})
		).toBe('mouth')
	})

	it('classifies two land edges as through', () => {
		expect(
			classifyRiverTerminalSummary({
				directions: [0, 3],
				terrain: 'grass',
				neighborTerrain: () => 'grass',
				maxEdgeWidth: 3,
			})
		).toBe('through')
	})

	it('classifies multi-arm as junction', () => {
		expect(
			classifyRiverTerminalSummary({
				directions: [0, 2, 4],
				terrain: 'grass',
				neighborTerrain: () => 'grass',
				maxEdgeWidth: 3,
			})
		).toBe('junction')
	})

	it('classifies delta when many arms and multiple water edges wide', () => {
		expect(
			classifyRiverTerminalSummary({
				directions: [0, 1, 2],
				terrain: 'grass',
				neighborTerrain: (d) => (d <= 1 ? 'water' : 'grass'),
				maxEdgeWidth: 5,
			})
		).toBe('delta')
	})
})

describe('buildRiverTileNode', () => {
	it('returns suppressed empty branches for water terrain', () => {
		const node = buildRiverTileNode({
			tileKey: '0,0',
			coord: { q: 0, r: 0 },
			tileSize,
			terrain: 'water',
			hydrologyEdges: { 0: edge(3, 1) },
			neighborTerrain: () => 'grass',
		})
		expect(node.suppressed).toBe(true)
		expect(node.branches.length).toBe(0)
		expect(node.terminalSummary).toBe('none')
	})

	it('builds source with one closed half-dragea', () => {
		const node = buildRiverTileNode({
			tileKey: '0,0',
			coord: { q: 0, r: 0 },
			tileSize,
			terrain: 'grass',
			hydrologyEdges: { 0: edge(3, 0.5) },
			neighborTerrain: () => 'grass',
		})
		expect(node.terminalSummary).toBe('source')
		expect(node.branches.length).toBe(1)
		expect(node.branches[0]!.halfDrageas.length).toBe(1)
		expect(node.branches[0]!.halfDrageas[0]!.terminalCap).toBe('closed')
		expect(node.branches[0]!.halfDrageas[0]!.leftQuarter.terminalRole).toBe('sourceTip')
	})

	it('builds through with one branch and two half-drageas', () => {
		const coord = { q: 0, r: 0 }
		const hub = cartesian(coord, tileSize)
		const node = buildRiverTileNode({
			tileKey: '0,0',
			coord,
			tileSize,
			terrain: 'grass',
			hydrologyEdges: { 0: edge(3, 0.4), 3: edge(3, 0.4) },
			neighborTerrain: () => 'grass',
		})
		expect(node.terminalSummary).toBe('through')
		expect(node.branches.length).toBe(1)
		expect(node.branches[0]!.halfDrageas.length).toBe(2)
		expect(node.branches[0]!.halfDrageas.every((h) => h.terminalCap === 'none')).toBe(true)
		for (const h of node.branches[0]!.halfDrageas) {
			expect(h.innerAnchor.x).toBeCloseTo(hub.x, 5)
			expect(h.innerAnchor.y).toBeCloseTo(hub.y, 5)
			expect(h.leftQuarter.innerAnchor.x).toBeCloseTo(hub.x, 5)
			expect(h.leftQuarter.innerAnchor.y).toBeCloseTo(hub.y, 5)
			expect(h.rightQuarter.innerAnchor.x).toBeCloseTo(hub.x, 5)
			expect(h.rightQuarter.innerAnchor.y).toBeCloseTo(hub.y, 5)
		}
	})

	it('through tile uses shared hub inner width between both edge half-widths', () => {
		const node = buildRiverTileNode({
			tileKey: '0,0',
			coord: { q: 0, r: 0 },
			tileSize,
			terrain: 'grass',
			hydrologyEdges: { 0: edge(4, 0.5), 3: edge(2, 0.5) },
			neighborTerrain: () => 'grass',
		})
		const [ha, hb] = node.branches[0]!.halfDrageas
		expect(ha!.leftQuarter.widthEnd).toBeCloseTo(hb!.leftQuarter.widthEnd, 5)
		const ratioA = ha!.leftQuarter.widthEnd / ha!.leftQuarter.widthStart
		expect(ratioA).toBeGreaterThan(0.55)
		expect(ratioA).toBeLessThan(1.01)
	})

	it('uses a sampled curved fill polygon that closes along both bank curves (includes hub lip)', () => {
		const node = buildRiverTileNode({
			tileKey: '0,0',
			coord: { q: 0, r: 0 },
			tileSize,
			terrain: 'grass',
			hydrologyEdges: { 0: edge(3, 0.4), 3: edge(3, 0.4) },
			neighborTerrain: () => 'grass',
		})
		const half = node.branches[0]!.halfDrageas[0]!
		const poly = halfDrageaSampledFillPolygonWorld(half, 6)
		expect(poly.length).toBeGreaterThan(12)
	})

	it('builds junction with one branch per active edge', () => {
		const node = buildRiverTileNode({
			tileKey: '0,0',
			coord: { q: 0, r: 0 },
			tileSize,
			terrain: 'grass',
			hydrologyEdges: {
				0: edge(2, 0.2),
				2: edge(2, 0.2),
				4: edge(2, 0.2),
			},
			neighborTerrain: () => 'grass',
		})
		expect(node.terminalSummary).toBe('junction')
		expect(node.branches.length).toBe(3)
		for (const b of node.branches) {
			expect(b.halfDrageas.length).toBe(1)
		}
	})

	it('marks suppressed when input says so', () => {
		const node = buildRiverTileNode({
			tileKey: '0,0',
			coord: { q: 0, r: 0 },
			tileSize,
			terrain: 'grass',
			hydrologyEdges: { 0: edge(3, 1) },
			neighborTerrain: () => 'grass',
			suppressed: true,
		})
		expect(node.suppressed).toBe(true)
		expect(node.branches.length).toBe(0)
	})

	it('renders inland terminal as an open lake lip when riverFlow says so', () => {
		const riverFlow: TerrainRiverFlowSample = {
			upstreamDirections: [3],
			downstreamDirections: [],
			rankFromSource: 4,
			rankToSea: 1,
			tileRole: 'inlandTerminal',
		}
		const node = buildRiverTileNode({
			tileKey: '0,0',
			coord: { q: 0, r: 0 },
			tileSize,
			terrain: 'grass',
			hydrologyEdges: { 0: edge(3, 1) },
			riverFlow,
			neighborTerrain: () => 'grass',
		})
		expect(node.terminalSummary).toBe('inlandTerminal')
		expect(node.branches[0]!.halfDrageas[0]!.terminalCap).toBe('open')
		expect(node.branches[0]!.halfDrageas[0]!.leftQuarter.terminalRole).toBe('lakeLip')
	})

	it('keeps a monotone outer width floor when edges are extremely narrow but riverFlow is present', () => {
		const riverFlow: TerrainRiverFlowSample = {
			upstreamDirections: [2],
			downstreamDirections: [5],
			rankFromSource: 4,
			rankToSea: 4,
			tileRole: 'through',
		}
		const node = buildRiverTileNode({
			tileKey: '0,0',
			coord: { q: 0, r: 0 },
			tileSize,
			terrain: 'grass',
			hydrologyEdges: { 0: edge(0.05, 0.05), 3: edge(0.05, 0.05) },
			riverFlow,
			neighborTerrain: () => 'grass',
		})
		const outer = node.branches[0]!.halfDrageas[0]!.leftQuarter.widthStart
		expect(outer).toBeGreaterThanOrEqual(tileSize * 0.07 * 2 * 0.95)
	})
})

describe('center arbitration', () => {
	it('returns undefined when no branches', () => {
		const node = buildRiverTileNode({
			tileKey: '0,0',
			coord: { q: 0, r: 0 },
			tileSize,
			terrain: 'water',
			hydrologyEdges: {},
			neighborTerrain: () => 'grass',
		})
		expect(riverBranchOwnershipIndexAtWorld(node, { x: 0, y: 0 })).toBeUndefined()
	})

	it('returns 0 for single branch', () => {
		const node = buildRiverTileNode({
			tileKey: '0,0',
			coord: { q: 0, r: 0 },
			tileSize,
			terrain: 'grass',
			hydrologyEdges: { 0: edge(3, 1) },
			neighborTerrain: () => 'grass',
		})
		expect(riverBranchOwnershipIndexAtWorld(node, { x: 1e6, y: 1e6 })).toBe(0)
	})

	it('picks nearest deepCenter among junction arms', () => {
		const node = buildRiverTileNode({
			tileKey: '0,0',
			coord: { q: 0, r: 0 },
			tileSize,
			terrain: 'grass',
			hydrologyEdges: {
				0: edge(2, 0.2),
				2: edge(2, 0.2),
				4: edge(2, 0.2),
			},
			neighborTerrain: () => 'grass',
		})
		const target = node.branches[1]!.deepCenter
		expect(riverBranchOwnershipIndexAtWorld(node, target)).toBe(1)
	})

	it('reports inside center zone near tile center', () => {
		const node = buildRiverTileNode({
			tileKey: '0,0',
			coord: { q: 0, r: 0 },
			tileSize,
			terrain: 'grass',
			hydrologyEdges: { 0: edge(3, 1), 3: edge(3, 1) },
			neighborTerrain: () => 'grass',
		})
		expect(isInsideRiverCenterZone(node, node.centerZone.origin)).toBe(true)
	})
})

describe('coastal mouth (two edges, one water)', () => {
	it('uses mouth summary and two half-drageas', () => {
		const node = buildRiverTileNode({
			tileKey: '0,0',
			coord: { q: 0, r: 0 },
			tileSize,
			terrain: 'grass',
			hydrologyEdges: { 0: edge(3, 0.5), 3: edge(3, 0.5) },
			neighborTerrain: (d) => (d === 3 ? 'water' : 'grass') as TerrainType,
		})
		expect(node.terminalSummary).toBe('mouth')
		expect(node.branches.length).toBe(1)
		expect(node.branches[0]!.halfDrageas.length).toBe(2)
		const caps = node.branches[0]!.halfDrageas.map((h) => h.terminalCap)
		expect(caps.includes('open')).toBe(true)
		expect(caps.includes('none')).toBe(true)
	})
})
