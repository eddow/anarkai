// @ts-nocheck
import { gameRootSpeed, gameTimeSpeedFactors } from 'engine-rules'
import { namedTrace } from 'ssh/dev/debug'
import { Game } from 'ssh/game'
import { configuration } from 'ssh/globals'
import type { SimulationLoop } from 'ssh/utils/loop'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('Game Clock', () => {
	let game: Game

	beforeEach(async () => {
		game = new Game({
			terrainSeed: 1,
			characterCount: 1,
			characterRadius: 5,
		})
		game.ticker.stop()
		await game.loaded
		game.clock.virtualTime = 0
	})

	afterEach(() => {
		configuration.timeControl = 1
		game.destroy()
	})

	it('advances virtual time using the selected numeric speed slot', () => {
		const tick = (deltaMs: number) => {
			game.tickerCallback({ elapsedMS: deltaMs } as SimulationLoop)
		}

		configuration.timeControl = 0
		for (let i = 0; i < 10; i++) {
			tick(100)
		}
		expect(game.clock.virtualTime).toBeCloseTo(0, 0.1)

		configuration.timeControl = 1
		for (let i = 0; i < 10; i++) {
			tick(100)
		}
		expect(game.clock.virtualTime).toBeCloseTo(gameRootSpeed * gameTimeSpeedFactors[1], 0.1)

		configuration.timeControl = gameTimeSpeedFactors.length - 1
		for (let i = 0; i < 10; i++) {
			tick(100)
		}

		expect(game.clock.virtualTime).toBeCloseTo(
			gameRootSpeed * (gameTimeSpeedFactors[1] + gameTimeSpeedFactors.at(-1)!),
			0.1
		)
		expect(gameRootSpeed).toBe(2)
	})

	it('stamps debug traces with the current virtual time', () => {
		const sink = namedTrace('clock-probe', { silent: true })

		game.clock.virtualTime = 12.75
		sink.warn?.('clock.probe')

		expect(sink.read()).toContain('warn clock.probe @t=12.75')
	})
})
