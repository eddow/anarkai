import type { Game } from 'ssh/game/game'
import { toAxialCoord } from 'ssh/utils/position'
import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine/engine'

/** Canonical, order-independent projection of the characters' observable state. */
function characterProjection(game: Game): Array<{ q: number; r: number; assigned: string | null }> {
	return [...game.population].map((c) => {
		const coord = toAxialCoord(c.position)
		const assigned = c.assignedAlveolus?.tile.position as { q: number; r: number } | undefined
		return {
			q: Math.round((coord?.q ?? 0) * 1000) / 1000,
			r: Math.round((coord?.r ?? 0) * 1000) / 1000,
			assigned: assigned ? `${assigned.q},${assigned.r}` : null,
		}
	})
}

const gen = { terrainSeed: 4242, characterCount: 0 }
const scenario = {
	tiles: [
		{ coord: [0, 0] as const, terrain: 'grass' as const },
		{ coord: [1, 0] as const, terrain: 'grass' as const },
		{ coord: [2, 0] as const, terrain: 'grass' as const },
		{ coord: [3, 0] as const, terrain: 'grass' as const },
	],
	hives: [
		{
			name: 'H',
			alveoli: [{ coord: [1, 0] as const, alveolus: 'sawmill' as const, goods: { wood: 20 } }],
		},
	],
}

describe('save/load determinism', () => {
	it('the simulation is deterministic: two identical games reach the same point', async () => {
		const a = new TestEngine(gen)
		const b = new TestEngine(gen)
		await a.init()
		await b.init()
		try {
			a.loadScenario(scenario)
			b.loadScenario(scenario)
			const wa = a.spawnCharacter('Worker', { q: 2, r: 0 })
			const wb = b.spawnCharacter('Worker', { q: 2, r: 0 })
			const actionA = wa.findAction()
			const actionB = wb.findAction()
			expect(!!actionA).toBe(!!actionB)
			if (actionA) wa.abandonAnd(actionA)
			if (actionB) wb.abandonAnd(actionB)

			a.tick(60)
			b.tick(60)

			expect(characterProjection(b.game)).toEqual(characterProjection(a.game))
			expect(b.game.random.getState()).toBe(a.game.random.getState())
			expect(b.game.clock.virtualTime).toBe(a.game.clock.virtualTime)
		} finally {
			await a.destroy()
			await b.destroy()
		}
	})

	it('RNG + clock round-trip through save/load (continuation plumbing)', async () => {
		const a = new TestEngine(gen)
		await a.init()
		try {
			a.loadScenario(scenario)
			const worker = a.spawnCharacter('Worker', { q: 2, r: 0 })
			const action = worker.findAction()
			if (action) worker.abandonAnd(action)

			a.tick(60)
			const save = a.game.saveGameData()
			const rngAtSave = a.game.random.getState()
			const clockAtSave = a.game.clock.virtualTime

			// The saved snapshot carries the RNG + clock so a loaded game can continue from it.
			expect(save.randomState).toBe(rngAtSave)
			expect(save.clockVirtualTime).toBe(clockAtSave)

			const b = new TestEngine(gen)
			await b.init()
			try {
				await b.game.loadGameData(save)
				expect(b.game.random.getState()).toBe(rngAtSave)
				expect(b.game.clock.virtualTime).toBe(clockAtSave)
			} finally {
				await b.destroy()
			}
		} finally {
			await a.destroy()
		}
	})

	it('resumes an in-flight script deterministically across save/load', async () => {
		const a = new TestEngine(gen)
		await a.init()
		try {
			a.loadScenario(scenario)
			const worker = a.spawnCharacter('Worker', { q: 2, r: 0 })
			const action = worker.findAction()
			expect(action).toBeTruthy()
			if (action) worker.abandonAnd(action)

			// 1 game-minute of simulation, ending mid-script.
			a.tick(60)
			expect(workerHasLiveScript(worker)).toBe(true)

			const save = a.game.saveGameData()

			// Reference: continue the *uninterrupted* run to 3 game-minutes.
			a.tick(120)
			const reference = {
				projection: characterProjection(a.game),
				rng: a.game.random.getState(),
				clock: a.game.clock.virtualTime,
			}

			// Reload the save into a fresh game and continue from the save point.
			const b = new TestEngine(gen)
			await b.init()
			try {
				await b.game.loadGameData(save)

				// The restored worker must have resumed (not stalled): live script or step.
				const restoredWorker = [...b.game.population][0]
				expect(workerHasLiveScript(restoredWorker)).toBe(true)

				b.tick(120)

				expect(characterProjection(b.game)).toEqual(reference.projection)
				expect(b.game.random.getState()).toBe(reference.rng)
				expect(b.game.clock.virtualTime).toBe(reference.clock)
			} finally {
				await b.destroy()
			}
		} finally {
			await a.destroy()
		}
	})
})

/** True when the character is mid-script: a running script or an active step. */
function workerHasLiveScript(worker: {
	runningScripts: unknown[]
	stepExecutor: unknown
}): boolean {
	return worker.runningScripts.length > 0 || worker.stepExecutor !== undefined
}
