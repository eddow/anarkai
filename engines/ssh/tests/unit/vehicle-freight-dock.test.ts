import { jobBalance } from 'engine-rules'
import { BuildDwelling } from 'ssh/board/content/build-dwelling'
import { namedTrace, traces } from 'ssh/dev/debug'
import type { FreightLineDefinition } from 'ssh/freight/freight-line'
import { normalizeFreightLineDefinition } from 'ssh/freight/freight-line'
import { migrateV1FiltersToGoodsSelection } from 'ssh/freight/goods-selection-policy'
import {
	collectDockedVehicleAdvertisementCandidates,
	dockedVehicleGoodsRelations,
} from 'ssh/freight/vehicle-freight-dock'
import {
	maybeAdvanceVehicleFromCompletedAnchorStop,
	pickInitialVehicleServiceCandidate,
} from 'ssh/freight/vehicle-run'
import { findVehicleHopJob, findVehicleOffloadJob } from 'ssh/freight/vehicle-work'
import type { SaveState } from 'ssh/game'
import type { FreightBayAlveolus } from 'ssh/hive/freight-bay'
import type { TrackedMovement } from 'ssh/hive/hive'
import type { StorageAlveolus } from 'ssh/hive/storage'
import { isVehicleLineService } from 'ssh/population/vehicle/vehicle'
import { describe, expect, it } from 'vitest'
import { distributeFreightLine, gatherFreightLine } from '../freight-fixtures'
import { TestEngine } from '../test-engine'

const woodOnly = migrateV1FiltersToGoodsSelection(['wood'])

function freightBayAnchor(hiveName: string, coord: readonly [number, number]) {
	return {
		kind: 'alveolus' as const,
		hiveName,
		alveolusType: 'freight_bay' as const,
		coord,
	}
}

