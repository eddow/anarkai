import { BuildDwelling } from 'ssh/board/content/build-dwelling'
import type { NpcSettlementTradeProfile } from 'ssh/commerce/settlement-trade'
import type { FreightLineDefinition } from 'ssh/freight/freight-line'
import {
	isOneShotLine,
	oneShotLineFulfilled,
	oneShotLineUnloadGoods,
	sweepOneShotLines,
	trySpawnConstructionDeliveries,
	trySpawnConstructionLines,
} from 'ssh/freight/one-shot-lines'
import { Game } from 'ssh/game/game'
import { afterEach, describe, expect, it } from 'vitest'

const woodOnly = {
	goodRules: [{ goodType: 'wood', effect: 'allow' }],
	tagRules: [],
	defaultEffect: 'deny',
} as const

const oneShotLine = (): FreightLineDefinition => ({
	name: 'one-shot wood',
	repeat: false,
	stops: [
		{
			loadSelection: woodOnly,
			unloadSelection: woodOnly,
			anchor: { kind: 'alveolus', hiveName: 'H', alveolusType: 'freight_bay', coord: [0, 0] },
		},
		{
			loadSelection: woodOnly,
			unloadSelection: woodOnly,
			zone: { kind: 'radius', center: [0, 0], radius: 3 },
		},
	],
})

