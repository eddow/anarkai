import type { Alveolus } from 'ssh/board/content/alveolus'
import { isTileCoord } from 'ssh/board/tile-coord'
import { Commitment } from 'ssh/commitment'
import type { GameConveyEvent, SaveState } from 'ssh/game'
import { BuildAlveolus } from 'ssh/hive/build'
import { commitmentValid, type Hive, type TrackedMovement } from 'ssh/hive/hive'
import type { StorageAlveolus } from 'ssh/hive/storage'
import { trackAllocation } from 'ssh/storage/guard'
import { axial } from 'ssh/utils/axial'
import { toAxialCoord } from 'ssh/utils/position'
import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine'

const flushDeferredEvents = () => new Promise((resolve) => setTimeout(resolve, 0))

function movementReason(movement: TrackedMovement, type: 'convey.hop' | 'convey.path') {
	return {
		type,
		goodType: movement.goodType,
		movementRef: movement.ref,
		providerRef: movement.provider,
		demanderRef: movement.demander,
		providerName: movement.provider.name,
		demanderName: movement.demander.name,
		movement,
	}
}

function movementCommitment(movement: TrackedMovement, type: 'convey.hop' | 'convey.path') {
	const commitment = new Commitment(`${type}.${movement.goodType}`)
	;(commitment as { reason?: ReturnType<typeof movementReason> }).reason = movementReason(
		movement,
		type
	)
	return commitment
}

function handOffFirstHop(hive: Hive, movement: TrackedMovement, label: string) {
	const nextHop = movement.path[0]
	expect(nextHop).toBeDefined()
	if (!nextHop) throw new Error(`${label}: expected a next hop`)

	const hopStorage = hive.storageAt(nextHop)
	expect(hopStorage).toBeDefined()
	if (!hopStorage) throw new Error(`${label}: expected hop storage`)

	const hopAllocation = movementCommitment(movement, 'convey.hop')
	expect(hopStorage.allocate({ [movement.goodType]: 1 }, hopAllocation)).toBeUndefined()

	if (
		(movement.allocations.source as { reason?: { type?: string } }).reason?.type !== 'hive-transfer'
	) {
		hive.fulfillMovementSource(movement, label)
	}
	const firstHop = movement.hop()
	movement.place()
	hopAllocation.fulfill()
	const sourceCommitment = movementCommitment(movement, 'convey.path')
	expect(hopStorage.reserve({ [movement.goodType]: 1 }, sourceCommitment)).toBeUndefined()
	hive.assignMovementSource(movement, sourceCommitment, label)
	return firstHop
}

