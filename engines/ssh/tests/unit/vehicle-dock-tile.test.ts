import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine'
import { gatherFreightLine } from '../freight-fixtures'
import type { SaveState } from 'ssh/game'
import { toAxialCoord } from 'ssh/utils/position'
import { axial } from 'ssh/utils'
import { reactive } from 'mutts'

/** Extract q,r for comparison, ignoring extra properties returned by toAxialCoord. */
function qr(pos: unknown): { q: number; r: number } {
	const c = toAxialCoord(pos as any)!
	return { q: c.q, r: c.r }
}

/**
 * Reveals a bug where character._tile is stale during driving.
 *
 * When a character boards a vehicle, `_tile` is set to the boarding tile.
 * During driving, the character's position setter updates the vehicle's position
 * but never updates `_tile`. When `walk.enter()` is called (e.g. before docking),
 * it uses the stale `_tile` to compute the target, moving the vehicle to the
 * wrong position. This causes the dock assertion to fail:
 *   "Vehicle ...: dock requires vehicle to be on the anchor tile"
 */
describe('Vehicle dock tile synchronization', () => {
	async function setupEngine() {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()
		return engine
	}

	it('character._tile is stale after driving – reveals the dock bug', async () => {
		const engine = await setupEngine()
		try {
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'TestHive',
						alveoli: [
							{ coord: [1, 0], alveolus: 'freight_bay', goods: {} },
						],
					},
				],
				tiles: [
					{ coord: [0, 0] as [number, number], terrain: 'grass' },
					{ coord: [1, 0] as [number, number], terrain: 'concrete' },
				],
				freightLines: [
					gatherFreightLine({
						id: 'TestHive:implicit-gather:1,0',
						name: 'Test gather',
						hiveName: 'TestHive',
						coord: [1, 0],
						filters: ['wood'],
						radius: 3,
					}),
				],
			}
			engine.loadScenario(scenario)

			const { game } = engine
			const character = engine.spawnCharacter('Driver', { q: 0, r: 0 })
			character.role = 'worker'
			void character.scriptsContext

			const line = game.freightLines[0]!
			const vehicle = game.vehicles.createVehicle(
				'test-wb', 'wheelbarrow', { q: 0, r: 0 }, [line]
			)

			// Attach line service with anchor stop at (1,0), then board
			vehicle.beginService(line, line.stops.at(-1)!, character)
			character.operates = vehicle
			character.onboard()

			// Verify initial state: character._tile is at boarding tile (0,0)
			expect(character.driving).toBe(true)
			expect(qr(character.tile.position)).toEqual({ q: 0, r: 0 })

			// Simulate driving to the anchor tile at (1,0)
			// MoveToStep calls who.position = ... which triggers Character.set position()
			// and should now update _tile through the reactive vehicle proxy
			character.position = reactive({ q: 1, r: 0 })

			// The vehicle is correctly at (1,0)
			expect(qr(vehicle.effectivePosition)).toEqual({ q: 1, r: 0 })

			// CORRECT BEHAVIOR: character._tile should follow vehicle position during driving.
			// BUG: character._tile is STILL at (0,0) — it was NOT updated during movement!
			// This causes walk.enter() to target the wrong tile and triggers the dock assertion.
			expect(qr(character.tile.position)).toEqual({ q: 1, r: 0 })
		} finally {
			await engine.destroy()
		}
	})

	it('vehicle.dock() succeeds when vehicle.position is at anchor after driving', async () => {
		const engine = await setupEngine()
		try {
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'TestHive',
						alveoli: [
							{ coord: [1, 0], alveolus: 'freight_bay', goods: {} },
						],
					},
				],
				tiles: [
					{ coord: [0, 0] as [number, number], terrain: 'grass' },
					{ coord: [1, 0] as [number, number], terrain: 'concrete' },
				],
				freightLines: [
					gatherFreightLine({
						id: 'TestHive:implicit-gather:1,0',
						name: 'Test gather',
						hiveName: 'TestHive',
						coord: [1, 0],
						filters: ['wood'],
						radius: 3,
					}),
				],
			}
			engine.loadScenario(scenario)

			const { game } = engine
			const character = engine.spawnCharacter('Driver', { q: 0, r: 0 })
			character.role = 'worker'
			void character.scriptsContext

			const line = game.freightLines[0]!
			const vehicle = game.vehicles.createVehicle(
				'test-wb', 'wheelbarrow', { q: 0, r: 0 }, [line]
			)

			vehicle.beginService(line, line.stops.at(-1)!, character)
			character.operates = vehicle
			character.onboard()

			// Drive to the anchor tile via the character position setter
			character.position = reactive({ q: 1, r: 0 })

			// Dock should succeed because vehicle.position is at (1,0)
			// which matches dockTile.position (the anchor at (1,0))
			expect(vehicle.dockTile).toBeDefined()
			vehicle.dock()
			expect(vehicle.isDocked).toBe(true)
		} finally {
			await engine.destroy()
		}
	})

	it('vehicle.dock() throws assertion when vehicle is NOT on the anchor tile', async () => {
		const engine = await setupEngine()
		try {
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'TestHive',
						alveoli: [
							{ coord: [2, 0], alveolus: 'freight_bay', goods: {} },
						],
					},
				],
				tiles: [
					{ coord: [0, 0] as [number, number], terrain: 'grass' },
					{ coord: [1, 0] as [number, number], terrain: 'grass' },
					{ coord: [2, 0] as [number, number], terrain: 'concrete' },
				],
				freightLines: [
					gatherFreightLine({
						id: 'TestHive:implicit-gather:2,0',
						name: 'Test gather',
						hiveName: 'TestHive',
						coord: [2, 0],
						filters: ['wood'],
						radius: 3,
					}),
				],
			}
			engine.loadScenario(scenario)

			const { game } = engine
			const character = engine.spawnCharacter('Driver', { q: 0, r: 0 })
			character.role = 'worker'
			void character.scriptsContext

			const line = game.freightLines[0]!
			const vehicle = game.vehicles.createVehicle(
				'test-wb', 'wheelbarrow', { q: 0, r: 0 }, [line]
			)

			vehicle.beginService(line, line.stops.at(-1)!, character)
			character.operates = vehicle
			character.onboard()

			// Drive to (1,0) — NOT the anchor (2,0)
			character.position = reactive({ q: 1, r: 0 })

			// Verify dockTile is at (2,0) — the anchor
			expect(vehicle.dockTile).toBeDefined()
			expect(qr(vehicle.dockTile!.position)).toEqual({ q: 2, r: 0 })

			// Verify vehicle is at (1,0) — NOT on the anchor
			expect(qr(vehicle.position!)).toEqual({ q: 1, r: 0 })

			// Dock should throw — vehicle is NOT on the anchor tile
			expect(() => vehicle.dock()).toThrow(/dock requires vehicle to be on the anchor tile/)
		} finally {
			await engine.destroy()
		}
	})
})