describe('one-shot lines', () => {
	let game: Game

	afterEach(() => {
		game?.destroy()
	})

	it('identifies one-shot lines and their unload goods', () => {
		const line = oneShotLine()
		expect(isOneShotLine(line)).toBe(true)
		expect(oneShotLineUnloadGoods(line)).toEqual(['wood'])
		expect(isOneShotLine({ ...line, repeat: true })).toBe(false)
		expect(isOneShotLine({ name: 'x', stops: [] })).toBe(false)
	})

	it('sweeps a one-shot line once its construction deficit is fulfilled', async () => {
		game = new Game(
			{ terrainSeed: 1, characterCount: 0, settlementGeneration: false },
			{
				terrains: {
					concrete: [
						[0, 0],
						[0, 1],
					],
				},
				dwellings: [
					{
						coord: [0, 1],
						tier: 'basic_dwelling',
						underConstruction: true,
						constructionPhase: 'waiting_materials',
					},
				],
			}
		)
		await game.loaded
		game.ticker.stop()

		// The under-construction dwelling declares construction demand (wood/planks).
		const dwelling = [...game.hex.tiles]
			.map((tile) => tile.content)
			.find((content): content is BuildDwelling => content instanceof BuildDwelling)
		expect(dwelling).toBeInstanceOf(BuildDwelling)
		if (!(dwelling instanceof BuildDwelling)) return

		expect(game.netDeficitLedger.wood?.deficit ?? 0).toBeGreaterThan(0)

		// Register a one-shot line covering wood.
		const line = game.addFreightLine(oneShotLine())
		expect(game.freightLines.has(line)).toBe(true)
		expect(oneShotLineFulfilled(game, line)).toBe(false)
		expect(sweepOneShotLines(game)).toBe(0)
		expect(game.freightLines.has(line)).toBe(true)

		// Satisfy the dwelling's needs → the deficit disappears.
		for (const [good, qty] of Object.entries(dwelling.requiredGoods)) {
			dwelling.storage.addGood(good as 'wood' | 'planks', qty)
		}
		expect(game.netDeficitLedger.wood?.deficit ?? 0).toBe(0)

		expect(oneShotLineFulfilled(game, line)).toBe(true)
		expect(sweepOneShotLines(game)).toBe(1)
		expect(game.freightLines.has(line)).toBe(false)
	})

	it('spawns one-shot lines for construction deficits using free vehicles', async () => {
		game = new Game(
			{ terrainSeed: 1, characterCount: 0, settlementGeneration: false },
			{
				terrains: {
					concrete: [
						[0, 0],
						[1, 0],
						[1, 1],
						[2, 0],
					],
				},
				hives: [
					{
						name: 'Grove',
						alveoli: [
							{ alveolus: 'freight_bay', coord: [0, 0] },
							{ alveolus: 'tree_chopper', coord: [1, 0] },
							// Buffer-less output pile holding the hive's wood supply.
							{ alveolus: 'pile', coord: [1, 1], variant: 'wood', goods: { wood: 6 } },
						],
					},
				],
				dwellings: [
					{
						coord: [2, 0],
						tier: 'basic_dwelling',
						underConstruction: true,
						constructionPhase: 'waiting_materials',
					},
				],
				vehicles: [{ name: 'free', vehicleType: 'wheelbarrow', position: { q: 0, r: 0 } }],
			}
		)
		await game.loaded
		game.ticker.stop()

		// The under-construction dwelling declares construction demand (wood).
		expect(game.netDeficitLedger.wood?.deficit ?? 0).toBeGreaterThan(0)

		const before = [...game.freightLines].filter(isOneShotLine).length
		const spawned = trySpawnConstructionLines(game, {
			reserve: { defaultReserve: 0 },
			internality: 0.5,
		})
		expect(spawned).toBeGreaterThan(0)
		expect([...game.freightLines].filter(isOneShotLine).length).toBe(before + spawned)

		// Each spawned line is repeat:false and has a bay source + radius dest.
		const spawnedLines = [...game.freightLines].filter(isOneShotLine)
		expect(spawnedLines.length).toBe(spawned)
		for (const line of spawnedLines) {
			expect(line.repeat).toBe(false)
			expect(line.stops.some((stop) => 'anchor' in stop)).toBe(true)
			expect(line.stops.some((stop) => 'zone' in stop)).toBe(true)
		}
	})

	it('does not spawn a one-shot line when a recurring line already covers the good', async () => {
		game = new Game(
			{ terrainSeed: 1, characterCount: 0, settlementGeneration: false },
			{
				terrains: {
					concrete: [
						[0, 0],
						[1, 0],
						[1, 1],
						[2, 0],
					],
				},
				hives: [
					{
						name: 'Grove',
						alveoli: [
							{ alveolus: 'freight_bay', coord: [0, 0] },
							{ alveolus: 'tree_chopper', coord: [1, 0] },
							{ alveolus: 'pile', coord: [1, 1], variant: 'wood', goods: { wood: 6 } },
						],
					},
				],
				dwellings: [
					{
						coord: [2, 0],
						tier: 'basic_dwelling',
						underConstruction: true,
						constructionPhase: 'waiting_materials',
					},
				],
				// A player-authored recurring line that already unloads wood → covers the need.
				freightLines: [
					{
						name: 'player wood line',
						cyclic: true,
						stops: [
							{
								loadSelection: woodOnly,
								unloadSelection: woodOnly,
								anchor: {
									kind: 'alveolus',
									hiveName: 'Grove',
									alveolusType: 'freight_bay',
									coord: [0, 0],
								},
							},
							{
								loadSelection: woodOnly,
								unloadSelection: woodOnly,
								zone: { kind: 'radius', center: [2, 0], radius: 3 },
							},
						],
					},
				],
				vehicles: [{ name: 'free', vehicleType: 'wheelbarrow', position: { q: 0, r: 0 } }],
			}
		)
		await game.loaded
		game.ticker.stop()

		expect(game.netDeficitLedger.wood?.deficit ?? 0).toBeGreaterThan(0)

		const before = [...game.freightLines].filter(isOneShotLine).length
		const spawned = trySpawnConstructionLines(game, {
			reserve: { defaultReserve: 0 },
			internality: 0.5,
		})
		// The recurring line already covers wood → no one-shot line is spawned.
		expect(spawned).toBe(0)
		expect([...game.freightLines].filter(isOneShotLine).length).toBe(before)
	})

	it('does not spawn when the reserve keep-target holds all stock back', async () => {
		game = new Game(
			{ terrainSeed: 1, characterCount: 0, settlementGeneration: false },
			{
				terrains: {
					concrete: [
						[0, 0],
						[1, 0],
						[1, 1],
						[2, 0],
					],
				},
				hives: [
					{
						name: 'Grove',
						alveoli: [
							{ alveolus: 'freight_bay', coord: [0, 0] },
							{ alveolus: 'tree_chopper', coord: [1, 0] },
							{ alveolus: 'pile', coord: [1, 1], variant: 'wood', goods: { wood: 6 } },
						],
					},
				],
				dwellings: [
					{
						coord: [2, 0],
						tier: 'basic_dwelling',
						underConstruction: true,
						constructionPhase: 'waiting_materials',
					},
				],
				vehicles: [{ name: 'free', vehicleType: 'wheelbarrow', position: { q: 0, r: 0 } }],
			}
		)
		await game.loaded
		game.ticker.stop()

		expect(game.netDeficitLedger.wood?.deficit ?? 0).toBeGreaterThan(0)

		// The pile holds 6 wood; a reserve of 10 keeps it all back → no internal
		// source above reserve → no line spawns.
		const spawned = trySpawnConstructionLines(game, {
			reserve: { defaultReserve: 10 },
			internality: 0.5,
		})
		expect(spawned).toBe(0)
	})

	it('seeds transport-automation config from engine-rules on Game', async () => {
		game = new Game(
			{ terrainSeed: 1, characterCount: 0, settlementGeneration: false },
			{ terrains: { concrete: [[0, 0]] } }
		)
		await game.loaded
		game.ticker.stop()

		expect(game.transportAutomation.autoSpawn).toBe(true)
		expect(game.transportAutomation.autoBuy).toBe(true)
		expect(game.transportAutomation.internality).toBe(0.5)
		expect(game.transportAutomation.spawnCooldownSeconds).toBe(2)
		expect(game.transportAutomation.reserve.defaultReserve).toBe(0)

		// The config is reactive — the player can tune it live.
		game.transportAutomation.autoSpawn = false
		expect(game.transportAutomation.autoSpawn).toBe(false)
		game.transportAutomation.autoBuy = false
		expect(game.transportAutomation.autoBuy).toBe(false)
	})

	it('orders deliveries: buys from an NPC settlement and credits the site', async () => {
		game = new Game(
			{ terrainSeed: 1, characterCount: 0, settlementGeneration: false },
			{
				terrains: {
					concrete: [
						[0, 0],
						[0, 1],
					],
				},
				dwellings: [
					{
						coord: [0, 1],
						tier: 'basic_dwelling',
						underConstruction: true,
						constructionPhase: 'waiting_materials',
					},
				],
			}
		)
		await game.loaded
		game.ticker.stop()

		const profile: NpcSettlementTradeProfile = {
			regionSetKey: '0,0',
			id: 'settlement-1,0',
			name: 'Neighbor market',
			kind: 'village',
			center: { q: 1, r: 0 },
			radius: 2,
			cityHall: {
				kind: 'city_hall',
				name: 'Neighbor market City Hall',
				position: { q: 1, r: 0 },
			},
			offers: [{ good: 'wood', direction: 'sell', priceVp: 4 }],
		}
		game.registerSettlementTradeProfile(profile)

		const dwelling = [...game.hex.tiles]
			.map((tile) => tile.content)
			.find((content): content is BuildDwelling => content instanceof BuildDwelling)
		expect(dwelling).toBeInstanceOf(BuildDwelling)
		if (!(dwelling instanceof BuildDwelling)) return

		expect(game.netDeficitLedger.wood?.deficit ?? 0).toBeGreaterThan(0)
		const balanceBefore = game.playerAccount.balanceVp

		const delivered = trySpawnConstructionDeliveries(game, {
			reserve: { defaultReserve: 0 },
			internality: 0.5,
		})
		expect(delivered).toBeGreaterThan(0)

		// Wood was credited to the dwelling's storage and VP was spent.
		expect(dwelling.storage.stock.wood ?? 0).toBeGreaterThan(0)
		expect(game.playerAccount.balanceVp).toBeLessThan(balanceBefore)

		// A single external offer is unbounded, so the whole wood deficit is filled.
		expect(game.netDeficitLedger.wood?.deficit ?? 0).toBe(0)
	})

	it('does not deliver when the good is already covered by a line', async () => {
		game = new Game(
			{ terrainSeed: 1, characterCount: 0, settlementGeneration: false },
			{
				terrains: {
					concrete: [
						[0, 0],
						[0, 1],
					],
				},
				dwellings: [
					{
						coord: [0, 1],
						tier: 'basic_dwelling',
						underConstruction: true,
						constructionPhase: 'waiting_materials',
					},
				],
			}
		)
		await game.loaded
		game.ticker.stop()

		const profile: NpcSettlementTradeProfile = {
			regionSetKey: '0,0',
			id: 'settlement-1,0',
			name: 'Neighbor market',
			kind: 'village',
			center: { q: 1, r: 0 },
			radius: 2,
			cityHall: {
				kind: 'city_hall',
				name: 'Neighbor market City Hall',
				position: { q: 1, r: 0 },
			},
			offers: [{ good: 'wood', direction: 'sell', priceVp: 4 }],
		}
		game.registerSettlementTradeProfile(profile)

		expect(game.netDeficitLedger.wood?.deficit ?? 0).toBeGreaterThan(0)

		// Register a one-shot line covering wood → delivery must not double-cover.
		game.addFreightLine(oneShotLine())
		const balanceBefore = game.playerAccount.balanceVp

		const delivered = trySpawnConstructionDeliveries(game, {
			reserve: { defaultReserve: 0 },
			internality: 0.5,
		})
		expect(delivered).toBe(0)
		expect(game.playerAccount.balanceVp).toBe(balanceBefore)
	})
})
