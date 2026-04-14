import { describe, expect, it } from 'vitest'
import {
	classifyRiverBodyAngle,
	classifyRiverJunction,
	planRiverTileOverlay,
	riverBodyTextureKey,
	riverJunctionTextureKey,
	riverSpriteRotationForBody,
	riverSpriteRotationForJunction,
	riverSpriteRotationForTerminal,
	riverSpriteScaleForBody,
	riverSpriteScaleForTerminal,
	riverSpriteUniformScale,
	riverTerminalTextureKey,
	riverWidthBandFromEdgeWidth,
} from './river-topology'

describe('riverWidthBandFromEdgeWidth', () => {
	it('maps thresholds to bands', () => {
		expect(riverWidthBandFromEdgeWidth(1)).toBe('narrow')
		expect(riverWidthBandFromEdgeWidth(2.25)).toBe('narrow')
		expect(riverWidthBandFromEdgeWidth(3)).toBe('medium')
		expect(riverWidthBandFromEdgeWidth(4.25)).toBe('wide')
		expect(riverWidthBandFromEdgeWidth(9)).toBe('wide')
	})
})

describe('classifyRiverBodyAngle', () => {
	it('classifies opposite edges as straight', () => {
		expect(classifyRiverBodyAngle([0, 3])).toBe('straight180')
		expect(classifyRiverBodyAngle([2, 5])).toBe('straight180')
	})

	it('classifies adjacent edges as 60° bend', () => {
		expect(classifyRiverBodyAngle([0, 1])).toBe('bend60')
		expect(classifyRiverBodyAngle([5, 0])).toBe('bend60')
	})

	it('classifies skip-one edges as 120° bend', () => {
		expect(classifyRiverBodyAngle([0, 2])).toBe('bend120')
		expect(classifyRiverBodyAngle([4, 0])).toBe('bend120')
	})

	it('returns undefined for non-degree-2', () => {
		expect(classifyRiverBodyAngle([0, 1, 2])).toBeUndefined()
		expect(classifyRiverBodyAngle([0])).toBeUndefined()
		expect(classifyRiverBodyAngle([])).toBeUndefined()
	})
})

describe('riverBodyTextureKey', () => {
	it('builds stable texture keys', () => {
		expect(riverBodyTextureKey('straight180', 'medium')).toBe('rivers.body_straight_180__medium')
		expect(riverBodyTextureKey('bend60', 'narrow')).toBe('rivers.body_bend_60__narrow')
		expect(riverBodyTextureKey('bend120', 'wide')).toBe('rivers.body_bend_120__wide')
	})
})

describe('riverTerminalTextureKey', () => {
	it('builds stable terminal texture keys', () => {
		expect(riverTerminalTextureKey('source', 'narrow')).toBe('rivers.terminal_source__narrow')
		expect(riverTerminalTextureKey('pool', 'medium')).toBe('rivers.terminal_pool__medium')
		expect(riverTerminalTextureKey('mouth', 'wide')).toBe('rivers.terminal_mouth__wide')
		expect(riverTerminalTextureKey('delta', 'wide')).toBe('rivers.terminal_delta__wide')
	})
})

describe('classifyRiverJunction', () => {
	it('classifies degree-3 families by cyclic gaps', () => {
		expect(classifyRiverJunction([0, 1, 2])).toBe('junction_arc_stub')
		expect(classifyRiverJunction([0, 1, 3])).toBe('junction_skew')
		expect(classifyRiverJunction([0, 2, 4])).toBe('junction_y_120')
	})

	it('classifies degree-4/5/6 families', () => {
		expect(classifyRiverJunction([0, 1, 2, 3])).toBe('junction_4a')
		expect(classifyRiverJunction([0, 1, 3, 4])).toBe('junction_4b')
		expect(classifyRiverJunction([0, 1, 2, 4])).toBe('junction_4c')
		expect(classifyRiverJunction([0, 1, 2, 3, 4])).toBe('junction_5way')
		expect(classifyRiverJunction([0, 1, 2, 3, 4, 5])).toBe('junction_6hub')
	})
})

