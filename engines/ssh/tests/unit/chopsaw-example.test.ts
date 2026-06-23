import { vehicles } from 'engine-rules'
import { Commitment } from 'ssh/commitment'
import { namedTrace, traces } from 'ssh/dev/debug'
import { executeNpcTradeStopTransfer } from 'ssh/freight/npc-trade-stop'
import { collectDockedVehicleAdvertisementCandidates } from 'ssh/freight/vehicle-freight-dock'
import {
	maybeAdvanceVehicleFromCompletedAnchorStop,
	projectedLineStopForVehicleHop,
} from 'ssh/freight/vehicle-run'
import {
	collectVehicleAdvertisedJobs,
	collectVehicleWorkPicks,
	findVehicleHopJob,
	findVehicleOffloadJob,
} from 'ssh/freight/vehicle-work'
import { chopSaw } from 'ssh/game/exampleGames'
import { Game } from 'ssh/game/game'
import { isVehicleLineService } from 'ssh/population/vehicle/vehicle'
import { afterEach, describe, expect, it } from 'vitest'

describe('chopSaw example game', () => {
	let game: Game

	afterEach(() => {
		game.destroy()
	})

	it('serves a cyclic exchange freight line from the freight bay', async () => {
		game = new Game({ terrainSeed: 549, characterCount: 0 }, chopSaw)
		await game.loaded
		game.ticker.stop()

		const lineIds = game.freightLines.map((line) => line.id)
		expect(lineIds).toEqual(
			expect.arrayContaining([
				'ChopSaw:implicit-gather:0,0',
				'ChopSaw:materials-loop:0,0:Melindbury',
			])
		)
		expect(lineIds).not.toContain('ChopSaw:distribute:0,0')

		const exchange = game.freightLines.find((line) => line.id === 'ChopSaw:implicit-gather:0,0')
		expect(exchange?.cyclic).toBe(true)
		expect(exchange?.stops[0]).toMatchObject({
			id: 'ChopSaw:ig-unload',
			loadSelection: {
				goodRules: expect.arrayContaining([{ goodType: 'concrete', effect: 'allow' }]),
			},
			unloadSelection: {
				goodRules: expect.arrayContaining([{ goodType: 'concrete', effect: 'allow' }]),
			},
			anchor: {
				kind: 'alveolus',
				hiveName: 'ChopSaw',
				alveolusType: 'freight_bay',
				coord: [0, 0],
			},
		})
		expect(exchange?.stops[1]).toMatchObject({
			id: 'ChopSaw:ig-load',
			loadSelection: {
				goodRules: expect.arrayContaining([{ goodType: 'concrete', effect: 'allow' }]),
			},
			unloadSelection: {
				goodRules: expect.arrayContaining([{ goodType: 'concrete', effect: 'allow' }]),
			},
			zone: { kind: 'radius', center: [0, 0], radius: 9 },
		})

		const vehicle = game.vehicles.vehicle('ChopSaw:wheelbarrow1')
		expect(vehicle?.servedLines.map((line) => line.id)).toEqual(['ChopSaw:implicit-gather:0,0'])

		const materials = game.freightLines.find(
			(line) => line.id === 'ChopSaw:materials-loop:0,0:Melindbury'
		)
		expect(materials?.cyclic).toBe(true)
		expect(materials?.stops).toHaveLength(2)
		expect(materials?.stops[0]).toMatchObject({
			id: 'ChopSaw:materials-bay',
			loadSelection: {
				goodRules: [{ goodType: 'planks', effect: 'allow' }],
				defaultEffect: 'deny',
			},
			unloadSelection: {
				goodRules: [{ goodType: 'concrete', effect: 'allow' }],
				defaultEffect: 'deny',
			},
			anchor: {
				kind: 'alveolus',
				hiveName: 'ChopSaw',
				alveolusType: 'freight_bay',
				coord: [0, 0],
			},
		})
		expect(materials?.stops[1]).toMatchObject({
			id: 'ChopSaw:materials-melindbury',
			loadSelection: {
				goodRules: [{ goodType: 'concrete', effect: 'allow' }],
				defaultEffect: 'deny',
			},
			unloadSelection: {
				goodRules: [{ goodType: 'planks', effect: 'allow' }],
				defaultEffect: 'deny',
			},
			trade: { kind: 'settlement', settlementId: 'settlement-7,19' },
		})

		const melindbury = game.getSettlementTradeProfile('settlement-7,19')
		expect(melindbury?.name).toBe('Melindbury')
		expect(melindbury?.cityHall.position).toMatchObject({ q: 7, r: 19 })
		expect(melindbury?.offers).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ good: 'concrete', direction: 'sell' }),
				expect.objectContaining({ good: 'planks', direction: 'buy' }),
			])
		)

		const pickup = game.vehicles.vehicle('ChopSaw:suv')
		expect([...game.vehicles].map((vehicle) => vehicle.uid)).toEqual(
			expect.arrayContaining(['ChopSaw:suv'])
		)
		expect(pickup?.vehicleType).toBe('suv')
		expect(pickup?.servedLines.map((line) => line.id)).toEqual([
			'ChopSaw:materials-loop:0,0:Melindbury',
		])
		expect(pickup?.storage.hasRoom('concrete')).toBe(3)
		expect(vehicles.wheelbarrow.movement).toBe('offroad')
		expect(vehicles.suv.movement).toBe('offroad')
		expect(vehicles.pickup_truck.movement).toBe('road')

		expect(game.hex.getRoadType({ q: -2.5, r: 1 })).toBe('path')
		expect(game.hex.getRoadType({ q: -1.5, r: 1 })).toBe('path')
		expect(game.hex.getRoadType({ q: -0.5, r: 1 })).toBe('path')
		expect(game.hex.getRoadType({ q: 0.5, r: 1 })).toBe('path')
	})

	it('loads the starter hive and authored zones', async () => {
		game = new Game({ terrainSeed: 549, characterCount: 0 }, chopSaw)
		await game.loaded
		game.ticker.stop()

		expect(game.hex.getTile({ q: 1, r: -1 })?.content?.name).toBe('engineer')
		expect(game.hex.zoneManager.getZone({ q: 3, r: 0 })).toBe('north-grove')
		expect(game.hex.zoneManager.getZone({ q: -4, r: 1 })).toBe('residential')
	})

	it('does not reclaim a loaded gather wheelbarrow with an empty bay-hop path while it is away from the bay', async () => {
		game = new Game({ terrainSeed: 549, characterCount: 0 }, chopSaw)
		await game.loaded
		game.ticker.stop()

		const vehicle = game.vehicles.vehicle('ChopSaw:wheelbarrow1')
		const line = game.freightLines.find(
			(candidate) => candidate.id === 'ChopSaw:implicit-gather:0,0'
		)
		if (!vehicle || !line) throw new Error('Expected ChopSaw fixture')

		const unloadStop = line.stops.find((stop) => stop.id === 'ChopSaw:ig-unload')
		if (!unloadStop) throw new Error('Expected gather unload stop')

		vehicle.position = { q: -2, r: 1 }
		vehicle.storage.addGood('wood', 1)
		vehicle.beginLineService(line, unloadStop)
		if (vehicle.service) vehicle.service.operator = undefined

		const worker = game.population.createCharacter('Bay Reclaimer', { q: -2, r: 1 })
		const picks = collectVehicleWorkPicks(game, worker)

		expect(picks.map((pick) => pick.job)).not.toContainEqual(
			expect.objectContaining({
				job: 'vehicleHop',

				lineId: 'ChopSaw:implicit-gather:0,0',
				stopId: 'ChopSaw:ig-unload',
				path: [],
				dockEnter: true,
			})
		)
	})

	it('lets the docked gather wheelbarrow leave the bay when dock demand has no convey job', async () => {
		game = new Game({ terrainSeed: 549, characterCount: 0 }, chopSaw)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines.find(
			(candidate) => candidate.id === 'ChopSaw:implicit-gather:0,0'
		)
		const vehicle = game.vehicles.vehicle('ChopSaw:wheelbarrow1')
		const bayTile = game.hex.getTile({ q: 0, r: 0 })
		const zoneTile = game.hex.getTile({ q: -1, r: 0 })
		if (!line || !vehicle || !bayTile || !zoneTile) throw new Error('Expected ChopSaw fixture')

		game.hex.looseGoods.add(bayTile, 'planks')
		game.hex.looseGoods.add(zoneTile, 'wood')
		vehicle.position = bayTile.position
		vehicle.beginLineService(line, line.stops[0]!)
		vehicle.dock()
		for (const other of [...game.vehicles]) {
			if (other.uid !== vehicle.uid) game.vehicles.removeVehicle(other.uid)
		}
		const worker = game.population.createCharacter('Sonden', { q: -4, r: 0 })
		worker.role = 'worker'
		void worker.scriptsContext

		expect(vehicle.advertisedJobs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					job: 'vehicleHop',
					lineId: 'ChopSaw:implicit-gather:0,0',
					stopId: 'ChopSaw:ig-load',
				}),
			])
		)
		expect(
			collectDockedVehicleAdvertisementCandidates(vehicle, bayTile.content as any)
		).not.toEqual(expect.arrayContaining([expect.objectContaining({ advertisement: 'demand' })]))
		expect(worker.resolveBestJobMatch()).toEqual(
			expect.objectContaining({
				job: expect.objectContaining({
					job: 'vehicleHop',
					vehicle,
					lineId: 'ChopSaw:implicit-gather:0,0',
					stopId: 'ChopSaw:ig-load',
				}),
			})
		)
	})

	it('loads stored concrete on the ChopSaw gather unload anchor without offering it back', async () => {
		game = new Game({ terrainSeed: 549, characterCount: 0 }, chopSaw)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines.find(
			(candidate) => candidate.id === 'ChopSaw:implicit-gather:0,0'
		)
		const vehicle = game.vehicles.vehicle('ChopSaw:wheelbarrow1')
		const bay = game.hex.getTile({ q: 0, r: 0 })?.content as any
		const storage = game.hex.getTile({ q: 0, r: -1 })?.content as any
		if (!line || !vehicle || !bay || !storage) throw new Error('Expected ChopSaw fixture')

		storage.storage.addGood('concrete', 2)
		vehicle.position = { q: 0, r: 0 }
		vehicle.beginLineService(line, line.stops[0]!)
		vehicle.dock()

		expect(vehicle.storage.allocated('concrete')).toBeGreaterThan(0)
		expect(
			bay.hive
				.collectActiveMovements()
				.some(
					(movement: any) =>
						movement.goodType === 'concrete' &&
						movement.demander?.vehicle?.uid === vehicle.uid &&
						movement.provider === storage
				)
		).toBe(true)

		const advertised = collectVehicleAdvertisedJobs(game, vehicle)
		expect(advertised).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					job: 'convey',
					source: expect.objectContaining({
						kind: 'alveolus',
						alveolus: storage,
					}),
				}),
			])
		)
		await new Promise((resolve) => setTimeout(resolve, 0))
		await new Promise((resolve) => setTimeout(resolve, 0))
		expect(storage.proposedJobs).toEqual(
			expect.arrayContaining([expect.objectContaining({ job: 'convey' })])
		)
		const worker = game.population.createCharacter('Concrete Dock Worker', { q: 1, r: 2 })
		expect(worker.workPlannerSnapshot?.ranked).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					jobKind: 'convey',
					targetCoord: { q: 0, r: -1 },
				}),
			])
		)

		vehicle.storage.addGood('concrete', 1)
		expect(collectDockedVehicleAdvertisementCandidates(vehicle, bay)).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					goodType: 'concrete',
					advertisement: 'provide',
				}),
			])
		)
	})

	it('releases stale claimed dock concrete loads so workers can pick the convey again', async () => {
		game = new Game({ terrainSeed: 549, characterCount: 0 }, chopSaw)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines.find(
			(candidate) => candidate.id === 'ChopSaw:implicit-gather:0,0'
		)
		const vehicle = game.vehicles.vehicle('ChopSaw:wheelbarrow1')
		const bay = game.hex.getTile({ q: 0, r: 0 })?.content as any
		const storage = game.hex.getTile({ q: 0, r: -1 })?.content as any
		if (!line || !vehicle || !bay || !storage) throw new Error('Expected ChopSaw fixture')

		storage.storage.addGood('concrete', 2)
		vehicle.position = { q: 0, r: 0 }
		vehicle.beginLineService(line, line.stops[0]!)
		vehicle.dock()

		void collectVehicleAdvertisedJobs(game, vehicle)
		const dock = bay.hive.freightVehicleDockFor(vehicle.uid)
		const movement = bay.hive
			.collectActiveMovements()
			.find(
				(candidate: any) =>
					candidate.goodType === 'concrete' &&
					(candidate.provider === dock || candidate.demander === dock)
			)
		if (!movement) throw new Error('Expected active dock concrete movement')

		const staleWorker = game.population.createCharacter('Stale Dock Claimant', { q: 1, r: 2 })
		movement.claimed = true
		movement.claimedBy = staleWorker
		movement.claimedAtMs = Date.now() - 5_000
		bay.hive.invalidateConveyPlanning('test.stale-dock-claim')
		expect(movement.claimed).toBe(true)

		const advertised = collectVehicleAdvertisedJobs(game, vehicle)
		expect(movement.claimed).toBe(false)
		expect(advertised).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					job: 'convey',
					source: expect.objectContaining({ kind: 'alveolus' }),
				}),
			])
		)
		await new Promise((resolve) => setTimeout(resolve, 0))
		await new Promise((resolve) => setTimeout(resolve, 0))
		expect(storage.proposedJobs).toEqual(
			expect.arrayContaining([expect.objectContaining({ job: 'convey' })])
		)
	})

	it('does not warn when a docked gather wheelbarrow keeps concrete reserved for the route', async () => {
		const previousVehicleTrace = traces.vehicle
		const vehicleTrace = namedTrace('vehicle', { silent: true })
		traces.vehicle = vehicleTrace
		try {
			game = new Game({ terrainSeed: 549, characterCount: 0 }, chopSaw)
			await game.loaded
			game.ticker.stop()

			const line = game.freightLines.find(
				(candidate) => candidate.id === 'ChopSaw:implicit-gather:0,0'
			)
			const vehicle = game.vehicles.vehicle('ChopSaw:wheelbarrow1')
			const unloadStop = line?.stops.find((stop) => stop.id === 'ChopSaw:ig-unload')
			const bay = game.hex.getTile({ q: 0, r: 0 })?.content as any
			const storage = game.hex.getTile({ q: 0, r: -1 })?.content as any
			if (!line || !vehicle || !unloadStop || !bay || !storage)
				throw new Error('Expected ChopSaw fixture')
			bay.hive.advertise(storage, storage.goodsRelations)

			vehicle.storage.addGood('concrete', 1)
			vehicle.position = { q: 0, r: 0 }
			vehicle.beginLineService(line, unloadStop)
			vehicle.dock()

			expect(vehicle.advertisedJobs).not.toEqual(
				expect.arrayContaining([expect.objectContaining({ job: 'convey' })])
			)
			expect(vehicleTrace.read()).not.toContain(
				'[vehicle.advertisedJobs] dock work exists but bay has no convey job'
			)
		} finally {
			traces.vehicle = previousVehicleTrace
		}
	})

	it('logs dock target diagnostics when candidates cannot become a convey job', async () => {
		const previousVehicleTrace = traces.vehicle
		const vehicleTrace = namedTrace('vehicle', { silent: true })
		traces.vehicle = vehicleTrace
		try {
			;(globalThis as any).allowExpectedDiagnostics(
				'[vehicle.advertisedJobs] dock work exists but bay has no convey job'
			)
			game = new Game({ terrainSeed: 549, characterCount: 0 }, chopSaw)
			await game.loaded
			game.ticker.stop()

			const line = game.freightLines.find(
				(candidate) => candidate.id === 'ChopSaw:implicit-gather:0,0'
			)
			const vehicle = game.vehicles.vehicle('ChopSaw:wheelbarrow1')
			const unloadStop = line?.stops.find((stop) => stop.id === 'ChopSaw:ig-unload')
			const bay = game.hex.getTile({ q: 0, r: 0 })?.content as any
			const storage = game.hex.getTile({ q: 0, r: -1 })?.content as any
			if (!line || !vehicle || !unloadStop || !bay || !storage)
				throw new Error('Expected ChopSaw fixture')

			const createMovement = bay.hive.createMovement.bind(bay.hive)
			bay.hive.createMovement = () => false
			try {
				bay.hive.advertise(storage, storage.goodsRelations)
				vehicle.storage.addGood('concrete', 1)
				Object.defineProperty(vehicle.storage, 'virtualGoodsCount', {
					configurable: true,
					get: () => 1,
				})
				const dockOnlyLine = {
					...line,
					id: 'ChopSaw:test-dock-only',
					cyclic: false,
					stops: [unloadStop],
				}
				vehicle.position = { q: 0, r: 0 }
				vehicle.beginLineService(dockOnlyLine, unloadStop)
				vehicle.dock()

				expect(collectDockedVehicleAdvertisementCandidates(vehicle, bay)).toEqual(
					expect.arrayContaining([
						expect.objectContaining({ goodType: 'concrete', advertisement: 'provide' }),
					])
				)
				expect(collectVehicleAdvertisedJobs(game, vehicle)).toEqual([])
				const log = vehicleTrace.read()
				expect(log).toContain('[vehicle.advertisedJobs] dock work exists but bay has no convey job')
				expect(log).toContain('candidateTargets:')
				expect(log).toContain('goodType: concrete')
				expect(log).toContain('canTakeFromDock2Use: true')
			} finally {
				bay.hive.createMovement = createMovement
			}
		} finally {
			traces.vehicle = previousVehicleTrace
		}
	})

	it('lets gathered wood ride through when the bay has no current wood sink', async () => {
		game = new Game({ terrainSeed: 549, characterCount: 0 }, chopSaw)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines.find(
			(candidate) => candidate.id === 'ChopSaw:implicit-gather:0,0'
		)
		const vehicle = game.vehicles.vehicle('ChopSaw:wheelbarrow1')
		const bay = game.hex.getTile({ q: 0, r: 0 })?.content as any
		if (!line || !vehicle || !bay) throw new Error('Expected ChopSaw fixture')

		const unloadStop = line.stops.find((stop) => stop.id === 'ChopSaw:ig-unload')
		if (!unloadStop) throw new Error('Expected gather unload stop')

		vehicle.position = { q: 0, r: 0 }
		vehicle.storage.addGood('wood', 1)
		vehicle.beginLineService(line, unloadStop)
		vehicle.dock()

		const candidates = collectDockedVehicleAdvertisementCandidates(vehicle, bay)
		expect(candidates).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ goodType: 'wood', advertisement: 'provide' }),
			])
		)
		expect(collectVehicleAdvertisedJobs(game, vehicle).length).toBeGreaterThan(0)
	})

	it('cleans stale dock reservations so advertised jobs can recover', async () => {
		game = new Game({ terrainSeed: 549, characterCount: 0 }, chopSaw)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines.find(
			(candidate) => candidate.id === 'ChopSaw:implicit-gather:0,0'
		)
		const vehicle = game.vehicles.vehicle('ChopSaw:wheelbarrow1')
		const bay = game.hex.getTile({ q: 0, r: 0 })?.content as any
		if (!line || !vehicle || !bay) throw new Error('Expected ChopSaw fixture')

		const unloadStop = line.stops.find((stop) => stop.id === 'ChopSaw:ig-unload')
		if (!unloadStop) throw new Error('Expected gather unload stop')

		vehicle.position = { q: 0, r: 0 }
		vehicle.storage.addGood('wood', 1)
		vehicle.beginLineService(line, unloadStop)
		vehicle.dock()

		const dock = bay.hive.freightVehicleDockFor(vehicle.uid)
		if (!dock) throw new Error('Expected dock registration')
		void collectVehicleAdvertisedJobs(game, vehicle)
		expect(vehicle.storage.virtualGoodsCount).toBe(1)
		for (const movement of bay.hive.collectActiveMovements()) {
			if (movement.provider !== dock && movement.demander !== dock) continue
			;(bay.hive as any).activeMovements.delete(movement)
			const bucket = bay.hive.movingGoods.get(movement.from)
			const index = bucket?.indexOf(movement) ?? -1
			if (bucket && index >= 0) bucket.splice(index, 1)
		}

		expect(collectVehicleAdvertisedJobs(game, vehicle).length).toBeGreaterThan(0)
		expect(bay.hive.hasActiveFreightVehicleDockMovement(vehicle.uid)).toBe(true)
	})

	it('offers a concrete distribution hop from a loaded active ChopSaw wheelbarrow', async () => {
		game = new Game({ terrainSeed: 549, characterCount: 0 }, chopSaw)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines.find(
			(candidate) => candidate.id === 'ChopSaw:implicit-gather:0,0'
		)
		const load = line?.stops.find((stop) => stop.id === 'ChopSaw:ig-load')
		const vehicle = game.vehicles.vehicle('ChopSaw:wheelbarrow1')
		if (!line || !load || !vehicle) throw new Error('Expected ChopSaw fixture')

		vehicle.storage.addGood('concrete', 2)
		vehicle.position = { q: 0, r: 0 }
		vehicle.beginLineService(line, load)

		const worker = game.population.createCharacter('ConcreteRunner', { q: -4, r: -1 })
		worker.role = 'worker'
		void worker.scriptsContext

		expect(collectVehicleWorkPicks(game, worker)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					job: expect.objectContaining({
						job: 'vehicleHop',
						vehicle,
						lineId: line.id,
						stopId: load.id,
						zoneBrowseAction: 'provide',
						goodType: 'concrete',
					}),
				}),
			])
		)
	})

	it('advances a docked gather wheelbarrow with only downstream-reserved cargo', async () => {
		game = new Game({ terrainSeed: 549, characterCount: 0 }, chopSaw)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines.find(
			(candidate) => candidate.id === 'ChopSaw:implicit-gather:0,0'
		)
		if (!line) throw new Error('expected ChopSaw implicit gather line')
		const unload = line.stops.find((stop) => stop.id === 'ChopSaw:ig-unload')
		const load = line.stops.find((stop) => stop.id === 'ChopSaw:ig-load')
		if (!unload || !load) throw new Error('expected ChopSaw load/unload stops')
		const vehicle = game.vehicles.vehicle('ChopSaw:wheelbarrow1')
		if (!vehicle) throw new Error('expected ChopSaw wheelbarrow')

		vehicle.storage.addGood('concrete', 1)
		const downstreamReservation = new Commitment('test.downstream-reserved-concrete')
		expect(vehicle.storage.reserve({ concrete: 1 }, downstreamReservation)).toBeUndefined()
		expect(vehicle.storage.virtualGoodsCount).toBe(1)

		vehicle.position = { q: 0, r: 0 }
		vehicle.beginLineService(line, unload)
		vehicle.dock()

		maybeAdvanceVehicleFromCompletedAnchorStop(game, vehicle)

		expect(isVehicleLineService(vehicle.service) && vehicle.service.stop.id).toBe(load.id)
		downstreamReservation.cancel('test cleanup')
	})

	it('lets a worker pick the storage convey when a docked wheelbarrow has reserved concrete', async () => {
		game = new Game({ terrainSeed: 549, characterCount: 0 }, chopSaw)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines.find(
			(candidate) => candidate.id === 'ChopSaw:implicit-gather:0,0'
		)
		if (!line) throw new Error('expected ChopSaw implicit gather line')
		const unload = line.stops.find((stop) => stop.id === 'ChopSaw:ig-unload')
		if (!unload) throw new Error('expected ChopSaw unload stop')
		const vehicle = game.vehicles.vehicle('ChopSaw:wheelbarrow1')
		const bay = game.hex.getTile({ q: 0, r: 0 })?.content as any
		const storage = game.hex.getTile({ q: 0, r: -1 })?.content as any
		if (!vehicle || !bay || !storage) throw new Error('expected ChopSaw dock fixture')

		storage.storage.addGood('concrete', 1)

		vehicle.position = { q: 0, r: 0 }
		vehicle.beginLineService(line, unload)
		vehicle.dock()
		expect(vehicle.storage.allocated('concrete')).toBe(1)

		vehicle.storage.addGood('concrete', 1)

		expect(vehicle.storage.stock.concrete).toBe(1)
		expect(vehicle.storage.allocated('concrete')).toBe(1)
		expect(vehicle.storage.virtualGoodsCount).toBe(1)
		const advertised = vehicle.advertisedJobs
		expect(advertised).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					job: 'convey',
					source: expect.objectContaining({ kind: 'alveolus', alveolus: storage }),
					targetTile: storage.tile,
				}),
			])
		)

		const worker = game.population.createCharacter('Concrete Dock Worker', { q: 0, r: -1 })
		expect(worker.workPlannerSnapshot?.ranked).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					jobKind: 'convey',
					targetCoord: { q: 0, r: -1 },
				}),
			])
		)
	})

	it('uses the materials loop as a concrete import and planks export fixture', async () => {
		game = new Game({ terrainSeed: 549, characterCount: 0 }, chopSaw)
		await game.loaded
		game.ticker.stop()
		game.setPlayerAccountBalance(1000)

		const line = game.freightLines.find(
			(candidate) => candidate.id === 'ChopSaw:materials-loop:0,0:Melindbury'
		)
		if (!line) throw new Error('Expected Chopsaw materials loop')
		const marketStop = line.stops.find((stop) => 'trade' in stop)
		if (!marketStop) throw new Error('Expected Melindbury trade stop')
		const pickup = game.vehicles.vehicle('ChopSaw:suv')
		if (!pickup) throw new Error('Expected Chopsaw SUV')
		pickup.storage.addGood('planks', 1)

		const result = executeNpcTradeStopTransfer({
			game,
			vehicle: pickup,
			line,
			stop: marketStop,
		})

		expect(result.exported.planks).toBe(1)
		expect(result.imported.concrete ?? 0).toBeGreaterThan(0)
		expect(result.creditedVp).toBeGreaterThan(0)
		expect(result.spentVp).toBeGreaterThan(0)
		expect(pickup.storage.stock.concrete ?? 0).toBeGreaterThan(0)
		expect(pickup.storage.stock.planks ?? 0).toBe(0)
	})

	it('offers the materials SUV even when the settlement stop is outside the local path graph', async () => {
		game = new Game({ terrainSeed: 549, characterCount: 0 }, chopSaw)
		await game.loaded
		game.ticker.stop()
		game.setPlayerAccountBalance(1000)

		const pickup = game.vehicles.vehicle('ChopSaw:suv')
		if (!pickup) throw new Error('Expected Chopsaw SUV')
		const melindbury = game.getSettlementTradeProfile('settlement-7,19')
		if (!melindbury) throw new Error('Expected Melindbury trade profile')
		expect(
			game.hex.findPathForVehicleServiceBorder(
				pickup.effectivePosition,
				melindbury.cityHall.position,
				Number.POSITIVE_INFINITY
			)
		).toBeUndefined()

		const worker = game.population.createCharacter('Materials Runner', { q: 0, r: 0 })
		const picks = collectVehicleWorkPicks(game, worker)

		expect(picks.map((pick) => pick.job)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					job: 'vehicleHop',

					lineId: 'ChopSaw:materials-loop:0,0:Melindbury',
					stopId: 'ChopSaw:materials-melindbury',
					needsBeginService: true,
				}),
			])
		)
	})

	it('advances a virtual trade stop back to the real bay once imports are loaded', async () => {
		game = new Game({ terrainSeed: 549, characterCount: 0 }, chopSaw)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines.find(
			(candidate) => candidate.id === 'ChopSaw:materials-loop:0,0:Melindbury'
		)
		if (!line) throw new Error('Expected Chopsaw materials loop')
		const marketStop = line.stops.find((stop) => stop.id === 'ChopSaw:materials-melindbury')
		if (!marketStop) throw new Error('Expected Melindbury trade stop')
		const bayStop = line.stops.find((stop) => stop.id === 'ChopSaw:materials-bay')
		if (!bayStop) throw new Error('Expected Chopsaw materials bay stop')
		const pickup = game.vehicles.vehicle('ChopSaw:suv')
		if (!pickup) throw new Error('Expected Chopsaw SUV')
		const storage = game.hex.getTile({ q: 0, r: -1 })?.content as any
		const worker = game.population.createCharacter('Materials Driver', { q: -1, r: 0 })

		storage.storage.addGood('concrete', 2)
		pickup.position = { q: -1, r: 0 }
		pickup.storage.addGood('concrete', 1)
		pickup.beginLineService(line, marketStop, worker)
		worker.setOperatedVehicleFromService(pickup)
		worker.onboard()

		expect(projectedLineStopForVehicleHop(game, worker, pickup)?.stop.id).toBe(bayStop.id)
		expect(findVehicleHopJob(game, worker)).toMatchObject({
			job: 'vehicleHop',
			lineId: line.id,
			stopId: bayStop.id,
			dockEnter: true,
		})
	})

	it('does not use the materials SUV as a generic local offload vehicle', async () => {
		game = new Game({ terrainSeed: 549, characterCount: 0 }, chopSaw)
		await game.loaded
		game.ticker.stop()

		const pickup = game.vehicles.vehicle('ChopSaw:suv')
		if (!pickup) throw new Error('Expected Chopsaw SUV')
		const worker = game.population.createCharacter('Materials Offload Probe', { q: -1, r: 0 })
		pickup.position = { q: -1, r: 0 }
		pickup.storage.addGood('concrete', 1)

		expect(findVehicleOffloadJob(game, worker)?.vehicle?.uid).not.toBe(pickup.uid)
	})

	it('keeps loaded ChopSaw wheelbarrow cargo for zone provide after a full bay dock', async () => {
		game = new Game({ terrainSeed: 549, characterCount: 0 }, chopSaw)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines.find(
			(candidate) => candidate.id === 'ChopSaw:implicit-gather:0,0'
		)
		if (!line) throw new Error('expected ChopSaw implicit gather line')
		const unload = line.stops.find((stop) => stop.id === 'ChopSaw:ig-unload')
		const load = line.stops.find((stop) => stop.id === 'ChopSaw:ig-load')
		if (!unload || !load) throw new Error('expected ChopSaw load/unload stops')
		const vehicle = game.vehicles.vehicle('ChopSaw:wheelbarrow1')
		if (!vehicle) throw new Error('expected ChopSaw wheelbarrow')
		const storage = game.hex.getTile({ q: 0, r: -1 })?.content as any
		const worker = game.population.createCharacter('Concrete Provider', { q: 0, r: 0 })

		storage.storage.addGood('concrete', 12)
		vehicle.storage.addGood('concrete', 1)
		vehicle.beginLineService(line, unload, worker)
		vehicle.dock()

		maybeAdvanceVehicleFromCompletedAnchorStop(game, vehicle, worker)

		expect(isVehicleLineService(vehicle.service) && vehicle.service.stop.id).toBe(load.id)
		const hop = findVehicleHopJob(game, worker)
		expect(hop).toMatchObject({
			job: 'vehicleHop',
			vehicle,
			lineId: line.id,
			stopId: load.id,
			zoneBrowseAction: 'provide',
			goodType: 'concrete',
			targetCoord: { q: -1, r: 0 },
		})
	})

	it('imports only buffered concrete demand, not extra storage room', async () => {
		game = new Game({ terrainSeed: 549, characterCount: 0 }, chopSaw)
		await game.loaded
		game.ticker.stop()
		game.setPlayerAccountBalance(1000)

		const line = game.freightLines.find(
			(candidate) => candidate.id === 'ChopSaw:materials-loop:0,0:Melindbury'
		)
		if (!line) throw new Error('Expected Chopsaw materials loop')
		const marketStop = line.stops.find((stop) => 'trade' in stop)
		if (!marketStop) throw new Error('Expected Melindbury trade stop')
		const pickup = game.vehicles.vehicle('ChopSaw:suv')
		if (!pickup) throw new Error('Expected Chopsaw SUV')

		const result = executeNpcTradeStopTransfer({
			game,
			vehicle: pickup,
			line,
			stop: marketStop,
		})

		expect(result.imported.concrete).toBe(3)
		expect(pickup.storage.stock.concrete).toBe(3)
	})

	it('keeps offering concrete from a full materials SUV while configured storage demands it', async () => {
		game = new Game({ terrainSeed: 549, characterCount: 0 }, chopSaw)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines.find(
			(candidate) => candidate.id === 'ChopSaw:materials-loop:0,0:Melindbury'
		)
		if (!line) throw new Error('Expected Chopsaw materials loop')
		const bayStop = line.stops.find((stop) => stop.id === 'ChopSaw:materials-bay')
		if (!bayStop) throw new Error('Expected Chopsaw materials bay stop')
		const pickup = game.vehicles.vehicle('ChopSaw:suv')
		if (!pickup) throw new Error('Expected Chopsaw SUV')
		const bay = game.hex.getTile({ q: 0, r: 0 })?.content as any
		const storage = game.hex.getTile({ q: 0, r: -1 })?.content as any

		pickup.storage.addGood('concrete', 6)
		pickup.position = { q: 0, r: 0 }
		pickup.beginLineService(line, bayStop)
		if (!isVehicleLineService(pickup.service)) throw new Error('expected line service')
		pickup.service.docked = true
		pickup.position = undefined

		expect(storage.acceptedRoomFor('concrete', '0-store')).toBeGreaterThan(0)
		expect(collectDockedVehicleAdvertisementCandidates(pickup, bay)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					goodType: 'concrete',
					advertisement: 'provide',
				}),
			])
		)

		expect(pickup.storage.stock.concrete).toBe(3)
		expect(storage.storage.stock.concrete ?? 0).toBe(0)
	})

	it('does not reserve the last concrete for generic storage room', async () => {
		game = new Game({ terrainSeed: 549, characterCount: 0 }, chopSaw)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines.find(
			(candidate) => candidate.id === 'ChopSaw:materials-loop:0,0:Melindbury'
		)
		if (!line) throw new Error('Expected Chopsaw materials loop')
		const bayStop = line.stops.find((stop) => stop.id === 'ChopSaw:materials-bay')
		if (!bayStop) throw new Error('Expected Chopsaw materials bay stop')
		const pickup = game.vehicles.vehicle('ChopSaw:suv')
		if (!pickup) throw new Error('Expected Chopsaw SUV')
		const bay = game.hex.getTile({ q: 0, r: 0 })?.content as any
		const storage = game.hex.getTile({ q: 0, r: -1 })?.content as any

		storage.storage.addGood('concrete', 3)
		expect(storage.acceptedRoomFor('concrete', '0-store')).toBeGreaterThan(0)
		pickup.storage.addGood('concrete', 1)
		pickup.position = { q: 0, r: 0 }
		pickup.beginLineService(line, bayStop)
		pickup.dock()

		void pickup.advertisedJobs
		await new Promise((resolve) => setTimeout(resolve, 10))

		expect(pickup.storage.virtualGoodsCount).toBe(0)
		expect(
			bay.hive
				.collectActiveMovements()
				.some(
					(movement: any) =>
						movement.goodType === 'concrete' &&
						movement.provider?.vehicle?.uid === pickup.uid &&
						!movement.claimed
				)
		).toBe(false)
		expect(pickup.advertisedJobs).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					job: 'convey',
					source: expect.objectContaining({
						kind: 'alveolus',
						alveolus: bay,
					}),
				}),
			])
		)
	})

	it('ends the materials SUV line at the bay when storage has room but no downstream demand', async () => {
		game = new Game({ terrainSeed: 549, characterCount: 0 }, chopSaw)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines.find(
			(candidate) => candidate.id === 'ChopSaw:materials-loop:0,0:Melindbury'
		)
		if (!line) throw new Error('Expected Chopsaw materials loop')
		const bayStop = line.stops.find((stop) => stop.id === 'ChopSaw:materials-bay')
		if (!bayStop) throw new Error('Expected Chopsaw materials bay stop')
		const pickup = game.vehicles.vehicle('ChopSaw:suv')
		if (!pickup) throw new Error('Expected Chopsaw SUV')
		const storage = game.hex.getTile({ q: 0, r: -1 })?.content as any
		const worker = game.population.createCharacter('BayCloser', { q: 0, r: 0 })

		storage.storage.addGood('concrete', 6)
		expect(storage.acceptedRoomFor('concrete', '0-store')).toBeGreaterThan(0)
		pickup.position = { q: 0, r: 0 }
		pickup.beginLineService(line, bayStop)
		pickup.dock()

		maybeAdvanceVehicleFromCompletedAnchorStop(game, pickup, worker)

		expect(pickup.service).toBeUndefined()
	})

	it('offers a dock job for an undocked line vehicle already sitting on its bay anchor', async () => {
		game = new Game({ terrainSeed: 549, characterCount: 0 }, chopSaw)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines.find(
			(candidate) => candidate.id === 'ChopSaw:materials-loop:0,0:Melindbury'
		)
		if (!line) throw new Error('Expected Chopsaw materials loop')
		const bayStop = line.stops.find((stop) => stop.id === 'ChopSaw:materials-bay')
		if (!bayStop) throw new Error('Expected Chopsaw materials bay stop')
		const pickup = game.vehicles.vehicle('ChopSaw:suv')
		if (!pickup) throw new Error('Expected Chopsaw SUV')
		const worker = game.population.createCharacter('Docking Driver', { q: 0, r: 0 })

		pickup.position = { q: 0, r: 0 }
		pickup.beginLineService(line, bayStop)

		expect(pickup.isDocked).toBe(false)
		expect(pickup.advertisedJobs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					job: 'vehicleHop',
					lineId: line.id,
					stopId: bayStop.id,
					dockEnter: true,
				}),
			])
		)
		expect(findVehicleHopJob(game, worker)).toEqual(
			expect.objectContaining({
				job: 'vehicleHop',
				lineId: line.id,
				stopId: bayStop.id,
				dockEnter: true,
			})
		)
	})

	it('lets the gather bay notice offloaded wood that storage can still accept', async () => {
		game = new Game(
			{ terrainSeed: 549, characterCount: 0 },
			{
				hives: [
					{
						name: 'GatherStore',
						alveoli: [
							{ alveolus: 'freight_bay', coord: [0, 0] },
							{
								alveolus: 'storage',
								coord: [1, 0],
								configuration: {
									ref: { scope: 'individual' },
									individual: { working: true, generalSlots: 2, goods: {} },
								},
							},
						],
					},
				],
				freightLines: [
					{
						id: 'GatherStore:gather-wood',
						name: 'GatherStore wood',
						cyclic: true,
						stops: [
							{
								id: 'GatherStore:gather-wood-zone',
								loadSelection: {
									goodRules: [{ goodType: 'wood', effect: 'allow' }],
									tagRules: [],
									defaultEffect: 'deny',
								},
								zone: { kind: 'radius', center: [0, 0], radius: 2 },
							},
							{
								id: 'GatherStore:gather-wood-bay',
								anchor: {
									kind: 'alveolus',
									hiveName: 'GatherStore',
									alveolusType: 'freight_bay',
									coord: [0, 0],
								},
							},
						],
					},
				],
			}
		)
		await game.loaded
		game.ticker.stop()

		const bay = game.hex.getTile({ q: 0, r: 0 })?.content as any
		const zoneTile = game.hex.getTile({ q: 0, r: 1 })
		if (!bay || !zoneTile) throw new Error('Expected gather fixture')

		game.hex.looseGoods.add(zoneTile, 'wood')

		expect(bay.hasLooseGoodsToGather).toBe(true)
	})

	it('loads planks from the ChopSaw bay into the materials SUV for Melindbury export', async () => {
		game = new Game({ terrainSeed: 549, characterCount: 0 }, chopSaw)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines.find(
			(candidate) => candidate.id === 'ChopSaw:materials-loop:0,0:Melindbury'
		)
		if (!line) throw new Error('Expected Chopsaw materials loop')
		const bayStop = line.stops.find((stop) => stop.id === 'ChopSaw:materials-bay')
		if (!bayStop) throw new Error('Expected Chopsaw materials bay stop')
		const pickup = game.vehicles.vehicle('ChopSaw:suv')
		if (!pickup) throw new Error('Expected Chopsaw SUV')
		const bay = game.hex.getTile({ q: 0, r: 0 })?.content as any
		const storage = game.hex.getTile({ q: 0, r: -1 })?.content as any
		storage.storage.addGood('planks', 2)

		pickup.position = { q: 0, r: 0 }
		pickup.beginLineService(line, bayStop)
		pickup.dock()

		expect(collectDockedVehicleAdvertisementCandidates(pickup, bay)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ goodType: 'planks', advertisement: 'demand' }),
			])
		)
		await new Promise((resolve) => setTimeout(resolve, 0))
		await new Promise((resolve) => setTimeout(resolve, 0))
		expect(
			bay.hive.collectActiveMovements().map((movement: any) => ({
				goodType: movement.goodType,
				provider: movement.provider?.name,
				demander: movement.demander?.name,
				pathLength: movement.path?.length,
			}))
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					goodType: 'planks',
					demander: `vehicle-dock:${pickup.uid}`,
				}),
			])
		)
		expect(storage.proposedJobs).toEqual(
			expect.arrayContaining([expect.objectContaining({ job: 'convey' })])
		)
	})

	it('does not park the active materials SUV while it is still on the line', async () => {
		game = new Game({ terrainSeed: 549, characterCount: 0 }, chopSaw)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines.find(
			(candidate) => candidate.id === 'ChopSaw:materials-loop:0,0:Melindbury'
		)
		if (!line) throw new Error('Expected Chopsaw materials loop')
		const bayStop = line.stops.find((stop) => stop.id === 'ChopSaw:materials-bay')
		if (!bayStop) throw new Error('Expected Chopsaw materials bay stop')
		const pickup = game.vehicles.vehicle('ChopSaw:suv')
		if (!pickup) throw new Error('Expected Chopsaw SUV')
		for (const vehicle of [...game.vehicles]) {
			if (vehicle.uid !== pickup.uid) game.vehicles.removeVehicle(vehicle.uid)
		}
		const worker = game.population.createCharacter('Heaget', { q: 0, r: 0 })
		worker.role = 'worker'
		void worker.scriptsContext

		pickup.position = { q: 0, r: 0 }
		pickup.beginLineService(line, bayStop)

		expect(pickup.isDocked).toBe(false)
		expect(isVehicleLineService(pickup.service)).toBe(true)
		expect(findVehicleOffloadJob(game, worker)).toBeUndefined()

		const match = worker.resolveBestJobMatch()
		expect(
			match && match.job.job === 'vehicleOffload' && match.job.vehicle?.uid === pickup.uid
		).toBe(false)
	})

	it('worker conveys planks from ChopSaw storage into the docked materials SUV', async () => {
		game = new Game({ terrainSeed: 549, characterCount: 0 }, chopSaw)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines.find(
			(candidate) => candidate.id === 'ChopSaw:materials-loop:0,0:Melindbury'
		)
		if (!line) throw new Error('Expected Chopsaw materials loop')
		const bayStop = line.stops.find((stop) => stop.id === 'ChopSaw:materials-bay')
		if (!bayStop) throw new Error('Expected Chopsaw materials bay stop')
		const pickup = game.vehicles.vehicle('ChopSaw:suv')
		if (!pickup) throw new Error('Expected Chopsaw SUV')
		const storage = game.hex.getTile({ q: 0, r: -1 })?.content as any
		storage.storage.addGood('planks', 2)
		const worker = game.population.createCharacter('PlankLoader', { q: 0, r: -1 })
		worker.role = 'worker'
		void worker.scriptsContext

		pickup.position = { q: 0, r: 0 }
		pickup.beginLineService(line, bayStop)
		pickup.dock()

		const timeline: string[] = []
		for (let i = 0; i < 200 && (pickup.storage.stock.planks ?? 0) <= 0; i++) {
			game.ticker.update(250)
			if (i % 10 === 0) await new Promise((resolve) => setTimeout(resolve, 0))
			if (i % 20 === 0) {
				timeline.push(
					[
						`i=${i}`,
						`pickup=${pickup.storage.stock.planks ?? 0}`,
						`storage=${storage.storage.stock.planks ?? 0}`,
						`action=${worker.actionDescription.join('/') || 'none'}`,
						`storageJobs=${storage.proposedJobs.map((job: any) => job.job).join(',') || 'none'}`,
						`bayJobs=${
							game.hex
								.getTile({ q: 0, r: 0 })
								?.content?.proposedJobs?.map((job: any) => job.job)
								.join(',') || 'none'
						}`,
						`movements=${
							storage.hive
								.collectActiveMovements()
								.map(
									(movement: any) =>
										`${movement.goodType}:${movement.provider?.name}->${movement.demander?.name}:claimed=${movement.claimed}:path=${movement.path.length}`
								)
								.join('|') || 'none'
						}`,
					].join(' ')
				)
			}
		}

		expect(pickup.storage.stock.planks ?? 0, timeline.join('\n')).toBeGreaterThan(0)
	})
})
