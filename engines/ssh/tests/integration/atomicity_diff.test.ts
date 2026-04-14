import { getActivationLog } from 'mutts'
import { traces } from 'ssh/debug'
import type { SaveState } from 'ssh/game'
import { StorageAlveolus } from 'ssh/hive/storage'
import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine'

describe('Atomicity & Environment Investigation', () => {
	// Setup identical to gather_convey.test.ts
	async function setupEngine(options: any = { terrainSeed: 1234, characterCount: 0 }) {
		const engine = new TestEngine(options)
		await engine.init()

		function spawnWorker(coord: { q: number; r: number }) {
			const char = engine.spawnCharacter('Worker', coord)
			char.role = 'worker'
			void char.scriptsContext
			const action = char.findAction()
			if (action) char.begin(action)
			return char
		}
		return { engine, game: engine.game, spawnWorker }
	}

	const scenario: Partial<SaveState> = {
		hives: [
			{
				name: 'GatherHive',
				alveoli: [
					{ coord: [0, 0], alveolus: 'gather', goods: {} },
					{ coord: [1, 0], alveolus: 'storage', goods: {} },
				],
			},
		],
		looseGoods: [
			{ goodType: 'berries', position: { q: 0, r: 1 } },
			{ goodType: 'berries', position: { q: 0, r: 1 } },
			{ goodType: 'berries', position: { q: 0, r: 1 } },
			{ goodType: 'berries', position: { q: 0, r: 1 } },
		],
	}

	/**
	 * Helper to run the simulation
	 * @param mode 'batched' wraps the tick in a batch (simulating zoned rAF). 'unbatched' runs tick raw (simulating disabled rAF).
	 */
	async function runSimulation(mode: 'batched' | 'unbatched') {
		const { engine, game, spawnWorker } = await setupEngine()
		const previousAdvertisingTrace = traces.advertising
		traces.advertising = console
		try {
			engine.loadScenario(scenario)

			const gathererTile = game.hex.getTile({ q: 0, r: 0 })
			const gatherer = gathererTile?.content

			const storageContent = game.hex.getTile({ q: 1, r: 0 })?.content
			if (storageContent instanceof StorageAlveolus) {
				storageContent.setBuffers({ berries: 10 })
			}
			await new Promise((resolve) => setTimeout(resolve, 0))

			spawnWorker({ q: 0, r: 0 })
			// One worker at storage is enough to complete convey once berries arrive; two workers can race the same loose stack.
			spawnWorker({ q: 1, r: 0 })

			// Run loop
			const dt = 0.1
			const totalSteps = 40 / dt

			for (let i = 0; i < totalSteps; i++) {
				engine.tick(dt, dt)
				await new Promise((resolve) => setTimeout(resolve, 0))
			}

			let looseBerries = 0
			for (const list of game.hex.looseGoods.goods.values()) {
				looseBerries += list.filter((fg) => fg.goodType === 'berries').length
			}

			const workerBerries = Array.from((game.population as any).characters.values()).reduce(
				(acc: number, char: any) => acc + (char.inventory?.stock?.berries || 0),
				0
			)

			const finalTile = game.hex.getTile({ q: 1, r: 0 })
			const finalContent = finalTile?.content as any
			const finalStorage = finalContent?.storage
			const gathererStorage = gatherer?.storage

			console.log(`[Test] Mode ${mode} | Total Berries on Board:
            Gatherer: ${gathererStorage?.stock.berries || 0}
            Storage: ${finalStorage?.stock.berries || 0}
            Loose: ${looseBerries}
            Workers: ${workerBerries}
            Total: ${(gathererStorage?.stock.berries || 0) + (finalStorage?.stock.berries || 0) + looseBerries + workerBerries}
        `)

			return {
				gathererStock: gathererStorage?.stock.berries || 0,
				storageStock: finalStorage?.stock.berries || 0,
			}
		} catch (error) {
			if (error instanceof Error && error.message.includes('Max effect chain')) {
				const recentActivations = getActivationLog()
					.filter(Boolean)
					.slice(-40)
					.map((entry) => ({
						effect: entry.effect?.name || 'anon',
						object: entry.obj?.constructor?.name || typeof entry.obj,
						property: String(entry.prop),
					}))
				console.error('ATOMICITY recentActivations:', recentActivations)
			}
			throw error
		} finally {
			traces.advertising = previousAdvertisingTrace
			await engine.destroy()
		}
	}

	it('should work when batched (Test/Zoned simulation)', async () => {
		const result = await runSimulation('batched')
		expect(result.storageStock).toBeGreaterThan(0)
	})

	it('should work when unbatched (Browser simulation - currently works due to Fix)', async () => {
		const result = await runSimulation('unbatched')
		expect(result.storageStock).toBeGreaterThan(0)
	})
})
