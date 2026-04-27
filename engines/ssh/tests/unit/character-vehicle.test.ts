import {
	detachVehicleServiceIfStorageEmpty,
	disembarkOperatorLeavingDockedVehicleInService,
	ensureVehicleServiceStarted,
	releaseVehicleFreightWorkOnPlanInterrupt,
} from 'ssh/freight/vehicle-run'
import { findVehicleApproachJob } from 'ssh/freight/vehicle-work'
import { Game } from 'ssh/game/game'
import { offloadDropBufferNative } from 'ssh/npcs/context/inventory'
import { getGameScript, ScriptExecution } from 'ssh/npcs/scripts'
import { isVehicleLineService, isVehicleMaintenanceService } from 'ssh/population/vehicle/vehicle'
import { axial } from 'ssh/utils'
import { toAxialCoord } from 'ssh/utils/position'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AssertionError, traces } from '../../src/lib/dev/debug.ts'
import { gatherFreightLine } from '../freight-fixtures'

describe('Character vehicle seam', () => {
	let game: Game

	afterEach(() => {
		game.destroy()
	})

	it('boards using operates only when aligned, then offboards with an independent foot position', async () => {
		const gen = { terrainSeed: 9301, characterCount: 0 }
		const patches = {
			tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }],
		}
		game = new Game(gen, patches)
		await game.loaded
		game.ticker.stop()

		const vehicle = game.vehicles.createVehicle('v-test', 'wheelbarrow', { q: 0, r: 0 })
		const character = game.population.createCharacter('Ada', { q: 0, r: 0 })

		expect(character.driving).toBe(false)

		vehicle.beginOffloadService(character)
		character.operates = vehicle
		character.onboard()
		expect(character.driving).toBe(true)
		expect(axial.key(toAxialCoord(character.position)!)).toBe(
			axial.key(toAxialCoord(vehicle.effectivePosition)!)
		)

		character.offboard()
		expect(character.driving).toBe(false)
		expect(character.operates).toBeUndefined()
		const foot = toAxialCoord(character.position)!
		expect(axial.key(foot)).toBe(axial.key(toAxialCoord(vehicle.effectivePosition)!))
	})

	it('onboards when vehicle axial position is fractional but rounds to the character hex', async () => {
		const gen = { terrainSeed: 9305, characterCount: 0 }
		const patches = {
			tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }],
		}
		game = new Game(gen, patches)
		await game.loaded
		game.ticker.stop()

		const vehicle = game.vehicles.createVehicle('v-frac', 'wheelbarrow', { q: 0, r: 0 })
		const character = game.population.createCharacter('Frac', { q: 0, r: 0 })
		// Same situation as walk-lerp / pixel jitter: still one hex, but raw `toAxialCoord` keys can differ.
		vehicle.position = { q: 0.004, r: -0.003 }

		vehicle.beginOffloadService(character)
		character.operates = vehicle
		character.onboard()
		expect(character.driving).toBe(true)
	})

	it('keeps character.operates and vehicle.operator in sync 1:1', async () => {
		game = new Game(
			{ terrainSeed: 9310, characterCount: 0 },
			{
				tiles: [
					{ coord: [0, 0] as const, terrain: 'grass' as const },
					{ coord: [1, 0] as const, terrain: 'grass' as const },
				],
			}
		)
		await game.loaded
		game.ticker.stop()

		const vehicle = game.vehicles.createVehicle('v-sync', 'wheelbarrow', { q: 0, r: 0 })
		const first = game.population.createCharacter('First', { q: 0, r: 0 })
		const second = game.population.createCharacter('Second', { q: 1, r: 0 })

		vehicle.beginOffloadService(first)
		first.operates = vehicle
		expect(vehicle.operator?.uid).toBe(first.uid)

		expect(() => {
			second.operates = vehicle
		}).toThrow(AssertionError)

		first.operates = undefined
		expect(vehicle.operator).toBeUndefined()
	})

	it('rejects operates assignment when vehicle has no service', async () => {
		game = new Game(
			{ terrainSeed: 9316, characterCount: 0 },
			{ tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }] }
		)
		await game.loaded
		game.ticker.stop()

		const vehicle = game.vehicles.createVehicle('v-no-service', 'wheelbarrow', { q: 0, r: 0 })
		const character = game.population.createCharacter('NoSvc', { q: 0, r: 0 })

		expect(() => {
			character.operates = vehicle
		}).toThrow(AssertionError)
	})

	it('setServiceOperator also binds character.operates while leaving onboarding separate', async () => {
		game = new Game(
			{ terrainSeed: 9317, characterCount: 0 },
			{ tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }] }
		)
		await game.loaded
		game.ticker.stop()

		const vehicle = game.vehicles.createVehicle('v-bind-helper', 'wheelbarrow', { q: 0, r: 0 })
		const character = game.population.createCharacter('Helper', { q: 0, r: 0 })

		vehicle.beginOffloadService()
		vehicle.setServiceOperator(character)

		expect(vehicle.operator?.uid).toBe(character.uid)
		expect(character.operates?.uid).toBe(vehicle.uid)
		expect(character.driving).toBe(false)
	})

	it('rebinds service.operator when the same operated vehicle is assigned again', async () => {
		game = new Game(
			{ terrainSeed: 9321, characterCount: 0 },
			{ tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }] }
		)
		await game.loaded
		game.ticker.stop()

		const vehicle = game.vehicles.createVehicle('v-rebind-same', 'wheelbarrow', { q: 0, r: 0 })
		const character = game.population.createCharacter('Rebind', { q: 0, r: 0 })

		vehicle.beginOffloadService()
		character.operates = vehicle
		expect(vehicle.operator?.uid).toBe(character.uid)

		vehicle.releaseOperator(character)
		character.setOperatedVehicleFromService(vehicle)
		expect(character.operates?.uid).toBe(vehicle.uid)
		expect(vehicle.operator?.uid).toBe(character.uid)

		vehicle.releaseOperator(character)
		character.setOperatedVehicleFromService(vehicle)
		character.operates = vehicle

		expect(character.operates?.uid).toBe(vehicle.uid)
		expect(vehicle.operator?.uid).toBe(character.uid)
	})

	it('does not offer a line-claimed wheelbarrow to a second character', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'grass' as const },
				{ coord: [1, 0] as const, terrain: 'grass' as const },
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
					id: 'CV:claimed-before-service',
					name: 'Claimed before service',
					hiveName: 'H',
					coord: [0, 0],
					filters: ['wood'],
					radius: 2,
				}),
			],
			looseGoods: [{ goodType: 'wood' as const, position: { q: 1, r: 0 } }],
		}
		game = new Game({ terrainSeed: 9311, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const vehicle = game.vehicles.createVehicle('v-claimed', 'wheelbarrow', { q: 0, r: 0 }, [
			game.freightLines[0]!,
		])
		const first = game.population.createCharacter('First', { q: 0, r: 0 })
		const second = game.population.createCharacter('Second', { q: 1, r: 0 })

		expect(ensureVehicleServiceStarted(vehicle, first, game, first)).toBe(true)
		first.operates = vehicle
		first.onboard()

		expect(isVehicleLineService(vehicle.service)).toBe(true)
		expect(vehicle.operator?.uid).toBe(first.uid)
		expect(findVehicleApproachJob(game, second)).toBeUndefined()
	})

	it('claims a vehicle as soon as an approach work plan begins', async () => {
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'grass' as const },
				{ coord: [1, 0] as const, terrain: 'grass' as const },
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
					id: 'CV:claim-on-select',
					name: 'Claim on select',
					hiveName: 'H',
					coord: [0, 0],
					filters: ['wood'],
					radius: 2,
				}),
			],
			looseGoods: [{ goodType: 'wood' as const, position: { q: 1, r: 0 } }],
		}
		game = new Game({ terrainSeed: 9313, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		game.vehicles.createVehicle('v-select', 'wheelbarrow', { q: 0, r: 0 }, [game.freightLines[0]!])
		const first = game.population.createCharacter('First', { q: 1, r: 0 })
		const second = game.population.createCharacter('Second', { q: 0, r: 0 })

		const action = first.findBestJob()
		expect(action).toBeTruthy()
		if (!action) throw new Error('Expected a vehicle approach action')
		first.begin(action)
		expect(findVehicleApproachJob(game, second)).toBeUndefined()
	})

	it('rejects boarding without operates', async () => {
		const gen = { terrainSeed: 9302, characterCount: 0 }
		game = new Game(gen, {
			tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }],
		})
		await game.loaded
		game.ticker.stop()

		const character = game.population.createCharacter('Bob', { q: 0, r: 0 })
		expect(() => character.onboard()).toThrow(AssertionError)
	})

	it('rejects boarding when operates is not at the same tile', async () => {
		const gen = { terrainSeed: 9303, characterCount: 0 }
		game = new Game(gen, {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'grass' as const },
				{ coord: [1, 0] as const, terrain: 'grass' as const },
			],
		})
		await game.loaded
		game.ticker.stop()

		game.vehicles.createVehicle('v-far', 'wheelbarrow', { q: 1, r: 0 })
		const vehicle = game.vehicles.vehicle('v-far')!
		const character = game.population.createCharacter('Cyd', { q: 0, r: 0 })
		vehicle.beginOffloadService(character)
		character.operates = vehicle
		expect(() => character.onboard()).toThrow(AssertionError)
	})

	it('actionDescription reflects current runningScripts after script stack changes', async () => {
		game = new Game(
			{ terrainSeed: 9320, characterCount: 0 },
			{ tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }] }
		)
		await game.loaded
		game.ticker.stop()

		const character = game.population.createCharacter('ActionDesc', { q: 0, r: 0 })
		void character.scriptsContext

		const selfCareScript = getGameScript('selfCare')
		const workScript = getGameScript('work')
		const vehicleScript = getGameScript('vehicle')
		const walkScript = getGameScript('walk')
		if (!selfCareScript || !workScript || !vehicleScript || !walkScript) {
			throw new Error('Expected core NPC scripts to be loaded')
		}

		character.runningScripts = [new ScriptExecution(selfCareScript, 'selfCare.wander')]
		expect(character.actionDescription).toEqual(['selfCare.wander'])

		character.runningScripts = [
			new ScriptExecution(walkScript, 'walk.until'),
			new ScriptExecution(vehicleScript, 'vehicle.vehicleOffload'),
			new ScriptExecution(workScript, 'work.goWork'),
		]
		expect(character.actionDescription).toEqual([
			'work.goWork',
			'vehicle.vehicleOffload',
			'walk.until',
		])

		character.runningScripts = [new ScriptExecution(selfCareScript, 'selfCare.wander')]
		expect(character.actionDescription).toEqual(['selfCare.wander'])
	})

	it('empty transport with offload service detaches service and clears operated vehicle without plan.finally offboarding', async () => {
		game = new Game(
			{ terrainSeed: 9314, characterCount: 0 },
			{ tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }] }
		)
		await game.loaded
		game.ticker.stop()

		const vehicle = game.vehicles.createVehicle('v-off-empty', 'wheelbarrow', { q: 0, r: 0 })
		const character = game.population.createCharacter('OffEmpty', { q: 0, r: 0 })
		vehicle.beginOffloadService(character)
		character.operates = vehicle
		character.onboard()

		detachVehicleServiceIfStorageEmpty(vehicle)
		expect(character.driving).toBe(false)
		expect(character.operates).toBeUndefined()
		expect(vehicle.service).toBeUndefined()
	})

	it('offloadDropBufferNative drops stock without completing maintenance service', async () => {
		game = new Game(
			{ terrainSeed: 9315, characterCount: 0 },
			{ tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }] }
		)
		await game.loaded
		game.ticker.stop()

		const vehicle = game.vehicles.createVehicle('v-off-drain', 'wheelbarrow', { q: 0, r: 0 })
		vehicle.storage.addGood('wood', 1)
		const character = game.population.createCharacter('OffDrain', { q: 0, r: 0 })
		vehicle.beginMaintenanceService(
			{ kind: 'unloadToTile', targetCoord: { q: 0, r: 0 } },
			character
		)
		character.operates = vehicle
		character.onboard()

		const step = offloadDropBufferNative(character.scriptsContext.inventory)
		expect(step).toBeTruthy()
		step?.finish()

		expect(character.driving).toBe(true)
		expect(character.operates?.uid).toBe(vehicle.uid)
		expect(isVehicleMaintenanceService(vehicle.service)).toBe(true)
		expect(vehicle.storage.available('wood')).toBe(0)
	})

	it('disembarkVehicleKeepingService clears operator but keeps line service', async () => {
		const patches = {
			tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }],
			freightLines: [
				gatherFreightLine({
					id: 'CV:disembark-dock',
					name: 'Disembark dock',
					hiveName: 'H',
					coord: [0, 0],
					filters: ['wood'],
					radius: 2,
				}),
			],
		}
		game = new Game({ terrainSeed: 9304, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines[0]!
		const anchorStop = line.stops[1]!
		const vehicle = game.vehicles.createVehicle('v-dock-keep', 'wheelbarrow', { q: 0, r: 0 }, [
			line,
		])
		const character = game.population.createCharacter('Dock', { q: 0, r: 0 })
		vehicle.beginLineService(line, anchorStop, character)
		character.operates = vehicle
		character.onboard()

		expect(isVehicleLineService(vehicle.service)).toBe(true)
		disembarkOperatorLeavingDockedVehicleInService(character, vehicle)
		expect(character.driving).toBe(false)
		expect(character.operates).toBeUndefined()
		expect(isVehicleLineService(vehicle.service)).toBe(true)
		expect(vehicle.operator).toBeUndefined()
	})

	it('can step off while keeping control, then re-board or disengage while keeping service', async () => {
		const patches = {
			tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }],
			freightLines: [
				gatherFreightLine({
					id: 'CV:zone-control',
					name: 'Zone control',
					hiveName: 'H',
					coord: [0, 0],
					filters: ['wood'],
					radius: 2,
				}),
			],
		}
		game = new Game({ terrainSeed: 93041, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines[0]!
		const zoneStop = line.stops[0]!
		const vehicle = game.vehicles.createVehicle('v-zone-control', 'wheelbarrow', { q: 0, r: 0 }, [
			line,
		])
		vehicle.storage.addGood('wood', 1)
		const character = game.population.createCharacter('Zoney', { q: 0, r: 0 })
		vehicle.beginLineService(line, zoneStop, character)
		character.operates = vehicle
		character.onboard()

		character.stepOffVehicleKeepingControl()
		expect(character.driving).toBe(false)
		expect(character.operates?.uid).toBe(vehicle.uid)
		expect(character.transportStorage).toBe(vehicle.storage)
		expect(vehicle.operator?.uid).toBe(character.uid)

		character.boardLinkedVehicle()
		expect(character.driving).toBe(true)

		character.stepOffVehicleKeepingControl()
		character.disengageVehicleKeepingService()
		expect(character.driving).toBe(false)
		expect(character.operates).toBeUndefined()
		expect(isVehicleLineService(vehicle.service)).toBe(true)
		expect(vehicle.operator).toBeUndefined()
	})

	it('offboard clears freight service but keeps vehicle stock', async () => {
		const patches = {
			tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }],
			freightLines: [
				gatherFreightLine({
					id: 'CV:offboard',
					name: 'Offboard',
					hiveName: 'H',
					coord: [0, 0],
					filters: ['wood'],
					radius: 2,
				}),
			],
		}
		game = new Game({ terrainSeed: 9304, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines[0]!
		const vehicle = game.vehicles.createVehicle('v-off', 'wheelbarrow', { q: 0, r: 0 }, [line])
		const character = game.population.createCharacter('Dee', { q: 0, r: 0 })
		const stop = line.stops[0]!
		vehicle.beginService(line, stop, character)
		vehicle.storage.addGood('wood', 2)
		character.operates = vehicle
		character.onboard()

		expect(vehicle.service).toBeDefined()
		character.offboard()
		expect(vehicle.service).toBeUndefined()
		expect(vehicle.storage.stock.wood).toBe(2)
	})

	it('releaseVehicleFreightWorkOnPlanInterrupt clears operator and keeps unfinished empty line service', async () => {
		const patches = {
			tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }],
			freightLines: [
				gatherFreightLine({
					id: 'CV:interrupt-empty',
					name: 'Interrupt',
					hiveName: 'H',
					coord: [0, 0],
					filters: ['wood'],
					radius: 2,
				}),
			],
		}
		game = new Game({ terrainSeed: 9305, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines[0]!
		const vehicle = game.vehicles.createVehicle('v-int', 'wheelbarrow', { q: 0, r: 0 }, [line])
		const character = game.population.createCharacter('Eve', { q: 0, r: 0 })
		vehicle.beginService(line, line.stops[0]!, character)
		character.operates = vehicle

		releaseVehicleFreightWorkOnPlanInterrupt(character)
		expect(isVehicleLineService(vehicle.service)).toBe(true)
		expect(vehicle.operator).toBeUndefined()
		expect(character.operates).toBeUndefined()
	})

	it('releaseVehicleFreightWorkOnPlanInterrupt keeps service when storage is non-empty', async () => {
		const patches = {
			tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }],
			freightLines: [
				gatherFreightLine({
					id: 'CV:interrupt-stock',
					name: 'Interrupt stock',
					hiveName: 'H',
					coord: [0, 0],
					filters: ['wood'],
					radius: 2,
				}),
			],
		}
		game = new Game({ terrainSeed: 9306, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines[0]!
		const vehicle = game.vehicles.createVehicle('v-stk', 'wheelbarrow', { q: 0, r: 0 }, [line])
		const character = game.population.createCharacter('Flo', { q: 0, r: 0 })
		vehicle.beginService(line, line.stops[0]!, character)
		vehicle.storage.addGood('wood', 1)
		character.operates = vehicle

		releaseVehicleFreightWorkOnPlanInterrupt(character)
		expect(vehicle.service).toBeDefined()
		expect(vehicle.service!.operator).toBeUndefined()
	})

	it('releaseVehicleFreightWorkOnPlanInterrupt keeps unfinished offload service when storage is empty', async () => {
		game = new Game(
			{ terrainSeed: 9312, characterCount: 0 },
			{ tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }] }
		)
		await game.loaded
		game.ticker.stop()

		const vehicle = game.vehicles.createVehicle('v-pre-service', 'wheelbarrow', { q: 0, r: 0 })
		const character = game.population.createCharacter('Pre', { q: 0, r: 0 })
		vehicle.beginOffloadService(character)
		character.operates = vehicle
		character.onboard()

		releaseVehicleFreightWorkOnPlanInterrupt(character)
		expect(vehicle.operator).toBeUndefined()
		expect(isVehicleMaintenanceService(vehicle.service)).toBe(true)
		expect(character.operates).toBeUndefined()
	})

	it('releaseVehicleFreightWorkOnPlanInterrupt traces operator release while keeping empty service', async () => {
		const patches = {
			tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }],
			freightLines: [
				gatherFreightLine({
					id: 'CV:trace-empty',
					name: 'Trace empty',
					hiveName: 'H',
					coord: [0, 0],
					filters: ['wood'],
					radius: 2,
				}),
			],
		}
		game = new Game({ terrainSeed: 9307, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines[0]!
		const vehicle = game.vehicles.createVehicle('v-tr-empty', 'wheelbarrow', { q: 0, r: 0 }, [line])
		const character = game.population.createCharacter('TraceE', { q: 0, r: 0 })
		vehicle.beginService(line, line.stops[0]!, character)
		character.operates = vehicle

		const log = vi.fn()
		const prev = traces.vehicle
		traces.vehicle = {
			debug: vi.fn(),
			error: vi.fn(),
			info: vi.fn(),
			log,
			warn: vi.fn(),
		} as unknown as typeof console
		try {
			releaseVehicleFreightWorkOnPlanInterrupt(character)
			expect(log).toHaveBeenCalledWith('vehicle freight operator released on plan interrupt', {
				vehicleUid: vehicle.uid,
				characterUid: character.uid,
				stillHasService: true,
			})
		} finally {
			traces.vehicle = prev
		}
	})

	it('releaseVehicleFreightWorkOnPlanInterrupt traces operator release when storage non-empty', async () => {
		const patches = {
			tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }],
			freightLines: [
				gatherFreightLine({
					id: 'CV:trace-stock',
					name: 'Trace stock',
					hiveName: 'H',
					coord: [0, 0],
					filters: ['wood'],
					radius: 2,
				}),
			],
		}
		game = new Game({ terrainSeed: 9308, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const line = game.freightLines[0]!
		const vehicle = game.vehicles.createVehicle('v-tr-stk', 'wheelbarrow', { q: 0, r: 0 }, [line])
		const character = game.population.createCharacter('TraceS', { q: 0, r: 0 })
		vehicle.beginService(line, line.stops[0]!, character)
		vehicle.storage.addGood('wood', 1)
		character.operates = vehicle

		const log = vi.fn()
		const prev = traces.vehicle
		traces.vehicle = {
			debug: vi.fn(),
			error: vi.fn(),
			info: vi.fn(),
			log,
			warn: vi.fn(),
		} as unknown as typeof console
		try {
			releaseVehicleFreightWorkOnPlanInterrupt(character)
			expect(log).toHaveBeenCalledWith('vehicle freight operator released on plan interrupt', {
				vehicleUid: vehicle.uid,
				characterUid: character.uid,
				stillHasService: true,
			})
		} finally {
			traces.vehicle = prev
		}
	})

	it('detachVehicleServiceIfStorageEmpty traces when service is dropped', async () => {
		const patches = {
			tiles: [{ coord: [0, 0] as const, terrain: 'grass' as const }],
			freightLines: [
				gatherFreightLine({
					id: 'CV:detach-tr',
					name: 'Detach trace',
					hiveName: 'H',
					coord: [0, 0],
					filters: ['wood'],
					radius: 2,
				}),
			],
		}
		game = new Game({ terrainSeed: 9309, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()
		const line = game.freightLines[0]!
		const vehicle = game.vehicles.createVehicle('v-det', 'wheelbarrow', { q: 0, r: 0 }, [line])
		const op = game.population.createCharacter('Detach', { q: 0, r: 0 })
		vehicle.beginService(line, line.stops[0]!, op)

		const log = vi.fn()
		const prev = traces.vehicle
		traces.vehicle = {
			debug: vi.fn(),
			error: vi.fn(),
			info: vi.fn(),
			log,
			warn: vi.fn(),
		} as unknown as typeof console
		try {
			detachVehicleServiceIfStorageEmpty(vehicle)
			expect(log).toHaveBeenCalledWith(
				'vehicle freight service detached (empty storage)',
				vehicle.uid
			)
		} finally {
			traces.vehicle = prev
		}
	})
})
