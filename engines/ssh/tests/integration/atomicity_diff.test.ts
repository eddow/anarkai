import { getActivationLog } from 'mutts'
import type { Game, SaveState } from 'ssh/game'
import { StorageAlveolus } from 'ssh/hive/storage'
import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine'

describe('Atomicity & Environment Investigation', () => {
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
					{ coord: [0, 0], alveolus: 'freight_bay', goods: { berries: 4 } },
					{ coord: [1, 0], alveolus: 'storage', goods: {} },
				],
			},
		],
	}

	function storageBerriesAt(game: Game): number {
		const finalTile = game.hex.getTile({ q: 1, r: 0 })
		const finalContent = finalTile?.content
		if (finalContent instanceof StorageAlveolus) {
			return finalContent.storage?.stock?.berries ?? 0
		}
		const s = (finalContent as { storage?: { stock?: { berries?: number } } })?.storage
		return s?.stock?.berries ?? 0
	}

	/**
	 * Berry convey from freight_bay to adjacent storage; stops as soon as storage receives berries
	 * (same assertion as before: storageStock > 0), with a hard cap instead of 400 fixed microtask drains.
	 */
	it('conveys berries into adjacent storage without max effect chain overflow', async () => {
		const { engine, game, spawnWorker } = await setupEngine()
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
			spawnWorker({ q: 1, r: 0 })

			const dt = 0.1
			const maxSimSeconds = 40
			let elapsed = 0
			let storageStock = 0

			while (elapsed < maxSimSeconds) {
				engine.tick(dt, dt)
				storageStock = storageBerriesAt(game)
				if (storageStock > 0) break
				elapsed += dt
			}

			let looseBerries = 0
			for (const list of game.hex.looseGoods.goods.values()) {
				looseBerries += list.filter((fg) => fg.goodType === 'berries').length
			}

			const workerBerries = Array.from((game.population as any).characters.values()).reduce(
				(acc: number, char: any) => acc + (char.inventory?.stock?.berries || 0),
				0
			)

			const finalStorage = (game.hex.getTile({ q: 1, r: 0 })?.content as any)?.storage
			const gathererStorage = gatherer?.storage

			console.log(`[Test] Atomicity | Total Berries on Board:
            Gatherer: ${gathererStorage?.stock.berries || 0}
            Storage: ${finalStorage?.stock.berries || 0}
            Loose: ${looseBerries}
            Workers: ${workerBerries}
            Total: ${(gathererStorage?.stock.berries || 0) + (finalStorage?.stock.berries || 0) + looseBerries + workerBerries}
        `)

			expect(storageStock).toBeGreaterThan(0)
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
			await engine.destroy()
		}
	})
})
