import type { GamePatches } from 'ssh/game/game'
import { Game } from 'ssh/game/game'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	DEFAULT_TRACE_LOG_LIFETIME,
	namedTrace,
	setTraceLevel,
	traceLevels,
	traces,
} from '../../src/lib/dev/debug.ts'
import { gatherFreightLine } from '../freight-fixtures'

class UnknownTraceThing {
	readonly value = 1
	readonly game = { uid: 'must-not-expand' }
}

class CustomTraceThing {
	readonly uid = 'custom-1'
	toTrace() {
		return {
			$type: 'CustomTraceThing',
			uid: this.uid,
			value: 42,
			game: { uid: 'must-not-expand' },
		}
	}
}

describe('safe trace serialization', () => {
	let game: Game | undefined

	afterEach(() => {
		game?.destroy()
		game = undefined
	})

	it('captures known runtime objects as bounded snapshots with stable refs', async () => {
		const line = gatherFreightLine({
			id: 'trace-line',
			name: 'Trace line',
			hiveName: 'TraceHive',
			coord: [0, 0],
			filters: ['wood'],
			radius: 2,
		})
		const patches = {
			tiles: [
				{ coord: [0, 0] as const, terrain: 'grass' as const },
				{ coord: [1, 0] as const, terrain: 'grass' as const },
			],
			freightLines: [line],
		} satisfies GamePatches
		game = new Game({ terrainSeed: 9701, characterCount: 0 }, patches)
		await game.loaded
		game.ticker.stop()

		const tile = game.hex.getTile({ q: 0, r: 0 })
		if (!tile) throw new Error('expected trace tile')
		const vehicle = game.vehicles.createVehicle('trace-vehicle', 'wheelbarrow', { q: 0, r: 0 }, [
			line,
		])
		vehicle.storage.addGood('wood', 2)
		const character = game.population.createCharacter('TraceCharacter', { q: 0, r: 0 })
		vehicle.beginService(line, line.stops[0]!, character)
		character.operates = vehicle
		const loose = game.hex.looseGoods.add({ q: 0, r: 0 }, 'wood')
		const movement = {
			goodType: 'wood',
			from: { q: 0, r: 0 },
			path: [
				{ q: 0, r: 0 },
				{ q: 1, r: 0 },
			],
			provider: vehicle,
			demander: tile,
			claimed: true,
			claimedBy: character,
			allocations: {
				target: {
					cancel() {},
					fulfill() {},
				},
			},
		}

		const sink = namedTrace('vehicle', { silent: true, time: () => 12.5 })
		sink.log?.('vehicleJob.selected', {
			character,
			vehicle,
			tile,
			loose,
			movement,
			again: vehicle,
			route: line,
			forbidden: {
				game,
				board: tile.board,
				hex: game.hex,
				kept: 'yes',
			},
		})

		const json = JSON.stringify(sink)
		expect(json).toContain('Vehicle')
		expect(json).not.toContain('"game"')
		expect(json).not.toContain('"board"')
		expect(json).not.toContain('"hex"')
		expect(() => JSON.stringify(sink)).not.toThrow()

		const text = sink.read(1)
		expect(text).toContain('log vehicleJob.selected @t=12.5')
		expect(text).toContain('vehicle: &Vehicle:trace-vehicle')
		expect(text).toContain('again: *Vehicle:trace-vehicle')
		expect(text).toContain('character: &Character:')
		expect(text).toContain('path:')
		expect(text).toContain('length: 2')
	})

	it('keeps plain objects safe without treating them as unprojected runtime objects', () => {
		const plain = Object.create(null) as Record<string, unknown>
		plain.topic = 'plain'
		plain.nested = { value: 1 }

		const sink = namedTrace('plain', { silent: true })
		sink.log?.('plain.object', plain)

		const json = JSON.stringify(sink)
		expect(json).toContain('"topic":"plain"')
		expect(json).not.toContain('$unprojected')
	})

	it('uses toTrace allowlists and never enumerates unknown class instances', () => {
		const sink = namedTrace('custom', { silent: true })
		sink.log?.('custom.object', new CustomTraceThing(), new UnknownTraceThing())

		const json = JSON.stringify(sink)
		expect(json).toContain('CustomTraceThing')
		expect(json).toContain('$unprojected')
		expect(json).toContain('UnknownTraceThing')
		expect(json).not.toContain('must-not-expand')
	})

	it('gates trace methods by configured level while keeping read available', () => {
		const sink = namedTrace('levels', { silent: true, level: 'warn' })

		expect(sink.log).toBeUndefined()
		expect(sink.warn).toBeDefined()
		expect(sink.assert).toBeDefined()
		expect(sink.error).toBeDefined()
		expect(sink.read).toBeDefined()
		expect(sink.display).toBeDefined()

		sink.warn?.('warning')
		sink.error?.('error')
		expect(sink.heads).toEqual(['warning', 'error'])
	})

	it('displays stored trace rows on demand', () => {
		const sink = namedTrace('display', { silent: true })
		const log = vi.spyOn(console, 'log').mockImplementation(() => {})
		try {
			sink.log?.('display.event', { value: 1 })

			sink.display(1)

			expect(log).toHaveBeenCalledWith(expect.stringContaining('display.event'))
			expect(log.mock.calls[0]?.[0]).toContain('value: 1')
		} finally {
			log.mockRestore()
		}
	})

	it('forwards configured trace rows to the matching console method', () => {
		const previousLevel = traceLevels.forwardProbe
		const groupCollapsed = vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {})
		const groupEnd = vi.spyOn(console, 'groupEnd').mockImplementation(() => {})
		const log = vi.spyOn(console, 'log').mockImplementation(() => {})
		try {
			setTraceLevel('forwardProbe', 'log')

			traces.forwardProbe.log?.('probe.event', { nested: 'yes' })

			expect(groupCollapsed).toHaveBeenCalledWith('<[forwardProbe]> probe.event')
			expect(log).toHaveBeenCalledWith(expect.stringContaining('nested: yes'))
			expect(groupEnd).toHaveBeenCalledTimes(1)
		} finally {
			setTraceLevel('forwardProbe', previousLevel)
			log.mockRestore()
			groupEnd.mockRestore()
			groupCollapsed.mockRestore()
		}
	})

	it('does not forward successful trace assertions', () => {
		const sink = namedTrace('assert-ok', { level: 'assert' })
		const groupCollapsed = vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {})
		const assert = vi.spyOn(console, 'assert').mockImplementation(() => {})
		try {
			sink.assert?.(true, 'ok')

			expect(sink).toHaveLength(0)
			expect(groupCollapsed).not.toHaveBeenCalled()
			expect(assert).not.toHaveBeenCalled()
		} finally {
			assert.mockRestore()
			groupCollapsed.mockRestore()
		}
	})

	it('does not evaluate disabled trace call arguments', () => {
		const sink = namedTrace('assert-only', { silent: true, level: 'error' })
		let evaluated = false
		const expensive = () => {
			evaluated = true
			return false
		}

		sink.assert?.(expensive(), 'should not be evaluated')

		expect(evaluated).toBe(false)
		expect(sink).toHaveLength(0)
	})

	it('drops expired time-stamped rows on write', () => {
		let now = 0
		const sink = namedTrace('retention', {
			silent: true,
			time: () => now,
			logLifetime: DEFAULT_TRACE_LOG_LIFETIME,
		})

		sink.log?.('old')
		now = DEFAULT_TRACE_LOG_LIFETIME + 1
		sink.log?.('fresh')

		expect(sink.heads).toEqual(['fresh'])
	})

	it('keeps proxy channel identity while changing levels', () => {
		const previousLevel = traceLevels.identityProbe
		try {
			const first = setTraceLevel('identityProbe', 'error')
			const throughProxy = traces.identityProbe
			expect(throughProxy).toBe(first)
			expect(throughProxy.log).toBeUndefined()
			expect(throughProxy.error).toBeDefined()

			const second = setTraceLevel('identityProbe', 'log')
			expect(second).toBe(throughProxy)
			expect(traces.identityProbe).toBe(throughProxy)
			expect(traces.identityProbe.log).toBeDefined()
		} finally {
			setTraceLevel('identityProbe', previousLevel)
		}
	})
})