describe('vehicle-freight-dock', () => {
	it('can provide surplus cargo while demanding downstream-needed goods at the same dock', async () => {
		const engine = new TestEngine({ terrainSeed: 12007, characterCount: 0 })
		await engine.init()
		try {
			const line: FreightLineDefinition = normalizeFreightLineDefinition({
				id: 'dock:mixed',
				name: 'Dock mixed',
				stops: [
					{ id: 'current', loadSelection: woodOnly, anchor: freightBayAnchor('A', [0, 0]) },
					{ id: 'future-load', loadSelection: woodOnly, anchor: freightBayAnchor('B', [2, 0]) },
					{ id: 'future-need', zone: { kind: 'radius', center: [4, 0], radius: 1 } },
				],
			})
			engine.loadScenario({
				hives: [
					{
						name: 'A',
						alveoli: [
							{ coord: [0, 0], alveolus: 'freight_bay', goods: { wood: 1 } },
							{ coord: [1, 0], alveolus: 'storage', goods: { wood: 1 } },
						],
					},
					{ name: 'B', alveoli: [{ coord: [2, 0], alveolus: 'freight_bay', goods: { wood: 1 } }] },
				],
				freightLines: [line],
			} satisfies Partial<SaveState>)

			for (const coord of [
				{ q: 4, r: 0 },
				{ q: 5, r: 0 },
			]) {
				const tile = engine.game.hex.getTile(coord)!
				tile.content = new BuildDwelling(tile, 'basic_dwelling')
			}

			const bay = engine.game.hex.getTile({ q: 0, r: 0 })?.content as FreightBayAlveolus | undefined
			expect(bay).toBeDefined()

			const vehicle = engine.game.vehicles.createVehicle('dock-v', 'wheelbarrow', { q: 0, r: 0 }, [
				line,
			])
			vehicle.storage.addGood('berries', 1)
			vehicle.beginLineService(line, line.stops[0]!)
			if (!isVehicleLineService(vehicle.service)) throw new Error('expected line service')
			vehicle.service.docked = true
			vehicle.position = undefined

			const relations = dockedVehicleGoodsRelations(vehicle, bay!)
			const candidates = collectDockedVehicleAdvertisementCandidates(vehicle, bay!)

			expect(relations.berries?.advertisement).toBe('provide')
			expect(relations.berries?.priority).toBe('2-use')
			expect(relations.wood?.advertisement).toBe('demand')
			expect(relations.wood?.priority).toBe('2-use')
			expect(candidates).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ goodType: 'berries', advertisement: 'provide', quantity: 1 }),
					expect.objectContaining({ goodType: 'wood', advertisement: 'demand', quantity: 3 }),
				])
			)
			for (const candidate of candidates) {
				expect(candidate.score).toBeGreaterThan(0)
			}
		} finally {
			await engine.destroy()
		}
	})

	it('creates a convey unload from a docked gather vehicle into its own gather-only bay', async () => {
		const engine = new TestEngine({ terrainSeed: 12008, characterCount: 0 })
		await engine.init()
		try {
			const line = gatherFreightLine({
				id: 'dock:gather-unload',
				name: 'Dock gather unload',
				hiveName: 'DockGather',
				coord: [0, 0],
				filters: ['wood'],
				radius: 2,
			})
			engine.loadScenario({
				hives: [
					{
						name: 'DockGather',
						alveoli: [
							{ coord: [0, 0], alveolus: 'freight_bay', goods: {} },
							{ coord: [1, 0], alveolus: 'sawmill', goods: {} },
						],
					},
				],
				freightLines: [line],
			} satisfies Partial<SaveState>)

			const bay = engine.game.hex.getTile({ q: 0, r: 0 })?.content as FreightBayAlveolus | undefined
			expect(bay).toBeDefined()
			expect(bay?.canTake('wood', '2-use')).toBe(false)

			const vehicle = engine.game.vehicles.createVehicle(
				'dock-gather-v',
				'wheelbarrow',
				{ q: 0, r: 0 },
				[line]
			)
			vehicle.storage.addGood('wood', 1)
			vehicle.beginLineService(line, line.stops[1]!)
			if (!isVehicleLineService(vehicle.service)) throw new Error('expected line service')
			vehicle.dock()
			expect(vehicle.position).toBeUndefined()
			expect(vehicle.effectiveTile.uid).toBe(bay?.tile.uid)
			expect(bay?.hive.freightVehicleDockFor(vehicle.uid)).toBeDefined()
			await new Promise((resolve) => setTimeout(resolve, 10))

			const worker = engine.game.population.createCharacter('DockConvey', { q: 0, r: 0 })
			expect(bay?.getJob(worker)?.job).toBe('convey')
		} finally {
			await engine.destroy()
		}
	})

	it('keeps dock convey offered for a loaded gather vehicle after forty in-game minutes', async () => {
		const engine = new TestEngine({ terrainSeed: 12018, characterCount: 0 })
		await engine.init()
		try {
			const line = gatherFreightLine({
				id: 'dock:gather-forty-minutes',
				name: 'Dock gather forty minutes',
				hiveName: 'DockForty',
				coord: [0, 0],
				filters: ['wood'],
				radius: 2,
			})
			engine.loadScenario({
				hives: [
					{
						name: 'DockForty',
						alveoli: [
							{ coord: [0, 0], alveolus: 'freight_bay', goods: {} },
							{ coord: [1, 0], alveolus: 'sawmill', goods: {} },
						],
					},
				],
				freightLines: [line],
			} satisfies Partial<SaveState>)

			const bay = engine.game.hex.getTile({ q: 0, r: 0 })?.content as FreightBayAlveolus | undefined
			expect(bay).toBeDefined()
			const vehicle = engine.game.vehicles.createVehicle(
				'dock-forty-v',
				'wheelbarrow',
				{ q: 0, r: 0 },
				[line]
			)
			vehicle.storage.addGood('wood', 1)
			vehicle.beginLineService(line, line.stops[1]!)
			vehicle.dock()

			const immediateAdvertisedConvey = vehicle.advertisedJobs.find((job) => job.job === 'convey')
			expect(immediateAdvertisedConvey).toBeDefined()

			engine.tick(40 * 60, 10)
			await new Promise((resolve) => setTimeout(resolve, 10))

			const worker = engine.game.population.createCharacter('DockFortyConvey', { q: 1, r: 0 })
			expect(vehicle.storage.stock.wood).toBe(1)
			const bayJob = bay?.proposedJobs.find((job) => job.job === 'convey')
			const advertisedConvey = vehicle.advertisedJobs.find((job) => job.job === 'convey')
			expect(bay?.getJob(worker)?.job).toBe('convey')
			expect(bayJob).toBeDefined()
			expect(advertisedConvey?.source.kind).toBe('alveolus')
			if (advertisedConvey?.source.kind === 'alveolus')
				expect(advertisedConvey.source.alveolus).toBe(bay)
			const workerConvey = worker.workPlannerSnapshot?.ranked.find(
				(candidate) => candidate.jobKind === 'convey'
			)
			expect(workerConvey?.targetCoord).toEqual({ q: 0, r: 0 })
			expect(workerConvey?.pathLength).toBeGreaterThan(0)
			const action = worker.findAction()
			expect(action).toBeTruthy()
			if (action) worker.begin(action)
			for (let i = 0; i < 200 && (vehicle.storage.stock.wood ?? 0) > 0; i++) {
				engine.tick(0.1, 0.1)
			}
			expect(vehicle.storage.stock.wood ?? 0).toBe(0)
			expect(bay?.storage.stock.wood ?? 0).toBe(0)
			expect(vehicle.proposedJobs.map((job) => job.job)).not.toContain('convey')
		} finally {
			await engine.destroy()
		}
	})

	it('offers dock unload when general storage can take surplus cargo', async () => {
		const engine = new TestEngine({ terrainSeed: 12020, characterCount: 0 })
		await engine.init()
		try {
			const line = gatherFreightLine({
				id: 'dock:full-bay-surplus',
				name: 'Dock full bay surplus',
				hiveName: 'DockFullBay',
				coord: [0, 0],
				filters: ['wood'],
				radius: 2,
			})
			engine.loadScenario({
				hives: [
					{
						name: 'DockFullBay',
						alveoli: [
							{ coord: [0, 0], alveolus: 'freight_bay', goods: {} },
							{
								coord: [1, 0],
								alveolus: 'storage',
								goods: {},
								configuration: {
									ref: { scope: 'individual' },
									individual: {
										working: true,
										generalSlots: 0,
										goods: { wood: { minSlots: 1, maxSlots: 1 } },
									},
								},
							},
						],
					},
				],
				freightLines: [line],
			} satisfies Partial<SaveState>)

			const bay = engine.game.hex.getTile({ q: 0, r: 0 })?.content as FreightBayAlveolus | undefined
			const storage = engine.game.hex.getTile({ q: 1, r: 0 })?.content as
				| StorageAlveolus
				| undefined
			expect(bay).toBeDefined()
			expect(storage).toBeDefined()
			if (!bay || !storage) throw new Error('Expected freight bay and storage')

			expect(bay.storage.hasRoom('wood')).toBe(0)
			expect(storage.canTake('wood', '0-store')).toBe(true)

			const vehicle = engine.game.vehicles.createVehicle(
				'dock-full-bay-v',
				'wheelbarrow',
				{ q: 0, r: 0 },
				[line]
			)
			vehicle.storage.addGood('wood', 1)
			vehicle.beginLineService(line, line.stops[1]!)
			if (!isVehicleLineService(vehicle.service)) throw new Error('expected line service')
			vehicle.service.docked = true
			vehicle.position = undefined

			const candidates = collectDockedVehicleAdvertisementCandidates(vehicle, bay)
			expect(candidates).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ goodType: 'wood', advertisement: 'provide' }),
				])
			)
			expect(vehicle.advertisedJobs.find((job) => job.job === 'convey')?.source.kind).toBe(
				'alveolus'
			)

			vehicle.dock()
			await new Promise((resolve) => setTimeout(resolve, 10))
			const worker = engine.game.population.createCharacter('DockFullBayWorker', { q: 0, r: 0 })
			const advertisedConvey = vehicle.advertisedJobs.find((job) => job.job === 'convey')
			expect(advertisedConvey?.source.kind).toBe('alveolus')
			expect(bay.getJob(worker)?.job).toBe('convey')
			const workerConvey = worker.workPlannerSnapshot?.ranked.find(
				(candidate) => candidate.jobKind === 'convey'
			)
			expect(workerConvey?.targetCoord).toEqual({ q: 0, r: 0 })
		} finally {
			await engine.destroy()
		}
	})

	it('lets reachable workers rank dock convey even when the bay has another assigned worker', async () => {
		const engine = new TestEngine({ terrainSeed: 12018, characterCount: 0 })
		await engine.init()
		try {
			const line = gatherFreightLine({
				id: 'dock:gather-assigned-convey',
				name: 'Dock gather assigned convey',
				hiveName: 'DockAssignedConvey',
				coord: [0, 0],
				filters: ['wood'],
				radius: 2,
			})
			engine.loadScenario({
				hives: [
					{
						name: 'DockAssignedConvey',
						alveoli: [
							{ coord: [0, 0], alveolus: 'freight_bay', goods: {} },
							{ coord: [1, 0], alveolus: 'sawmill', goods: {} },
						],
					},
				],
				freightLines: [line],
			} satisfies Partial<SaveState>)

			const bay = engine.game.hex.getTile({ q: 0, r: 0 })?.content as FreightBayAlveolus | undefined
			expect(bay).toBeDefined()
			if (!bay) throw new Error('Expected freight bay')
			const vehicle = engine.game.vehicles.createVehicle(
				'dock-assigned-convey-v',
				'wheelbarrow',
				{ q: 0, r: 0 },
				[line]
			)
			vehicle.storage.addGood('wood', 1)
			vehicle.beginLineService(line, line.stops[1]!)
			vehicle.dock()

			const assignedWorker = engine.game.population.createCharacter('AssignedDockWorker', {
				q: 2,
				r: 0,
			})
			bay.assignedWorker = assignedWorker
			assignedWorker.assignedAlveolus = bay
			const worker = engine.game.population.createCharacter('UnassignedDockConveyWorker', {
				q: 1,
				r: 0,
			})

			expect(vehicle.advertisedJobs.find((job) => job.job === 'convey')).toBeDefined()
			const workerConvey = worker.workPlannerSnapshot?.ranked.find(
				(candidate) => candidate.jobKind === 'convey'
			)
			expect(workerConvey?.targetCoord).toEqual({ q: 0, r: 0 })
			const action = worker.findAction()
			expect(action).toBeTruthy()
			expect(() => {
				if (action) worker.begin(action)
			}).not.toThrow()
		} finally {
			await engine.destroy()
		}
	})

	it('always exposes a proposal for a docked vehicle even when empty and drained', async () => {
		const engine = new TestEngine({ terrainSeed: 12019, characterCount: 0 })
		await engine.init()
		try {
			const line = gatherFreightLine({
				id: 'dock:empty-proposal',
				name: 'Dock empty proposal',
				hiveName: 'DockEmptyProposal',
				coord: [0, 0],
				filters: ['wood'],
				radius: 2,
			})
			engine.loadScenario({
				hives: [
					{
						name: 'DockEmptyProposal',
						alveoli: [{ coord: [0, 0], alveolus: 'freight_bay', goods: {} }],
					},
				],
				freightLines: [line],
			} satisfies Partial<SaveState>)

			const vehicle = engine.game.vehicles.createVehicle(
				'dock-empty-proposal-v',
				'wheelbarrow',
				{ q: 0, r: 0 },
				[line]
			)
			vehicle.beginLineService(line, line.stops[1]!)
			vehicle.dock()

			const jobs = vehicle.proposedJobs
			expect(jobs.length).toBeGreaterThan(0)
			expect(jobs.map((job) => job.job)).toContain('vehicleOffload')
			expect(jobs.find((job) => job.job === 'vehicleOffload')?.maintenanceKind).toBe('park')
			const worker = engine.game.population.createCharacter('DockEmptyProposalWorker', {
				q: 1,
				r: 0,
			})
			const ranked = worker.workPlannerSnapshot?.ranked.find(
				(candidate) =>
					candidate.jobKind === 'vehicleOffload' &&
					candidate.targetCoord.q === 0 &&
					candidate.targetCoord.r === 0
			)
			expect(ranked).toBeDefined()
			const action = worker.findAction()
			expect(action).toBeTruthy()
		} finally {
			await engine.destroy()
		}
	})

	it('ends an empty final dock halt and exposes a park job once dock work is drained', async () => {
		const engine = new TestEngine({ terrainSeed: 12009, characterCount: 0 })
		await engine.init()
		try {
			const line = gatherFreightLine({
				id: 'dock:gather-finished',
				name: 'Dock gather finished',
				hiveName: 'DockDone',
				coord: [0, 0],
				filters: ['wood'],
				radius: 2,
			})
			engine.loadScenario({
				tiles: [
					{ coord: [0, 0], terrain: 'concrete' },
					{ coord: [1, 0], terrain: 'grass' },
				],
				hives: [
					{
						name: 'DockDone',
						alveoli: [{ coord: [0, 0], alveolus: 'freight_bay', goods: {} }],
					},
				],
				freightLines: [line],
			} satisfies Partial<SaveState>)

			const bay = engine.game.hex.getTile({ q: 0, r: 0 })?.content as FreightBayAlveolus | undefined
			expect(bay).toBeDefined()
			const vehicle = engine.game.vehicles.createVehicle(
				'dock-finished-v',
				'wheelbarrow',
				{ q: 0, r: 0 },
				[line]
			)
			const previousVehicleTrace = traces.vehicle
			const vehicleTrace = namedTrace('vehicle', { silent: true })
			traces.vehicle = vehicleTrace
			try {
				vehicle.beginLineService(line, line.stops[1]!)
				vehicle.dock()
				expect(vehicle.position).toBeUndefined()
				expect(vehicle.effectiveTile.uid).toBe(bay?.tile.uid)
				expect(bay?.hive.freightVehicleDockFor(vehicle.uid)).toBeDefined()
				await new Promise((resolve) => setTimeout(resolve, 10))
			} finally {
				traces.vehicle = previousVehicleTrace
			}

			const worker = engine.game.population.createCharacter('DockFinishConvey', { q: 0, r: 0 })
			expect(vehicle.service).toBeUndefined()
			expect(vehicle.position && { q: vehicle.position.q, r: vehicle.position.r }).toEqual({
				q: 0,
				r: 0,
			})
			expect(bay?.hive.freightVehicleDockFor(vehicle.uid)).toBeUndefined()
			const traceDump = vehicleTrace.read()
			expect(traceDump).toContain('vehicleJob.dock.complete')
			expect(traceDump).not.toContain('not-alveolus-tile')
			const park = findVehicleOffloadJob(engine.game, worker)
			expect(park?.job).toBe('vehicleOffload')
			expect(park?.maintenanceKind).toBe('park')
		} finally {
			await engine.destroy()
		}
	})

	it('waits on active dock movements before completing a drained halt', async () => {
		const engine = new TestEngine({ terrainSeed: 12011, characterCount: 0 })
		await engine.init()
		try {
			const line = gatherFreightLine({
				id: 'dock:gather-broken-pending',
				name: 'Dock gather broken pending',
				hiveName: 'DockBrokenPending',
				coord: [0, 0],
				filters: ['wood'],
				radius: 2,
			})
			engine.loadScenario({
				tiles: [
					{ coord: [0, 0], terrain: 'concrete' },
					{ coord: [1, 0], terrain: 'grass' },
				],
				hives: [
					{
						name: 'DockBrokenPending',
						alveoli: [
							{ coord: [0, 0], alveolus: 'freight_bay', goods: {} },
							{ coord: [1, 0], alveolus: 'sawmill', goods: {} },
						],
					},
				],
				freightLines: [line],
			} satisfies Partial<SaveState>)

			const bay = engine.game.hex.getTile({ q: 0, r: 0 })?.content as FreightBayAlveolus | undefined
			expect(bay).toBeDefined()
			const vehicle = engine.game.vehicles.createVehicle(
				'dock-broken-pending-v',
				'wheelbarrow',
				{ q: 0, r: 0 },
				[line]
			)
			vehicle.storage.addGood('wood', 1)
			vehicle.beginLineService(line, line.stops[1]!)
			vehicle.dock()

			const dock = bay?.hive.freightVehicleDockFor(vehicle.uid)
			expect(dock).toBeDefined()
			await new Promise((resolve) => setTimeout(resolve, 10))
			const activeMovements = (bay?.hive as unknown as { activeMovements: Set<TrackedMovement> })
				.activeMovements
			const movement = Array.from(activeMovements).find((candidate) => candidate.provider === dock)
			expect(movement).toBeDefined()
			expect(vehicle.storage.virtualGoodsCount).toBe(1)
			const worker = engine.game.population.createCharacter('DockBrokenPendingWorker', {
				q: 0,
				r: 0,
			})
			maybeAdvanceVehicleFromCompletedAnchorStop(engine.game, vehicle, worker)
			expect(isVehicleLineService(vehicle.service)).toBe(true)

			movement?.allocations.source?.fulfill()
			expect(vehicle.storage.stock.wood ?? 0).toBe(0)
			expect(vehicle.storage.virtualGoodsCount).toBe(0)
			maybeAdvanceVehicleFromCompletedAnchorStop(engine.game, vehicle, worker)

			expect(isVehicleLineService(vehicle.service)).toBe(true)
			expect(bay?.hive.freightVehicleDockFor(vehicle.uid)).toBeDefined()
		} finally {
			await engine.destroy()
		}
	})

	it('advances a non-final drained dock halt so the next hop is offered', async () => {
		const engine = new TestEngine({ terrainSeed: 12010, characterCount: 0 })
		await engine.init()
		try {
			const line: FreightLineDefinition = normalizeFreightLineDefinition({
				id: 'dock:continue',
				name: 'Dock continue',
				stops: [
					{ id: 'current', anchor: freightBayAnchor('DockContinueA', [0, 0]) },
					{ id: 'next', anchor: freightBayAnchor('DockContinueB', [1, 0]) },
				],
			})
			engine.loadScenario({
				tiles: [
					{ coord: [0, 0], terrain: 'concrete' },
					{ coord: [1, 0], terrain: 'concrete' },
				],
				hives: [
					{
						name: 'DockContinueA',
						alveoli: [{ coord: [0, 0], alveolus: 'freight_bay', goods: {} }],
					},
					{
						name: 'DockContinueB',
						alveoli: [{ coord: [1, 0], alveolus: 'freight_bay', goods: {} }],
					},
				],
				freightLines: [line],
			} satisfies Partial<SaveState>)

			const bay = engine.game.hex.getTile({ q: 0, r: 0 })?.content as FreightBayAlveolus | undefined
			expect(bay).toBeDefined()
			const vehicle = engine.game.vehicles.createVehicle(
				'dock-continue-v',
				'wheelbarrow',
				{ q: 0, r: 0 },
				[line]
			)
			vehicle.beginLineService(line, line.stops[0]!)
			vehicle.dock()
			expect(vehicle.position).toBeUndefined()
			const worker = engine.game.population.createCharacter('DockContinueWorker', { q: 0, r: 0 })

			maybeAdvanceVehicleFromCompletedAnchorStop(engine.game, vehicle, worker)

			expect(isVehicleLineService(vehicle.service)).toBe(true)
			if (!isVehicleLineService(vehicle.service)) throw new Error('expected line service')
			expect(vehicle.service.stop.id).toBe('next')
			expect(vehicle.service.docked).toBe(false)
			expect(vehicle.position && { q: vehicle.position.q, r: vehicle.position.r }).toEqual({
				q: 0,
				r: 0,
			})
			const hop = findVehicleHopJob(engine.game, worker)
			expect(hop?.job).toBe('vehicleHop')
			expect(hop?.stopId).toBe('next')
		} finally {
			await engine.destroy()
		}
	})

	it('keeps a distribute dock load parked while downstream dock demand remains', async () => {
		const engine = new TestEngine({ terrainSeed: 12012, characterCount: 0 })
		await engine.init()
		try {
			const line = distributeFreightLine({
				id: 'dock:distribute-load',
				name: 'Dock distribute load',
				hiveName: 'DockDistributeLoad',
				coord: [0, 0],
				filters: ['wood'],
				unloadRadius: 1,
			})
			engine.loadScenario({
				tiles: [{ coord: [0, 0], terrain: 'concrete' }],
				hives: [
					{
						name: 'DockDistributeLoad',
						alveoli: [
							{ coord: [0, 0], alveolus: 'freight_bay', goods: { wood: 1 } },
							{ coord: [1, 0], alveolus: 'storage', goods: {} },
						],
					},
				],
				freightLines: [line],
			} satisfies Partial<SaveState>)
			const constructionTile = engine.game.hex.getTile({ q: 0, r: -1 })!
			constructionTile.content = new BuildDwelling(constructionTile, 'basic_dwelling')

			const bay = engine.game.hex.getTile({ q: 0, r: 0 })?.content as FreightBayAlveolus | undefined
			expect(bay).toBeDefined()
			const vehicle = engine.game.vehicles.createVehicle(
				'dock-distribute-load-v',
				'wheelbarrow',
				{ q: 0, r: 0 },
				[line]
			)
			vehicle.beginLineService(line, line.stops[0]!)
			vehicle.dock()
			const dock = bay?.hive.freightVehicleDockFor(vehicle.uid)
			expect(dock).toBeDefined()
			expect(vehicle.storage.virtualGoodsCount).toBe(0)

			const worker = engine.game.population.createCharacter('DockDistributeLoadWorker', {
				q: 0,
				r: 0,
			})
			maybeAdvanceVehicleFromCompletedAnchorStop(engine.game, vehicle, worker)
			expect(isVehicleLineService(vehicle.service)).toBe(true)
			if (!isVehicleLineService(vehicle.service)) throw new Error('expected line service')
			expect(vehicle.service.stop.id).toBe(line.stops[0]!.id)

			vehicle.storage.addGood('wood', 1)
			expect(vehicle.storage.stock.wood ?? 0).toBe(1)
			expect(vehicle.storage.virtualGoodsCount).toBe(0)
			maybeAdvanceVehicleFromCompletedAnchorStop(engine.game, vehicle, worker)

			expect(isVehicleLineService(vehicle.service)).toBe(true)
			if (!isVehicleLineService(vehicle.service)) throw new Error('expected line service')
			expect(vehicle.service.stop.id).toBe(line.stops[0]!.id)
			expect(collectDockedVehicleAdvertisementCandidates(vehicle, bay!)).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ goodType: 'wood', advertisement: 'demand' }),
				])
			)

			vehicle.storage.addGood('wood', 1)
			expect(collectDockedVehicleAdvertisementCandidates(vehicle, bay!)).toEqual([])
			maybeAdvanceVehicleFromCompletedAnchorStop(engine.game, vehicle, worker)

			expect(isVehicleLineService(vehicle.service)).toBe(true)
			if (!isVehicleLineService(vehicle.service)) throw new Error('expected line service')
			expect(vehicle.service.stop.id).toBe(line.stops[1]!.id)
			expect(vehicle.service.docked).toBe(false)
		} finally {
			await engine.destroy()
		}
	})

	it('advertises a convey job while an empty docked distribute vehicle can load from hive storage', async () => {
		const engine = new TestEngine({ terrainSeed: 12013, characterCount: 0 })
		await engine.init()
		try {
			const line = distributeFreightLine({
				id: 'dock:distribute-advertise',
				name: 'Dock distribute advertise',
				hiveName: 'DockDistributeAdvertise',
				coord: [0, 0],
				filters: ['wood'],
				unloadRadius: 1,
			})
			engine.loadScenario({
				tiles: [{ coord: [0, -1], terrain: 'grass' }],
				hives: [
					{
						name: 'DockDistributeAdvertise',
						alveoli: [
							{ coord: [0, 0], alveolus: 'freight_bay', goods: {} },
							{ coord: [1, 0], alveolus: 'storage', goods: { wood: 1 } },
						],
					},
				],
				freightLines: [line],
			} satisfies Partial<SaveState>)
			const constructionTile = engine.game.hex.getTile({ q: 0, r: -1 })!
			constructionTile.content = new BuildDwelling(constructionTile, 'basic_dwelling')

			const bay = engine.game.hex.getTile({ q: 0, r: 0 })?.content as FreightBayAlveolus | undefined
			expect(bay).toBeDefined()
			const vehicle = engine.game.vehicles.createVehicle(
				'dock-distribute-advertise-v',
				'wheelbarrow',
				{ q: 0, r: 0 },
				[line]
			)
			vehicle.beginLineService(line, line.stops[0]!)
			vehicle.dock()

			expect(collectDockedVehicleAdvertisementCandidates(vehicle, bay!)).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ goodType: 'wood', advertisement: 'demand' }),
				])
			)
			expect(vehicle.advertisedJobs).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						job: 'convey',
						source: expect.objectContaining({ kind: 'alveolus' }),
					}),
				])
			)
			expect(vehicle.proposedJobs).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						job: 'convey',
						vehicleUid: vehicle.uid,
						source: expect.objectContaining({ kind: 'vehicle' }),
					}),
				])
			)
		} finally {
			await engine.destroy()
		}
	})

	it('begins a distribute line from buffered hive stock when downstream construction needs it', async () => {
		const engine = new TestEngine({ terrainSeed: 12014, characterCount: 0 })
		await engine.init()
		try {
			const line = distributeFreightLine({
				id: 'dock:distribute-empty',
				name: 'Dock distribute empty',
				hiveName: 'DockDistributeEmpty',
				coord: [0, 0],
				filters: ['wood'],
				unloadRadius: 1,
			})
			engine.loadScenario({
				tiles: [{ coord: [0, -1], terrain: 'grass' }],
				hives: [
					{
						name: 'DockDistributeEmpty',
						alveoli: [
							{ coord: [0, 0], alveolus: 'freight_bay', goods: {} },
							{ coord: [1, 0], alveolus: 'storage', goods: {} },
						],
					},
				],
				freightLines: [line],
			} satisfies Partial<SaveState>)
			const constructionTile = engine.game.hex.getTile({ q: 0, r: -1 })!
			constructionTile.content = new BuildDwelling(constructionTile, 'basic_dwelling')

			const worker = engine.game.population.createCharacter('NoStockWorker', { q: 0, r: 0 })
			const vehicle = engine.game.vehicles.createVehicle(
				'dock-distribute-empty-v',
				'wheelbarrow',
				{ q: 0, r: 0 },
				[line]
			)

			const storage = engine.game.hex.getTile({ q: 1, r: 0 })?.content as
				| StorageAlveolus
				| undefined
			storage?.setBuffers({ wood: 1 })
			storage?.storage.addGood('wood', 1)
			expect(storage?.storage.available('wood')).toBe(1)
			expect(storage?.goodsRelations.wood?.advertisement).not.toBe('provide')
			const bufferedPick = pickInitialVehicleServiceCandidate(engine.game, worker, vehicle)
			expect(bufferedPick).toMatchObject({ line, stop: line.stops[0] })
			const neededWood = (constructionTile.content as BuildDwelling).remainingNeeds.wood ?? 0
			expect(bufferedPick?.urgency).toBe(
				jobBalance.vehicleBeginService * (Math.min(neededWood, 2) / 1)
			)

			storage?.storage.addGood('wood', 3)
			const pick = pickInitialVehicleServiceCandidate(engine.game, worker, vehicle)
			expect(pick).toMatchObject({ line, stop: line.stops[0] })
			expect(pick?.urgency).toBe(
				jobBalance.vehicleBeginService * (Math.min(neededWood, 2) / 4)
			)
		} finally {
			await engine.destroy()
		}
	})
})
