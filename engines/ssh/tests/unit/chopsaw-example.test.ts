import { chopSaw } from 'ssh/game/exampleGames'
import { executeNpcTradeStopTransfer } from 'ssh/freight/npc-trade-stop'
import { collectDockedVehicleAdvertisementCandidates } from 'ssh/freight/vehicle-freight-dock'
import { findVehicleOffloadJob } from 'ssh/freight/vehicle-work'
import { maybeAdvanceVehicleFromCompletedAnchorStop } from 'ssh/freight/vehicle-run'
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

		const vehicle = game.vehicles.vehicle('ChopSaw:wheelbarrow')
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

		const pickup = game.vehicles.vehicle('ChopSaw:pickup-truck')
		expect([...game.vehicles].map((vehicle) => vehicle.uid)).toEqual(
			expect.arrayContaining(['ChopSaw:pickup-truck'])
		)
		expect(pickup?.vehicleType).toBe('pickup_truck')
		expect(pickup?.servedLines.map((line) => line.id)).toEqual([
			'ChopSaw:materials-loop:0,0:Melindbury',
		])
		expect(pickup?.storage.hasRoom('concrete')).toBe(6)

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

	it('lets the docked gather wheelbarrow leave the bay when dock demand has no convey job', async () => {
		game = new Game({ terrainSeed: 549, characterCount: 0 }, chopSaw)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines.find((candidate) => candidate.id === 'ChopSaw:implicit-gather:0,0')
		const vehicle = game.vehicles.vehicle('ChopSaw:wheelbarrow')
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
		expect(worker.resolveBestJobMatch()).toEqual(
			expect.objectContaining({
				job: expect.objectContaining({
					job: 'vehicleHop',
					vehicleUid: vehicle.uid,
					lineId: 'ChopSaw:implicit-gather:0,0',
					stopId: 'ChopSaw:ig-load',
				}),
			})
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
		const pickup = game.vehicles.vehicle('ChopSaw:pickup-truck')
		if (!pickup) throw new Error('Expected Chopsaw pickup truck')
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
		const pickup = game.vehicles.vehicle('ChopSaw:pickup-truck')
		if (!pickup) throw new Error('Expected Chopsaw pickup truck')

		const result = executeNpcTradeStopTransfer({
			game,
			vehicle: pickup,
			line,
			stop: marketStop,
		})

		expect(result.imported.concrete).toBe(3)
		expect(pickup.storage.stock.concrete).toBe(3)
	})

	it('keeps offering concrete from a full materials pickup while configured storage can accept it', async () => {
		game = new Game({ terrainSeed: 549, characterCount: 0 }, chopSaw)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines.find(
			(candidate) => candidate.id === 'ChopSaw:materials-loop:0,0:Melindbury'
		)
		if (!line) throw new Error('Expected Chopsaw materials loop')
		const bayStop = line.stops.find((stop) => stop.id === 'ChopSaw:materials-bay')
		if (!bayStop) throw new Error('Expected Chopsaw materials bay stop')
		const pickup = game.vehicles.vehicle('ChopSaw:pickup-truck')
		if (!pickup) throw new Error('Expected Chopsaw pickup truck')
		const bay = game.hex.getTile({ q: 0, r: 0 })?.content as any
		const storage = game.hex.getTile({ q: 0, r: -1 })?.content as any

		pickup.storage.addGood('concrete', 6)
		pickup.position = { q: 0, r: 0 }
		pickup.beginLineService(line, bayStop)
		if (!isVehicleLineService(pickup.service)) throw new Error('expected line service')
		pickup.service.docked = true
		pickup.position = undefined

		for (let offloaded = 0; offloaded < 4; offloaded++) {
			expect(storage.acceptedRoomFor('concrete', '0-store')).toBeGreaterThan(0)
			const candidates = collectDockedVehicleAdvertisementCandidates(pickup, bay)
			expect(candidates).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						goodType: 'concrete',
						advertisement: 'provide',
					}),
				])
			)

			expect(pickup.storage.removeGood('concrete', 1)).toBe(1)
			expect(storage.storage.addGood('concrete', 1)).toBe(1)
		}

		expect(pickup.storage.stock.concrete).toBe(2)
		expect(storage.storage.stock.concrete).toBe(4)
	})

	it('advertises convey for the last reserved concrete while storage still has room', async () => {
		game = new Game({ terrainSeed: 549, characterCount: 0 }, chopSaw)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines.find(
			(candidate) => candidate.id === 'ChopSaw:materials-loop:0,0:Melindbury'
		)
		if (!line) throw new Error('Expected Chopsaw materials loop')
		const bayStop = line.stops.find((stop) => stop.id === 'ChopSaw:materials-bay')
		if (!bayStop) throw new Error('Expected Chopsaw materials bay stop')
		const pickup = game.vehicles.vehicle('ChopSaw:pickup-truck')
		if (!pickup) throw new Error('Expected Chopsaw pickup truck')
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

		expect(pickup.storage.virtualGoodsCount).toBe(1)
		expect(
			bay.hive.collectActiveMovements().some(
				(movement: any) =>
					movement.goodType === 'concrete' &&
					movement.provider?.vehicle?.uid === pickup.uid &&
					!movement.claimed
			)
		).toBe(true)
		expect(pickup.advertisedJobs).toEqual(
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

	it('ends the materials pickup line at the bay when storage has room but no downstream demand', async () => {
		game = new Game({ terrainSeed: 549, characterCount: 0 }, chopSaw)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines.find(
			(candidate) => candidate.id === 'ChopSaw:materials-loop:0,0:Melindbury'
		)
		if (!line) throw new Error('Expected Chopsaw materials loop')
		const bayStop = line.stops.find((stop) => stop.id === 'ChopSaw:materials-bay')
		if (!bayStop) throw new Error('Expected Chopsaw materials bay stop')
		const pickup = game.vehicles.vehicle('ChopSaw:pickup-truck')
		if (!pickup) throw new Error('Expected Chopsaw pickup truck')
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

	it('loads planks from the ChopSaw bay into the materials pickup for Melindbury export', async () => {
		game = new Game({ terrainSeed: 549, characterCount: 0 }, chopSaw)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines.find(
			(candidate) => candidate.id === 'ChopSaw:materials-loop:0,0:Melindbury'
		)
		if (!line) throw new Error('Expected Chopsaw materials loop')
		const bayStop = line.stops.find((stop) => stop.id === 'ChopSaw:materials-bay')
		if (!bayStop) throw new Error('Expected Chopsaw materials bay stop')
		const pickup = game.vehicles.vehicle('ChopSaw:pickup-truck')
		if (!pickup) throw new Error('Expected Chopsaw pickup truck')
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

	it('does not park the active materials pickup while it is still on the line', async () => {
		game = new Game({ terrainSeed: 549, characterCount: 0 }, chopSaw)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines.find(
			(candidate) => candidate.id === 'ChopSaw:materials-loop:0,0:Melindbury'
		)
		if (!line) throw new Error('Expected Chopsaw materials loop')
		const bayStop = line.stops.find((stop) => stop.id === 'ChopSaw:materials-bay')
		if (!bayStop) throw new Error('Expected Chopsaw materials bay stop')
		const pickup = game.vehicles.vehicle('ChopSaw:pickup-truck')
		if (!pickup) throw new Error('Expected Chopsaw pickup truck')
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
		expect(match && match.job.job === 'vehicleOffload' && match.job.vehicleUid === pickup.uid).toBe(
			false
		)
	})

	it('worker conveys planks from ChopSaw storage into the docked materials pickup', async () => {
		game = new Game({ terrainSeed: 549, characterCount: 0 }, chopSaw)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines.find(
			(candidate) => candidate.id === 'ChopSaw:materials-loop:0,0:Melindbury'
		)
		if (!line) throw new Error('Expected Chopsaw materials loop')
		const bayStop = line.stops.find((stop) => stop.id === 'ChopSaw:materials-bay')
		if (!bayStop) throw new Error('Expected Chopsaw materials bay stop')
		const pickup = game.vehicles.vehicle('ChopSaw:pickup-truck')
		if (!pickup) throw new Error('Expected Chopsaw pickup truck')
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
						`movements=${storage.hive
							.collectActiveMovements()
							.map(
								(movement: any) =>
									`${movement.goodType}:${movement.provider?.name}->${movement.demander?.name}:claimed=${movement.claimed}:path=${movement.path.length}`
							)
							.join('|') || 'none'}`,
					].join(' ')
				)
			}
		}

		expect(pickup.storage.stock.planks ?? 0, timeline.join('\n')).toBeGreaterThan(0)
	})
})
