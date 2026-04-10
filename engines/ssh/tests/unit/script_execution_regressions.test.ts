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
})
