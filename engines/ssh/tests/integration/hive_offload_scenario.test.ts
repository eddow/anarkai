import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import type { LooseGood } from 'ssh/board/looseGoods'
import type { Tile } from 'ssh/board/tile'
import { maybeAdvanceVehicleFromCompletedAnchorStop } from 'ssh/freight/vehicle-run'
import { findVehicleOffloadJob } from 'ssh/freight/vehicle-work'
import type { Game } from 'ssh/game/game'
import type { Character } from 'ssh/population/character'
import { debugActiveAllocations, resetDebugActiveAllocations } from 'ssh/storage/guard'
import { toAxialCoord } from 'ssh/utils/position'
import { describe, expect, it } from 'vitest'
import { type NamedTrace, namedTrace, traces } from '../../src/lib/dev/debug.ts'
import { gatherFreightLine } from '../freight-fixtures'
import { TestEngine } from '../test-engine'

function createOffloadWheelbarrow(game: Game, coord: { q: number; r: number }, uid: string) {
	return game.vehicles.createVehicle(uid, 'wheelbarrow', coord, [])
}

function rocksInTransport(char: Character): number {
	return char.carry?.stock?.stone ?? 0
}

function firstTileWithPresentLooseRocks(game: Game): Tile | undefined {
	for (const list of game.hex.looseGoods.goods.values()) {
		for (const g of list) {
			if (g.goodType === 'stone' && !g.isRemoved) {
				const tile = game.hex.getTile(g.position)
				if (tile) return tile
			}
		}
	}
	return undefined
}

function firstLooseRockCoordLabel(game: Game): string {
	const tile = firstTileWithPresentLooseRocks(game)
	if (!tile) return 'none'
	const c = toAxialCoord(tile.position)
	return `${c.q},${c.r}`
}

function availableLooseWoodCount(game: Game, coord: { q: number; r: number }) {
	return game.hex.looseGoods
		.getGoodsAt(coord)
		.filter((g) => g.goodType === 'wood' && g.available && !g.isRemoved).length
}

/** String message keys from `traces.vehicle` `log`/`warn`/`error` rows (same contract as `NamedTrace.heads` for string heads). */
function vehicleTraceMessages(sink: NamedTrace | undefined): string[] {
	if (!sink) return []
	const out: string[] = []
	for (const row of sink as unknown as Iterable<unknown>) {
		if (!Array.isArray(row) || row.length < 2) continue
		const [level, head] = row as [string, unknown]
		if (level === 'log' || level === 'warn' || level === 'error') {
			if (typeof head === 'string') out.push(head)
		}
	}
	return out
}

function formatTwoLooseRoundDiagnostics(
	rounds: ReadonlyArray<{
		round: number
		directOffload: boolean
		plannerJob: string | null
		findBestJob: string | false
		presentRocks: number
		rocksInTransport: number
		sinkLength: number
	}>
): string {
	return rounds
		.map((r) =>
			[
				`round=${r.round}`,
				`directOffload=${String(r.directOffload)}`,
				`plannerJob=${r.plannerJob ?? 'null'}`,
				`findBestJob=${String(r.findBestJob)}`,
				`presentRocks=${String(r.presentRocks)}`,
				`rocksInTransport=${String(r.rocksInTransport)}`,
				`sinkLength=${String(r.sinkLength)}`,
			].join(' ')
		)
		.join('\n')
}