describe('Multi-Hop Convey Tests', () => {
	it('throws when a movement source reservation has no target allocation', {
		timeout: 15000,
	}, async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()
		try {
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'MovementPairInvariant',
						alveoli: [
							{ coord: [0, 0], alveolus: 'storage', goods: { wood: 1 } },
							{ coord: [1, 0], alveolus: 'storage', goods: {} },
						],
					},
				],
			}

			engine.loadScenario(scenario)

			const provider = engine.game.hex.getTile({ q: 0, r: 0 })?.content as Alveolus | undefined
			const demander = engine.game.hex.getTile({ q: 1, r: 0 })?.content as Alveolus | undefined
			const hive = (provider?.hive ?? demander?.hive) as Hive | undefined
			expect(provider).toBeDefined()
			expect(demander).toBeDefined()
			expect(hive).toBeDefined()
			if (!provider || !demander || !hive) throw new Error('Expected invariant hive')

			expect(hive.createMovement('wood', provider, demander)).toBe(true)
			const movement = hive.movingGoods
				.get(toAxialCoord(provider.tile.position))
				?.find((candidate) => candidate.goodType === 'wood')
			expect(movement).toBeDefined()
			if (!movement) throw new Error('Expected wood movement')
			expect(provider.storage.available('wood')).toBe(0)

			movement.allocations.target.cancel('test.missing-target')
			;(globalThis as any).allowExpectedDiagnostics?.(
				/\[WATCHDOG\] Movement source reservation without target allocation/
			)
			expect(() => hive.reconcileMovementAllocationPairs('test.missing-target')).toThrow(
				/source-without-target-allocation/
			)
			expect(provider.storage.available('wood')).toBe(0)
			expect((hive as any).activeMovements.has(movement)).toBe(true)
		} finally {
			await engine.destroy()
		}
	})

	it('skips an unpaired movement reservation when offering convey work', {
		timeout: 15000,
	}, async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()
		try {
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'MovementPairOfferInvariant',
						alveoli: [
							{ coord: [0, 0], alveolus: 'storage', goods: { wood: 1 } },
							{ coord: [1, 0], alveolus: 'storage', goods: {} },
						],
					},
				],
			}

			engine.loadScenario(scenario)

			const provider = engine.game.hex.getTile({ q: 0, r: 0 })?.content as Alveolus | undefined
			const demander = engine.game.hex.getTile({ q: 1, r: 0 })?.content as Alveolus | undefined
			expect(provider).toBeDefined()
			expect(demander).toBeDefined()
			if (!provider || !demander) throw new Error('Expected invariant hive')

			expect(provider.hive.createMovement('wood', provider, demander)).toBe(true)
			const movement = provider.hive.movingGoods
				.get(toAxialCoord(provider.tile.position))
				?.find((candidate) => candidate.goodType === 'wood')
			expect(movement).toBeDefined()
			if (!movement) throw new Error('Expected wood movement')
			expect(provider.storage.available('wood')).toBe(0)

			movement.allocations.target.cancel('test.offer-missing-target')
			expect(() => provider.aGoodMovement).not.toThrow()
			expect(provider.aGoodMovement).toBeUndefined()
			;(globalThis as any).allowExpectedDiagnostics?.(
				/\[WATCHDOG\] Movement source reservation without target allocation/
			)
			expect(() =>
				provider.hive.reconcileMovementAllocationPairs('test.offer-missing-target')
			).toThrow(/source-without-target-allocation/)
			expect(provider.storage.available('wood')).toBe(0)
			expect((provider.hive as any).activeMovements.has(movement)).toBe(true)
		} finally {
			await engine.destroy()
		}
	})

	it('emits conveyed events for non-border hop endpoints after fulfillment', {
		timeout: 15000,
	}, async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()
		try {
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'ConveyedEndpointEvents',
						alveoli: [
							{ coord: [0, 0], alveolus: 'storage', goods: { wood: 1 } },
							{ coord: [1, 0], alveolus: 'storage', goods: {} },
						],
					},
				],
			}

			engine.loadScenario(scenario)

			const provider = engine.game.hex.getTile({ q: 0, r: 0 })?.content as Alveolus | undefined
			const demander = engine.game.hex.getTile({ q: 1, r: 0 })?.content as Alveolus | undefined
			const hive = provider?.hive as Hive | undefined
			expect(provider).toBeDefined()
			expect(demander).toBeDefined()
			expect(hive).toBeDefined()
			if (!provider || !demander || !hive) throw new Error('Expected conveyed event hive')

			const batches: readonly GameConveyEvent[][] = []
			engine.game.on({
				conveyEvents(events) {
					batches.push(events)
				},
			})

			expect(hive.createMovement('wood', provider, demander)).toBe(true)
			const movement = hive.movingGoods
				.get(toAxialCoord(provider.tile.position))
				?.find((candidate) => candidate.goodType === 'wood')
			expect(movement).toBeDefined()
			if (!movement) throw new Error('Expected wood movement')

			const expectedFrom = { ...movement.from }
			const expectedHop = movement.path[0]
			expect(expectedHop).toBeDefined()
			if (!expectedHop) throw new Error('Expected first convey hop')

			const worker = engine.spawnCharacter('conveyed-event-worker', { q: 0, r: 0 })
			worker.assignedAlveolus = provider
			const step = worker.scriptsContext.work.conveyStep()
			expect(step).toBeDefined()
			step?.tick(0.01)
			step?.tick(999)

			await flushDeferredEvents()

			const events = batches.flat()
			const expectedEvents: GameConveyEvent[] = []
			if (isTileCoord(expectedFrom)) {
				expectedEvents.push({
					type: 'conveyed',
					ownerUid: provider.tile.uid,
					endpoint: 'source',
					goodType: 'wood',
					movementRef: movement.ref.id,
					characterUid: worker.uid,
					from: expectedFrom,
					to: expectedHop,
				})
			}
			if (isTileCoord(expectedHop)) {
				const targetTile = engine.game.hex.getTile(expectedHop)
				expect(targetTile).toBeDefined()
				if (!targetTile) throw new Error('Expected tile target hop')
				expectedEvents.push({
					type: 'conveyed',
					ownerUid: targetTile.uid,
					endpoint: 'target',
					goodType: 'wood',
					movementRef: movement.ref.id,
					characterUid: worker.uid,
					from: expectedFrom,
					to: expectedHop,
				})
			}
			expect(events).toEqual(expectedEvents)
		} finally {
			await engine.destroy()
		}
	})

	it('prunes resolved source allocation residue instead of throwing source-without-target', {
		timeout: 15000,
	}, async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()
		try {
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'ResolvedResidueInvariant',
						alveoli: [
							{ coord: [0, 0], alveolus: 'storage', goods: { wood: 1 } },
							{ coord: [1, 0], alveolus: 'storage', goods: {} },
						],
					},
				],
			}

			engine.loadScenario(scenario)

			const provider = engine.game.hex.getTile({ q: 0, r: 0 })?.content as Alveolus | undefined
			const demander = engine.game.hex.getTile({ q: 1, r: 0 })?.content as Alveolus | undefined
			const hive = (provider?.hive ?? demander?.hive) as Hive | undefined
			expect(provider).toBeDefined()
			expect(demander).toBeDefined()
			expect(hive).toBeDefined()
			if (!provider || !demander || !hive) throw new Error('Expected residue hive')

			expect(hive.createMovement('wood', provider, demander)).toBe(true)
			const movement = hive.movingGoods
				.get(toAxialCoord(provider.tile.position))
				?.find((candidate) => candidate.goodType === 'wood')
			expect(movement).toBeDefined()
			if (!movement) throw new Error('Expected wood movement')

			const source = movement.allocations.source
			const sourceReason = (source as { reason?: unknown } | undefined)?.reason
			expect(source).toBeDefined()
			expect(sourceReason).toBeDefined()
			if (!source || !sourceReason) throw new Error('Expected source allocation reason')

			movement.allocations.target.cancel('silent-discard.target')
			source.cancel('silent-discard.source')
			trackAllocation(source, sourceReason)

			expect(() =>
				(
					hive as unknown as { scanForDetachedMovementAllocations(): void }
				).scanForDetachedMovementAllocations()
			).not.toThrow()
			expect(() => hive.reconcileMovementAllocationPairs('test.resolved-residue')).not.toThrow()
		} finally {
			await engine.destroy()
		}
	})

	it('throws on unreserved goods in border transit storage', {
		timeout: 15000,
	}, async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()
		try {
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'BorderTransitInvariant',
						alveoli: [
							{ coord: [0, 0], alveolus: 'storage', goods: {} },
							{ coord: [1, 0], alveolus: 'storage', goods: {} },
						],
					},
				],
			}

			engine.loadScenario(scenario)

			const provider = engine.game.hex.getTile({ q: 0, r: 0 })?.content as Alveolus | undefined
			const demander = engine.game.hex.getTile({ q: 1, r: 0 })?.content as Alveolus | undefined
			const hive = (provider?.hive ?? demander?.hive) as Hive | undefined
			expect(provider).toBeDefined()
			expect(demander).toBeDefined()
			expect(hive).toBeDefined()
			if (!provider || !demander || !hive) throw new Error('Expected invariant hive')

			const borderStorage = hive.storageAt({ q: 0.5, r: 0 })
			expect(borderStorage).toBeDefined()
			if (!borderStorage) throw new Error('Expected border storage')
			expect(borderStorage.addGood('wood', 1)).toBe(1)
			expect(borderStorage.available('wood')).toBe(1)

			;(globalThis as any).allowExpectedDiagnostics?.(
				/\[WATCHDOG\] Border transit stock without movement reservation/
			)
			expect(() => (hive as any).scanBorderTransitStorageInvariant()).toThrow(
				/Border transit stock without movement reservation/
			)
			expect(() => provider.aGoodMovement).not.toThrow()
			expect(borderStorage.stock.wood ?? 0).toBe(1)
		} finally {
			await engine.destroy()
		}
	})

	it('does not repair a fulfilled-hop window during movement selection', {
		timeout: 15000,
	}, async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()
		try {
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'BorderTransitRepair',
						alveoli: [
							{ coord: [0, 0], alveolus: 'storage', goods: { wood: 1 } },
							{ coord: [1, 0], alveolus: 'storage', goods: {} },
						],
					},
				],
			}

			engine.loadScenario(scenario)

			const provider = engine.game.hex.getTile({ q: 0, r: 0 })?.content as Alveolus | undefined
			const demander = engine.game.hex.getTile({ q: 1, r: 0 })?.content as Alveolus | undefined
			const hive = (provider?.hive ?? demander?.hive) as Hive | undefined
			expect(provider).toBeDefined()
			expect(demander).toBeDefined()
			expect(hive).toBeDefined()
			if (!provider || !demander || !hive) throw new Error('Expected repair hive')

			expect(hive.createMovement('wood', provider, demander)).toBe(true)
			const movement = hive.movingGoods
				.get(toAxialCoord(provider.tile.position))
				?.find((candidate) => candidate.goodType === 'wood')
			expect(movement).toBeDefined()
			if (!movement) throw new Error('Expected wood movement')

			const hop = movement.path[0]
			expect(hop).toBeDefined()
			if (!hop) throw new Error('Expected first hop')
			const hopStorage = hive.storageAt(hop)
			expect(hopStorage).toBeDefined()
			if (!hopStorage) throw new Error('Expected hop storage')

			movement.claimed = true
			movement.claimedBy = 'border-transit-repair-test' as never
			movement.claimedAtMs = Date.now()
			const step = new Commitment('test.border-transit-repair.step')
			expect(hopStorage.allocate({ wood: 1 }, step)).toBeUndefined()
			movement.hop()
			movement.place()
			hive.bindMovementsSourceToHopStep([movement], step, 'test.border-transit-repair')
			step.fulfill()

			expect(hopStorage.available('wood')).toBe(1)
			expect(() => provider.aGoodMovement).not.toThrow()
			expect(hopStorage.available('wood')).toBe(1)
			expect(commitmentValid(movement.allocations.source)).toBe(false)
			expect((movement.allocations.source as any).reason?.type).toBe('convey.hop')
		} finally {
			await engine.destroy()
		}
	})

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
			const firstHop = handOffFirstHop(hive, movement, 'test.multi-hop.first')
			expect(firstHop).toMatchObject({ q: 0.5, r: 0 })
			movement.claimed = false

			const relayMovements = relay.aGoodMovement
			expect(relayMovements?.length ?? 0).toBeGreaterThan(0)
			expect(relayMovements?.[0]?.movement.goodType).toBe('wood')
			expect(relayMovements?.[0]?.movement.provider?.name).toBe(provider.name)
			expect(relayMovements?.[0]?.movement.demander?.name).toBe(demander.name)
			expect(relayMovements?.[0]?.movement.path.at(0)).toMatchObject({ q: 1.5, r: 0 })
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
			const firstHop = handOffFirstHop(hive, inbound, 'test.multi-hop.border-first')
			expect(firstHop).toMatchObject({ q: 0.5, r: 0 })
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
			expect(first.movement.ref).toStrictEqual(inbound.ref)
		} finally {
			await engine.destroy()
		}
	})

	it('can route stone past an intermediate alveolus that cannot buffer stone', {
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
		} finally {
			await engine.destroy()
		}
	})

	it('does not restore a lost claim projection before release', {
		timeout: 15000,
	}, async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()
		try {
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'TerminalClaimRepair',
						alveoli: [
							{ coord: [0, 0], alveolus: 'storage', goods: { wood: 1 } },
							{ coord: [1, 0], alveolus: 'storage', goods: {} },
						],
					},
				],
			}

			engine.loadScenario(scenario)
			const provider = engine.game.hex.getTile({ q: 0, r: 0 })?.content as Alveolus | undefined
			const demander = engine.game.hex.getTile({ q: 1, r: 0 })?.content as Alveolus | undefined
			const hive = provider?.hive as Hive | undefined
			expect(provider).toBeDefined()
			expect(demander).toBeDefined()
			expect(hive).toBeDefined()
			if (!provider || !demander || !hive) throw new Error('Expected terminal convey scenario')

			expect(hive.createMovement('wood', provider, demander)).toBe(true)
			const movement = hive.movingGoods
				.get(toAxialCoord(provider.tile.position))
				?.find((candidate) => candidate.goodType === 'wood')
			expect(movement).toBeDefined()
			if (!movement) throw new Error('Expected wood movement')

			const worker = engine.spawnCharacter('terminal-worker', { q: 0, r: 0 })
			worker.assignedAlveolus = provider
			const step = worker.scriptsContext.work.conveyStep()
			expect(step).toBeDefined()
			expect(movement.claimed).toBe(true)
			expect(movement.claimedBy?.uid).toBe(worker.uid)
			expect(movement.allocations.source).toBe(step)
			expect(commitmentValid(movement.allocations.source)).toBe(true)
			expect(
				(movement.allocations.source as unknown as { reason?: { type?: string } }).reason?.type
			).toBe('convey.hop')
			expect(provider.storage.stock.wood ?? 0).toBe(0)

			movement.claimed = false
			delete movement.claimedBy
			delete movement.claimedAtMs
			;(globalThis as any).allowExpectedDiagnostics?.(/conveyStep.after-hop-rebind.before-unclaim/)
			expect(() => step?.finish()).not.toThrow()
			expect(provider.storage.stock.wood ?? 0).toBe(0)
			expect(demander.storage.stock.wood ?? 0).toBe(0)
			expect(movement.claimed).toBe(false)
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
			const firstHop = handOffFirstHop(hive, movement, 'test.multi-hop.full-relay')
			expect(firstHop).toMatchObject({ q: 0.5, r: 0 })
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
			expect(hive.movingGoods.get({ q: 1.5, r: 0 })?.[0]?.ref.id).toBe(movement.ref.id)
			expect(relay.storage.stock.planks ?? 0).toBe(3)

			;(hive as unknown as { scanForStalledExchanges(): void }).scanForStalledExchanges()
			expect(movement.claimed).toBe(true)
			expect(movement.claimedBy?.uid).toBe(relayWorker.uid)

			step?.finish()

			expect(movement.from).toMatchObject({ q: 1.5, r: 0 })
			expect(hive.movingGoods.get({ q: 1, r: 0 })).toBeUndefined()
			expect(hive.movingGoods.get({ q: 1.5, r: 0 })?.[0]?.ref.id).toBe(movement.ref.id)
			expect(relay.storage.stock.planks ?? 0).toBe(3)
		} finally {
			await engine.destroy()
		}
	})

	it('rolls back fulfilled hop stock when the next source reservation cannot stay paired', {
		timeout: 15000,
	}, async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()
		try {
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'FailedRelayHandoff',
						alveoli: [
							{ coord: [0, 0], alveolus: 'storage', goods: { planks: 1 } },
							{ coord: [1, 0], alveolus: 'storage', goods: {} },
							{ coord: [2, 0], alveolus: 'storage', goods: {} },
						],
					},
				],
			}

			engine.loadScenario(scenario)

			const provider = engine.game.hex.getTile({ q: 0, r: 0 })?.content as Alveolus | undefined
			const relay = engine.game.hex.getTile({ q: 1, r: 0 })?.content as Alveolus | undefined
			const demander = engine.game.hex.getTile({ q: 2, r: 0 })?.content as Alveolus | undefined
			const hive = (provider?.hive ?? relay?.hive ?? demander?.hive) as Hive | undefined

			expect(provider).toBeDefined()
			expect(relay).toBeDefined()
			expect(demander).toBeDefined()
			expect(hive).toBeDefined()
			if (!provider || !relay || !demander || !hive) {
				throw new Error('Expected relay handoff scenario to be created')
			}

			expect(hive.createMovement('planks', provider, demander)).toBe(true)
			const movement = hive.movingGoods
				.get(toAxialCoord(provider.tile.position))
				?.find((candidate) => candidate.goodType === 'planks')
			expect(movement).toBeDefined()
			if (!movement) throw new Error('Expected plank movement from provider')

			movement.claimed = true
			movement.claimedBy = 'test-provider'
			movement.claimedAtMs = Date.now()
			handOffFirstHop(hive, movement, 'test.failed-handoff.first')
			movement.claimed = false
			delete movement.claimedBy
			delete movement.claimedAtMs

			const relayWorker = engine.spawnCharacter('relay-worker', { q: 1, r: 0 })
			relayWorker.assignedAlveolus = relay
			const step = relayWorker.scriptsContext.work.conveyStep()
			expect(step).toBeDefined()
			expect(movement.from).toMatchObject({ q: 1.5, r: 0 })

			movement.allocations.target.cancel('test.failed-handoff.invalid-target')
			;(globalThis as any).allowExpectedDiagnostics?.(
				/\[conveyStep\] Error in finished callback/,
				/invalid-target-allocation/
			)
			step?.finish()

			const hopStorage = hive.storageAt({ q: 1.5, r: 0 })
			expect(hopStorage?.stock.planks ?? 0).toBe(0)
			expect(hopStorage?.available('planks') ?? 0).toBe(0)
			expect(hopStorage?.allocated('planks') ?? 0).toBe(0)
			expect(engine.game.hex.looseGoods.getGoodsAt({ q: 0.5, r: 0 })).toEqual(
				expect.arrayContaining([expect.objectContaining({ goodType: 'planks', available: true })])
			)
		} finally {
			await engine.destroy()
		}
	})
})
