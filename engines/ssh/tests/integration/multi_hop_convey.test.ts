import type { Alveolus } from 'ssh/board/content/alveolus'
import { isTileCoord } from 'ssh/board/tile-coord'
import type { SaveState } from 'ssh/game'
import { BuildAlveolus } from 'ssh/hive/build'
import type { Hive } from 'ssh/hive/hive'
import type { StorageAlveolus } from 'ssh/hive/storage'
import { axial } from 'ssh/utils/axial'
import { toAxialCoord } from 'ssh/utils/position'
import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine'

describe('Multi-Hop Convey Tests', () => {
	it('creates a movement that can be handed through an intermediate storage', {
		timeout: 15000,
	}, async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()
		try {
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'ChainHive',
						alveoli: [
							{ coord: [0, 0], alveolus: 'storage', goods: { wood: 3 } },
							{ coord: [1, 0], alveolus: 'storage', goods: {} },
							{ coord: [2, 0], alveolus: 'sawmill', goods: {} },
						],
					},
				],
			}

			engine.loadScenario(scenario)

			const provider = engine.game.hex.getTile({ q: 0, r: 0 })?.content as Alveolus | undefined
			const relay = engine.game.hex.getTile({ q: 1, r: 0 })?.content as Alveolus | undefined
			const demander = engine.game.hex.getTile({ q: 2, r: 0 })?.content as Alveolus | undefined
			const hive = (provider?.hive ?? demander?.hive) as Hive | undefined

			expect(provider).toBeDefined()
			expect(relay).toBeDefined()
			expect(demander).toBeDefined()
			expect(hive).toBeDefined()
			if (!provider || !relay || !demander || !hive) {
				throw new Error('Expected chain hive to be created')
			}

			const providerCoord = toAxialCoord(provider.tile.position)
			const created = hive.createMovement('wood', provider, demander)
			const providerMovements = hive.movingGoods.get(providerCoord)
			expect(created || (providerMovements?.length ?? 0) > 0).toBe(true)
			expect(providerMovements?.length ?? 0).toBeGreaterThan(0)

			const movement = providerMovements?.find(
				(candidate) =>
					candidate.goodType === 'wood' &&
					candidate.provider === provider &&
					candidate.demander === demander
			)
			expect(movement).toBeDefined()
			if (!movement) {
				throw new Error('Expected initial movement from provider')
			}

			expect(movement.path.length).toBeGreaterThan(2)
			expect(movement.path.map((step) => axial.key(step))).toContain('1.5,0')
			expect(movement.path.at(-1)).toMatchObject({ q: 2, r: 0 })

			movement.claimed = true
			movement.allocations.source.fulfill()
			const firstHop = movement.hop()
			expect(firstHop).toMatchObject({ q: 0.5, r: 0 })
			movement.place()
			movement.allocations.source = hive
				.storageAt(firstHop)!
				.reserve({ wood: 1 }, { type: 'convey.path', movement })
			movement.claimed = false

			const relayMovements = relay.aGoodMovement
			expect(relayMovements?.length ?? 0).toBeGreaterThan(0)
			expect(relayMovements?.[0]?.movement.goodType).toBe('wood')
			expect(relayMovements?.[0]?.movement.provider?.name).toBe(provider.name)
			expect(relayMovements?.[0]?.movement.demander?.name).toBe(demander.name)
			expect(relayMovements?.[0]?.movement.path.at(0)).toMatchObject({ q: 1, r: 0 })
		} finally {
			await engine.destroy()
		}
	})

	it('prefers a border-tracked advanceable movement over a tile-tracked one on the same relay', {
		timeout: 15000,
	}, async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()
		try {
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'BorderFirstHive',
						alveoli: [
							{ coord: [0, 0], alveolus: 'storage', goods: { wood: 3 } },
							{ coord: [1, 0], alveolus: 'storage', goods: { wood: 1 } },
							{ coord: [2, 0], alveolus: 'storage', goods: {} },
						],
					},
				],
			}

			engine.loadScenario(scenario)

			const provider = engine.game.hex.getTile({ q: 0, r: 0 })?.content as
				| StorageAlveolus
				| undefined
			const relay = engine.game.hex.getTile({ q: 1, r: 0 })?.content as StorageAlveolus | undefined
			const demander = engine.game.hex.getTile({ q: 2, r: 0 })?.content as
				| StorageAlveolus
				| undefined
			const hive = (provider?.hive ?? demander?.hive) as Hive | undefined

			expect(provider).toBeDefined()
			expect(relay).toBeDefined()
			expect(demander).toBeDefined()
			expect(hive).toBeDefined()
			if (!provider || !relay || !demander || !hive) {
				throw new Error('Expected chain hive')
			}

			expect(hive.createMovement('wood', provider, demander)).toBe(true)

			const providerCoord = toAxialCoord(provider.tile.position)!
			const inbound = hive.movingGoods
				.get(providerCoord)
				?.find((m) => m.goodType === 'wood' && m.provider === provider && m.demander === demander)
			expect(inbound).toBeDefined()
			if (!inbound) throw new Error('Expected inbound movement')

			inbound.claimed = true
			inbound.allocations.source!.fulfill()
			const firstHop = inbound.hop()
			expect(firstHop).toMatchObject({ q: 0.5, r: 0 })
			inbound.place()
			inbound.allocations.source = hive
				.storageAt(firstHop)!
				.reserve({ wood: 1 }, { type: 'convey.path', movement: inbound })
			inbound.claimed = false

			expect(hive.createMovement('wood', relay, demander)).toBe(true)

			const relayTileCoord = toAxialCoord(relay.tile.position)!
			const relayTileMovements = hive.movingGoods.get(relayTileCoord) ?? []
			expect(
				relayTileMovements.some((m) => m.provider === relay && m.demander === demander),
				'expected a relay-originated movement tracked on the relay tile'
			).toBe(true)

			const borderKeys = new Set(
				relay.tile.surroundings.map(({ border }) => axial.key(toAxialCoord(border.position)!))
			)
			const inboundTrackedOnBorder = [...hive.movingGoods.entries()].some(
				([coord, goods]) => borderKeys.has(axial.key(coord)) && goods.includes(inbound)
			)
			expect(inboundTrackedOnBorder, 'inbound movement should be tracked on a border').toBe(true)

			const pick = relay.aGoodMovement
			expect(pick?.length).toBeGreaterThan(0)
			const first = pick![0]!
			expect(isTileCoord(first.fromSnapshot), 'border-tracked movement should win').toBe(false)
			expect(first.movement.ref).toBe(inbound.ref)
		} finally {
			await engine.destroy()
		}
	})

	it('finds a border-to-border path through an intermediate alveolus even when that alveolus cannot buffer stone', {
		timeout: 15000,
	}, async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()
		try {
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'StoneRelayMismatch',
						alveoli: [
							{ coord: [0, 0], alveolus: 'stonecutter', goods: { stone: 1 } },
							{ coord: [1, 0], alveolus: 'woodpile', goods: {} },
						],
					},
				],
			}

			engine.loadScenario(scenario)

			const targetTile = engine.game.hex.getTile({ q: 2, r: 0 })
			expect(targetTile).toBeDefined()
			if (!targetTile) throw new Error('Expected target tile to exist')
			targetTile.content = new BuildAlveolus(targetTile, 'sawmill')

			const provider = engine.game.hex.getTile({ q: 0, r: 0 })?.content as Alveolus | undefined
			const relay = engine.game.hex.getTile({ q: 1, r: 0 })?.content as Alveolus | undefined
			const demander = engine.game.hex.getTile({ q: 2, r: 0 })?.content as Alveolus | undefined
			const hive = (provider?.hive ?? demander?.hive ?? relay?.hive) as Hive | undefined

			expect(provider).toBeDefined()
			expect(relay).toBeDefined()
			expect(demander).toBeDefined()
			expect(hive).toBeDefined()
			if (!provider || !relay || !demander || !hive) {
				throw new Error('Expected stone relay scenario to be created')
			}

			expect(relay.storage.hasRoom('stone')).toBe(0)
			const path = hive.getPath(provider, demander, 'stone')
			expect(path).toBeDefined()
			expect(path?.map((step) => axial.key(step))).toContain('1,0')
			expect(path?.map((step) => axial.key(step))).toContain('1.5,0')
		} finally {
			await engine.destroy()
		}
	})

	it('bridges border-to-border through a full relay storage without parking on the tile', {
		timeout: 15000,
	}, async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()
		try {
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'FullRelayBridge',
						alveoli: [
							{ coord: [0, 0], alveolus: 'storage', goods: { planks: 1 } },
							{
								coord: [1, 0],
								alveolus: 'storage',
								goods: { wood: 6, stone: 3, planks: 3, berries: 3, mushrooms: 3 },
							},
							{ coord: [2, 0], alveolus: 'storage', goods: {} },
						],
					},
				],
			}

			engine.loadScenario(scenario)

			const provider = engine.game.hex.getTile({ q: 0, r: 0 })?.content as Alveolus | undefined
			const relay = engine.game.hex.getTile({ q: 1, r: 0 })?.content as Alveolus | undefined
			const demander = engine.game.hex.getTile({ q: 2, r: 0 })?.content as Alveolus | undefined
			const hive = (provider?.hive ?? demander?.hive ?? relay?.hive) as Hive | undefined

			expect(provider).toBeDefined()
			expect(relay).toBeDefined()
			expect(demander).toBeDefined()
			expect(hive).toBeDefined()
			if (!provider || !relay || !demander || !hive) {
				throw new Error('Expected full relay bridge scenario to be created')
			}

			expect(relay.storage.hasRoom('planks')).toBe(0)
			expect(hive.getPath(provider, demander, 'planks')).toBeDefined()
			expect(hive.createMovement('planks', provider, demander)).toBe(true)

			const providerCoord = toAxialCoord(provider.tile.position)
			const movement = hive.movingGoods
				.get(providerCoord)
				?.find((candidate) => candidate.goodType === 'planks')
			expect(movement).toBeDefined()
			if (!movement) throw new Error('Expected planks movement from provider')

			movement.claimed = true
			movement.claimedBy = 'test-provider'
			movement.claimedAtMs = Date.now()
			movement.allocations.source.fulfill()
			const firstHop = movement.hop()
			expect(firstHop).toMatchObject({ q: 0.5, r: 0 })
			movement.place()
			movement.allocations.source = hive
				.storageAt(firstHop)!
				.reserve({ planks: 1 }, { type: 'convey.path', movement })
			movement.claimed = false
			delete movement.claimedBy
			delete movement.claimedAtMs

			const relayWorker = engine.spawnCharacter('relay-worker', { q: 1, r: 0 })
			relayWorker.assignedAlveolus = relay
			expect(relay.aGoodMovement?.length ?? 0).toBeGreaterThan(0)
			const step = relayWorker.scriptsContext.work.conveyStep()
			expect(step).toBeDefined()
			expect(movement.from).toMatchObject({ q: 1.5, r: 0 })
			expect(hive.movingGoods.get({ q: 1, r: 0 })).toBeUndefined()
			expect(hive.movingGoods.get({ q: 1.5, r: 0 })?.[0]).toBe(movement)
			expect(relay.storage.stock.planks ?? 0).toBe(3)

			step?.finish()

			expect(movement.from).toMatchObject({ q: 1.5, r: 0 })
			expect(hive.movingGoods.get({ q: 1, r: 0 })).toBeUndefined()
			expect(hive.movingGoods.get({ q: 1.5, r: 0 })?.[0]).toBe(movement)
			expect(relay.storage.stock.planks ?? 0).toBe(3)
		} finally {
			await engine.destroy()
		}
	})
})