describe('Hive Offload Scenario', () => {
	it('Scenario: Offload Rock planner surfaces vehicleOffload for hive storage + loose stone', {
		timeout: 25000,
	}, async () => {
		const engine = new TestEngine({
			terrainSeed: 1234,
			characterCount: 0,
		})
		await engine.init()
		const game = engine.game
		try {
			const center = { q: 2, r: 2 }
			engine.loadScenario({
				generationOptions: {
					terrainSeed: 1234,
					characterCount: 0,
				},
				tiles: [
					{ coord: [2, 2], terrain: 'concrete' },
					{ coord: [2, 3], terrain: 'concrete' },
					{ coord: [3, 2], terrain: 'concrete' },
					{ coord: [3, 3], terrain: 'concrete' },
				],
				looseGoods: [{ goodType: 'stone', position: center }],
				hives: [
					{
						name: 'OffloadRockHive',
						alveoli: [{ coord: [2, 2], alveolus: 'storage', goods: {} }],
					},
				],
			} as any)

			createOffloadWheelbarrow(game, { q: 3, r: 3 }, 'wb-rock')

			const char = engine.spawnCharacter('Worker', { q: 3, r: 2 })
			char.role = 'worker'
			void char.scriptsContext

			const tile = game.hex.getTile(center)
			expect(tile).toBeDefined()
			expect(tile?.availableGoods.length).toBe(1)
			expect(tile?.availableGoods[0].goodType).toBe('stone')
			expect((tile?.content as any).hive).toBeDefined()

			expect(findVehicleOffloadJob(game, char)?.job).toBe('vehicleOffload')
			const action = char.findBestJob()
			expect(action).toBeTruthy()
			if (!action) throw new Error('Expected offload action')
			expect(action.name).toBe('work.goWork')
		} finally {
			await engine.destroy()
		}
	})

	it('Scenario: loadFromBurden completes once the burdening good is loaded into the vehicle', {
		timeout: 15000,
	}, async () => {
		const engine = new TestEngine({
			terrainSeed: 1234,
			characterCount: 0,
		})
		await engine.init()
		const game = engine.game
		try {
			const center = { q: 2, r: 2 }
			engine.loadScenario({
				generationOptions: {
					terrainSeed: 1234,
					characterCount: 0,
				},
				tiles: [
					{ coord: [2, 2], terrain: 'concrete' },
					{ coord: [2, 3], terrain: 'concrete' },
					{ coord: [3, 2], terrain: 'concrete' },
					{ coord: [3, 3], terrain: 'concrete' },
				],
				looseGoods: [{ goodType: 'stone', position: center }],
				hives: [
					{
						name: 'OffloadLoadOnlyHive',
						alveoli: [{ coord: [2, 2], alveolus: 'storage', goods: {} }],
					},
				],
			} as any)

			const vehicle = createOffloadWheelbarrow(game, { q: 3, r: 3 }, 'wb-load-only')
			const worker = engine.spawnCharacter('Worker', { q: 3, r: 2 })
			worker.role = 'worker'
			void worker.scriptsContext

			const action = worker.findBestJob()
			expect(action).toBeTruthy()
			if (!action) throw new Error('Expected loadFromBurden action')
			worker.begin(action)

			let time = 0
			while (time < 8) {
				engine.tick(0.1, 0.1)
				if (vehicle.storage.available('stone') > 0) break
				time += 0.1
			}

			expect(vehicle.storage.available('stone')).toBe(1)
			const looseStone = Array.from(game.hex.looseGoods.goods.values())
				.flat()
				.filter((good) => good.goodType === 'stone' && !good.isRemoved)
			expect(looseStone).toHaveLength(0)
		} finally {
			await engine.destroy()
		}
	})

	it('Scenario: Idle loaded wheelbarrow chooses unload maintenance and drops onto a free tile', {
		timeout: 15000,
	}, async () => {
		const engine = new TestEngine({
			terrainSeed: 1234,
			characterCount: 0,
		})
		await engine.init()
		const game = engine.game
		try {
			const center = { q: 2, r: 2 }
			engine.loadScenario({
				generationOptions: {
					terrainSeed: 1234,
					characterCount: 0,
				},
				tiles: [
					{ coord: [2, 2], terrain: 'grass' },
					{ coord: [2, 3], terrain: 'grass' },
					{ coord: [3, 2], terrain: 'grass' },
				],
			} as any)

			const vehicle = createOffloadWheelbarrow(game, center, 'wb-unload-scenario')
			vehicle.storage.addGood('stone', 1)

			const worker = engine.spawnCharacter('Worker', center)
			worker.role = 'worker'
			void worker.scriptsContext

			const directJob = findVehicleOffloadJob(game, worker)
			expect(directJob?.maintenanceKind).toBe('unloadToTile')
			const action = worker.findBestJob()
			expect(action).toBeTruthy()
			if (!action) throw new Error('Expected unload maintenance action')
			worker.begin(action)

			let time = 0
			let dropped: LooseGood | undefined
			while (time < 8) {
				engine.tick(0.1, 0.1)
				if (rocksInTransport(worker) === 0) {
					dropped = Array.from(game.hex.looseGoods.goods.values())
						.flat()
						.find((good) => good.goodType === 'stone' && !good.isRemoved)
					if (dropped) break
				}
				time += 0.1
			}

			expect(dropped).toBeDefined()
			if (!dropped) throw new Error('Expected unloaded loose stone to exist')
			expect(dropped.position).toHaveProperty('x')
			expect(dropped.position).toHaveProperty('y')
			expect(toAxialCoord(dropped.position)).not.toEqual(center)
		} finally {
			await engine.destroy()
		}
	})

	it('Scenario: Idle empty burdening wheelbarrow chooses park maintenance and moves away', {
		timeout: 15000,
	}, async () => {
		const engine = new TestEngine({
			terrainSeed: 1234,
			characterCount: 0,
		})
		await engine.init()
		const game = engine.game
		try {
			const center = { q: 2, r: 2 }
			engine.loadScenario({
				generationOptions: {
					terrainSeed: 1234,
					characterCount: 0,
				},
				hives: [
					{
						name: 'ParkScenarioHive',
						alveoli: [{ coord: [2, 2], alveolus: 'storage', goods: {} }],
					},
				],
			} as any)

			const vehicle = createOffloadWheelbarrow(game, center, 'wb-park-scenario')
			const worker = engine.spawnCharacter('Worker', center)
			worker.role = 'worker'
			void worker.scriptsContext

			const directJob = findVehicleOffloadJob(game, worker)
			expect(directJob?.maintenanceKind).toBe('park')
			const action = worker.findBestJob()
			expect(action).toBeTruthy()
			if (!action) throw new Error('Expected park maintenance action')
			worker.begin(action)

			let time = 0
			while (time < 8) {
				engine.tick(0.1, 0.1)
				if (!vehicle.service && !worker.operates) break
				time += 0.1
			}

			expect(vehicle.service).toBeUndefined()
			expect(worker.operates).toBeUndefined()
			expect(toAxialCoord(vehicle.position)).not.toEqual(center)
			const parkedTile = game.hex.getTile(vehicle.position)
			expect(parkedTile?.zone).not.toBe('residential')
			expect(parkedTile?.content instanceof UnBuiltLand).toBe(true)
			expect(parkedTile?.isClear).toBe(true)
		} finally {
			await engine.destroy()
		}
	})

	it('Scenario: Completed last docked anchor falls into park maintenance on the next pick', async () => {
		const engine = new TestEngine({
			terrainSeed: 1234,
			characterCount: 0,
		})
		await engine.init()
		const game = engine.game
		try {
			engine.loadScenario({
				generationOptions: {
					terrainSeed: 1234,
					characterCount: 0,
				},
				hives: [
					{
						name: 'DockParkHive',
						alveoli: [{ coord: [0, 0], alveolus: 'freight_bay', goods: {} }],
					},
				],
				freightLines: [
					gatherFreightLine({
						id: 'dock-park',
						name: 'Dock Park',
						hiveName: 'DockParkHive',
						coord: [0, 0],
						filters: ['wood'],
						radius: 2,
					}),
				],
			} as any)

			const line = game.freightLines[0]!
			const unloadStop = line.stops[1]!
			const vehicle = game.vehicles.createVehicle('wb-dock-park', 'wheelbarrow', { q: 0, r: 0 }, [
				line,
			])
			const dockActor = engine.spawnCharacter('DockActor', { q: 0, r: 0 })
			vehicle.beginService(line, unloadStop, dockActor)
			vehicle.dock()

			maybeAdvanceVehicleFromCompletedAnchorStop(game, vehicle, dockActor)
			expect(vehicle.service).toBeUndefined()

			dockActor.role = 'worker'
			void dockActor.scriptsContext
			expect(findVehicleOffloadJob(game, dockActor)?.maintenanceKind).toBe('park')
		} finally {
			await engine.destroy()
		}
	})

	it('Scenario: Gather line picks project wood before plain wood when the pickup also serves downstream hive need', async () => {
		const engine = new TestEngine({
			terrainSeed: 1234,
			characterCount: 0,
		})
		await engine.init()
		const game = engine.game
		try {
			engine.loadScenario({
				generationOptions: {
					terrainSeed: 1234,
					characterCount: 0,
				},
				tiles: [
					{ coord: [0, 0] as [number, number], terrain: 'concrete' },
					{ coord: [0, 1] as [number, number], terrain: 'concrete' },
					{ coord: [1, 0] as [number, number], terrain: 'concrete' },
					{ coord: [2, 0] as [number, number], terrain: 'grass' },
					{ coord: [1, 1] as [number, number], terrain: 'grass' },
				],
				hives: [
					{
						name: 'JointPriorityHive',
						alveoli: [
							{ coord: [0, 0], alveolus: 'freight_bay', goods: {} },
							{ coord: [1, 0], alveolus: 'sawmill', goods: {} },
						],
					},
				],
				projects: {
					'build:storage': [[2, 0] as [number, number]],
				},
				looseGoods: [
					{ goodType: 'wood', position: { q: 2, r: 0 } },
					{ goodType: 'wood', position: { q: 1, r: 1 } },
				],
				freightLines: [
					gatherFreightLine({
						id: 'joint-priority-line',
						name: 'Joint priority line',
						hiveName: 'JointPriorityHive',
						coord: [0, 0],
						filters: ['wood'],
						radius: 3,
					}),
				],
			} as any)

			const worker = engine.spawnCharacter('JointWorker', { q: 0, r: 1 })
			worker.role = 'worker'
			void worker.scriptsContext

			const line = game.freightLines[0]!
			game.vehicles.createVehicle('wb-joint-priority', 'wheelbarrow', { q: 0, r: 0 }, [line])

			expect(availableLooseWoodCount(game, { q: 2, r: 0 })).toBe(1)
			expect(availableLooseWoodCount(game, { q: 1, r: 1 })).toBe(1)

			let time = 0
			while (time < 60 && availableLooseWoodCount(game, { q: 2, r: 0 }) > 0) {
				if (!worker.stepExecutor) {
					const action = worker.findBestJob()
					if (action) worker.begin(action)
				}
				engine.tick(0.1, 0.1)
				time += 0.1
			}

			expect(availableLooseWoodCount(game, { q: 2, r: 0 })).toBe(0)
			expect(availableLooseWoodCount(game, { q: 1, r: 1 })).toBe(1)
		} finally {
			await engine.destroy()
		}
	})

	it('Scenario: Two loose goods — one worker, one wheelbarrow — vehicle trace order', {
		timeout: 20000,
	}, async () => {
		const engine = new TestEngine({
			terrainSeed: 1234,
			characterCount: 0,
		})
		await engine.init()
		const game = engine.game
		// Hold a dedicated sink: `traces.vehicle` is cleared in Vitest `beforeEach`; reinstall after `init`
		// so bootstrap cannot replace it. Keep the reference for assertions (same object the engine calls).
		const vehicleSink = namedTrace('vehicle', { silent: true })
		traces.vehicle = vehicleSink
		try {
			resetDebugActiveAllocations()
			const center = { q: 2, r: 2 }
			engine.loadScenario({
				generationOptions: {
					terrainSeed: 1234,
					characterCount: 0,
				},
				tiles: [
					{ coord: [2, 2], terrain: 'concrete' },
					{ coord: [2, 3], terrain: 'concrete' },
					{ coord: [3, 2], terrain: 'concrete' },
					{ coord: [3, 3], terrain: 'concrete' },
				],
				looseGoods: [
					{ goodType: 'stone', position: center },
					{ goodType: 'stone', position: center },
				],
				hives: [
					{
						name: 'TwoLooseOffloadHive',
						alveoli: [{ coord: [2, 2], alveolus: 'storage', goods: {} }],
					},
				],
			} as any)

			createOffloadWheelbarrow(game, { q: 3, r: 3 }, 'wb-two-loose')

			const char = engine.spawnCharacter('Worker', { q: 3, r: 2 })
			char.role = 'worker'
			void char.scriptsContext

			const tile = game.hex.getTile(center)
			expect(tile).toBeDefined()
			const presentRockCount = () =>
				game.hex.looseGoods
					.getGoodsAt(center)
					.filter((good) => good.goodType === 'stone' && !good.isRemoved).length
			expect(presentRockCount()).toBe(2)

			const rounds: Array<{
				round: number
				directOffload: boolean
				plannerJob: string | null
				findBestJob: string | false
				presentRocks: number
				rocksInTransport: number
				sinkLength: number
			}> = []

			for (let round = 0; round < 2; round++) {
				const directJob = findVehicleOffloadJob(game, char)
				const planner = char.resolveBestJobMatch()
				const action = char.findBestJob()
				const findBestJobName = action === false ? false : action.name

				rounds.push({
					round,
					directOffload: directJob?.job === 'vehicleOffload',
					plannerJob: planner ? planner.job.job : null,
					findBestJob: findBestJobName,
					presentRocks: presentRockCount(),
					rocksInTransport: rocksInTransport(char),
					sinkLength: (vehicleSink as unknown as unknown[]).length,
				})

				if (directJob?.job !== 'vehicleOffload') break
				if (!action) break

				expect(action.name).toBe('work.goWork')
				char.begin(action)
				engine.tick(20, 0.1)
			}

			const diag = formatTwoLooseRoundDiagnostics(rounds)

			const messages = vehicleTraceMessages(vehicleSink)
			// The first two maintenance runs are the two `loadFromBurden` works: each ends after the
			// load, and follow-up unload/park work is selected by later planner passes.
			expect(messages.slice(0, 11), `${diag}\nvehicleTrace=${JSON.stringify(messages)}`).toEqual([
				'vehicleJob.selected',
				'vehicleJob.approach.onboard',
				'vehicleJob.load',
				'vehicleJob.maintenance.complete',
				'vehicleJob.offboard.endService',
				'vehicleJob.offboard',
				'vehicleJob.selected',
				'vehicleJob.load',
				'vehicleJob.maintenance.complete',
				'vehicleJob.offboard.endService',
				'vehicleJob.offboard',
			])
			expect(messages.filter((message) => message === 'vehicleJob.load')).toHaveLength(2)
		} finally {
			resetDebugActiveAllocations()
			await engine.destroy()
		}
	})

	it('Scenario: Offload Lifecycle Keeps LooseGood Present Until Pickup Fulfills', {
		timeout: 15000,
	}, async () => {
		const engine = new TestEngine({
			terrainSeed: 1234,
			characterCount: 0,
		})
		await engine.init()
		const game = engine.game
		try {
			const target = { q: 2, r: 2 }
			engine.loadScenario({
				generationOptions: {
					terrainSeed: 1234,
					characterCount: 0,
				},
				looseGoods: [{ goodType: 'stone', position: target }],
				hives: [
					{
						name: 'LifecycleHive',
						alveoli: [
							{
								coord: [2, 2],
								alveolus: 'tree_chopper',
								goods: {},
							},
						],
					},
				],
			} as any)

			createOffloadWheelbarrow(game, target, 'wb-lifecycle')

			const char = engine.spawnCharacter('Worker', target)
			void char.scriptsContext

			const tile = game.hex.getTile(target)!
			const directJob = findVehicleOffloadJob(game, char)
			expect(directJob?.job).toBe('vehicleOffload')
			if (directJob?.job !== 'vehicleOffload' || directJob.maintenanceKind !== 'loadFromBurden')
				throw new Error('Expected a loadFromBurden vehicleOffload job')

			const looseGood = directJob.looseGood
			expect(tile.availableGoods.length).toBe(1)
			expect(looseGood.isRemoved).toBe(false)
			expect(looseGood.available).toBe(true)

			const action = char.findBestJob()
			expect(action).toBeTruthy()
			if (!action) throw new Error('Expected an offload action')

			char.begin(action)

			expect(looseGood.isRemoved).toBe(false)
			expect(looseGood.available).toBe(false)
			expect(game.hex.looseGoods.getGoodsAt(target)).toContain(looseGood)
			expect(tile.availableGoods.length).toBe(0)
			expect(rocksInTransport(char)).toBe(0)

			const timeline: string[] = []
			let firstRemovedAt: number | undefined
			let firstCarriedAt: number | undefined
			let time = 0
			for (let i = 0; i < 80; i++) {
				const carried = rocksInTransport(char)
				timeline.push(
					`${time.toFixed(2)} removed=${String(looseGood.isRemoved)} available=${String(looseGood.available)} onTile=${String(game.hex.looseGoods.getGoodsAt(target).includes(looseGood))} carried=${carried} step=${char.stepExecutor?.constructor.name ?? 'none'} desc=${String(char.stepExecutor?.description ?? 'none')}`
				)
				if (looseGood.isRemoved && firstRemovedAt === undefined) firstRemovedAt = time
				if (carried > 0 && firstCarriedAt === undefined) firstCarriedAt = time
				if (firstRemovedAt !== undefined && firstCarriedAt !== undefined) break
				engine.tick(0.05, 0.05)
				time += 0.05
				if (!looseGood.isRemoved) {
					expect(looseGood.available).toBe(false)
					expect(game.hex.looseGoods.getGoodsAt(target)).toContain(looseGood)
				}
			}

			expect(firstRemovedAt, timeline.join('\n')).toBeDefined()
			expect(firstCarriedAt, timeline.join('\n')).toBeDefined()
			expect(firstRemovedAt, timeline.join('\n')).toBeGreaterThan(0)
			expect(firstCarriedAt, timeline.join('\n')).toBeGreaterThan(0)
			expect(firstRemovedAt, timeline.join('\n')).toBe(firstCarriedAt)
			expect(looseGood.isRemoved, timeline.join('\n')).toBe(true)
			expect(game.hex.looseGoods.getGoodsAt(target), timeline.join('\n')).not.toContain(looseGood)
			expect(rocksInTransport(char), timeline.join('\n')).toBe(1)

			time = 0
			while (time < 6 && rocksInTransport(char) > 0) {
				engine.tick(0.1, 0.1)
				time += 0.1
			}

			expect(rocksInTransport(char)).toBe(0)
		} finally {
			await engine.destroy()
		}
	})

	it('Scenario: Offload Rock Must Not Leave Pickup Or Drop Allocations Alive', {
		timeout: 15000,
	}, async () => {
		resetDebugActiveAllocations()
		const engine = new TestEngine({
			terrainSeed: 1234,
			characterCount: 0,
		})
		await engine.init()
		const game = engine.game
		try {
			const center = { q: 2, r: 2 }
			engine.loadScenario({
				generationOptions: {
					terrainSeed: 1234,
					characterCount: 0,
				},
				looseGoods: [{ goodType: 'stone', position: center }],
				hives: [
					{
						name: 'LeakCheckHive',
						alveoli: [{ coord: [2, 2], alveolus: 'storage', goods: {} }],
					},
				],
			} as any)

			createOffloadWheelbarrow(game, center, 'wb-leak')

			const worker = engine.spawnCharacter('Worker', center)
			worker.role = 'worker'
			void worker.scriptsContext

			const action = worker.findBestJob()
			expect(action).toBeTruthy()
			if (!action) throw new Error('Expected initial offload action')
			worker.begin(action)

			let time = 0
			while (time < 25) {
				engine.tick(0.1, 0.1)
				time += 0.1
				const reasons = debugActiveAllocations().map(({ reason }) => reason)
				if (!reasons.includes('plan.pickup') && !reasons.includes('drop.stone')) break
			}

			const activeReasons = debugActiveAllocations().map(({ reason }) => reason)
			expect(activeReasons).not.toContain('plan.pickup')
			expect(activeReasons).not.toContain('drop.stone')
		} finally {
			resetDebugActiveAllocations()
			await engine.destroy()
		}
	})

	it('Scenario: Avoid Dropping on Alveoli', { timeout: 5000 }, async () => {
		const engine = new TestEngine({
			terrainSeed: 1234,
			characterCount: 0,
		})
		await engine.init()
		const game = engine.game
		try {
			const center = { q: 5, r: 5 }

			// Setup: Center has rocks
			// Neighbor (6,5) has an Alveolus (e.g. storage or another chopper)
			// Neighbor (4,5) is empty UnBuiltLand
			// Character offloads from center.
			// EXPECT: Drop on (4,5), NOT (6,5)

			const scenario = {
				generationOptions: {
					terrainSeed: 1234,
					characterCount: 0,
				},
				looseGoods: [{ goodType: 'stone', position: center }],
				hives: [
					{
						name: 'BlockerHive',
						alveoli: [
							{
								coord: [6, 5],
								alveolus: 'storage', // Blocker
								goods: {},
							},
							{
								coord: [5, 5], // Center - needs to be alveolus/residential to trigger offload
								alveolus: 'tree_chopper',
								goods: {},
							},
						],
					},
				],
			}

			engine.loadScenario(scenario as any)

			createOffloadWheelbarrow(game, center, 'wb-alveoli-block')

			const char = engine.spawnCharacter('Worker', center)
			void char.scriptsContext

			// Trigger offload
			const bestJob = char.findBestJob()
			if (bestJob) char.begin(bestJob)
			else throw new Error('No job found')

			// Run
			let time = 0
			while (time < 8) {
				engine.tick(0.1, 0.1)
				if (rocksInTransport(char) === 0 && char.tiredness > 0.1) break // simplistic 'done' check
				time += 0.1
			}

			// Check where it went
			const neighborAlveolusTile = game.hex.getTile({ q: 6, r: 5 })

			const goodsOnAlveolus = game.hex.looseGoods.getGoodsAt(neighborAlveolusTile!.position)

			// Should NOT be on alveolus
			expect(goodsOnAlveolus.length).toBe(0)

			// MIGHT be on empty (or any other empty neighbor, but definitely not alveolus)
			// We can just assert that no good is on the alveolus tile.
		} finally {
			await engine.destroy()
		}
	})

	it('Scenario: Offload Engagement Allocates The Rock Before A Second Worker Can Commit', {
		timeout: 5000,
	}, async () => {
		const engine = new TestEngine({
			terrainSeed: 1234,
			characterCount: 0,
		})
		await engine.init()
		const game = engine.game
		try {
			const target = { q: 4, r: 4 }
			const scenario = {
				generationOptions: {
					terrainSeed: 1234,
					characterCount: 0,
				},
				looseGoods: [{ goodType: 'stone', position: target }],
				hives: [
					{
						name: 'ContestHive',
						alveoli: [
							{
								coord: [4, 4],
								alveolus: 'tree_chopper',
								goods: {},
							},
						],
					},
				],
			}

			engine.loadScenario(scenario as any)

			createOffloadWheelbarrow(game, { q: 3, r: 4 }, 'wb-contest-a')
			createOffloadWheelbarrow(game, { q: 5, r: 4 }, 'wb-contest-b')

			const workerA = engine.spawnCharacter('Worker', { q: 3, r: 4 })
			const workerB = engine.spawnCharacter('Worker', { q: 5, r: 4 })
			workerA.role = 'worker'
			workerB.role = 'worker'
			void workerA.scriptsContext
			void workerB.scriptsContext

			void game.hex.getTile(target)!
			const directJobA = findVehicleOffloadJob(game, workerA)
			const directJobB = findVehicleOffloadJob(game, workerB)
			const jobA = workerA.findBestJob()

			expect(directJobA?.job).toBe('vehicleOffload')
			expect(directJobB?.job).toBe('vehicleOffload')
			if (
				directJobA?.job !== 'vehicleOffload' ||
				directJobA.maintenanceKind !== 'loadFromBurden' ||
				directJobB?.job !== 'vehicleOffload' ||
				directJobB.maintenanceKind !== 'loadFromBurden'
			) {
				throw new Error('Expected vehicleOffload jobs before engagement')
			}
			expect(directJobA.looseGood).toBeTruthy()
			expect(directJobA.looseGood.goodType).toBe('stone')
			expect(directJobB.looseGood.goodType).toBe('stone')
			expect(jobA).toBeTruthy()
			if (!jobA) throw new Error('First worker failed to find contested offload job')

			workerA.begin(jobA)
			expect(directJobA.looseGood?.available).toBe(false)

			const tileAfterEngagement = game.hex.getTile(target)!
			expect(tileAfterEngagement.availableGoods.length).toBe(0)
			expect(findVehicleOffloadJob(game, workerB)).toBeUndefined()
			expect(workerB.findBestJob()).toBe(false)

			let oneWorkerPickedUp = false
			let maxCarried = 0

			for (let i = 0; i < 55; i++) {
				engine.tick(0.1, 0.1)
				const carried = rocksInTransport(workerA) + rocksInTransport(workerB)
				maxCarried = Math.max(maxCarried, carried)
				if (carried > 0) oneWorkerPickedUp = true
			}

			expect(oneWorkerPickedUp).toBe(true)
			expect(maxCarried).toBe(1)
			expect(game.hex.getTile(target)!.availableGoods.length).toBe(0)
			expect(rocksInTransport(workerA) + rocksInTransport(workerB)).toBe(0)
		} finally {
			await engine.destroy()
		}
	})

	it('Scenario: Removed LooseGood Before Offload Engagement Does Not Assert', {
		timeout: 5000,
	}, async () => {
		const engine = new TestEngine({
			terrainSeed: 1234,
			characterCount: 0,
		})
		await engine.init()
		const game = engine.game
		try {
			const target = { q: 4, r: 4 }
			engine.loadScenario({
				generationOptions: {
					terrainSeed: 1234,
					characterCount: 0,
				},
				looseGoods: [{ goodType: 'stone', position: target }],
				hives: [
					{
						name: 'ContestHive',
						alveoli: [
							{
								coord: [4, 4],
								alveolus: 'tree_chopper',
								goods: {},
							},
						],
					},
				],
			} as any)

			createOffloadWheelbarrow(game, { q: 3, r: 4 }, 'wb-removed')

			const worker = engine.spawnCharacter('Worker', { q: 3, r: 4 })
			worker.role = 'worker'
			void worker.scriptsContext

			void game.hex.getTile(target)!
			const directJob = findVehicleOffloadJob(game, worker)
			expect(directJob?.job).toBe('vehicleOffload')
			if (directJob?.job !== 'vehicleOffload' || directJob.maintenanceKind !== 'loadFromBurden')
				throw new Error('Expected loadFromBurden vehicleOffload job before engagement')

			directJob.looseGood?.remove()

			const action = worker.findBestJob()
			expect(() => {
				if (action) worker.begin(action)
			}).not.toThrow()
		} finally {
			await engine.destroy()
		}
	})

	it('Scenario: Residential Offload Drop Target Must Not Re-Offer Offload', {
		timeout: 25000,
	}, async () => {
		const engine = new TestEngine({
			terrainSeed: 1234,
			characterCount: 0,
		})
		await engine.init()
		const game = engine.game
		try {
			const center = { q: 5, r: 5 }
			const residentialDrop = { q: 4, r: 5 }
			engine.loadScenario({
				generationOptions: {
					terrainSeed: 1234,
					characterCount: 0,
				},
				looseGoods: [{ goodType: 'stone', position: center }],
				hives: [
					{
						name: 'ResidentialLoopHive',
						alveoli: [
							{ coord: [5, 5], alveolus: 'storage', goods: {} },
							{ coord: [6, 5], alveolus: 'storage', goods: {} },
							{ coord: [6, 4], alveolus: 'storage', goods: {} },
							{ coord: [5, 4], alveolus: 'storage', goods: {} },
							{ coord: [4, 6], alveolus: 'storage', goods: {} },
							{ coord: [5, 6], alveolus: 'storage', goods: {} },
						],
					},
				],
				zones: {
					residential: [[4, 5]],
				},
			} as any)

			createOffloadWheelbarrow(game, center, 'wb-residential')

			const worker = engine.spawnCharacter('Worker', center)
			worker.role = 'worker'
			void worker.scriptsContext

			const initialAction = worker.findBestJob()
			expect(initialAction).toBeTruthy()
			if (!initialAction) throw new Error('Expected initial offload action')
			worker.begin(initialAction)

			let time = 0
			let foundTile: Tile | undefined
			while (time < 22) {
				engine.tick(0.1, 0.1)
				if (rocksInTransport(worker) === 0) {
					foundTile = firstTileWithPresentLooseRocks(game)
					if (foundTile) break
				}
				time += 0.1
			}

			expect(foundTile).toBeDefined()
			if (!foundTile) throw new Error('Expected dropped tile to be found')
			expect(
				game.hex.looseGoods
					.getGoodsAt(foundTile.position)
					.some((good) => good.goodType === 'stone' && !good.isRemoved),
				'expected a non-removed loose stone on the dropped tile'
			).toBe(true)
			expect(foundTile.getJob(worker)).toBeUndefined()

			// Verify it didn't drop on residential tile
			const foundCoord = toAxialCoord(foundTile.position)
			expect(foundCoord.q === residentialDrop.q && foundCoord.r === residentialDrop.r).toBe(false)
			expect(foundTile.zone).not.toBe('residential')
			expect(foundTile.content instanceof UnBuiltLand || foundTile.baseTerrain === 'concrete').toBe(
				true
			)
		} finally {
			await engine.destroy()
		}
	})

	it('Scenario: Offloaded Rock Must Stabilize Instead Of Re-Offloading Forever', {
		timeout: 5000,
	}, async () => {
		const engine = new TestEngine({
			terrainSeed: 1234,
			characterCount: 0,
		})
		await engine.init()
		const game = engine.game
		try {
			const center = { q: 5, r: 5 }
			engine.loadScenario({
				generationOptions: {
					terrainSeed: 1234,
					characterCount: 0,
				},
				looseGoods: [{ goodType: 'stone', position: center }],
				hives: [
					{
						name: 'ResidentialDriftHive',
						alveoli: [{ coord: [5, 5], alveolus: 'tree_chopper', goods: {} }],
					},
				],
				zones: {
					residential: [
						[4, 5],
						[4, 4],
						[5, 4],
						[6, 4],
						[6, 5],
						[5, 6],
						[4, 6],
						[3, 5],
						[3, 4],
						[4, 3],
						[5, 3],
						[6, 3],
						[7, 4],
						[7, 5],
						[6, 6],
						[5, 7],
						[4, 7],
						[3, 6],
					],
				},
			} as any)

			createOffloadWheelbarrow(game, center, 'wb-stabilize')

			const worker = engine.spawnCharacter('Worker', center)
			worker.role = 'worker'
			void worker.scriptsContext

			const initialAction = worker.findBestJob()
			expect(initialAction).toBeTruthy()
			if (!initialAction) throw new Error('Expected initial offload action')
			worker.begin(initialAction)

			let firstDropTime = 0
			while (firstDropTime < 8) {
				engine.tick(0.1, 0.1)
				firstDropTime += 0.1
			}

			const seenCoords = new Set<string>()
			const timeline: string[] = []
			let pickedUpAgain = false
			for (let i = 0; i < 65; i++) {
				const carried = rocksInTransport(worker)
				if (carried > 0) pickedUpAgain = true
				const coordLabel = firstLooseRockCoordLabel(game)
				if (coordLabel !== 'none') seenCoords.add(coordLabel)
				timeline.push(
					`${(i * 0.1).toFixed(1)} carried=${carried} loose=${coordLabel} step=${String(worker.stepExecutor?.description ?? 'none')} action=${worker.actionDescription.join('>')}`
				)
				engine.tick(0.1, 0.1)
			}

			expect(pickedUpAgain, timeline.join('\n')).toBe(false)
			expect(seenCoords.size, timeline.join('\n')).toBeLessThanOrEqual(1)
		} finally {
			await engine.destroy()
		}
	})

	it('Scenario: Tree Chopper Adjacent To Trees Must Offer Work Instead Of Leaving Workers To Wander', {
		timeout: 10000,
	}, async () => {
		const engine = new TestEngine({
			terrainSeed: 1234,
			characterCount: 0,
		})
		await engine.init()
		const game = engine.game
		try {
			const workerStart = { q: 5, r: 5 }
			const chopperLocation = { q: 4, r: 5 }
			const treeLocation = { q: 4, r: 4 }
			engine.loadScenario({
				generationOptions: {
					terrainSeed: 1234,
					characterCount: 0,
				},
				tiles: [
					{
						coord: [4, 4],
						deposit: { type: 'tree', name: 'tree', amount: 10 },
						terrain: 'forest',
					},
				],
				hives: [
					{
						name: 'WorkHive',
						alveoli: [{ coord: [4, 5], alveolus: 'tree_chopper', goods: {} }],
					},
				],
			} as any)

			const worker = engine.spawnCharacter('Worker', workerStart)
			worker.role = 'worker'
			void worker.scriptsContext

			const chopperTile = game.hex.getTile(chopperLocation)!
			const directJob = chopperTile.content?.getJob(worker)
			expect(directJob).toBeTruthy()
			expect(directJob?.job).toBe('harvest')

			const action = worker.findAction()
			expect(action).toBeTruthy()
			if (!action) throw new Error('Worker should find harvest work')
			expect(action.name).toBe('work.goWork')

			worker.begin(action)

			let reachedTree = false
			const timeline: string[] = []
			for (let i = 0; i < 80; i++) {
				const coord = toAxialCoord(worker.position)
				timeline.push(
					`${(i * 0.1).toFixed(1)} coord=${coord.q},${coord.r} action=${worker.actionDescription.join('>')} step=${String(worker.stepExecutor?.description ?? 'none')}`
				)
				const tileCoord = toAxialCoord(worker.tile.position)
				if (tileCoord.q === treeLocation.q && tileCoord.r === treeLocation.r) {
					reachedTree = true
					break
				}
				engine.tick(0.1, 0.1)
			}

			expect(reachedTree, timeline.join('\n')).toBe(true)
		} finally {
			await engine.destroy()
		}
	})
})
