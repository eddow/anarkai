import { BuildDwelling } from 'ssh/board/content/build-dwelling'
import { defined, traces } from 'ssh/debug'
import {
	findLoadOntoVehicleJob,
	findProvideFromVehicleJob,
	lineFreightVehicleType,
} from 'ssh/freight/vehicle-work'
import type { SaveState } from 'ssh/game'
import { StorageAlveolus } from 'ssh/hive/storage'
import { VehicleFunctions } from 'ssh/npcs/context/vehicle'
import { subject } from 'ssh/npcs/scripts'
import { DurationStep } from 'ssh/npcs/steps'
import type { Character } from 'ssh/population/character'
import { afterEach, describe, expect, it } from 'vitest'
import { distributeFreightLine, gatherFreightLine } from '../freight-fixtures'
import { TestEngine } from '../test-engine'

type NpcTraceRecord = { method: string; message: string }

const noop = () => undefined

type VehicleTraceSink = NonNullable<typeof traces.vehicle>
type NpcTraceSink = NonNullable<typeof traces.npc>

/** Long simulations can spam traces; keep compact buffers to avoid huge Vitest RPC payloads. */
const MAX_VEHICLE_DEBUG = 2_000
const MAX_NPC_EVENTS = 2_000

function createTraceCollector() {
	const vehicleDebug: string[] = []
	const npcEvents: NpcTraceRecord[] = []

	const pushVehicleDebug = (message?: unknown) => {
		const s = typeof message === 'string' ? message : String(message)
		if (!s.startsWith('vehicleJob.')) return
		// `vehicleJob.selected` can spam every planner pass; keep consecutive runs collapsed here too.
		if (
			vehicleDebug.length > 0 &&
			vehicleDebug[vehicleDebug.length - 1] === 'vehicleJob.selected' &&
			s === 'vehicleJob.selected'
		) {
			return
		}
		if (vehicleDebug.length >= MAX_VEHICLE_DEBUG) vehicleDebug.shift()
		vehicleDebug.push(s)
	}

	const captureNpc =
		(method: NpcTraceRecord['method']) =>
		(message?: unknown, ..._rest: unknown[]) => {
			if (npcEvents.length >= MAX_NPC_EVENTS) npcEvents.shift()
			const m = typeof message === 'string' ? message : String(message)
			npcEvents.push({ method, message: m })
		}

	const vehicle = {
		log: (message?: unknown, ..._rest: unknown[]) => pushVehicleDebug(message),
		info: noop,
		debug: (message?: unknown, ..._rest: unknown[]) => pushVehicleDebug(message),
		warn: noop,
		error: noop,
		assert: noop,
	}
	const npc = {
		log: captureNpc('log'),
		info: captureNpc('info'),
		debug: captureNpc('debug'),
		warn: captureNpc('warn'),
		error: captureNpc('error'),
	}
	return {
		vehicleDebug,
		npcEvents,
		vehicle,
		npc,
		reset() {
			vehicleDebug.length = 0
			npcEvents.length = 0
		},
	}
}

/** Collapse consecutive duplicates (selection can log every planner pass). */
function collapseRuns(seq: readonly string[]): string[] {
	const out: string[] = []
	for (const s of seq) {
		if (out.length === 0 || out[out.length - 1] !== s) out.push(s)
	}
	return out
}

function hasOrderedSubsequence(haystack: readonly string[], needle: readonly string[]): boolean {
	if (needle.length === 0) return true
	let j = 0
	for (const h of haystack) {
		if (h === needle[j]) {
			j++
			if (j === needle.length) return true
		}
	}
	return false
}

function availableLooseWoodCount(game: TestEngine['game'], coord: { q: number; r: number }) {
	return game.hex.looseGoods
		.getGoodsAt(coord)
		.filter((g) => g.goodType === 'wood' && g.available && !g.isRemoved).length
}

function hiveWoodStock(alveolus: StorageAlveolus) {
	return alveolus.storage.stock.wood ?? 0
}

/**
 * Advance virtual time, re-invoking `findBestJob`→`begin` whenever the worker is between steps.
 * Stops when `isDone()` is true or `maxVirtualSeconds` elapses.
 */
async function simulateFreightUntil(
	engine: TestEngine,
	worker: Character,
	isDone: () => boolean,
	maxVirtualSeconds: number,
	step = 0.1
) {
	let elapsed = 0
	let i = 0
	while (elapsed < maxVirtualSeconds && !isDone()) {
		if (!worker.stepExecutor) {
			const job = worker.findBestJob()
			if (job) worker.begin(job)
		}
		engine.tick(step)
		elapsed += step
		i++
		if (i % 200 === 0) await new Promise((r) => setTimeout(r, 0))
	}
}

