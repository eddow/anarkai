import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine'

describe('Script execution regressions', () => {
	it('goHome falls back to a real ScriptExecution step when no home exists', async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		try {
			const worker = engine.spawnCharacter('Homeless', { q: 0, r: 0 })
			const action = worker.scriptsContext.selfCare.goHome()

			expect(() => worker.begin(action)).not.toThrow()
			expect(() => engine.tick(0.1)).not.toThrow()
			expect(worker.stepExecutor).toBeDefined()
		} finally {
			await engine.destroy()
		}
	})

	it('walk.until yields a step when the path is already satisfied', async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()

		try {
			const worker = engine.spawnCharacter('Looper', { q: 0, r: 0 })
			const execution = worker.scriptsContext.walk.until([{ q: 0, r: 0 }])
			const first = execution.run(worker.scriptsContext)

			expect(first.type).toBe('yield')
			if (first.type !== 'yield') throw new Error('walk.until should yield a pause step')
			expect(first.value.description).toBe('walk.pause')
		} finally {
			await engine.destroy()
		}
	})
})
