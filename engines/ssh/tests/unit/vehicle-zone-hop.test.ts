import { BuildDwelling } from 'ssh/board/content/build-dwelling'
import {
	type FreightStop,
	type FreightZoneDefinitionRadius,
	normalizeFreightLineDefinition,
} from 'ssh/freight/freight-line'
import {
	aggregateHiveNeedTypes,
	gatherZoneLoadStopForBay,
	pickGatherTargetInZoneStop,
} from 'ssh/freight/freight-zone-gather-target'
import { migrateV1FiltersToGoodsSelection } from 'ssh/freight/goods-selection-policy'
import {
	freightStopMovementTarget,
	maybeAdvanceVehicleFromCompletedAnchorStop,
	maybeAdvanceVehiclePastCompletedZoneStop,
	pickInitialVehicleServiceCandidate,
	previewInitialVehicleService,
	projectedLineStopForVehicleHop,
} from 'ssh/freight/vehicle-run'
import {
	collectVehicleAdvertisedJobs,
	findVehicleBeginServiceJob,
	findVehicleHopJob,
	findVehicleOffloadJob,
	findZoneBrowseJob,
} from 'ssh/freight/vehicle-work'
import { chopSaw } from 'ssh/game/exampleGames'
import type { GamePatches } from 'ssh/game/game'
import { Game } from 'ssh/game/game'
import type { StorageAlveolus } from 'ssh/hive/storage'
import { isVehicleLineService, isVehicleMaintenanceService } from 'ssh/population/vehicle/vehicle'
import type { WorkPlan } from 'ssh/types/base'
import { axial } from 'ssh/utils'
import { toAxialCoord } from 'ssh/utils/position'
import { afterEach, describe, expect, it } from 'vitest'
import { distributeFreightLine, gatherFreightLine } from '../freight-fixtures'
import { bindOperatedWheelbarrowOffload } from '../test-engine/vehicle-bind'

const woodOnly = migrateV1FiltersToGoodsSelection(['wood'])

function freightBayAnchor(hiveName: string, coord: readonly [number, number]) {
	return {
		kind: 'alveolus' as const,
		hiveName,
		alveolusType: 'freight_bay' as const,
		coord,
	}
}