describe('Freight simulation (gather + distribute)', () => {
	afterEach(() => {
		delete traces.vehicle
		delete traces.npc
	})

	async function tickAsync(engine: TestEngine, seconds: number, step = 0.1) {
		const steps = Math.ceil(seconds / step)
		for (let i = 0; i < steps; i++) {
			engine.tick(step)
			if (i % 20 === 0) await new Promise((r) => setTimeout(r, 0))
		}
	}

	it('gather line: loose wood moves off the ground toward hive storage (wheelbarrow + traces)', {
		timeout: 60000,
	}, async () => {
		const collector = createTraceCollector()
		traces.vehicle = collector.vehicle as unknown as VehicleTraceSink
		traces.npc = collector.npc as unknown as NpcTraceSink

		let engine: TestEngine | undefined
		try {
			engine = new TestEngine({ terrainSeed: 9101, characterCount: 0 })
			await engine.init()

			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'SimGather',
						alveoli: [
							{ coord: [0, 0], alveolus: 'storage', goods: {} },
							{ coord: [1, 0], alveolus: 'freight_bay', goods: {} },
						],
					},
				],
				tiles: [
					{ coord: [0, 0] as [number, number], terrain: 'concrete' },
					{ coord: [1, 0] as [number, number], terrain: 'concrete' },
					{ coord: [2, 0] as [number, number], terrain: 'grass' },
				],
				looseGoods: [
					{ position: { q: 2, r: 0 }, goodType: 'wood' },
					{ position: { q: 2, r: 0 }, goodType: 'wood' },
					{ position: { q: 2, r: 0 }, goodType: 'wood' },
				],
				freightLines: [
					gatherFreightLine({
						id: 'SimGather:wood',
						name: 'Wood gather',
						hiveName: 'SimGather',
						coord: [1, 0],
						filters: ['wood'],
						radius: 4,
					}),
				],
			}

			engine.loadScenario(scenario)

			const storageTile = engine.game.hex.getTile({ q: 0, r: 0 })
			const bayTile = engine.game.hex.getTile({ q: 1, r: 0 })
			const storageAlveolus = storageTile?.content as StorageAlveolus
			const bayAlveolus = bayTile?.content as StorageAlveolus
			expect(storageAlveolus).toBeInstanceOf(StorageAlveolus)
			expect(bayAlveolus).toBeInstanceOf(StorageAlveolus)
			storageAlveolus.setBuffers({ wood: 10 })

			const worker = engine.spawnCharacter('Gatherer', { q: 2, r: 0 })
			worker.role = 'worker'
			void worker.scriptsContext

			const line = engine.game.freightLines[0]!
			const vehicle = engine.game.vehicles.createVehicle(
				'sim-gather-wb',
				'wheelbarrow',
				{ q: 2, r: 0 },
				[line]
			)
			vehicle.beginService(line, line.stops[0]!, worker)
			worker.operates = vehicle
			worker.onboard()

			expect(findLoadOntoVehicleJob(engine.game, worker)).toBeDefined()

			const looseBefore = availableLooseWoodCount(engine.game, { q: 2, r: 0 })
			const hiveWoodBefore = hiveWoodStock(storageAlveolus) + hiveWoodStock(bayAlveolus)

			await simulateFreightUntil(
				engine,
				worker,
				() => {
					// Do not use loose-good count alone: long runs can decay loose goods without freight.
					const hiveNow = hiveWoodStock(storageAlveolus) + hiveWoodStock(bayAlveolus)
					const vehicleWoodNow = vehicle.storage.available('wood') ?? 0
					return hiveNow > hiveWoodBefore || vehicleWoodNow > 0
				},
				90
			)

			const rawVehicle = [...collector.vehicleDebug]
			expect(rawVehicle.length).toBeGreaterThan(0)

			const looseAfter = availableLooseWoodCount(engine.game, { q: 2, r: 0 })
			const hiveWoodAfter = hiveWoodStock(storageAlveolus) + hiveWoodStock(bayAlveolus)
			const vehicleWood = vehicle.storage.available('wood') ?? 0
			expect(hiveWoodAfter > hiveWoodBefore || vehicleWood > 0).toBe(true)
			expect(looseAfter <= looseBefore).toBe(true)

			// `findBestJob` emits `vehicleJob.selected`; load work emits `vehicleJob.load` before grab planning.
			expect(hasOrderedSubsequence(rawVehicle, ['vehicleJob.selected', 'vehicleJob.load'])).toBe(
				true
			)

			const npcFails = collector.npcEvents.filter((e) => e.message === 'nextStep.infiniteFail')
			expect(npcFails).toHaveLength(0)
		} finally {
			collector.reset()
			await engine?.destroy()
		}
	})

	it('distribute: wheelbarrow provides wood to a standalone BuildDwelling under virtual time (traces)', {
		timeout: 60000,
	}, async () => {
		const collector = createTraceCollector()
		traces.vehicle = collector.vehicle as unknown as VehicleTraceSink
		traces.npc = collector.npc as unknown as NpcTraceSink

		let engine: TestEngine | undefined
		try {
			engine = new TestEngine({ terrainSeed: 9102, characterCount: 0 })
			await engine.init()

			const scenario: Partial<SaveState> = {
				tiles: [
					{ coord: [0, 0] as [number, number], terrain: 'concrete' },
					{ coord: [2, 0] as [number, number], terrain: 'concrete' },
				],
				hives: [
					{
						name: 'SimDist',
						alveoli: [{ coord: [2, 0], alveolus: 'freight_bay', goods: {} }],
					},
				],
				freightLines: [
					distributeFreightLine({
						id: 'sim-dist-wood',
						name: 'Wood distribute',
						hiveName: 'SimDist',
						coord: [2, 0],
						filters: ['wood'],
						unloadRadius: 12,
					}),
				],
			}

			engine.loadScenario(scenario)

			const siteTile = engine.game.hex.getTile({ q: 0, r: 0 })!
			siteTile.zone = 'residential'
			siteTile.content = new BuildDwelling(siteTile, 'basic_dwelling')
			const site = siteTile.content as BuildDwelling
			site.storage.addGood('planks', 1)

			const woodNeedBefore = site.remainingNeeds.wood ?? 0
			expect(woodNeedBefore).toBeGreaterThan(0)

			expect(engine.game.freightLines.some((l) => l.id === 'sim-dist-wood')).toBe(true)

			const distLine = engine.game.freightLines.find((l) => l.id === 'sim-dist-wood')!
			const vehicle = engine.game.vehicles.createVehicle(
				'sim-dist-wb',
				lineFreightVehicleType(),
				{ q: 0, r: 0 },
				[distLine]
			)

			const worker = engine.spawnCharacter('Hauler', { q: 0, r: 0 })
			worker.role = 'worker'
			void worker.scriptsContext
			vehicle.beginLineService(distLine, distLine.stops[1]!, worker)
			worker.operates = vehicle
			worker.onboard()
			vehicle.storage.addGood('wood', Math.max(woodNeedBefore, 5))
			expect(vehicle.storage.available('wood')).toBeGreaterThan(0)

			const pj = defined(findProvideFromVehicleJob(engine.game, worker), 'provideFromVehicle job')

			// `work.goWork` begins by dumping any carried goods (`inventory.dropAllLoose`), which would
			// empty a preloaded wheelbarrow before `provideFromVehicle`. Drive the step directly like the
			// unit test, then advance virtual time with `engine.tick` for the duration step.
			const wf = new VehicleFunctions()
			Object.assign(wf, { [subject]: worker })
			const step = wf.provideFromVehicleStep({
				type: 'work',
				job: 'provideFromVehicle',
				target: vehicle,
				vehicleUid: vehicle.uid,
				goodType: pj.goodType,
				quantity: pj.quantity ?? 1,
				path: [],
				urgency: pj.urgency,
				fatigue: pj.fatigue,
			}) as DurationStep
			expect(step).toBeInstanceOf(DurationStep)
			step.finish()
			await tickAsync(engine, 2)

			const woodNeedAfter = site.remainingNeeds.wood ?? 0
			expect(woodNeedAfter).toBeLessThan(woodNeedBefore)

			const seq = collapseRuns([...collector.vehicleDebug])
			expect(seq.length).toBeGreaterThan(0)
			expect(seq.some((s) => s === 'vehicleJob.provide')).toBe(true)

			const npcFails = collector.npcEvents.filter((e) => e.message === 'nextStep.infiniteFail')
			expect(npcFails).toHaveLength(0)
		} finally {
			collector.reset()
			await engine?.destroy()
		}
	})
})
