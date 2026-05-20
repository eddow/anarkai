import { chopSaw } from 'ssh/game/exampleGames'
import { executeNpcTradeStopTransfer } from 'ssh/freight/npc-trade-stop'
import { Game } from 'ssh/game/game'
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

	it('loads the starter hive and zones into the default district', async () => {
		game = new Game({ terrainSeed: 549, characterCount: 0 }, chopSaw)
		await game.loaded
		game.ticker.stop()

		const members = game.getDistrict()?.members.map((coord) => `${coord.q},${coord.r}`) ?? []
		expect(members).toEqual(
			expect.arrayContaining([
				'-1,-1',
				'2,0',
				'0,-1',
				'0,0',
				'1,-1',
				'1,0',
				'-1,0',
				'4,1',
				'3,2',
				'3,3',
				'-4,2',
				'-5,2',
				'-4,1',
				'-4,0',
			])
		)
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
		vehicle.beginLineService(line, line.stops[0]!)
		vehicle.dock()

		expect(vehicle.advertisedJobs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					job: 'vehicleHop',
					lineId: 'ChopSaw:implicit-gather:0,0',
					stopId: 'ChopSaw:ig-load',
				}),
			])
		)
	})

	it('uses the materials loop as a concrete import and planks export fixture', async () => {
		game = new Game({ terrainSeed: 549, characterCount: 0 }, chopSaw)
		await game.loaded
		game.ticker.stop()
		game.setPlayerAccountBalance(100)

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
})