describe('Vehicle zone hop semantics', () => {
	let game: Game

	afterEach(() => {
		game.destroy()
	})

	it('boarding binds maintenance offload service until line beginService attaches route', async () => {
		const patches = {
			tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }],
			freightLines: [
				gatherFreightLine({
					id: 'VH:test-gather',
					name: 'Test gather',
					hiveName: 'H',
					coord: [0, 0],
					filters: ['wood'],
					radius: 2,
				}),
			],
		}
		game = new Game({ terrainSeed: 9401, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines[0]!
		const vehicle = game.vehicles.createVehicle('v1', 'wheelbarrow', { q: 0, r: 0 }, [line])
		const character = game.population.createCharacter('Test', { q: 0, r: 0 })
		bindOperatedWheelbarrowOffload(character, vehicle)
		character.onboard()

		expect(character.driving).toBe(true)
		expect(isVehicleMaintenanceService(vehicle.service)).toBe(true)
	})

	it('docks an anchor stop from the adjacent border side', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'grass' as const },
				{ coord: [1, 0] as const, terrain: 'grass' as const },
			],
			hives: [
				{
					name: 'BorderDock',
					alveoli: [{ coord: [1, 0] as const, alveolus: 'freight_bay', goods: {} }],
				},
			],
			freightLines: [
				distributeFreightLine({
					id: 'BorderDock:line',
					name: 'Border dock',
					hiveName: 'BorderDock',
					coord: [1, 0],
					filters: ['wood'],
				}),
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 94021, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines.find((candidate) => candidate.id === 'BorderDock:line')!
		const vehicle = game.vehicles.createVehicle('v-border-dock', 'wheelbarrow', { q: 0.5, r: 0 }, [
			line,
		])
		const character = game.population.createCharacter('BorderDockWorker', { q: 0, r: 0 })
		vehicle.beginLineService(line, line.stops[0]!, character)
		character.operates = vehicle
		character.onboard()

		vehicle.dock()

		expect(vehicle.isDocked).toBe(true)
		expect(vehicle.position).toBeUndefined()
	})

	it('normalizes an adjacent service-side tile to the anchor border before docking', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'grass' as const },
				{ coord: [1, 0] as const, terrain: 'grass' as const },
			],
			hives: [
				{
					name: 'AdjacentDock',
					alveoli: [{ coord: [1, 0] as const, alveolus: 'freight_bay', goods: {} }],
				},
			],
			freightLines: [
				distributeFreightLine({
					id: 'AdjacentDock:line',
					name: 'Adjacent dock',
					hiveName: 'AdjacentDock',
					coord: [1, 0],
					filters: ['wood'],
				}),
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 94022, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines.find((candidate) => candidate.id === 'AdjacentDock:line')!
		const vehicle = game.vehicles.createVehicle('v-adjacent-dock', 'wheelbarrow', { q: 0, r: 0 }, [
			line,
		])
		const character = game.population.createCharacter('AdjacentDockWorker', { q: 0, r: 0 })
		vehicle.beginLineService(line, line.stops[0]!, character)
		character.operates = vehicle
		character.onboard()

		vehicle.dock()

		expect(vehicle.isDocked).toBe(true)
		expect(vehicle.position).toBeUndefined()
	})

	it('begins advertised park fallback for a completed docked anchor line', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'grass' as const },
				{ coord: [1, 0] as const, terrain: 'grass' as const },
			],
			hives: [
				{
					name: 'CompletedDock',
					alveoli: [{ coord: [0, 0] as const, alveolus: 'freight_bay', goods: {} }],
				},
			],
			freightLines: [
				normalizeFreightLineDefinition({
					id: 'CompletedDock:line',
					name: 'Completed dock line',
					cyclic: false,
					stops: [
						{
							id: 'CompletedDock:unload',
							unloadSelection: woodOnly,
							anchor: freightBayAnchor('CompletedDock', [0, 0]),
						},
					],
				}),
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 94023, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines.find((candidate) => candidate.id === 'CompletedDock:line')!
		const stop = line.stops[0]!
		const vehicle = game.vehicles.createVehicle('v-completed-dock', 'wheelbarrow', { q: 0, r: 0 }, [
			line,
		])
		const character = game.population.createCharacter('CompletedDockWorker', { q: 0, r: 0 })
		vehicle.beginLineService(line, stop)
		vehicle.dock()

		const park = collectVehicleAdvertisedJobs(game, vehicle).find(
			(job) => job.job === 'vehicleOffload'
		)
		expect(park?.job).toBe('vehicleOffload')
		expect(park?.maintenanceKind).toBe('park')

		character.scriptsContext.plan.begin({ ...park, type: 'work' } as any)
		expect(isVehicleMaintenanceService(vehicle.service)).toBe(true)
		expect(vehicle.service?.kind).toBe('park')
	})

	it('falls back to the zone center when no downstream utility makes a loose-good target actionable', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'grass' as const },
				{ coord: [2, 0] as const, terrain: 'grass' as const },
			],
			hives: [
				{
					name: 'HiveVH',
					alveoli: [{ coord: [0, 0] as const, alveolus: 'freight_bay', goods: {} }],
				},
			],
			looseGoods: [{ goodType: 'wood' as const, position: { q: 2, r: 0 } }],
			freightLines: [
				gatherFreightLine({
					id: 'HiveVH:implicit-gather:0,0',
					name: 'Gather',
					hiveName: 'HiveVH',
					coord: [0, 0],
					filters: ['wood'],
					radius: 3,
				}),
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9402, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const gather = game.hex.getTile({ q: 0, r: 0 })?.content as StorageAlveolus
		const line = game.freightLines.find((l) => l.id === 'HiveVH:implicit-gather:0,0')!
		const zoneStop = gatherZoneLoadStopForBay(line, gather)
		expect(zoneStop).toBeDefined()

		const hiveNeeds = aggregateHiveNeedTypes(game)
		const zStop = zoneStop! as FreightStop & { zone: FreightZoneDefinitionRadius }
		const pick = pickGatherTargetInZoneStop(game, line, zStop, gather.tile.position, hiveNeeds, {
			bayAlveolus: gather,
		})
		expect(pick?.path.length).toBeGreaterThan(0)
		const dest = pick!.path[pick!.path.length - 1]!
		const destKey = axial.key(toAxialCoord(dest)!)
		expect(destKey).toBe(axial.key({ q: 2, r: 0 }))

		const character = game.population.createCharacter('Hop', { q: 0, r: 0 })
		const vehicle = game.vehicles.createVehicle('vh-wheel', 'wheelbarrow', { q: 0, r: 0 }, [line])
		bindOperatedWheelbarrowOffload(character, vehicle)
		character.onboard()

		const target = freightStopMovementTarget(game, character, line, zStop)
		expect(target).toBeDefined()
		const targetKey = axial.key(toAxialCoord(target!)!)
		expect(targetKey).toBe(axial.key({ q: 0, r: 0 }))
	})

	it('previewInitialVehicleService matches ensureVehicleServiceStarted first stop', async () => {
		const patches = {
			tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }],
			freightLines: [
				gatherFreightLine({
					id: 'VH:preview',
					name: 'Preview',
					hiveName: 'H',
					coord: [0, 0],
					filters: ['wood'],
					radius: 2,
				}),
			],
		}
		game = new Game({ terrainSeed: 9403, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const vehicle = game.vehicles.createVehicle('pv', 'wheelbarrow', { q: 0, r: 0 })
		vehicle.servedLines = [game.freightLines[0]!]
		const preview = previewInitialVehicleService(vehicle)
		expect(preview?.line.id).toBe(game.freightLines[0]!.id)
		expect(preview?.stop.id).toBeDefined()
	})

	it('does not begin a line while an unfinished maintenance service is bound', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'grass' as const },
				{ coord: [1, 0] as const, terrain: 'grass' as const },
			],
			freightLines: [
				gatherFreightLine({
					id: 'VH:begin',
					name: 'Begin',
					hiveName: 'H',
					coord: [0, 0],
					filters: ['wood'],
					radius: 2,
				}),
			],
			looseGoods: [{ goodType: 'wood' as const, position: { q: 1, r: 0 } }],
		}
		game = new Game({ terrainSeed: 9404, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines[0]!
		const vehicle = game.vehicles.createVehicle('vb', 'wheelbarrow', { q: 0, r: 0 }, [line])
		const character = game.population.createCharacter('Begin', { q: 0, r: 0 })
		bindOperatedWheelbarrowOffload(character, vehicle)
		character.onboard()

		expect(findVehicleBeginServiceJob(game, character)).toBeUndefined()
		expect(findVehicleHopJob(game, character)).toBeUndefined()
	})

	it('begins a served gather line at the unload stop when idle cargo already matches it', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'grass' as const },
				{ coord: [1, 0] as const, terrain: 'grass' as const },
				{ coord: [2, 0] as const, terrain: 'grass' as const },
			],
			hives: [
				{
					name: 'H',
					alveoli: [
						{ coord: [0, 0] as const, alveolus: 'freight_bay', goods: {} },
						{ coord: [1, 0] as const, alveolus: 'sawmill', goods: {} },
					],
				},
			],
			freightLines: [
				gatherFreightLine({
					id: 'VH:loaded-compatible',
					name: 'Loaded compatible',
					hiveName: 'H',
					coord: [0, 0],
					filters: ['wood'],
					radius: 2,
				}),
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 94045, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines[0]!
		const vehicle = game.vehicles.createVehicle(
			'vloaded-compatible',
			'wheelbarrow',
			{ q: 1, r: 0 },
			[line]
		)
		vehicle.storage.addGood('wood', 1)
		const character = game.population.createCharacter('LoadedCompatible', { q: 2, r: 0 })

		expect(findVehicleOffloadJob(game, character)).toBeUndefined()
		const hop = findVehicleHopJob(game, character)
		expect(hop?.job).toBe('vehicleHop')
		expect(hop?.needsBeginService).toBe(true)
		expect(hop?.stopId).toBe(line.stops[1]!.id)
	})

	it('does not begin gather service for loaded goods the serving hive does not demand', async () => {
		const patches = {
			tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }],
			hives: [
				{ name: 'H', alveoli: [{ coord: [0, 0] as const, alveolus: 'freight_bay', goods: {} }] },
			],
			freightLines: [
				gatherFreightLine({
					id: 'VH:mush-no-demand',
					name: 'Mushroom gather',
					hiveName: 'H',
					coord: [0, 0],
					filters: ['mushrooms'],
					radius: 2,
				}),
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 94047, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines[0]!
		const vehicle = game.vehicles.createVehicle('vmush-nodemand', 'wheelbarrow', { q: 0, r: 0 }, [
			line,
		])
		vehicle.storage.addGood('mushrooms', 1)
		const character = game.population.createCharacter('MushNoDemand', { q: 0, r: 0 })
		bindOperatedWheelbarrowOffload(character, vehicle)
		character.onboard()

		expect(pickInitialVehicleServiceCandidate(game, character, vehicle)).toBeUndefined()
		expect(findVehicleHopJob(game, character)).toBeUndefined()
	})

	it('does not begin a served gather line from loaded cargo outside the first zone stop', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'grass' as const },
				{ coord: [2, 0] as const, terrain: 'grass' as const },
				{ coord: [4, 0] as const, terrain: 'grass' as const },
				{ coord: [4, 1] as const, terrain: 'grass' as const },
				{ coord: [5, 0] as const, terrain: 'grass' as const },
			],
			hives: [
				{ name: 'H', alveoli: [{ coord: [0, 0] as const, alveolus: 'freight_bay', goods: {} }] },
			],
			freightLines: [
				gatherFreightLine({
					id: 'VH:loaded-outside-zone',
					name: 'Loaded outside zone',
					hiveName: 'H',
					coord: [0, 0],
					filters: ['wood'],
					radius: 1,
				}),
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 94046, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines[0]!
		const vehicle = game.vehicles.createVehicle(
			'vloaded-outside-zone',
			'wheelbarrow',
			{ q: 4, r: 0 },
			[line]
		)
		vehicle.storage.addGood('wood', 1)
		const character = game.population.createCharacter('LoadedOutsideZone', { q: 4, r: 1 })

		expect(findVehicleHopJob(game, character)).toBeUndefined()
		expect(pickInitialVehicleServiceCandidate(game, character, vehicle)).toBeUndefined()
	})

	it('does not offer zoneBrowse on the current zone stop when downstream utility says no further load is needed', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'grass' as const },
				{ coord: [2, 0] as const, terrain: 'grass' as const },
			],
			freightLines: [
				gatherFreightLine({
					id: 'VH:zone-browse',
					name: 'Zone browse',
					hiveName: 'H',
					coord: [0, 0],
					filters: ['wood'],
					radius: 3,
				}),
			],
			hives: [
				{ name: 'H', alveoli: [{ coord: [0, 0] as const, alveolus: 'freight_bay', goods: {} }] },
			],
			looseGoods: [{ goodType: 'wood' as const, position: { q: 2, r: 0 } }],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9405, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines[0]!
		const zoneStop = line.stops[0]!
		const vehicle = game.vehicles.createVehicle('vz', 'wheelbarrow', { q: 1, r: 0 }, [line])
		const character = game.population.createCharacter('Browse', { q: 1, r: 0 })
		vehicle.beginLineService(line, zoneStop, character)
		character.operates = vehicle
		character.onboard()

		expect(findZoneBrowseJob(game, character)).toBeUndefined()
	})

	it('prefers a project-tile load that also serves the line over a plain pure-line gather', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'grass' as const },
				{ coord: [1, 0] as const, terrain: 'grass' as const },
				{ coord: [2, 0] as const, terrain: 'grass' as const },
				{ coord: [1, 1] as const, terrain: 'grass' as const },
			],
			hives: [
				{
					name: 'JointPriority',
					alveoli: [
						{ coord: [0, 0] as const, alveolus: 'freight_bay', goods: {} },
						{ coord: [1, 0] as const, alveolus: 'sawmill', goods: {} },
					],
				},
			],
			projects: {
				'build:storage': [[2, 0] as [number, number]],
			},
			looseGoods: [
				{ goodType: 'wood' as const, position: { q: 2, r: 0 } },
				{ goodType: 'wood' as const, position: { q: 1, r: 1 } },
			],
			freightLines: [
				gatherFreightLine({
					id: 'VH:joint-priority',
					name: 'Joint priority',
					hiveName: 'JointPriority',
					coord: [0, 0],
					filters: ['wood'],
					radius: 3,
				}),
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 94055, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines[0]!
		const zoneStop = line.stops[0]!
		const vehicle = game.vehicles.createVehicle('joint-zone', 'wheelbarrow', { q: 0, r: 0 }, [line])
		const character = game.population.createCharacter('JointBrowse', { q: 0, r: 0 })
		vehicle.beginLineService(line, zoneStop, character)
		character.operates = vehicle
		character.onboard()

		const job = findZoneBrowseJob(game, character)
		expect(job?.job).toBe('zoneBrowse')
		expect(job?.zoneBrowseAction).toBe('load')
		expect(job?.targetCoord).toMatchObject({ q: 2, r: 0 })
		expect(job?.adSource).toBe('project')
		expect(job?.priorityTier).toBe('lineAndOffloadJoint')
	})

	it('zoneBrowse does not offer provide work when current cargo is reserved for later stops', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'grass' as const },
				{ coord: [1, 0] as const, terrain: 'grass' as const },
				{ coord: [2, 0] as const, terrain: 'grass' as const },
				{ coord: [3, 0] as const, terrain: 'grass' as const },
			],
			hives: [
				{ name: 'A', alveoli: [{ coord: [0, 0] as const, alveolus: 'freight_bay', goods: {} }] },
				{ name: 'B', alveoli: [{ coord: [2, 0] as const, alveolus: 'freight_bay', goods: {} }] },
			],
			freightLines: [
				normalizeFreightLineDefinition({
					id: 'VH:dist-zone',
					name: 'Distribute zone',
					stops: [
						{
							id: 'load-a',
							loadSelection: woodOnly,
							anchor: freightBayAnchor('A', [0, 0]),
						},
						{
							id: 'current-zone',
							zone: { kind: 'radius', center: [1, 0] as const, radius: 1 },
						},
						{
							id: 'load-b',
							loadSelection: woodOnly,
							anchor: freightBayAnchor('B', [2, 0]),
						},
						{
							id: 'future-zone',
							zone: { kind: 'radius', center: [3, 0] as const, radius: 1 },
						},
					],
				}),
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9406, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const currentSiteTile = game.hex.getTile({ q: 1, r: 0 })!
		currentSiteTile.content = new BuildDwelling(currentSiteTile, 'basic_dwelling')
		const futureSiteTile = game.hex.getTile({ q: 3, r: 0 })!
		futureSiteTile.content = new BuildDwelling(futureSiteTile, 'basic_dwelling')

		const line = game.freightLines[0]!
		const vehicle = game.vehicles.createVehicle('vd', 'wheelbarrow', { q: 1, r: 0 }, [line])
		const character = game.population.createCharacter('Distribute', { q: 1, r: 0 })
		vehicle.beginLineService(line, line.stops[1]!, character)
		character.operates = vehicle
		character.onboard()

		vehicle.storage.addGood('wood', 1)
		expect(findZoneBrowseJob(game, character)).toBeUndefined()
	})

	it('zoneBrowse allows local zone exchange when the halt can load and unload', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'grass' as const },
				{ coord: [1, 0] as const, terrain: 'grass' as const },
			],
			looseGoods: [{ goodType: 'wood' as const, position: { q: 0, r: 0 } }],
			freightLines: [
				normalizeFreightLineDefinition({
					id: 'VH:local-exchange',
					name: 'Local exchange',
					stops: [
						{
							id: 'zone',
							loadSelection: woodOnly,
							unloadSelection: woodOnly,
							zone: { kind: 'radius', center: [0, 0] as const, radius: 1 },
						},
					],
				}),
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 94061, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()
		game.hex.getTile({ q: 1, r: 0 })!.content = new BuildDwelling(
			game.hex.getTile({ q: 1, r: 0 })!,
			'basic_dwelling'
		)

		const line = game.freightLines[0]!
		const stop = line.stops[0]!
		const vehicle = game.vehicles.createVehicle('v-local-exchange', 'wheelbarrow', { q: 0, r: 0 }, [
			line,
		])
		const character = game.population.createCharacter('LocalExchange', { q: 0, r: 0 })
		vehicle.beginLineService(line, stop, character)
		character.operates = vehicle
		character.onboard()

		const loadJob = findZoneBrowseJob(game, character)
		expect(loadJob?.job).toBe('zoneBrowse')
		expect(loadJob?.zoneBrowseAction).toBe('load')
		expect(loadJob?.goodType).toBe('wood')

		game.hex.looseGoods.getGoodsAt({ q: 0, r: 0 })[0]?.remove()
		vehicle.storage.addGood('wood', 1)
		const provideJob = findZoneBrowseJob(game, character)
		expect(provideJob?.job).toBe('zoneBrowse')
		expect(provideJob?.zoneBrowseAction).toBe('provide')
		expect(provideJob?.goodType).toBe('wood')
		expect(provideJob?.targetCoord).toMatchObject({ q: 1, r: 0 })
	})

	it('does not provide loaded cargo while stopped on a gather load zone', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'grass' as const },
				{ coord: [1, 0] as const, terrain: 'grass' as const },
			],
			hives: [
				{
					name: 'GatherBay',
					alveoli: [{ coord: [0, 0] as const, alveolus: 'freight_bay' as const, goods: {} }],
				},
			],
			freightLines: [
				gatherFreightLine({
					id: 'gather-load-only',
					name: 'Gather load only',
					hiveName: 'GatherBay',
					coord: [0, 0],
					filters: ['wood'],
					radius: 1,
				}),
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 94062, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()
		const siteTile = game.hex.getTile({ q: 1, r: 0 })!
		siteTile.content = new BuildDwelling(siteTile, 'basic_dwelling')

		const line = game.freightLines[0]!
		const stop = line.stops[0]!
		const vehicle = game.vehicles.createVehicle(
			'v-gather-load-zone',
			'wheelbarrow',
			{ q: 1, r: 0 },
			[line]
		)
		vehicle.storage.addGood('wood', 1)
		const character = game.population.createCharacter('GatherLoadZone', { q: 1, r: 0 })
		vehicle.beginLineService(line, stop, character)
		character.operates = vehicle
		character.onboard()

		expect(findZoneBrowseJob(game, character)).toBeUndefined()
	})

	it('zoneBrowse prioritizes current-zone demand over later hive demand for the same loaded good', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'concrete' as const },
				{ coord: [1, 0] as const, terrain: 'grass' as const },
				{ coord: [2, 0] as const, terrain: 'grass' as const },
				{ coord: [3, 0] as const, terrain: 'concrete' as const },
				{ coord: [4, 0] as const, terrain: 'concrete' as const },
			],
			hives: [
				{
					name: 'LaterDemand',
					alveoli: [
						{ coord: [3, 0] as const, alveolus: 'freight_bay', goods: {} },
						{ coord: [4, 0] as const, alveolus: 'sawmill', goods: {} },
					],
				},
			],
			looseGoods: [{ goodType: 'wood' as const, position: { q: 2, r: 0 } }],
			freightLines: [
				normalizeFreightLineDefinition({
					id: 'VH:local-before-hive',
					name: 'Local before hive',
					stops: [
						{
							id: 'zone',
							loadSelection: woodOnly,
							unloadSelection: woodOnly,
							zone: { kind: 'radius', center: [1, 0] as const, radius: 1 },
						},
						{
							id: 'bay',
							unloadSelection: woodOnly,
							anchor: freightBayAnchor('LaterDemand', [3, 0]),
						},
					],
				}),
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 94064, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()
		game.hex.getTile({ q: 1, r: 0 })!.content = new BuildDwelling(
			game.hex.getTile({ q: 1, r: 0 })!,
			'basic_dwelling'
		)
		const bayHive = (game.hex.getTile({ q: 3, r: 0 })?.content as { hive?: { needs?: unknown } })
			.hive
		expect((bayHive?.needs as { wood?: unknown } | undefined)?.wood).toBeDefined()

		const line = game.freightLines.find((candidate) => candidate.id === 'VH:local-before-hive')!
		const vehicle = game.vehicles.createVehicle(
			'v-local-before-hive',
			'wheelbarrow',
			{ q: 1, r: 0 },
			[line]
		)
		const character = game.population.createCharacter('LocalBeforeHive', { q: 1, r: 0 })
		vehicle.beginLineService(line, line.stops[0]!, character)
		character.operates = vehicle
		character.onboard()

		const loadJob = findZoneBrowseJob(game, character)
		expect(loadJob?.job).toBe('zoneBrowse')
		expect(loadJob?.zoneBrowseAction).toBe('load')
		expect(loadJob?.targetCoord).toMatchObject({ q: 2, r: 0 })
		expect(loadJob?.adSource).toBe('project')
		expect(loadJob?.priorityTier).toBe('lineAndOffloadJoint')
	})

	it('zoneBrowse does not load local loose goods when the zone has no matching sink', async () => {
		const patches = {
			tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }],
			looseGoods: [{ goodType: 'wood' as const, position: { q: 0, r: 0 } }],
			freightLines: [
				normalizeFreightLineDefinition({
					id: 'VH:local-no-sink',
					name: 'Local no sink',
					stops: [
						{
							id: 'zone',
							loadSelection: woodOnly,
							unloadSelection: woodOnly,
							zone: { kind: 'radius', center: [0, 0] as const, radius: 1 },
						},
					],
				}),
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 94062, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines[0]!
		const vehicle = game.vehicles.createVehicle('v-local-no-sink', 'wheelbarrow', { q: 0, r: 0 }, [
			line,
		])
		const character = game.population.createCharacter('LocalNoSink', { q: 0, r: 0 })
		vehicle.beginLineService(line, line.stops[0]!, character)
		character.operates = vehicle
		character.onboard()

		expect(findZoneBrowseJob(game, character)).toBeUndefined()
	})

	it('cyclic bay-zone routes may begin at the zone for local zone exchange', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'concrete' as const },
				{ coord: [2, 0] as const, terrain: 'grass' as const },
				{ coord: [3, 0] as const, terrain: 'grass' as const },
			],
			hives: [
				{
					name: 'CyclicLocal',
					alveoli: [{ coord: [0, 0] as const, alveolus: 'freight_bay', goods: {} }],
				},
			],
			looseGoods: [{ goodType: 'wood' as const, position: { q: 2, r: 0 } }],
			freightLines: [
				normalizeFreightLineDefinition({
					id: 'VH:cyclic-local',
					name: 'Cyclic local',
					cyclic: true,
					stops: [
						{
							id: 'bay',
							anchor: freightBayAnchor('CyclicLocal', [0, 0]),
						},
						{
							id: 'zone',
							loadSelection: woodOnly,
							unloadSelection: woodOnly,
							zone: { kind: 'radius', center: [2, 0] as const, radius: 1 },
						},
					],
				}),
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 94063, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()
		game.hex.getTile({ q: 3, r: 0 })!.content = new BuildDwelling(
			game.hex.getTile({ q: 3, r: 0 })!,
			'basic_dwelling'
		)

		const line = game.freightLines.find((candidate) => candidate.id === 'VH:cyclic-local')!
		const vehicle = game.vehicles.createVehicle('v-cyclic-local', 'wheelbarrow', { q: 2, r: 0 }, [
			line,
		])
		const character = game.population.createCharacter('CyclicLocal', { q: 2, r: 0 })

		const pick = pickInitialVehicleServiceCandidate(game, character, vehicle)
		expect(pick?.line.id).toBe(line.id)
		expect(pick?.stop.id).toBe('zone')
	})

	it('does not skip a cyclic zone halt that can still load after an empty bay halt', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'concrete' as const },
				{ coord: [1, 0] as const, terrain: 'grass' as const },
			],
			hives: [
				{
					name: 'CyclicEmptyBay',
					alveoli: [{ coord: [0, 0] as const, alveolus: 'freight_bay', goods: {} }],
				},
			],
			looseGoods: [{ goodType: 'wood' as const, position: { q: 1, r: 0 } }],
			freightLines: [
				normalizeFreightLineDefinition({
					id: 'VH:empty-bay-keeps-zone',
					name: 'Empty bay keeps zone',
					cyclic: true,
					stops: [
						{
							id: 'bay',
							loadSelection: woodOnly,
							unloadSelection: woodOnly,
							anchor: freightBayAnchor('CyclicEmptyBay', [0, 0]),
						},
						{
							id: 'zone',
							loadSelection: woodOnly,
							unloadSelection: woodOnly,
							zone: { kind: 'radius', center: [0, 0] as const, radius: 1 },
						},
					],
				}),
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 94065, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()
		game.hex.getTile({ q: 1, r: 0 })!.content = new BuildDwelling(
			game.hex.getTile({ q: 1, r: 0 })!,
			'basic_dwelling'
		)

		const line = game.freightLines.find((candidate) => candidate.id === 'VH:empty-bay-keeps-zone')!
		const vehicle = game.vehicles.createVehicle(
			'v-empty-bay-keeps-zone',
			'wheelbarrow',
			{ q: 0, r: 0 },
			[line]
		)
		const character = game.population.createCharacter('EmptyBayKeepsZone', { q: 0, r: 0 })
		vehicle.beginLineService(line, line.stops[0]!, character)
		vehicle.dock()

		maybeAdvanceVehicleFromCompletedAnchorStop(game, vehicle)

		expect(isVehicleLineService(vehicle.service) && vehicle.service.stop.id).toBe('zone')
	})

	it('work-plan finalizer releases a line operator while preserving unfinished service', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'grass' as const },
				{ coord: [1, 0] as const, terrain: 'grass' as const },
			],
			freightLines: [
				gatherFreightLine({
					id: 'VH:lifecycle-line',
					name: 'Lifecycle line',
					hiveName: 'H',
					coord: [0, 0],
					filters: ['wood'],
					radius: 2,
				}),
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9407, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines[0]!
		const stop = line.stops[0]!
		const vehicle = game.vehicles.createVehicle('vlifecycle', 'wheelbarrow', { q: 0, r: 0 }, [line])
		const character = game.population.createCharacter('Lifecycle', { q: 0, r: 0 })
		const plan = {
			type: 'work',
			job: 'zoneBrowse',
			vehicleUid: vehicle.uid,
			target: vehicle,
			path: [],
			lineId: line.id,
			stopId: stop.id,
			zoneBrowseAction: 'load',
			goodType: 'wood',
			quantity: 1,
			targetCoord: { q: 1, r: 0 },
			adSource: 'hive',
			priorityTier: 'pureLine',
			urgency: 1,
			fatigue: 0,
		} as const

		vehicle.beginLineService(line, stop)
		character.scriptsContext.plan.begin(plan as any)
		expect(character.operates?.uid).toBe(vehicle.uid)
		expect(vehicle.operator?.uid).toBe(character.uid)

		character.scriptsContext.plan.finally(plan as any)

		expect(character.operates).toBeUndefined()
		expect(vehicle.operator).toBeUndefined()
		const serviceAfterRelease = vehicle.service
		expect(isVehicleLineService(serviceAfterRelease)).toBe(true)
		if (!isVehicleLineService(serviceAfterRelease)) throw new Error('Expected line service')
		expect(serviceAfterRelease.stop.id).toBe(stop.id)
	})

	it('work-plan finalizer preserves unfinished maintenance service for another operator', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'grass' as const },
				{ coord: [1, 0] as const, terrain: 'grass' as const },
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9408, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const vehicle = game.vehicles.createVehicle('vmaint', 'wheelbarrow', { q: 0, r: 0 }, [])
		vehicle.storage.addGood('wood', 1)
		const character = game.population.createCharacter('Maintenance', { q: 0, r: 0 })
		const plan = {
			type: 'work',
			job: 'vehicleOffload',
			maintenanceKind: 'unloadToTile',
			vehicleUid: vehicle.uid,
			target: vehicle,
			path: [],
			targetCoord: { q: 1, r: 0 },
			urgency: 1,
			fatigue: 0,
		} as const

		character.scriptsContext.plan.begin(plan as any)
		expect(character.operates?.uid).toBe(vehicle.uid)
		expect(vehicle.operator?.uid).toBe(character.uid)

		character.scriptsContext.plan.finally(plan as any)

		expect(character.operates).toBeUndefined()
		expect(vehicle.operator).toBeUndefined()
		const serviceAfterRelease = vehicle.service
		expect(isVehicleMaintenanceService(serviceAfterRelease)).toBe(true)
		if (!isVehicleMaintenanceService(serviceAfterRelease))
			throw new Error('Expected maintenance service')
		expect(serviceAfterRelease.kind).toBe('unloadToTile')
	})

	it('explicit maintenance completion ends service before work-plan cleanup', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'grass' as const },
				{ coord: [1, 0] as const, terrain: 'grass' as const },
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9409, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const vehicle = game.vehicles.createVehicle('vcomplete', 'wheelbarrow', { q: 0, r: 0 }, [])
		const character = game.population.createCharacter('Complete', { q: 0, r: 0 })
		const plan = {
			type: 'work',
			job: 'vehicleOffload',
			maintenanceKind: 'park',
			vehicleUid: vehicle.uid,
			target: vehicle,
			path: [],
			targetCoord: { q: 1, r: 0 },
			urgency: 1,
			fatigue: 0,
		} as const

		character.scriptsContext.plan.begin(plan as any)
		expect(character.operates?.uid).toBe(vehicle.uid)
		expect(isVehicleMaintenanceService(vehicle.service)).toBe(true)

		character.scriptsContext.vehicle.completeVehicleMaintenanceService(plan as any)
		character.scriptsContext.plan.finally(plan as any)

		expect(character.operates).toBeUndefined()
		expect(vehicle.operator).toBeUndefined()
		expect(vehicle.service).toBeUndefined()
	})

	it('maintenance unload transfer completes service after fulfillment', async () => {
		const patches = {
			tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9410, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const vehicle = game.vehicles.createVehicle(
			'vunload-lifecycle',
			'wheelbarrow',
			{ q: 0, r: 0 },
			[]
		)
		vehicle.storage.addGood('wood', 1)
		const character = game.population.createCharacter('UnloadLifecycle', { q: 0, r: 0 })
		const plan: WorkPlan = {
			type: 'work',
			job: 'vehicleOffload',
			maintenanceKind: 'unloadToTile',
			vehicleUid: vehicle.uid,
			target: vehicle,
			path: [],
			targetCoord: { q: 0, r: 0 },
			urgency: 1,
			fatigue: 0,
		}

		character.scriptsContext.plan.begin(plan)
		const step = character.scriptsContext.vehicle.vehicleUnloadTransferStep(plan)
		if (!step || !('tick' in step)) throw new Error('Expected unload transfer step')
		step.tick(999)

		expect(character.operates).toBeUndefined()
		expect(vehicle.operator).toBeUndefined()
		expect(vehicle.service).toBeUndefined()
	})

	it('zoneBrowse transfer dispatch uses native helpers without relying on this-bound siblings', async () => {
		const patches = {
			tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }],
			looseGoods: [{ goodType: 'wood' as const, position: { q: 0, r: 0 } }],
			freightLines: [
				gatherFreightLine({
					id: 'VH:native-dispatch',
					name: 'Native dispatch',
					hiveName: 'H',
					coord: [0, 0],
					filters: ['wood'],
					radius: 1,
				}),
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9411, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines[0]!
		const stop = line.stops[0]!
		const vehicle = game.vehicles.createVehicle('vnative-dispatch', 'wheelbarrow', { q: 0, r: 0 }, [
			line,
		])
		const character = game.population.createCharacter('NativeDispatch', { q: 0, r: 0 })
		vehicle.beginLineService(line, stop, character)
		character.operates = vehicle
		const plan: WorkPlan = {
			type: 'work',
			job: 'zoneBrowse',
			vehicleUid: vehicle.uid,
			target: vehicle,
			path: [],
			lineId: line.id,
			stopId: stop.id,
			zoneBrowseAction: 'load',
			goodType: 'wood',
			quantity: 1,
			targetCoord: { q: 0, r: 0 },
			adSource: 'hive',
			priorityTier: 'pureLine',
			urgency: 1,
			fatigue: 0,
		}

		const step = character.scriptsContext.vehicle.vehicleZoneBrowseTransferStep(plan)

		expect(step).toBeTruthy()
		step?.finish()
		expect(isVehicleLineService(vehicle.service)).toBe(true)
		if (!isVehicleLineService(vehicle.service)) throw new Error('expected line service')
		expect(vehicle.service.stop.id).toBe(line.stops[1]!.id)
		expect(vehicle.storage.available('wood')).toBe(1)
	})

	it('canceled zoneBrowse transfer keeps the current zone stop', async () => {
		const patches = {
			tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }],
			looseGoods: [{ goodType: 'wood' as const, position: { q: 0, r: 0 } }],
			freightLines: [
				gatherFreightLine({
					id: 'VH:native-dispatch-cancel',
					name: 'Native dispatch cancel',
					hiveName: 'H',
					coord: [0, 0],
					filters: ['wood'],
					radius: 1,
				}),
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 94118, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines[0]!
		const stop = line.stops[0]!
		const vehicle = game.vehicles.createVehicle('vnative-cancel', 'wheelbarrow', { q: 0, r: 0 }, [
			line,
		])
		const character = game.population.createCharacter('NativeCancel', { q: 0, r: 0 })
		vehicle.beginLineService(line, stop, character)
		character.operates = vehicle
		const plan: WorkPlan = {
			type: 'work',
			job: 'zoneBrowse',
			vehicleUid: vehicle.uid,
			target: vehicle,
			path: [],
			lineId: line.id,
			stopId: stop.id,
			zoneBrowseAction: 'load',
			goodType: 'wood',
			quantity: 1,
			targetCoord: { q: 0, r: 0 },
			adSource: 'hive',
			priorityTier: 'pureLine',
			urgency: 1,
			fatigue: 0,
		}

		const step = character.scriptsContext.vehicle.vehicleZoneBrowseTransferStep(plan)

		expect(step).toBeTruthy()
		step?.cancel('test.cancel')
		expect(character.operates?.uid).toBe(vehicle.uid)
		expect(vehicle.operator?.uid).toBe(character.uid)
		expect(isVehicleLineService(vehicle.service)).toBe(true)
		if (!isVehicleLineService(vehicle.service)) throw new Error('expected line service')
		expect(vehicle.service.stop.id).toBe(stop.id)
	})

	it('non-vehicle work plan releases stale vehicle usage before preparing work', async () => {
		const patches = {
			tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9412, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const vehicle = game.vehicles.createVehicle(
			'vnon-vehicle-plan',
			'wheelbarrow',
			{ q: 0, r: 0 },
			[]
		)
		const character = game.population.createCharacter('NonVehiclePlan', { q: 0, r: 0 })
		bindOperatedWheelbarrowOffload(character, vehicle)
		character.onboard()
		const target = game.hex.getTile({ q: 0, r: 0 })!.content!
		const plan = {
			type: 'work',
			job: 'harvest',
			target,
			path: [],
			urgency: 1,
			fatigue: 0,
		} as const

		character.scriptsContext.plan.begin(plan as any)

		expect(character.operates).toBeUndefined()
		expect(vehicle.operator).toBeUndefined()
		expect(vehicle.service).toBeDefined()
	})

	it('self-care selection releases stale vehicle usage before returning eat/rest activity', async () => {
		const patches = {
			tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9413, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const vehicle = game.vehicles.createVehicle('vself-care', 'wheelbarrow', { q: 0, r: 0 }, [])
		const character = game.population.createCharacter('SelfCare', { q: 0, r: 0 })
		bindOperatedWheelbarrowOffload(character, vehicle)
		character.onboard()
		character.hunger = character.triggerLevels.hunger.critical + 1

		const action = character.findAction()

		expect(action).toBeTruthy()
		expect(character.operates).toBeUndefined()
		expect(vehicle.operator).toBeUndefined()
		expect(vehicle.service).toBeDefined()
	})

	it('disengaging after vehicle movement restores the character foot tile at the vehicle location', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'grass' as const },
				{ coord: [1, 0] as const, terrain: 'grass' as const },
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9414, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const vehicle = game.vehicles.createVehicle('vfoot-sync', 'wheelbarrow', { q: 0, r: 0 }, [])
		const character = game.population.createCharacter('FootSync', { q: 0, r: 0 })
		bindOperatedWheelbarrowOffload(character, vehicle)
		character.onboard()
		character.position = { q: 1, r: 0 }

		character.disengageVehicleKeepingService()

		expect(character.operates).toBeUndefined()
		expect(toAxialCoord(character.position)).toMatchObject({ q: 1, r: 0 })
		expect(toAxialCoord(character.tile.position)).toMatchObject({ q: 1, r: 0 })
	})

	it('anchor line hop: sub-hex position still matches unload tile (empty path allowed)', async () => {
		const patches = {
			tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }],
			hives: [
				{
					name: 'SubHexH',
					alveoli: [
						{ coord: [0, 0] as const, alveolus: 'freight_bay', goods: {} },
						{ coord: [1, 0] as const, alveolus: 'sawmill', goods: {} },
					],
				},
			],
			freightLines: [
				gatherFreightLine({
					id: 'SubHexH:implicit-gather:0,0',
					name: 'Sub-hex test',
					hiveName: 'SubHexH',
					coord: [0, 0],
					filters: ['wood'],
					radius: 2,
				}),
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9416, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines[0]!
		const unload = line.stops[1]!
		const vehicle = game.vehicles.createVehicle('v-subhex', 'wheelbarrow', { q: 0, r: 0 }, [line])
		vehicle.storage.addGood('wood', 1)
		const character = game.population.createCharacter('SubHex', { q: 0, r: 0 })
		vehicle.beginLineService(line, unload, character)
		character.operates = vehicle
		character.onboard()

		const targetPos = freightStopMovementTarget(game, character, line, unload)
		expect(targetPos).toBeDefined()
		// On the same hex, foot/vehicle coords can differ from the tile center; raw axial keys differ.
		const frac = { q: 0.14, r: 0.09 }
		character.position = frac
		vehicle.position = frac
		expect(
			axial.key(toAxialCoord(character.position)!) === axial.key(toAxialCoord(targetPos!))
		).toBe(false)

		const hop = findVehicleHopJob(game, character)
		expect(hop?.job).toBe('vehicleHop')
		expect(hop?.lineId).toBe(line.id)
		expect(hop?.stopId).toBe(unload.id)
		expect(hop?.dockEnter).toBe(true)
	})

	it('projects a reclaimed completed zone stop to the next line stop', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'grass' as const },
				{ coord: [2, 0] as const, terrain: 'grass' as const },
			],
			hives: [
				{
					name: 'NoZoneTargetH',
					alveoli: [{ coord: [0, 0] as const, alveolus: 'freight_bay', goods: {} }],
				},
			],
			freightLines: [
				gatherFreightLine({
					id: 'NoZoneTargetH:implicit-gather:0,0',
					name: 'No zone target',
					hiveName: 'NoZoneTargetH',
					coord: [0, 0],
					filters: ['wood'],
					radius: 2,
				}),
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9417, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines[0]!
		const vehicle = game.vehicles.createVehicle('v-no-zone-target', 'wheelbarrow', { q: 0, r: 0 }, [
			line,
		])
		vehicle.beginLineService(line, line.stops[0]!)
		const character = game.population.createCharacter('NoZoneTarget', { q: 2, r: 0 })

		const projected = projectedLineStopForVehicleHop(game, character, vehicle)
		expect(projected?.stop.id).toBe(line.stops[1]!.id)
		const hop = findVehicleHopJob(game, character)
		expect(hop?.job).toBe('vehicleHop')
		expect(hop?.stopId).toBe(line.stops[1]!.id)
		expect(hop?.dockEnter).toBe(true)
	})

	it('offers the ChopSaw unload hop after loading wood in the gather zone', async () => {
		game = new Game({ terrainSeed: 9418, characterCount: 0 }, chopSaw)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines.find(
			(candidate) => candidate.id === 'ChopSaw:implicit-gather:0,0'
		)
		if (!line) throw new Error('expected ChopSaw implicit gather line')
		const unload = line.stops.find((stop) => stop.id === 'ChopSaw:ig-unload')
		if (!unload) throw new Error('expected ChopSaw unload stop')
		const vehicle = game.vehicles.vehicle('ChopSaw:wheelbarrow1')
		if (!vehicle) throw new Error('expected ChopSaw wheelbarrow')
		// Sub-hex coords from a live ChopSaw play session (wheelbarrow mid-hex after walk.enter).
		vehicle.position = { q: -0.9, r: -0.9 }
		vehicle.storage.addGood('wood', 1)
		vehicle.beginLineService(line, unload)
		const character = game.population.createCharacter('ChopSawReclaim', { q: -1, r: -1 })

		const hop = findVehicleHopJob(game, character)
		expect(hop?.job).toBe('vehicleHop')
		expect(hop?.stopId).toBe(unload.id)
		expect(hop?.dockEnter).toBe(true)
		expect(hop?.path.length).toBeGreaterThan(0)
	})

	it('advances ChopSaw from zone load to unload in the same tick as the pickup', async () => {
		game = new Game({ terrainSeed: 9419, characterCount: 0 }, chopSaw)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines.find(
			(candidate) => candidate.id === 'ChopSaw:implicit-gather:0,0'
		)
		if (!line) throw new Error('expected ChopSaw implicit gather line')
		const load = line.stops.find((stop) => stop.id === 'ChopSaw:ig-load')
		const unload = line.stops.find((stop) => stop.id === 'ChopSaw:ig-unload')
		if (!load || !unload) throw new Error('expected ChopSaw load/unload stops')
		const vehicle = game.vehicles.vehicle('ChopSaw:wheelbarrow1')
		if (!vehicle) throw new Error('expected ChopSaw wheelbarrow')
		const character = game.population.createCharacter('ChopSawLoader', { q: -1, r: -1 })
		character.position = { q: -1, r: -1 }
		vehicle.position = { q: -1, r: -1 }
		vehicle.beginLineService(line, load, character)
		character.operates = vehicle
		character.onboard()
		const loose = game.hex.looseGoods.add({ q: -1, r: -1 }, 'wood')

		const loadJob = findZoneBrowseJob(game, character)
		expect(loadJob?.job).toBe('zoneBrowse')
		expect(loadJob?.zoneBrowseAction).toBe('load')

		loose.remove()
		vehicle.storage.addGood('wood', 1)
		maybeAdvanceVehiclePastCompletedZoneStop(game, vehicle, character)

		expect(isVehicleLineService(vehicle.service) && vehicle.service.stop.id).toBe(unload.id)
		const hop = findVehicleHopJob(game, character)
		expect(hop?.job).toBe('vehicleHop')
		expect(hop?.stopId).toBe(unload.id)
		expect(hop?.dockEnter).toBe(true)
	})

	it('keeps ChopSaw on the gather zone while another needed wood can be loaded', async () => {
		game = new Game({ terrainSeed: 9425, characterCount: 0 }, chopSaw)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines.find(
			(candidate) => candidate.id === 'ChopSaw:implicit-gather:0,0'
		)
		if (!line) throw new Error('expected ChopSaw implicit gather line')
		const load = line.stops.find((stop) => stop.id === 'ChopSaw:ig-load')
		if (!load) throw new Error('expected ChopSaw load stop')
		const vehicle = game.vehicles.vehicle('ChopSaw:wheelbarrow1')
		if (!vehicle) throw new Error('expected ChopSaw wheelbarrow')
		const character = game.population.createCharacter('ChopSawSecondLoad', { q: -5, r: 1 })
		character.position = { q: -5, r: 1 }
		vehicle.position = { q: -5, r: 1 }
		vehicle.storage.addGood('wood', 1)
		vehicle.beginLineService(line, load, character)
		character.operates = vehicle
		character.onboard()
		game.hex.looseGoods.add({ q: -4, r: 1 }, 'wood')

		maybeAdvanceVehiclePastCompletedZoneStop(game, vehicle, character)
		character.stepOffVehicleKeepingControl()

		expect(isVehicleLineService(vehicle.service) && vehicle.service.stop.id).toBe(load.id)
		const browse = findZoneBrowseJob(game, character)
		expect(browse?.job).toBe('zoneBrowse')
		expect(browse?.stopId).toBe(load.id)
		expect(browse?.zoneBrowseAction).toBe('load')
		expect(browse?.goodType).toBe('wood')
		expect(browse?.targetCoord).toMatchObject({ q: -4, r: 1 })
		expect(browse?.path.at(-1)).toMatchObject({ q: -4, r: 1 })
	})

	it('ends a distribute line at an empty zone unload stop with no cargo to provide', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'concrete' as const },
				{ coord: [0, -1] as const, terrain: 'grass' as const },
			],
			hives: [
				{
					name: 'ZoneEmptyUnloadH',
					alveoli: [{ coord: [0, 0] as const, alveolus: 'freight_bay', goods: {} }],
				},
			],
			freightLines: [
				distributeFreightLine({
					id: 'ZoneEmptyUnloadH:distribute',
					name: 'Zone empty unload',
					hiveName: 'ZoneEmptyUnloadH',
					coord: [0, 0],
					filters: ['wood'],
					unloadRadius: 1,
				}),
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9422, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const constructionTile = game.hex.getTile({ q: 0, r: -1 })!
		constructionTile.content = new BuildDwelling(constructionTile, 'basic_dwelling')
		const line = game.freightLines.find(
			(candidate) => candidate.id === 'ZoneEmptyUnloadH:distribute'
		)!
		const unload = line.stops[1]!
		const vehicle = game.vehicles.createVehicle('v-empty-unload', 'wheelbarrow', { q: 0, r: -1 }, [
			line,
		])
		const character = game.population.createCharacter('EmptyUnload', { q: 0, r: -1 })
		vehicle.beginLineService(line, unload, character)
		character.operates = vehicle

		expect(isVehicleLineService(vehicle.service) && vehicle.service.stop.id).toBe(unload.id)
		expect('zone' in unload).toBe(true)
		maybeAdvanceVehiclePastCompletedZoneStop(game, vehicle, character)

		expect(isVehicleLineService(vehicle.service)).toBe(false)
		expect(vehicle.service).toBeUndefined()
	})

	it('uses the ChopSaw gather line instead of maintenance offload for needed wood on a project tile', async () => {
		game = new Game({ terrainSeed: 9421, characterCount: 0 }, chopSaw)
		await game.loaded
		game.ticker.stop()

		const vehicle = game.vehicles.vehicle('ChopSaw:wheelbarrow1')
		if (!vehicle) throw new Error('expected ChopSaw wheelbarrow')
		const character = game.population.createCharacter('ChopSawLineLoader', { q: 9, r: -7 })
		vehicle.position = { q: 9, r: -7 }
		const loose = game.hex.looseGoods.add({ q: 9, r: -7 }, 'wood')

		const hop = findVehicleHopJob(game, character)
		expect(hop?.job).toBe('vehicleHop')
		expect(hop?.stopId).toBe('ChopSaw:ig-load')
		expect(hop?.zoneBrowseAction).toBe('load')
		expect(hop?.targetCoord).toMatchObject({ q: 9, r: -7 })
		expect(hop?.goodType).toBe('wood')
		expect(hop?.needsBeginService).toBe(true)

		const offload = findVehicleOffloadJob(game, character)
		expect(offload).toBeUndefined()
		expect(loose.isRemoved).toBe(false)
	})

	it('offers a hop when the zone operator is stepped off but still linked to a loaded wheelbarrow', async () => {
		game = new Game({ terrainSeed: 9420, characterCount: 0 }, chopSaw)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines.find(
			(candidate) => candidate.id === 'ChopSaw:implicit-gather:0,0'
		)
		if (!line) throw new Error('expected ChopSaw implicit gather line')
		const load = line.stops.find((stop) => stop.id === 'ChopSaw:ig-load')
		const unload = line.stops.find((stop) => stop.id === 'ChopSaw:ig-unload')
		if (!load || !unload) throw new Error('expected ChopSaw load/unload stops')
		const vehicle = game.vehicles.vehicle('ChopSaw:wheelbarrow1')
		if (!vehicle) throw new Error('expected ChopSaw wheelbarrow')
		const character = game.population.createCharacter('ChopSawSteppedOff', { q: -1, r: -1 })
		vehicle.position = { q: -1, r: -1 }
		vehicle.storage.addGood('wood', 1)
		vehicle.beginLineService(line, load, character)
		character.operates = vehicle
		character.onboard()
		character.stepOffVehicleKeepingControl()

		expect(character.driving).toBe(false)
		expect(character.operates?.uid).toBe(vehicle.uid)

		const hop = findVehicleHopJob(game, character)
		expect(hop?.job).toBe('vehicleHop')
		expect(hop?.stopId).toBe(unload.id)
		expect(hop?.dockEnter).toBe(true)
	})

	it('parks an empty cyclic line vehicle when one full route pass has no actionable stop', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'concrete' as const },
				{ coord: [1, 0] as const, terrain: 'grass' as const },
			],
			hives: [
				{
					name: 'EndRouteH',
					alveoli: [{ coord: [0, 0] as const, alveolus: 'freight_bay', goods: {} }],
				},
			],
			freightLines: [
				normalizeFreightLineDefinition({
					id: 'EndRouteH:exchange',
					name: 'Exchange',
					cyclic: true,
					stops: [
						{
							id: 'EndRouteH:bay',
							loadSelection: woodOnly,
							unloadSelection: woodOnly,
							anchor: freightBayAnchor('EndRouteH', [0, 0]),
						},
						{
							id: 'EndRouteH:zone',
							loadSelection: woodOnly,
							unloadSelection: woodOnly,
							zone: { kind: 'radius' as const, center: [0, 0] as const, radius: 2 },
						},
					],
				}),
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9423, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines.find((candidate) => candidate.id === 'EndRouteH:exchange')!
		const zone = line.stops[1]!
		const vehicle = game.vehicles.createVehicle('v-end-route', 'wheelbarrow', { q: 0, r: 0 }, [
			line,
		])
		vehicle.beginLineService(line, zone)
		const character = game.population.createCharacter('EndRouteWorker', { q: 0, r: 0 })

		expect(projectedLineStopForVehicleHop(game, character, vehicle)).toBeUndefined()
		expect(findVehicleHopJob(game, character)).toBeUndefined()
		const park = findVehicleOffloadJob(game, character)
		expect(park?.job).toBe('vehicleOffload')
		expect(park?.maintenanceKind).toBe('park')
		expect(park?.targetCoord).not.toEqual({ q: 0, r: 0 })

		character.scriptsContext.plan.begin({ ...park, type: 'work' } as any)
		expect(isVehicleMaintenanceService(vehicle.service)).toBe(true)
		expect(vehicle.service?.kind).toBe('park')
	})

	it('unfinished maintenance service without operator is offered to another worker', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'grass' as const },
				{ coord: [1, 0] as const, terrain: 'grass' as const },
			],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9415, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const vehicle = game.vehicles.createVehicle(
			'vresume-maintenance',
			'wheelbarrow',
			{ q: 0, r: 0 },
			[]
		)
		vehicle.storage.addGood('wood', 1)
		vehicle.beginMaintenanceService({ kind: 'unloadToTile', targetCoord: { q: 1, r: 0 } })
		const character = game.population.createCharacter('ResumeMaintenance', { q: 1, r: 0 })

		const job = findVehicleOffloadJob(game, character)

		expect(job?.job).toBe('vehicleOffload')
		expect(job?.maintenanceKind).toBe('unloadToTile')
		expect(job?.vehicleUid).toBe(vehicle.uid)
	})
})
