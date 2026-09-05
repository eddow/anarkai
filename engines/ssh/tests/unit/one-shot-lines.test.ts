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
import { BuildAlveolus } from 'ssh/hive/build'
import type { SimulationLoop } from 'ssh/utils/loop'
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

		// Each spawned line is a one-shot, has a bay source + radius dest, and carries
		// the construction structure it fulfills as its `repeat` (an object reference).
		const spawnedLines = [...game.freightLines].filter(isOneShotLine)
		expect(spawnedLines.length).toBe(spawned)
		for (const line of spawnedLines) {
			expect(isOneShotLine(line)).toBe(true)
			expect(line.stops.some((stop) => 'anchor' in stop)).toBe(true)
			expect(line.stops.some((stop) => 'zone' in stop)).toBe(true)
			expect(line.repeat).toBeInstanceOf(BuildDwelling)
		}
	})

	it('fulfills a stamped target line once the site advances past waiting_materials', async () => {
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

		const dwelling = [...game.hex.tiles]
			.map((tile) => tile.content)
			.find((content): content is BuildDwelling => content instanceof BuildDwelling)
		expect(dwelling).toBeInstanceOf(BuildDwelling)
		if (!(dwelling instanceof BuildDwelling)) return

		// A one-shot line whose `repeat` IS the dwelling it fulfills (object reference).
		const line = game.addFreightLine({
			name: 'one-shot wood',
			repeat: dwelling,
			stops: [
				{
					loadSelection: woodOnly,
					unloadSelection: woodOnly,
					anchor: { kind: 'alveolus', hiveName: 'H', alveolusType: 'freight_bay', coord: [0, 0] },
				},
				{
					loadSelection: woodOnly,
					unloadSelection: woodOnly,
					zone: { kind: 'radius', center: [0, 1], radius: 3 },
				},
			],
		})
		// Materials still outstanding → not fulfilled.
		expect(oneShotLineFulfilled(game, line)).toBe(false)

		// Deliver the materials → the shell advances out of waiting_materials → fulfilled.
		for (const [good, qty] of Object.entries(dwelling.requiredGoods)) {
			dwelling.storage.addGood(good as 'wood' | 'planks', qty)
		}
		expect(oneShotLineFulfilled(game, line)).toBe(true)
		expect(sweepOneShotLines(game)).toBe(1)
		expect(game.freightLines.has(line)).toBe(false)
	})

	it('does not self-haul when the nearest source is beyond the distance cap', async () => {
		game = new Game(
			{ terrainSeed: 1, characterCount: 0, settlementGeneration: false },
			{
				terrains: {
					concrete: [
						[0, 0],
						[1, 0],
						[1, 1],
						[10, 0],
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
						coord: [10, 0],
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

		// Cap below the bay→site distance (10) → no self-haul line; the deficit stays.
		game.transportAutomation.maxSelfHaulDistance = 5
		const capped = trySpawnConstructionLines(game, {
			reserve: { defaultReserve: 0 },
			internality: 0.5,
		})
		expect(capped).toBe(0)
		expect([...game.freightLines].filter(isOneShotLine).length).toBe(0)

		// Lift the cap → the same need now self-hauls.
		game.transportAutomation.maxSelfHaulDistance = 20
		const spawned = trySpawnConstructionLines(game, {
			reserve: { defaultReserve: 0 },
			internality: 0.5,
		})
		expect(spawned).toBeGreaterThan(0)
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

	it('auto-buy picks the cheapest offer and charges price × qty', async () => {
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

		// Cheap-but-far vs pricey-but-near: cheapest must win (price, then distance).
		game.registerSettlementTradeProfile({
			regionSetKey: '0,0',
			id: 'settlement-cheap',
			name: 'Cheap far',
			kind: 'village',
			center: { q: 20, r: 0 },
			radius: 2,
			cityHall: { kind: 'city_hall', name: 'Cheap far City Hall', position: { q: 20, r: 0 } },
			offers: [{ good: 'wood', direction: 'sell', priceVp: 2 }],
		})
		game.registerSettlementTradeProfile({
			regionSetKey: '0,0',
			id: 'settlement-near',
			name: 'Near pricey',
			kind: 'village',
			center: { q: 1, r: 0 },
			radius: 2,
			cityHall: { kind: 'city_hall', name: 'Near pricey City Hall', position: { q: 1, r: 0 } },
			offers: [{ good: 'wood', direction: 'sell', priceVp: 5 }],
		})

		const dwelling = [...game.hex.tiles]
			.map((tile) => tile.content)
			.find((content): content is BuildDwelling => content instanceof BuildDwelling)
		expect(dwelling).toBeInstanceOf(BuildDwelling)
		if (!(dwelling instanceof BuildDwelling)) return

		// basic_dwelling needs wood 2 → cheapest (2 VP) wins: exactly 4 VP spent.
		const balanceBefore = game.playerAccount.balanceVp
		const delivered = trySpawnConstructionDeliveries(game, {
			reserve: { defaultReserve: 0 },
			internality: 0.5,
		})
		expect(delivered).toBeGreaterThan(0)
		expect(dwelling.storage.stock.wood ?? 0).toBe(2)
		expect(game.playerAccount.balanceVp).toBe(balanceBefore - 4)
	})

	it('project take/buy gates self-haul vs delivery per good', async () => {
		game = new Game(
			{ terrainSeed: 1, characterCount: 0, settlementGeneration: false },
			{
				terrains: {
					grass: [
						[0, 0],
						[1, 0],
						[1, 1],
						[2, 0],
						[3, 0],
					],
				},
				hives: [
					{
						name: 'Grove',
						alveoli: [
							{ alveolus: 'freight_bay', coord: [0, 0] },
							{ alveolus: 'tree_chopper', coord: [1, 0] },
							{ alveolus: 'pile', coord: [1, 1], variant: 'wood', goods: { wood: 12 } },
						],
					},
				],
				vehicles: [
					{ name: 'free1', vehicleType: 'wheelbarrow', position: { q: 0, r: 0 } },
					{ name: 'free2', vehicleType: 'wheelbarrow', position: { q: 0, r: 0 } },
				],
			}
		)
		await game.loaded
		game.ticker.stop()

		// Distinct layouts so dedup does not merge them (fingerprint covers type).
		const { project: takeProject } = game.projects.createDraft('Take pile', [
			{ coord: [2, 0], alveolusType: 'pile' },
		])
		const { project: buyProject } = game.projects.createDraft('Buy storage', [
			{ coord: [3, 0], alveolusType: 'storage' },
		])
		expect(game.commitProject(takeProject).ok).toBe(true)
		expect(game.commitProject(buyProject).ok).toBe(true)
		game.projects.setSourcingMode(takeProject, 'wood', 'take')
		game.projects.setSourcingMode(buyProject, 'wood', 'buy')
		game.registerSettlementTradeProfile({
			regionSetKey: '0,0',
			id: 'settlement-1,0',
			name: 'Neighbor market',
			kind: 'village',
			center: { q: 5, r: 0 },
			radius: 2,
			cityHall: {
				kind: 'city_hall',
				name: 'Neighbor market City Hall',
				position: { q: 5, r: 0 },
			},
			offers: [{ good: 'wood', direction: 'sell', priceVp: 4 }],
		})

		// Self-haul serves only the take project (buy suppresses the self-haul branch).
		const spawned = trySpawnConstructionLines(game, {
			reserve: { defaultReserve: 0 },
			internality: 0.5,
		})
		expect(spawned).toBe(1)
		expect([...game.freightLines].filter(isOneShotLine)).toHaveLength(1)

		// Delivery serves only the buy project (take suppresses the delivery branch).
		const delivered = trySpawnConstructionDeliveries(game, {
			reserve: { defaultReserve: 0 },
			internality: 0.5,
		})
		expect(delivered).toBe(1)
		const shellTake = game.hex.getTile({ q: 2, r: 0 })?.content as BuildAlveolus
		const shellBuy = game.hex.getTile({ q: 3, r: 0 })?.content as BuildAlveolus
		expect(shellTake).toBeInstanceOf(BuildAlveolus)
		expect(shellBuy).toBeInstanceOf(BuildAlveolus)
		// Take awaits its haul (no instant credit); buy was credited by the NPC delivery.
		expect(shellTake.storage.stock.wood ?? 0).toBe(0)
		expect(shellBuy.storage.stock.wood ?? 0).toBeGreaterThan(0)
	})

	it('a player import line suppresses automated delivery (bring it yourself)', async () => {
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
			center: { q: 4, r: 0 },
			radius: 2,
			cityHall: {
				kind: 'city_hall',
				name: 'Neighbor market City Hall',
				position: { q: 4, r: 0 },
			},
			offers: [{ good: 'wood', direction: 'sell', priceVp: 4 }],
		}
		game.registerSettlementTradeProfile(profile)
		expect(game.netDeficitLedger.wood?.deficit ?? 0).toBeGreaterThan(0)

		// Player-authored import line (settlement → construction zone) covers wood.
		game.addFreightLine({
			name: 'player wood import',
			cyclic: true,
			stops: [
				{
					loadSelection: woodOnly,
					unloadSelection: woodOnly,
					trade: { kind: 'settlement', center: profile.center, profile },
				},
				{
					loadSelection: woodOnly,
					unloadSelection: woodOnly,
					zone: { kind: 'radius', center: [0, 1], radius: 3 },
				},
			],
		})
		const suppressed = trySpawnConstructionDeliveries(game, {
			reserve: { defaultReserve: 0 },
			internality: 0.5,
		})
		expect(suppressed).toBe(0)

		// Without the player line the automation resumes buying.
		for (const line of [...game.freightLines]) game.removeFreightLine(line)
		const delivered = trySpawnConstructionDeliveries(game, {
			reserve: { defaultReserve: 0 },
			internality: 0.5,
		})
		expect(delivered).toBeGreaterThan(0)
	})

	it('spawns one line per concurrent construction need of the same good', async () => {
		game = new Game(
			{ terrainSeed: 1, characterCount: 0, settlementGeneration: false },
			{
				terrains: {
					concrete: [
						[0, 0],
						[1, 0],
						[1, 1],
						[2, 0],
						[3, 0],
						[4, 0],
						[5, 0],
						[6, 0],
						[6, 1],
					],
				},
				hives: [
					{
						name: 'Grove',
						alveoli: [
							{ alveolus: 'freight_bay', coord: [0, 0] },
							{ alveolus: 'tree_chopper', coord: [1, 0] },
							{ alveolus: 'pile', coord: [1, 1], variant: 'wood', goods: { wood: 12 } },
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
					// 4 hexes from the first site — outside the radius-3 unload zone, so
					// it must get its own one-shot line.
					{
						coord: [6, 0],
						tier: 'basic_dwelling',
						underConstruction: true,
						constructionPhase: 'waiting_materials',
					},
				],
				vehicles: [
					{ name: 'free1', vehicleType: 'wheelbarrow', position: { q: 0, r: 0 } },
					{ name: 'free2', vehicleType: 'wheelbarrow', position: { q: 0, r: 0 } },
				],
			}
		)
		await game.loaded
		game.ticker.stop()

		// Two distinct construction sites both need wood → two needs in the ledger.
		expect(game.netDeficitLedger.wood?.needs.length ?? 0).toBe(2)

		const spawned = trySpawnConstructionLines(game, {
			reserve: { defaultReserve: 0 },
			internality: 0.5,
		})
		// One line per destination — the second site must not be blocked by the first.
		expect(spawned).toBe(2)
		expect([...game.freightLines].filter(isOneShotLine).length).toBe(2)
	})

	it('delivers to each concurrent construction need of the same good', async () => {
		game = new Game(
			{ terrainSeed: 1, characterCount: 0, settlementGeneration: false },
			{
				terrains: {
					concrete: [
						[0, 0],
						[0, 1],
						[2, 0],
						[2, 1],
					],
				},
				dwellings: [
					{
						coord: [0, 1],
						tier: 'basic_dwelling',
						underConstruction: true,
						constructionPhase: 'waiting_materials',
					},
					{
						coord: [2, 0],
						tier: 'basic_dwelling',
						underConstruction: true,
						constructionPhase: 'waiting_materials',
					},
				],
			}
		)
		await game.loaded
		game.ticker.stop()

		game.registerSettlementTradeProfile({
			regionSetKey: '0,0',
			id: 'settlement-1,0',
			name: 'Neighbor market',
			kind: 'village',
			center: { q: 1, r: 0 },
			radius: 2,
			cityHall: { kind: 'city_hall', name: 'Neighbor market City Hall', position: { q: 1, r: 0 } },
			offers: [{ good: 'wood', direction: 'sell', priceVp: 4 }],
		})

		expect(game.netDeficitLedger.wood?.needs.length ?? 0).toBe(2)

		const delivered = trySpawnConstructionDeliveries(game, {
			reserve: { defaultReserve: 0 },
			internality: 0.5,
		})
		expect(delivered).toBe(2)
		expect(game.netDeficitLedger.wood?.deficit ?? 0).toBe(0)
	})

	it('ticker autonomously spawns and sweeps a one-shot line end-to-end', async () => {
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

		// Make the ticker act on the next pass, self-haul only.
		game.transportAutomation.spawnCooldownSeconds = 0
		game.transportAutomation.autoSpawn = true
		game.transportAutomation.autoBuy = false
		game.transportAutomation.internality = 1

		const tick = () => game.tickerCallback({ elapsedMS: 100 } as SimulationLoop)

		expect(game.netDeficitLedger.wood?.deficit ?? 0).toBeGreaterThan(0)
		expect([...game.freightLines].filter(isOneShotLine).length).toBe(0)

		// First tick: the ticker (not a direct call) spawns a one-shot line targeting the dwelling.
		tick()
		const spawned = [...game.freightLines].filter(isOneShotLine)
		expect(spawned.length).toBe(1)
		expect(spawned[0]!.repeat).toBeInstanceOf(BuildDwelling)

		// Fulfill the deficit (simulate the haul completing): the dwelling's wood need is met.
		const dwelling = [...game.hex.tiles]
			.map((tile) => tile.content)
			.find((content): content is BuildDwelling => content instanceof BuildDwelling)
		expect(dwelling).toBeInstanceOf(BuildDwelling)
		for (const [good, qty] of Object.entries(dwelling!.requiredGoods)) {
			dwelling!.storage.addGood(good as 'wood' | 'planks', qty)
		}
		expect(game.netDeficitLedger.wood?.deficit ?? 0).toBe(0)

		// Next tick: the ticker sweeps the now-fulfilled one-shot line.
		tick()
		expect([...game.freightLines].filter(isOneShotLine).length).toBe(0)
	})
})
