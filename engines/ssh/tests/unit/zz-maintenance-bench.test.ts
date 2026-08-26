// @ts-nocheck
// Scratch benchmark for the vehicle maintenance planning hot path.
// Not a real test — run directly, read the printed profile tree. Delete when done.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'vitest'
import { setProfileLevel, profile } from 'ssh/dev/debug'
import { collectVehicleWorkPicks } from 'ssh/freight/vehicle-work'
import { toAxialCoord } from 'ssh/utils/position'
import { gatherFreightLine } from '../freight-fixtures'
import { TestEngine } from '../test-engine'

// Build a board of concentric concrete tiles so A* has a real connected region to explore.
function concreteBoard(radius: number) {
	const tiles: Array<{ coord: [number, number]; terrain: 'concrete' }> = []
	for (let q = -radius; q <= radius; q++) {
		for (let r = -radius; r <= radius; r++) {
			if (Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r)) > radius) continue
			tiles.push({ coord: [q, r], terrain: 'concrete' })
		}
	}
	return tiles
}

describe('maintenance bench', () => {
	it('profiles collectVehicleWorkPicks across a populated board', { timeout: 120000 }, async () => {
		setProfileLevel('proposedJobs', 'summary')
		const radius = 14
		const tiles = concreteBoard(radius)
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()
		const game = engine.game
		try {
			const looseGoods: Record<string, Array<[number, number]>> = { wood: [] }
			for (let i = 1; i <= 6; i++) looseGoods.wood.push([i, 0])
			engine.loadScenario({
				generationOptions: { terrainSeed: 1234, characterCount: 0 },
				tiles,
				hives: [
					{
						name: 'H',
						alveoli: [
							{ coord: [0, 0] as const, alveolus: 'sawmill' as const, goods: {} },
							{ coord: [radius, 0] as const, alveolus: 'freight_bay' as const, goods: {} },
						],
					},
				],
				looseGoods,
			})
			const line = gatherFreightLine({
				name: 'Bench',
				hiveName: 'H',
				coord: [0, 0],
				filters: ['wood'],
				radius: 3,
			})
			const vehicles = []
			for (let i = 0; i < 5; i++) {
				const v = game.vehicles.createVehicle('wheelbarrow', { q: i, r: 0 }, [line])
				vehicles.push(v)
			}
			const characters = []
			for (let i = 0; i < 5; i++) {
				characters.push(game.population.createCharacter('Worker' + i, { q: i, r: 1 }))
			}

			profile.proposedJobs.reset()
			const t0 = performance.now()
			for (const character of characters) {
				collectVehicleWorkPicks(game, character)
			}
			const t1 = performance.now()
			const out = `=== collectVehicleWorkPicks x${characters.length}: ${(t1 - t0).toFixed(1)}ms ===\n${profile.proposedJobs.read()}\n`

			// Micro: time the flood for EACH vehicle's actual position (as the planner sees it).
			let micro = `\n--- micro ---\n`
			for (const v of vehicles) {
				const effCoord = toAxialCoord(v.effectivePosition)!
				const tileCoord = toAxialCoord(v.tile.position)!
				const start = { q: Math.round(effCoord.q), r: Math.round(effCoord.r) }
				const tt: Array<{ q: number; r: number }> = []
				for (const tile of game.hex.tilesAround(tileCoord, 6)) {
					const tc = toAxialCoord(tile.position)
					if (tc) tt.push({ q: Math.round(tc.q), r: Math.round(tc.r) })
				}
				const h0 = performance.now()
				for (let i = 0; i < 20; i++) game.hex.reachableForVehicleTargets(start, 24, tt)
				const h1 = performance.now()
				micro +=
					`vehicle eff=(${effCoord.q},${effCoord.r}) tile=(${tileCoord.q},${tileCoord.r}) ` +
					`start=(${start.q},${start.r}) targets=${tt.length}: ${((h1 - h0) / 20).toFixed(2)}ms/call\n`
			}
			const outPath = path.join(
				path.dirname(fileURLToPath(import.meta.url)),
				'../../sandbox/maintenance-bench.txt'
			)
			fs.writeFileSync(outPath, out + micro)
		} finally {
			setProfileLevel('proposedJobs', undefined)
			game.destroy()
		}
	})

	it('reports workPlanningRevision trajectory across a findAction/abandonAnd sweep', {
		timeout: 120000,
	}, async () => {
		const radius = 14
		const tiles = concreteBoard(radius)
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()
		const game = engine.game
		try {
			const looseGoods: Record<string, Array<[number, number]>> = { wood: [] }
			for (let i = 1; i <= 6; i++) looseGoods.wood.push([i, 0])
			engine.loadScenario({
				generationOptions: { terrainSeed: 1234, characterCount: 0 },
				tiles,
				hives: [
					{
						name: 'H',
						alveoli: [
							{ coord: [0, 0] as const, alveolus: 'sawmill' as const, goods: {} },
							{ coord: [radius, 0] as const, alveolus: 'freight_bay' as const, goods: {} },
						],
					},
				],
				looseGoods,
			})
			const line = gatherFreightLine({
				name: 'Bench',
				hiveName: 'H',
				coord: [0, 0],
				filters: ['wood'],
				radius: 3,
			})
			for (let i = 0; i < 3; i++) {
				game.vehicles.createVehicle('wheelbarrow', { q: i, r: 0 }, [line])
			}
			const characters = []
			for (let i = 0; i < 4; i++) {
				characters.push(game.population.createCharacter('Worker' + i, { q: i, r: 1 }))
			}

			let report = '\n--- revision sweep ---\n'
			for (const c of characters) {
				const before = game.workPlanningRevision
				const action = c.findAction()
				const afterFind = game.workPlanningRevision
				if (action) c.abandonAnd(action)
				const afterAbandon = game.workPlanningRevision
				report +=
					`worker ${c.name}: findAction ${before}->${afterFind}` +
					` (${action ? 'action' : 'none'}), abandonAnd ->${afterAbandon}\n`
			}
			const outPath = path.join(
				path.dirname(fileURLToPath(import.meta.url)),
				'../../sandbox/maintenance-bench.txt'
			)
			fs.appendFileSync(outPath, report)
		} finally {
			game.destroy()
		}
	})

	it('measures unbounded service-border miss cost on a large board', { timeout: 120000 }, async () => {
		const radius = 28
		// Concrete board, but carve a water "moat" at r == 14 so the far side is unreachable.
		const tiles: Array<{ coord: [number, number]; terrain: 'concrete' | 'water' }> = []
		for (let q = -radius; q <= radius; q++) {
			for (let r = -radius; r <= radius; r++) {
				if (Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r)) > radius) continue
				const terrain = Math.abs(q) + Math.abs(r) > 30 && Math.abs(r) < 3 ? 'water' : 'concrete'
				tiles.push({ coord: [q, r], terrain })
			}
		}
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()
		const game = engine.game
		try {
			engine.loadScenario({ generationOptions: { terrainSeed: 1234, characterCount: 0 }, tiles })
			const start = { q: 0, r: 0 }
			const far = { q: 28, r: 0 } // across the water moat — unreachable
			// Warm up JIT.
			game.hex.findPathForVehicleServiceBorder(start, far, 999999)
			const t0 = performance.now()
			for (let i = 0; i < 5; i++) game.hex.findPathForVehicleServiceBorder(start, far, 999999)
			const t1 = performance.now()
			const u0 = performance.now()
			for (let i = 0; i < 5; i++) game.hex.findPathForVehicleServiceBorderUnbounded(start, far)
			const u1 = performance.now()
			const out =
				`\n--- unbounded miss (radius ${radius}) ---\n` +
				`uncached  findPathForVehicleServiceBorder(Infinity) x5: ${(t1 - t0).toFixed(1)}ms\n` +
				`cached    findPathForVehicleServiceBorderUnbounded x5 (first miss): ${(u1 - u0).toFixed(1)}ms\n`
			const outPath = path.join(
				path.dirname(fileURLToPath(import.meta.url)),
				'../../sandbox/maintenance-bench.txt'
			)
			fs.appendFileSync(outPath, out)
		} finally {
			game.destroy()
		}
	})
})
