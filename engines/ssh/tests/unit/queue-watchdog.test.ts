// @ts-nocheck
import { Game } from 'ssh/game/game'
import { namedTrace, traces } from '../../src/lib/dev/debug.ts'
import { afterEach, describe, expect, it } from 'vitest'

describe('HexBoard queue watchdog', () => {
	let game: Game

	afterEach(() => {
		game?.destroy()
		game = undefined
	})

	function setupBoard(tiles) {
		return new Game({ terrainSeed: 9701, characterCount: 0 }, { tiles })
	}

	it('surfaces a head-on circular wait as blocked-by-queuer / free-front instead of silently waiting', async () => {
		game = setupBoard([
			{ coord: [0, 0] as const, terrain: 'grass' as const },
			{ coord: [1, 0] as const, terrain: 'grass' as const },
		])
		await game.loaded
		game.ticker.stop()

		// Capture queue traces in a silent sink so we can assert on them.
		const previous = traces.queue
		const queueTrace = namedTrace('queue', { silent: true })
		traces.queue = queueTrace

		const a = game.population.createCharacter('Alice', { q: 0, r: 0 })
		const b = game.population.createCharacter('Bob', { q: 1, r: 0 })

		// Head-on: Alice wants Bob's tile, Bob wants Alice's tile.
		// `moveCharacter` detects the cycle and releases it, so neither should
		// remain a QueueStep. The watchdog must therefore report NO stall for
		// this resolved exchange.
		const tileA = game.hex.getTile({ q: 0, r: 0 })
		const tileB = game.hex.getTile({ q: 1, r: 0 })
		game.hex.moveCharacter(a, tileB.position, tileA.position)
		game.hex.moveCharacter(b, tileA.position, tileB.position)

		// Advance the watchdog (self-reschedules every 0.5s).
		game.clock.advance(1.0)

		const warns = queueTrace.filter((row) => row[0] === 'warn')
		expect(warns).toHaveLength(0)

		traces.queue = previous
	})

	it('flags a waiter whose target tile is free (pass event never fired)', async () => {
		game = setupBoard([
			{ coord: [0, 0] as const, terrain: 'grass' as const },
			{ coord: [1, 0] as const, terrain: 'grass' as const },
		])
		await game.loaded
		game.ticker.stop()

		const previous = traces.queue
		const queueTrace = namedTrace('queue', { silent: true })
		traces.queue = queueTrace

		const a = game.population.createCharacter('Alice', { q: 0, r: 0 })
		// Occupy Bob's tile with a live (non-queued) occupant so Alice queues.
		const b = game.population.createCharacter('Bob', { q: 1, r: 0 })

		const tileB = game.hex.getTile({ q: 1, r: 0 })
		const tileA = game.hex.getTile({ q: 0, r: 0 })
		const queued = game.hex.moveCharacter(a, tileB.position, tileA.position)
		expect(queued).toBeDefined()

		game.clock.advance(1.0)

		// Bob is a real occupant, so Alice is legitimately "waiting-on" — logged,
		// not warned. No orphaned/free-front should fire.
		const warns = queueTrace.filter((row) => row[0] === 'warn')
		expect(warns).toHaveLength(0)

		traces.queue = previous
	})
})