describe('riverJunctionTextureKey', () => {
	it('builds stable junction texture keys', () => {
		expect(riverJunctionTextureKey('junction_y_120', 'medium')).toBe(
			'rivers.junction_y_120__medium'
		)
		expect(riverJunctionTextureKey('junction_4b', 'wide')).toBe('rivers.junction_4b__wide')
	})
})

describe('riverSpriteRotationForBody', () => {
	it('is finite for representative edge pairs', () => {
		const ts = 30
		for (const angle of ['straight180', 'bend60', 'bend120'] as const) {
			for (const [a, b] of [
				[0, 3],
				[0, 1],
				[0, 2],
			] as const) {
				const r = riverSpriteRotationForBody(angle, a, b, ts)
				expect(Number.isFinite(r)).toBe(true)
			}
		}
	})

	it('aligns authored bend entries from +texture Y (90°) for canonical edge pairs', () => {
		const ts = 30
		expect(riverSpriteRotationForBody('bend60', 0, 1, ts)).toBeCloseTo(Math.PI / 2, 5)
		expect(riverSpriteRotationForBody('bend120', 0, 2, ts)).toBeCloseTo(Math.PI / 2, 5)
	})

	it('aligns straights along the chord between edge midpoints', () => {
		const ts = 30
		expect(riverSpriteRotationForBody('straight180', 0, 3, ts)).toBeCloseTo(-Math.PI / 2, 5)
	})
})

describe('riverSpriteRotationForJunction', () => {
	it('uses a stable 60° step rotation from canonical topology', () => {
		expect(riverSpriteRotationForJunction('junction_y_120', [0, 2, 4])).toBeCloseTo(0, 5)
		expect(riverSpriteRotationForJunction('junction_y_120', [1, 3, 5])).toBeCloseTo(Math.PI / 3, 5)
	})
})

describe('riverSpriteUniformScale', () => {
	it('is positive', () => {
		expect(riverSpriteUniformScale(30)).toBeGreaterThan(0)
	})
})

describe('riverSpriteScaleForBody', () => {
	it('overscales straights past hex-clip fit so painted water bridges neighbours', () => {
		const ts = 30
		const base = riverSpriteUniformScale(ts)
		const scaled = riverSpriteScaleForBody(ts, 'straight180', 0, 3)
		expect(scaled).toBeGreaterThan(base * 1.05)
	})

	it('boosts bends over the hex-clip baseline', () => {
		const ts = 30
		const base = riverSpriteUniformScale(ts)
		expect(riverSpriteScaleForBody(ts, 'bend60', 0, 1)).toBeGreaterThan(base * 1.15)
		expect(riverSpriteScaleForBody(ts, 'bend120', 0, 2)).toBeGreaterThan(base * 1.18)
	})
})

describe('riverSpriteRotationForTerminal', () => {
	it('aligns downstream terminals to the requested edge direction', () => {
		const ts = 30
		expect(riverSpriteRotationForTerminal('mouth', 2, ts, 'grass')).toBeCloseTo(
			(7 * Math.PI) / 6,
			5
		)
		expect(riverSpriteRotationForTerminal('mouth', 4, ts, 'grass')).toBeCloseTo(
			(11 * Math.PI) / 6,
			5
		)
	})

	it('keeps source orientation on the connected edge', () => {
		const ts = 30
		expect(riverSpriteRotationForTerminal('source', 2, ts, 'grass')).toBeCloseTo(
			(7 * Math.PI) / 6,
			5
		)
	})

	it('reverses downstream terminals when the terminal sample is already on water', () => {
		const ts = 30
		expect(riverSpriteRotationForTerminal('mouth', 2, ts, 'water')).toBeCloseTo(Math.PI / 6, 5)
	})
})

