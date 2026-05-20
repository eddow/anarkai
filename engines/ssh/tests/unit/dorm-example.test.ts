import { BasicDwelling } from 'ssh/board/content/basic-dwelling'
import { BuildDwelling } from 'ssh/board/content/build-dwelling'
import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import { collectDockedVehicleAdvertisementCandidates } from 'ssh/freight/vehicle-freight-dock'
import {
	collectVehicleAdvertisedJobs,
	collectVehicleWorkPicks,
} from 'ssh/freight/vehicle-work'
import { dorm } from 'ssh/game/exampleGames'
import { Game } from 'ssh/game/game'
import { BuildAlveolus } from 'ssh/hive/build'
import { EngineerAlveolus } from 'ssh/hive/engineer'
import { FreightBayAlveolus } from 'ssh/hive/freight-bay'
import type { TrackedMovement } from 'ssh/hive/hive'
import { StorageAlveolus } from 'ssh/hive/storage'
import { WorkFunctions } from 'ssh/npcs/context/work'
import { subject } from 'ssh/npcs/scripts'
import { DurationStep } from 'ssh/npcs/steps'
import { residentialBasicDwellingProject } from 'ssh/residential/constants'
import { trySpawnResidentialProject } from 'ssh/residential/demand'
import type { GoodType } from 'ssh/types/base'
import { afterEach, describe, expect, it } from 'vitest'

