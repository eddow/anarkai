import type { GamePatches } from 'ssh/game/game'
import { Game } from 'ssh/game/game'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	DEFAULT_TRACE_LOG_LIFETIME,
	namedTrace,
	registerTraceInvariants,
	setTraceTimeSource,
	traceFor,
	traceLevels,
	traces,
} from '../../src/lib/dev/debug.ts'
import { isWatched, resetWatched, unwatch, watch } from '../../src/lib/dev/watch.ts'
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
			uid: 'custom-1',
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
		const vehicle = game.vehicles.createVehicle('wheelbarrow', { q: 0, r: 0 }, [line])
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
		// Runtime objects are anchored by type + ephemeral debug id; the same
		// object referenced twice must reuse one stable ref.
		const vehicleAnchor = text.match(/vehicle: &(Vehicle:[A-Za-z0-9:_-]+)/)?.[1]
		expect(vehicleAnchor).toBeDefined()
		expect(text).toContain(`again: *${vehicleAnchor}`)
		expect(text).toContain('character: &Character:')
		expect(text).toContain('path:')
		expect(text).toContain('length: 2')
		expect(vehicle.logs.at(-1)).toContain('vehicleJob.selected')
		expect(character.logs.at(-1)).toContain('vehicleJob.selected')
		expect(tile.logs.at(-1)).toContain('vehicleJob.selected')
		expect(vehicle.logs.at(-1)).toContain('movement:')
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
		;(globalThis as any).allowExpectedDiagnostics?.(/\[trace:levels:error\] error/)
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

	it('debug verb is warn-like generally and log-like for watched subjects', () => {
		const sink = namedTrace('vehicle', { silent: true, level: 'debug' })
		traces.vehicle = sink
		const watched = { id: 'watched' }
		const other = { id: 'other' }
		watch(watched)
		try {
			// Base sink is warn-like: `log` undefined, `warn` defined.
			expect(sink.log).toBeUndefined()
			expect(sink.warn).toBeDefined()

			// Watched subject gets `log` via traceFor and via the callable accessor.
			const watchedView = traceFor('vehicle', watched)
			expect(watchedView.log).toBeDefined()
			expect(traces.vehicle(watched).log).toBeDefined()
			expect(isWatched(watched)).toBe(true)

			// Unwatched subject keeps the warn-level sink (log undefined).
			expect(traceFor('vehicle', other).log).toBeUndefined()
			expect(traces.vehicle(other).log).toBeUndefined()

			// Only the watched subject's log row is recorded.
			watchedView.log?.('event.watched')
			traceFor('vehicle', other).log?.('event.other')
			expect(sink.heads).toEqual(['event.watched'])
		} finally {
			unwatch(watched)
			resetWatched()
			delete traces.vehicle
		}
	})

	it('warn is the default channel level: warn fires for everyone, log stays gated', () => {
		expect(traceLevels.vehicle).toBe('warn')
		const sink = namedTrace('warn-default', { silent: true, level: 'warn' })
		traces.warnDefaultProbe = sink
		const watched = { id: 'watched-default' }
		const other = { id: 'other-default' }
		watch(watched)
		try {
			// `warn` fires regardless of watch; `log` stays undefined for everyone.
			expect(traceFor('warnDefaultProbe', other).warn).toBeDefined()
			expect(traceFor('warnDefaultProbe', watched).warn).toBeDefined()
			expect(traceFor('warnDefaultProbe', other).log).toBeUndefined()
			expect(traceFor('warnDefaultProbe', watched).log).toBeUndefined()
			traceFor('warnDefaultProbe', other).warn?.('warn.other')
			traceFor('warnDefaultProbe', watched).warn?.('warn.watched')
			expect(sink.heads).toEqual(['warn.other', 'warn.watched'])
		} finally {
			unwatch(watched)
			resetWatched()
			delete traces.warnDefaultProbe
		}
	})

	it('hybrid channels resolve the watch subject from the named bag', () => {
		const sink = namedTrace('convey', { silent: true, level: 'debug' })
		traces.convey = sink
		const alveolus = { id: 'alveolus' }
		const other = { id: 'other' }
		watch(alveolus)
		try {
			expect(traces.convey({ alveolus }).log).toBeDefined()
			expect(traces.convey({ tile: other }).log).toBeUndefined()
			traces.convey({ alveolus }).log?.('event.watched')
			traces.convey({ tile: other }).log?.('event.other')
			expect(sink.heads).toEqual(['event.watched'])
		} finally {
			unwatch(alveolus)
			resetWatched()
			delete traces.convey
		}
	})

	it('watching a subject arms channels to debug so its log is defined', () => {
		// Default channel level is 'warn'; before any subject is watched the sink is warn-like.
		const sink = namedTrace('vehicle', { silent: true, level: 'warn' })
		traces.vehicle = sink
		const watched = { id: 'armed-watched' }
		const other = { id: 'armed-other' }
		try {
			// Unwatched, at warn: log undefined even for a "watched" identity (nothing watched yet).
			expect(sink.level).toBe('warn')
			expect(traces.vehicle(watched).log).toBeUndefined()

			watch(watched)
			// Watching arms the channels: the backing sink is now at `debug`.
			expect(sink.level).toBe('debug')
			expect(traces.vehicle(watched).log).toBeDefined()
			// Unwatched subject stays warn-like at the debug verb.
			expect(traces.vehicle(other).log).toBeUndefined()
			traces.vehicle(watched).log?.('event.armed')
			traces.vehicle(other).log?.('event.other')
			expect(sink.heads).toEqual(['event.armed'])

			unwatch(watched)
			// Releasing the last watched subject disarms: back to warn.
			expect(sink.level).toBe('warn')
			expect(traces.vehicle(watched).log).toBeUndefined()
		} finally {
			unwatch(watched)
			resetWatched()
			delete traces.vehicle
		}
	})

	it('callable attached accessors share the backing sink (setLevel/read/reset apply channel-wide)', () => {
		const sink = namedTrace('vehicle', { silent: true, level: 'warn' })
		traces.vehicle = sink
		try {
			// Property-style access on the callable forwards to the same backing sink.
			expect(traces.vehicle.read).toBeDefined()
			traces.vehicle({ id: 'a' }).warn?.('shared.warn')
			expect(sink.heads).toEqual(['shared.warn'])
			expect(traces.vehicle.read()).toContain('shared.warn')
			traces.vehicle.reset()
			expect(sink.heads).toEqual([])
			// setLevel through the accessor changes the channel level.
			traces.vehicle.setLevel('error')
			expect(sink.warn).toBeUndefined()
			expect(sink.error).toBeDefined()
		} finally {
			delete traces.vehicle
		}
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

	it('resets stored trace rows without replacing the sink or changing enabled methods', () => {
		const sink = namedTrace('reset', { silent: true })
		const logMethod = sink.log
		const warnMethod = sink.warn

		sink.log?.('before.log')
		sink.warn?.('before.warn')
		expect(sink.heads).toEqual(['before.log', 'before.warn'])

		sink.reset()

		expect(sink).toHaveLength(0)
		expect(sink.heads).toEqual([])
		expect(sink.read()).toBe('')
		expect(sink.log).toBe(logMethod)
		expect(sink.warn).toBe(warnMethod)

		sink.log?.('after.log')
		expect(sink.heads).toEqual(['after.log'])
	})

	it('forwards configured trace rows to the matching console method', () => {
		const previousLevel = traceLevels.forwardProbe
		const groupCollapsed = vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {})
		const groupEnd = vi.spyOn(console, 'groupEnd').mockImplementation(() => {})
		const log = vi.spyOn(console, 'log').mockImplementation(() => {})
		try {
			traces.forwardProbe?.setLevel?.('log')

			traces.forwardProbe.log?.('probe.event', { nested: 'yes' })

			expect(groupCollapsed).toHaveBeenCalledWith('<[forwardProbe]> probe.event')
			expect(log).toHaveBeenCalledWith(expect.stringContaining('nested: yes'))
			expect(groupEnd).toHaveBeenCalledTimes(1)
		} finally {
			if (previousLevel !== undefined) {
				traces.forwardProbe?.setLevel?.(previousLevel)
			}
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

	it('assert is undefined when the channel level suppresses it (?. skips evaluation)', async () => {
		const sink = namedTrace('assert-suppressed', { silent: true, level: 'error' })

		expect(sink.assert).toBeUndefined()
		// `?.` short-circuits: the condition is never evaluated, nothing recorded.
		let evaluated = false
		expect(() => sink.assert?.((evaluated = true) as unknown as boolean, 'suppressed boom')).not.toThrow()
		expect(evaluated).toBe(false)
		expect(sink).toHaveLength(0)
	})

	it('throws AssertionError on failed trace assertions after recording the row', async () => {
		const { AssertionError } = await import('../../src/lib/dev/debug.ts')
		;(globalThis as any).allowExpectedDiagnostics?.(/\[trace:assertThrow:assert failure\] boom/)
		const sink = namedTrace('assertThrow', { silent: true, level: 'assert' })

		expect(() => sink.assert?.(false, 'boom')).toThrow(AssertionError)
		expect(sink.heads).toEqual(['boom'])
		expect(sink.read()).toContain('assert failure boom')
	})

	it('connects invariants when assert is connected', () => {
		;(globalThis as any).allowExpectedDiagnostics?.(
			/\[trace:invariantProbe:assert failure\] probe invariant failed/
		)
		registerTraceInvariants('invariantProbe', {
			'always-fails': (value) => ({
				ok: false,
				message: 'probe invariant failed',
				payload: { value },
			}),
		})
		const sink = namedTrace('invariantProbe', { silent: true, level: 'assert' })

		expect(sink.invariant?.['always-fails']).toBeDefined()

		expect(() => sink.invariant?.['always-fails']('seen')).toThrow()

		expect(sink.heads).toEqual(['probe invariant failed'])
		expect(sink.read()).toContain('assert failure probe invariant failed')
		expect(sink.read()).toContain('invariant: invariantProbe.always-fails')
		expect(sink.read()).toContain('value: seen')
	})

	it('disconnects invariants when the level suppresses assert', async () => {
		registerTraceInvariants('invariantOffProbe', {
			'expensive-check': () => ({
				ok: false,
				message: 'expensive check failed',
			}),
		})
		const sink = namedTrace('invariantOffProbe', { silent: true, level: 'error' })

		// `assert` is level-gated: invariants stay connected only while the
		// `assert` verb is enabled; at `error` the sink has no assert and no
		// invariant methods, so violations are skipped, not thrown.
		expect(sink.assert).toBeUndefined()
		expect(sink.invariant?.['expensive-check']).toBeUndefined()
		let evaluated = false
		expect(() => sink.invariant?.['expensive-check']?.((evaluated = true) as never)).not.toThrow()
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

	it('uses the shared trace time source when a sink has no explicit clock', () => {
		let now = 3
		const clearTimeSource = setTraceTimeSource(() => now)
		try {
			const sink = namedTrace('clocked', { silent: true })

			sink.log?.('clocked.event')
			now = 4.25
			sink.warn?.('clocked.warning')

			expect(sink.read()).toContain('log clocked.event @t=3')
			expect(sink.read()).toContain('warn clocked.warning @t=4.25')
		} finally {
			clearTimeSource()
		}
	})

	it('prefers a sink-specific clock over the shared trace time source', () => {
		const clearTimeSource = setTraceTimeSource(() => 3)
		try {
			const sink = namedTrace('explicit-clock', { silent: true, time: () => 9 })

			sink.log?.('explicit.event')

			expect(sink.read()).toContain('log explicit.event @t=9')
			expect(sink.read()).not.toContain('@t=3')
		} finally {
			clearTimeSource()
		}
	})

	it('keeps proxy channel identity while changing levels', () => {
		const previousLevel = traceLevels.identityProbe
		try {
			const first = traces.identityProbe
			first?.setLevel?.('error')
			const throughProxy = traces.identityProbe
			expect(throughProxy).toBe(first)
			expect(throughProxy?.log).toBeUndefined()
			expect(throughProxy?.error).toBeDefined()

			const second = traces.identityProbe
			second?.setLevel?.('log')
			expect(second).toBe(throughProxy)
			expect(traces.identityProbe).toBe(throughProxy)
			expect(traces.identityProbe?.log).toBeDefined()
		} finally {
			if (previousLevel !== undefined) {
				traces.identityProbe?.setLevel?.(previousLevel)
			}
		}
	})
})
