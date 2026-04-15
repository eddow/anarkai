import { Rectangle } from 'pixi.js'
import type { RenderableTerrainTile } from 'ssh/game/game'
import { axial } from 'ssh/utils'
import { tileSize } from 'ssh/utils/varied'
import { describe, expect, it } from 'vitest'

import {
	collectInlandLakeTileComponents,
	singleInlandTerminalBasinPolygonLocal,
} from './terrain-sector-baker'

const edge = { flux: 1, width: 3, depth: 0.5 }

describe('collectInlandLakeTileComponents', () => {
	it('fuses two adjacent inland terminal tiles into one component', () => {
		const coords = [
			{ q: 0, r: 0 },
			{ q: 1, r: 0 },
		]
		const map = new Map<string, RenderableTerrainTile>()
		for (const c of coords) {
			map.set(axial.key(c), {
				terrain: 'grass',
				height: 0,
				hydrology: {
					isChannel: true,
					edges: { 0: edge },
					riverFlow: {
						upstreamDirections: [3],
						downstreamDirections: [],
						rankFromSource: 2,
						rankToSea: 0,
						tileRole: 'inlandTerminal',
					},
				},
			})
		}
		const comps = collectInlandLakeTileComponents(coords, map)
		expect(comps.length).toBe(1)
		expect(comps[0]!.length).toBe(2)
	})

	it('does not fuse inland terminals separated by a non-terminal tile', () => {
		const coords = [
			{ q: 0, r: 0 },
			{ q: 1, r: 0 },
			{ q: 2, r: 0 },
		]
		const map = new Map<string, RenderableTerrainTile>()
		const terminal: RenderableTerrainTile = {
			terrain: 'grass',
			height: 0,
			hydrology: {
				isChannel: true,
				edges: { 0: edge },
				riverFlow: {
					upstreamDirections: [3],
					downstreamDirections: [],
					rankFromSource: 1,
					rankToSea: 1,
					tileRole: 'inlandTerminal',
				},
			},
		}
		map.set(axial.key(coords[0]!), terminal)
		map.set(axial.key(coords[1]!), {
			terrain: 'grass',
			height: 0,
			hydrology: {
				isChannel: true,
				edges: { 0: edge, 3: edge },
				riverFlow: {
					upstreamDirections: [2],
					downstreamDirections: [5],
					rankFromSource: 2,
					rankToSea: 2,
					tileRole: 'through',
				},
			},
		})
		map.set(axial.key(coords[2]!), terminal)
		const comps = collectInlandLakeTileComponents(coords, map)
		expect(comps.length).toBe(2)
	})
})

describe('singleInlandTerminalBasinPolygonLocal', () => {
	it('produces a non-degenerate oriented basin for one inland terminal', () => {
		const coord = { q: 0, r: 0 }
		const map = new Map<string, RenderableTerrainTile>()
		map.set(axial.key(coord), {
			terrain: 'grass',
			height: 0,
			hydrology: {
				isChannel: true,
				edges: { 0: edge },
				riverFlow: {
					upstreamDirections: [3],
					downstreamDirections: [],
					rankFromSource: 2,
					rankToSea: 0,
					tileRole: 'inlandTerminal',
				},
			},
		})
		const bounds = new Rectangle(-400, -400, 800, 800)
		const poly = singleInlandTerminalBasinPolygonLocal(coord, bounds, map)
		expect(poly.length).toBeGreaterThanOrEqual(20)
		let minX = Number.POSITIVE_INFINITY
		let maxX = Number.NEGATIVE_INFINITY
		for (const p of poly) {
			minX = Math.min(minX, p.x)
			maxX = Math.max(maxX, p.x)
		}
		expect(maxX - minX).toBeGreaterThan(tileSize * 0.5)
	})
})