describe('riverSpriteScaleForTerminal', () => {
	it('keeps terminals above the baseline fit', () => {
		const ts = 30
		const base = riverSpriteUniformScale(ts)
		expect(riverSpriteScaleForTerminal(ts, 'source')).toBeGreaterThan(base)
		expect(riverSpriteScaleForTerminal(ts, 'delta')).toBeGreaterThan(base * 1.1)
	})
})

describe('planRiverTileOverlay', () => {
	it('suppresses everything on water terrain', () => {
		expect(
			planRiverTileOverlay({
				edgeDirections: [0, 3],
				maxEdgeWidth: 3,
				tileSize: 30,
				terrain: 'water',
			})
		).toEqual({ mode: 'none' })
	})

	it('uses sprites for degree-2 land tiles', () => {
		const plan = planRiverTileOverlay({
			edgeDirections: [0, 3],
			maxEdgeWidth: 3,
			tileSize: 30,
			terrain: 'grass',
		})
		expect(plan.mode).toBe('sprite')
		if (plan.mode === 'sprite') {
			expect(plan.spriteKind).toBe('body')
			expect(plan.angle).toBe('straight180')
			expect(plan.widthBand).toBe('medium')
			expect(plan.scale).toBeGreaterThan(0)
		}
	})

	it('uses inland terminals for degree-1 land tiles', () => {
		const plan = planRiverTileOverlay({
			edgeDirections: [2],
			maxEdgeWidth: 3,
			tileSize: 30,
			terrain: 'grass',
			terminalNeighborTerrain: 'grass',
		})
		expect(plan.mode).toBe('sprite')
		if (plan.mode === 'sprite') {
			expect(plan.spriteKind).toBe('terminal')
			expect(plan.terminal).toBe('source')
			expect(plan.textureKey).toBe('rivers.terminal_source__medium')
		}
	})

	it('uses coastal terminals for water-adjacent degree-1 land tiles', () => {
		const plan = planRiverTileOverlay({
			edgeDirections: [2],
			maxEdgeWidth: 5,
			tileSize: 30,
			terrain: 'grass',
			terminalNeighborTerrain: 'water',
		})
		expect(plan.mode).toBe('sprite')
		if (plan.mode === 'sprite') {
			expect(plan.spriteKind).toBe('terminal')
			expect(plan.terminal).toBe('delta')
			expect(plan.textureKey).toBe('rivers.terminal_delta__wide')
		}
	})

	it('uses coastal terminals on the last land tile when one of two edges enters water', () => {
		const plan = planRiverTileOverlay({
			edgeDirections: [1, 2],
			maxEdgeWidth: 5,
			tileSize: 30,
			terrain: 'grass',
			waterEdgeDirections: [2],
		})
		expect(plan.mode).toBe('sprite')
		if (plan.mode === 'sprite') {
			expect(plan.spriteKind).toBe('terminal')
			expect(plan.terminal).toBe('delta')
			expect(plan.direction).toBe(2)
		}
	})

	it('uses downstream terminals on degree-1 water tiles too', () => {
		const plan = planRiverTileOverlay({
			edgeDirections: [2],
			maxEdgeWidth: 3,
			tileSize: 30,
			terrain: 'water',
		})
		expect(plan.mode).toBe('sprite')
		if (plan.mode === 'sprite') {
			expect(plan.spriteKind).toBe('terminal')
			expect(plan.terminal).toBe('mouth')
		}
	})

	it('falls back to debug for junctions', () => {
		const plan = planRiverTileOverlay({
			edgeDirections: [0, 1, 2],
			maxEdgeWidth: 3,
			tileSize: 30,
			terrain: 'grass',
		})
		expect(plan.mode).toBe('sprite')
		if (plan.mode === 'sprite') {
			expect(plan.spriteKind).toBe('junction')
			expect(plan.junction).toBe('junction_arc_stub')
			expect(plan.textureKey).toBe('rivers.junction_arc_stub__medium')
		}
	})
})
