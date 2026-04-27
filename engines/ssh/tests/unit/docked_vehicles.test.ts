import {
	collectDockedVehiclesForBay,
	collectDockedVehiclesForHive,
} from 'ssh/freight/docked-vehicles'
import type { FreightLineDefinition, FreightStop } from 'ssh/freight/freight-line'
import { alveolusClass } from 'ssh/hive'
import { StorageAlveolus } from 'ssh/hive/storage'
import { afterEach, describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine/engine'

describe('docked vehicle collectors', () => {
	let engine: TestEngine | undefined

	afterEach(async () => {
		await engine?.destroy()
		engine = undefined
	})

	async function setupEngine(): Promise<TestEngine> {
		const next = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await next.init()
		engine = next
		return next
	}

	/** Stops are passed straight to `beginLineService` (no resolver); `hiveName` is unused here. */
	function stopAt(id: string, q: number, r: number): FreightStop {
		return {
			id,
			anchor: {
				kind: 'alveolus',
				hiveName: '',
				alveolusType: 'freight_bay',
				coord: [q, r],
			},
		}
	}

	it('collects only vehicles docked at the selected freight bay', async () => {
		const testEngine = await setupEngine()
		const game = testEngine.game
		const FreightBay = alveolusClass.freight_bay
		const tileA = game.hex.getTile({ q: 0, r: 0 })
		const tileB = game.hex.getTile({ q: 6, r: 0 })
		if (!FreightBay || !tileA || !tileB) throw new Error('test setup missing freight bays')

		const bayA = new FreightBay(tileA)
		tileA.content = bayA
		const bayB = new FreightBay(tileB)
		tileB.content = bayB
		if (!(bayA instanceof StorageAlveolus)) throw new Error('freight bay must be storage')

		const stop = stopAt('bay-a', 0, 0)
		const otherStop = stopAt('bay-b', 6, 0)
		const line: FreightLineDefinition = { id: 'line-1', name: 'Line 1', stops: [stop, otherStop] }

		const docked = game.vehicles.createVehicle('docked', 'wheelbarrow', { q: 0, r: 0 })
		docked.beginLineService(line, stop)
		docked.dock()

		const underway = game.vehicles.createVehicle('underway', 'wheelbarrow', { q: 0, r: 0 })
		underway.beginLineService(line, stop)

		const otherBayDocked = game.vehicles.createVehicle('other-bay', 'wheelbarrow', {
			q: 6,
			r: 0,
		})
		otherBayDocked.beginLineService(line, otherStop)
		otherBayDocked.dock()

		const entries = collectDockedVehiclesForBay(game, bayA)

		expect(entries.map((entry) => entry.vehicle.uid)).toEqual(['docked'])
		expect(entries[0]?.line.id).toBe(line.id)
		expect(entries[0]?.stop.id).toBe(stop.id)
	})

	it('collects docked vehicles physically attached to the selected hive', async () => {
		const testEngine = await setupEngine()
		const game = testEngine.game
		const FreightBay = alveolusClass.freight_bay
		const tileA = game.hex.getTile({ q: 0, r: 0 })
		const tileB = game.hex.getTile({ q: 6, r: 0 })
		if (!FreightBay || !tileA || !tileB) throw new Error('test setup missing freight bays')

		const bayA = new FreightBay(tileA)
		tileA.content = bayA
		const bayB = new FreightBay(tileB)
		tileB.content = bayB

		const stopA = stopAt('bay-a', 0, 0)
		const stopB = stopAt('bay-b', 6, 0)
		const line: FreightLineDefinition = { id: 'line-1', name: 'Line 1', stops: [stopA, stopB] }

		const dockedInHive = game.vehicles.createVehicle('hive-a-docked', 'wheelbarrow', { q: 0, r: 0 })
		dockedInHive.beginLineService(line, stopA)
		dockedInHive.dock()

		const underwayInHive = game.vehicles.createVehicle('hive-a-underway', 'wheelbarrow', {
			q: 0,
			r: 0,
		})
		underwayInHive.beginLineService(line, stopA)

		const dockedElsewhere = game.vehicles.createVehicle('hive-b-docked', 'wheelbarrow', {
			q: 6,
			r: 0,
		})
		dockedElsewhere.beginLineService(line, stopB)
		dockedElsewhere.dock()

		const entries = collectDockedVehiclesForHive(game, bayA.hive)

		expect(entries.map((entry) => entry.vehicle.uid)).toEqual(['hive-a-docked'])
		expect(entries[0]?.line.id).toBe(line.id)
		expect(entries[0]?.stop.id).toBe(stopA.id)
	})
})