describe('dorm example game', () => {
	let game: Game

	afterEach(() => {
		game.destroy()
	})

	function stageFoundationGoods(tile: { content?: unknown }): void {
		if (tile.content instanceof UnBuiltLand) {
			tile.content.foundationStorage?.addGood('concrete', 1)
		}
	}

	function buildCurrentResidentialProject(storage: StorageAlveolus): void {
		const tile = [...game.hex.tiles].find((candidate) => {
			const content = candidate.content
			return content instanceof UnBuiltLand && content.project === residentialBasicDwellingProject
		})
		expect(tile).toBeDefined()
		if (!tile) return

		const builder = game.population.createCharacter(`Builder ${tile.uid}`, tile.position)
		const work = new WorkFunctions()
		Object.assign(work, { [subject]: builder })

		stageFoundationGoods(tile)
		const foundation = work.foundationStep() as DurationStep
		expect(foundation).toBeInstanceOf(DurationStep)
		foundation.tick(foundation.duration)
		expect(tile.content).toBeInstanceOf(BuildDwelling)
		if (!(tile.content instanceof BuildDwelling)) return

		for (const [good, qty] of Object.entries(tile.content.requiredGoods)) {
			const goodType = good as GoodType
			const quantity = qty ?? 0
			expect(storage.storage.available(goodType)).toBeGreaterThanOrEqual(quantity)
			storage.storage.removeGood(goodType, quantity)
			tile.content.storage.addGood(goodType, quantity)
		}

		const construction = work.constructionStep() as DurationStep
		expect(construction).toBeInstanceOf(DurationStep)
		construction.tick(construction.duration)
		expect(tile.content).toBeInstanceOf(BasicDwelling)
	}

	it('contains the residential construction hive and can build both zoned dwellings', async () => {
		game = new Game({ terrainSeed: 867, characterCount: 0 }, dorm)
		await game.loaded
		game.ticker.stop()

		const storage = game.hex.getTile({ q: 0, r: 0 })?.content
		const engineer = game.hex.getTile({ q: 1, r: 0 })?.content
		const bay = game.hex.getTile({ q: 0, r: 1 })?.content
		const chopperSite = game.hex.getTile({ q: 0, r: -1 })?.content
		expect(storage).toBeInstanceOf(StorageAlveolus)
		expect(engineer).toBeInstanceOf(EngineerAlveolus)
		expect(bay).toBeInstanceOf(FreightBayAlveolus)
		expect(chopperSite).toBeInstanceOf(BuildAlveolus)
		if (!(storage instanceof StorageAlveolus)) return
		if (!(chopperSite instanceof BuildAlveolus)) return

		expect(storage.storage.available('wood')).toBeGreaterThanOrEqual(4)
		expect(storage.storage.available('planks')).toBeGreaterThanOrEqual(2)
		expect(storage.storage.available('stone')).toBeGreaterThan(0)
		expect(chopperSite.target).toBe('tree_chopper')
		expect(chopperSite.requiredGoods.stone).toBeGreaterThan(0)
		expect(chopperSite.remainingNeeds.stone).toBe(chopperSite.requiredGoods.stone)
		expect(
			(chopperSite.advertisedNeeds.stone ?? 0) + chopperSite.storage.allocated('stone')
		).toBeGreaterThan(0)
		expect(
			(chopperSite.hive as unknown as { activeMovements: Set<unknown> }).activeMovements.size
		).toBeGreaterThan(0)
		expect(game.freightLines.map((line) => line.id)).toContain('Dorm:implicit-gather:0,1')
		expect(game.freightLines.map((line) => line.id)).not.toContain('Dorm:distribute:0,1')
		expect(game.freightLines.find((line) => line.id === 'Dorm:implicit-gather:0,1')?.cyclic).toBe(
			true
		)

		const burdened = game.hex.getTile({ q: 3, r: 0 })!
		const clear = game.hex.getTile({ q: 4, r: 0 })!
		expect(burdened.zone).toBe('residential')
		expect(clear.zone).toBe('residential')
		expect(burdened.isBurdened).toBe(true)
		expect(clear.isBurdened).toBe(false)

		game.population.createCharacter('Dorm A', { q: 2, r: 0 })
		game.population.createCharacter('Dorm B', { q: 2, r: 1 })

		trySpawnResidentialProject(game)
		expect((clear.content as UnBuiltLand).project).toBe(residentialBasicDwellingProject)
		buildCurrentResidentialProject(storage)

		for (const loose of [...burdened.looseGoods]) loose.remove()
		expect(burdened.isBurdened).toBe(false)
		trySpawnResidentialProject(game)
		expect((burdened.content as UnBuiltLand).project).toBe(residentialBasicDwellingProject)
		buildCurrentResidentialProject(storage)

		expect(clear.content).toBeInstanceOf(BasicDwelling)
		expect(burdened.content).toBeInstanceOf(BasicDwelling)
	})

	it('begins the exchange route at the burdening zone when loose goods are already useful there', async () => {
		game = new Game({ terrainSeed: 867, characterCount: 0 }, dorm)
		await game.loaded
		game.ticker.stop()

		const bayTile = game.hex.getTile({ q: 0, r: 1 })!
		const buildTile = game.hex.getTile({ q: 4, r: 0 })!
		const vehicle = game.vehicles.vehicle('Dorm:wheelbarrow')
		expect(vehicle).toBeDefined()
		expect(bayTile.content).toBeInstanceOf(FreightBayAlveolus)
		expect(bayTile.isBurdened).toBe(true)

		game.population.createCharacter('Dorm resident A', { q: 2, r: 0 })
		game.population.createCharacter('Dorm resident B', { q: 2, r: 1 })
		trySpawnResidentialProject(game)
		expect((buildTile.content as UnBuiltLand).project).toBe(residentialBasicDwellingProject)
		stageFoundationGoods(buildTile)

		const builder = game.population.createCharacter('Residential builder', buildTile.position)
		const work = new WorkFunctions()
		Object.assign(work, { [subject]: builder })
		const foundation = work.foundationStep() as DurationStep
		expect(foundation).toBeInstanceOf(DurationStep)
		foundation.tick(foundation.duration)
		expect(buildTile.content).toBeInstanceOf(BuildDwelling)
		if (!(buildTile.content instanceof BuildDwelling) || !vehicle) return
		expect(buildTile.content.remainingNeeds.wood).toBeGreaterThan(0)

		const driver = game.population.createCharacter('Dorm driver', bayTile.position)

		const picks = collectVehicleWorkPicks(game, driver)
		const exchange = picks.find(
			(pick) =>
				pick.job.job === 'vehicleHop' &&
				pick.job.lineId === 'Dorm:implicit-gather:0,1' &&
				pick.job.needsBeginService
			)
			expect(exchange).toBeDefined()
			if (!exchange || exchange.job.job !== 'vehicleHop') return
			expect(exchange.job.dockEnter).toBe(false)
			expect(exchange.job.stopId).toBe('Dorm:gather-zone')
			expect(exchange.job.zoneBrowseAction).toBe('load')
			expect(exchange.job.goodType).toBe('wood')
			expect(exchange.job.targetCoord).toMatchObject({ q: 3, r: 0 })
		})

	it('refreshes dock demand when downstream construction appears after docking', async () => {
		game = new Game({ terrainSeed: 867, characterCount: 0 }, dorm)
		await game.loaded
		game.ticker.stop()

		const bayTile = game.hex.getTile({ q: 0, r: 1 })!
		const bay = bayTile.content as FreightBayAlveolus
		const buildTile = game.hex.getTile({ q: 4, r: 0 })!
		const vehicle = game.vehicles.vehicle('Dorm:wheelbarrow')
		expect(vehicle).toBeDefined()
		expect(bay).toBeInstanceOf(FreightBayAlveolus)
		if (!vehicle) return

		const line = game.freightLines.find((candidate) => candidate.id === 'Dorm:implicit-gather:0,1')
		const stop = line?.stops.find((candidate) => candidate.id === 'Dorm:gather-unload')
		expect(line).toBeDefined()
		expect(stop).toBeDefined()
		if (!line || !stop) return

		const driver = game.population.createCharacter('Dorm early dock driver', bayTile.position)
		vehicle.beginLineService(line, stop, driver)
		vehicle.dock()
		expect(vehicle.isDocked).toBe(true)
		expect(collectDockedVehicleAdvertisementCandidates(vehicle, bay)).toHaveLength(0)

		game.population.createCharacter('Dorm late resident A', { q: 2, r: 0 })
		game.population.createCharacter('Dorm late resident B', { q: 2, r: 1 })
		trySpawnResidentialProject(game)
		expect((buildTile.content as UnBuiltLand).project).toBe(residentialBasicDwellingProject)
		stageFoundationGoods(buildTile)

		const builder = game.population.createCharacter('Late residential builder', buildTile.position)
		const work = new WorkFunctions()
		Object.assign(work, { [subject]: builder })
		const foundation = work.foundationStep() as DurationStep
		expect(foundation).toBeInstanceOf(DurationStep)
		foundation.tick(foundation.duration)
		expect(buildTile.content).toBeInstanceOf(BuildDwelling)

		const dock = bay.hive.freightVehicleDockFor(vehicle.uid)
		expect(dock).toBeDefined()
		if (!dock) return
		bay.hive.unregisterFreightVehicleDock(vehicle.uid)
		expect(bay.hive.freightVehicleDockFor(vehicle.uid)).toBeUndefined()
		const activeMovements = (bay.hive as unknown as { activeMovements: Set<TrackedMovement> })
			.activeMovements
		expect(
			Array.from(activeMovements).filter((movement) => movement.demander === dock)
		).toHaveLength(0)

		expect(collectDockedVehicleAdvertisementCandidates(vehicle, bay)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ goodType: 'wood', advertisement: 'demand' }),
			])
		)
		const advertisedJobs = collectVehicleAdvertisedJobs(game, vehicle)
		expect(advertisedJobs.some((job) => job.job === 'convey')).toBe(true)
		const providerConvey = advertisedJobs.find((job) => job.job === 'convey')
		expect(providerConvey?.source.kind).toBe('alveolus')
		if (providerConvey?.source.kind === 'alveolus') {
			expect(providerConvey.source.alveolus).toBe(game.hex.getTile({ q: 0, r: 0 })?.content)
		}
		const repairedDock = bay.hive.freightVehicleDockFor(vehicle.uid)
		expect(repairedDock).toBeDefined()
		expect(Array.from(activeMovements).some((movement) => movement.demander === repairedDock)).toBe(
			true
		)
		const storageAlveolus = game.hex.getTile({ q: 0, r: 0 })?.content as StorageAlveolus | undefined
		expect(storageAlveolus).toBeInstanceOf(StorageAlveolus)
		if (!storageAlveolus) return
		const carrier = game.population.createCharacter('Late dock carrier', { q: 0, r: 0 })
		if (storageAlveolus.assignedWorker) storageAlveolus.assignedWorker.assignedAlveolus = undefined
		storageAlveolus.assignedWorker = undefined
		carrier.assignedAlveolus = storageAlveolus
		storageAlveolus.assignedWorker = carrier
		const carrierConvey = carrier.workPlannerSnapshot?.ranked.find(
			(candidate) => candidate.jobKind === 'convey'
		)
		expect(carrierConvey?.targetCoord).toEqual({ q: 0, r: 0 })
		carrier.hunger = 0
		carrier.fatigue = 0
		carrier.tiredness = 0
		const carrierAction = carrier.findAction()
		expect(
			carrierAction,
			JSON.stringify({
				actionDescription: carrier.actionDescription,
				snapshot: carrier.lastWorkPlannerSnapshot,
				storageGoodMovement: storageAlveolus.aGoodMovement?.map(({ movement, fromSnapshot }) => ({
					goodType: movement.goodType,
					from: { q: fromSnapshot.q, r: fromSnapshot.r },
					path: movement.path.map(({ q, r }) => ({ q, r })),
					claimed: movement.claimed,
				})),
			})
		).toBeTruthy()
		if (carrierAction) carrier.begin(carrierAction)
		expect(carrier.actionDescription).toContain('work.convey')
		expect(
			carrier.stepExecutor?.description,
			JSON.stringify({
				actionDescription: carrier.actionDescription,
				stepType: carrier.stepExecutor?.constructor.name,
				stepDescription: carrier.stepExecutor?.description,
				storageGoodMovement: storageAlveolus.aGoodMovement?.map(({ movement, fromSnapshot }) => ({
					goodType: movement.goodType,
					from: { q: fromSnapshot.q, r: fromSnapshot.r },
					path: movement.path.map(({ q, r }) => ({ q, r })),
					claimed: movement.claimed,
				})),
			})
		).toContain('convey.')
		for (let tick = 0; tick < 40; tick++) {
			if (
				Array.from(activeMovements).some(
					(movement) =>
						movement.demander === repairedDock &&
						movement.path.length === 1 &&
						!Number.isInteger(movement.from.r)
				)
			) {
				break
			}
			carrier.update(0.25)
		}
		expect(
			Array.from(activeMovements).some(
				(movement) => movement.demander === repairedDock && movement.path.length === 1
			),
			JSON.stringify({
				actionDescription: carrier.actionDescription,
				stepEnded: carrier.stepExecutor?.ended,
				position: carrier.position,
				storageGoodMovement: storageAlveolus.aGoodMovement?.map(({ movement, fromSnapshot }) => ({
					goodType: movement.goodType,
					from: { q: fromSnapshot.q, r: fromSnapshot.r },
					path: movement.path.map(({ q, r }) => ({ q, r })),
					claimed: movement.claimed,
				})),
				activeMovements: Array.from(activeMovements).map((movement) => ({
					goodType: movement.goodType,
					provider: movement.provider.name,
					demander: movement.demander.name,
					from: { q: movement.from.q, r: movement.from.r },
					path: movement.path.map(({ q, r }) => ({ q, r })),
					claimed: movement.claimed,
					ref: String((movement.ref as { id?: unknown }).id ?? movement.ref),
					debug: movement._debug,
				})),
				vehicleStock: vehicle.storage.stock,
				vehicleVirtualGoodsCount: vehicle.storage.virtualGoodsCount,
				movingGoodsAtStorage: (
					(
						bay.hive as unknown as {
							movingGoods: { get(coord: { q: number; r: number }): TrackedMovement[] | undefined }
						}
					).movingGoods.get({ q: 0, r: 0 }) ?? []
				).map((movement) => ({
					goodType: movement.goodType,
					from: { q: movement.from.q, r: movement.from.r },
					path: movement.path.map(({ q, r }) => ({ q, r })),
					selectable: bay.hive.isSelectableMovement(movement, { q: 0, r: 0 }, 'test.debug'),
				})),
			})
		).toBe(true)

		const bayCarrier = game.population.createCharacter('Late bay carrier', { q: 1, r: 0 })
		if (bay.assignedWorker) bay.assignedWorker.assignedAlveolus = undefined
		bay.assignedWorker = undefined
		bayCarrier.assignedAlveolus = bay
		bay.assignedWorker = bayCarrier
		bayCarrier.hunger = 0
		bayCarrier.fatigue = 0
		bayCarrier.tiredness = 0
		expect(bay.getJob(bayCarrier)?.job).toBe('convey')
	})
})
