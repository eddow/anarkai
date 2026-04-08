import { getActivationLog, reactiveOptions } from 'mutts'
import type { SaveState } from 'ssh/game'
import { describe, expect, it } from 'vitest'
import { characterEvolutionRates } from '../../assets/constants'
import { TestEngine } from '../test-engine'

describe('Deadlock Reproduction', () => {
	async function setupEngine(
		options: any = { terrainSeed: 1234, characterCount: 0 }
	) {
		// Disable need drift for this test so we isolate planner behavior.
		characterEvolutionRates.hunger['*'] = 0
		characterEvolutionRates.hunger['walk'] = 0
		characterEvolutionRates.hunger['work'] = 0
		characterEvolutionRates.fatigue['*'] = 0
		characterEvolutionRates.fatigue['walk'] = 0
		characterEvolutionRates.fatigue['work'] = 0
		characterEvolutionRates.tiredness['*'] = 0
		characterEvolutionRates.tiredness['walk'] = 0
		characterEvolutionRates.tiredness['work'] = 0

		const engine = new TestEngine(options)
		await engine.init()

		function spawnWorker(coord: { q: number; r: number }) {
			const char = engine.spawnCharacter('Worker', coord)
			char.role = 'worker'
			void char.scriptsContext

			return char
		}

		return { engine, game: engine.game, spawnWorker }
	}
	// TODO: Leaked allocations here - retrieve and heal
	it('Regression: should not deadlock in waitForIncomingGoods during heavy conveyance', {
		timeout: 20000,
	}, async () => {
		const origMaxChain = reactiveOptions.maxEffectChain
		const originalRates = {
			hunger: {
				'*': characterEvolutionRates.hunger['*'],
				walk: characterEvolutionRates.hunger['walk'],
				work: characterEvolutionRates.hunger['work'],
			},
			fatigue: {
				'*': characterEvolutionRates.fatigue['*'],
				walk: characterEvolutionRates.fatigue['walk'],
				work: characterEvolutionRates.fatigue['work'],
			},
			tiredness: {
				'*': characterEvolutionRates.tiredness['*'],
				walk: characterEvolutionRates.tiredness['walk'],
				work: characterEvolutionRates.tiredness['work'],
			},
		}
		reactiveOptions.maxEffectChain = 12
		try {
			const { engine, game, spawnWorker } = await setupEngine()

			// Scenario:
			// Hive 1: [0,0] (Gatherer), [1,0] (Transit), [2,0] (Woodpile)
			const scenario: Partial<SaveState> = {
				hives: [
					{
						name: 'MainHive',
						alveoli: [
							{ coord: [0, 0], alveolus: 'gather', goods: {} },
							{ coord: [1, 0], alveolus: 'woodpile', goods: {} },
						],
					},
				],
				looseGoods: [],
			}

			engine.loadScenario(scenario)
			console.log('Repro milestone: scenario loaded')
			await new Promise((r) => setTimeout(r, 0))
			console.log('Repro milestone: after scenario drain')

			const gatherer = game.hex.getTile({ q: 0, r: 0 })!.content!
			const woodpile = game.hex.getTile({ q: 1, r: 0 })!.content!.storage!

			// Pre-fill gatherer storage with wood
			const woodCount = 10
			if (gatherer.storage) {
				gatherer.storage.addGood('wood', woodCount)
			}
			console.log('Repro milestone: gatherer seeded')
			await new Promise((r) => setTimeout(r, 0))
			console.log('Repro milestone: after addGood drain')

			console.log('Repro milestone: before worker-driven convey')
			await new Promise((r) => setTimeout(r, 0))
			console.log('Repro milestone: after yield before workers')

			// Spawn workers without food (test focuses on conveyance, not eating)
			const gatherWorker = spawnWorker({ q: 0, r: 0 })
			gatherWorker.assignedAlveolus = gatherer as any
			gatherer.assignedWorker = gatherWorker
			const gatherAction = gatherWorker.findBestJob()
			if (gatherAction) gatherWorker.begin(gatherAction)

			const woodpileWorker = spawnWorker({ q: 1, r: 0 })
			woodpileWorker.assignedAlveolus = game.hex.getTile({ q: 1, r: 0 })!.content as any
			game.hex.getTile({ q: 1, r: 0 })!.content!.assignedWorker = woodpileWorker
			const woodpileAction = woodpileWorker.findBestJob()
			if (woodpileAction) woodpileWorker.begin(woodpileAction)

			const workers = [gatherWorker, woodpileWorker]
			// Set hunger to 0 so workers don't need to eat during test
			for (const w of workers) {
				w.hunger = 0
			}
			console.log('Repro milestone: workers spawned')

			// Helper to check progress
			const getWoodpileStock = () => woodpile.stock.wood || 0

			console.log('Starting simulation...')
			let movementObserved = false
			let localConveyObserved = false

			for (let i = 0; i < 400; i++) {
				engine.tick(0.1)
				if ((gatherer.hive?.movingGoods.size ?? 0) > 0) {
					movementObserved = true
					if (gatherer.getJob?.(gatherWorker)?.job === 'convey') {
						localConveyObserved = true
						break
					}
				}
				if (i % 100 === 0) {
					await new Promise((resolve) => setTimeout(resolve, 0))
				}
			}

			console.log(`Final Woodpile Stock: ${getWoodpileStock()}`)
			console.log(
				'Deadlock final state:',
				JSON.stringify({
					sourceStock: gatherer.storage?.stock.wood || 0,
					targetStock: getWoodpileStock(),
					workers: workers.map((w: any) => ({
						name: w.name,
						tile: w.tile.position,
						step: w.stepExecutor?.constructor.name,
						action: [...w.actionDescription],
						assigned: w.assignedAlveolus?.tile?.position,
						carry: w.carry.stock,
						nextAction: w.findAction()?.name,
					})),
					movingGoods: gatherer.hive
						? Array.from(gatherer.hive.movingGoods.entries()).map(([coord, movements]: any) => ({
								coord: coord.key,
								goods: movements.map((m: any) => ({
									goodType: m.goodType,
									from: m.from.key ?? `${m.from.q},${m.from.r}`,
									path: m.path.map((p: any) => p.key ?? `${p.q},${p.r}`),
									provider: m.provider?.tile?.position,
									demander: m.demander?.tile?.position,
								})),
							}))
						: [],
					gathererJob: gatherer.getJob?.(workers[0])?.job,
					woodpileJob: game.hex.getTile({ q: 1, r: 0 })!.content!.getJob?.(workers[0])?.job,
				})
			)
			expect(movementObserved).toBe(true)
			expect(localConveyObserved).toBe(true)
			expect(gatherer.hive?.movingGoods.size ?? 0).toBeGreaterThan(0)
		} catch (error) {
			if (error instanceof Error && error.message.includes('Max effect chain')) {
				const recentActivations = getActivationLog()
					.filter(Boolean)
					.slice(-20)
					.map((entry) => ({
						effect: entry.effect?.name || 'anon',
						object: entry.obj?.constructor?.name || typeof entry.obj,
						property: String(entry.prop),
					}))
				console.error('OVERFLOW recentActivations:', recentActivations)
				console.error(
					'OVERFLOW stack:',
					(error as Error).stack?.split('\n').slice(0, 20).join('\n')
				)
			}
			throw error
		} finally {
			reactiveOptions.maxEffectChain = origMaxChain
			characterEvolutionRates.hunger['*'] = originalRates.hunger['*']
			characterEvolutionRates.hunger['walk'] = originalRates.hunger.walk
			characterEvolutionRates.hunger['work'] = originalRates.hunger.work
			characterEvolutionRates.fatigue['*'] = originalRates.fatigue['*']
			characterEvolutionRates.fatigue['walk'] = originalRates.fatigue.walk
			characterEvolutionRates.fatigue['work'] = originalRates.fatigue.work
			characterEvolutionRates.tiredness['*'] = originalRates.tiredness['*']
			characterEvolutionRates.tiredness['walk'] = originalRates.tiredness.walk
			characterEvolutionRates.tiredness['work'] = originalRates.tiredness.work
		}
	})
})
