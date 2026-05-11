import { TransformAlveolus } from 'ssh/hive/transform'
import { WorkFunctions } from 'ssh/npcs/context/work'
import { subject } from 'ssh/npcs/scripts'
import { describe, expect, it } from 'vitest'
import { TestEngine } from '../test-engine'

async function withSawmill(
	goods: Record<string, number>,
	fn: (context: {
		engine: TestEngine
		sawmill: TransformAlveolus
		work: WorkFunctions
	}) => void | Promise<void>
) {
	const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
	await engine.init()
	try {
		engine.loadScenario({
			hives: [
				{
					name: 'TransformProcess',
					alveoli: [{ coord: [0, 0], alveolus: 'sawmill', goods }],
				},
			],
		})
		const sawmill = engine.game.hex.getTile({ q: 0, r: 0 })?.content
		if (!(sawmill instanceof TransformAlveolus)) throw new Error('expected sawmill')
		const worker = engine.spawnCharacter('Worker', { q: 0, r: 0 })
		worker.assignedAlveolus = sawmill
		const work = new WorkFunctions()
		Object.assign(work, { [subject]: worker })
		await fn({ engine, sawmill, work })
	} finally {
		await engine.destroy()
	}
}

describe('transform process buffers', () => {
	it('initializes one empty process buffer per transform good', async () => {
		await withSawmill({}, ({ sawmill }) => {
			expect(sawmill.processBuffers).toMatchObject({ wood: 0, planks: 0 })
		})
	})

	it('can work with stored input and output room', async () => {
		await withSawmill({ wood: 1 }, ({ sawmill }) => {
			expect(sawmill.canWork).toBe(true)
		})
	})

	it('cannot work without input stock or loaded input buffer', async () => {
		await withSawmill({}, ({ sawmill }) => {
			expect(sawmill.canWork).toBe(false)
		})
	})

	it('cannot work when produced output has no room', async () => {
		await withSawmill({ wood: 1, planks: 3 }, ({ sawmill }) => {
			sawmill.setProcessBuffer('planks', 1)
			expect(sawmill.canWork).toBe(false)
		})
	})

	it('does not accept inputs when produced output has no storage room', async () => {
		await withSawmill({ wood: 1, planks: 3 }, ({ sawmill }) => {
			expect(sawmill.processBuffer('planks')).toBe(0)
			expect(sawmill.canWork).toBe(false)
			expect(sawmill.nextLoadGood).toBeUndefined()
			expect(sawmill.canTake('wood', '2-use')).toBe(false)
			expect(sawmill.workingGoodsRelations.wood).toBeUndefined()
		})
	})

	it('demands input before loading and provides output only after unloading', async () => {
		await withSawmill({}, ({ sawmill }) => {
			expect(sawmill.workingGoodsRelations.wood?.advertisement).toBe('demand')
			expect(sawmill.workingGoodsRelations.planks).toBeUndefined()

			sawmill.storage.addGood('planks', 1)
			expect(sawmill.workingGoodsRelations.planks).toEqual({
				advertisement: 'provide',
				priority: '2-use',
			})
		})
	})

	it('skips generic transform preparation', async () => {
		await withSawmill({ wood: 1 }, ({ work, sawmill }) => {
			expect(
				work.prepare({
					type: 'work',
					job: 'transform',
					target: sawmill,
					urgency: 1,
					fatigue: 0,
				} as any)
			).toBeUndefined()
		})
	})

	it('load step takes 0.5s, consumes one input, and fills the input buffer', async () => {
		await withSawmill({ wood: 1 }, ({ work, sawmill }) => {
			const step = work.transformStep()
			expect(step?.description).toBe('transform.load.sawmill.wood')
			expect(step?.descriptionKey).toEqual({
				key: 'transform.load',
				params: { alveolus: 'sawmill', goodType: 'wood' },
			})
			expect(sawmill.storage.available('wood')).toBe(0)
			step?.tick(0.5)
			expect(sawmill.storage.stock.wood ?? 0).toBe(0)
			expect(sawmill.processBuffer('wood')).toBe(1)
		})
	})

	it('continuous process step advances buffers by rates', async () => {
		await withSawmill({}, ({ work, sawmill }) => {
			sawmill.setProcessBuffer('wood', 1)
			sawmill.setProcessBuffer('planks', 0)
			const step = work.transformStep()
			expect(step?.description).toBe('transform.sawmill')
			expect(step?.descriptionKey).toEqual({
				key: 'transform.process',
				params: { alveolus: 'sawmill' },
			})
			step?.tick(2.5)
			expect(sawmill.processBuffer('wood')).toBeCloseTo(0.5)
			expect(sawmill.processBuffer('planks')).toBeCloseTo(0.5)
			step?.tick(2.5)
			expect(sawmill.processBuffer('wood')).toBeCloseTo(0)
			expect(sawmill.processBuffer('planks')).toBeCloseTo(1)
		})
	})

	it('unload step takes 0.5s, stores one output, and empties the output buffer', async () => {
		await withSawmill({}, ({ work, sawmill }) => {
			sawmill.setProcessBuffer('planks', 1)
			const step = work.transformStep()
			expect(step?.description).toBe('transform.unload.sawmill.planks')
			expect(step?.descriptionKey).toEqual({
				key: 'transform.unload',
				params: { alveolus: 'sawmill', goodType: 'planks' },
			})
			expect(sawmill.storage.allocated('planks')).toBe(1)
			step?.tick(0.5)
			expect(sawmill.storage.stock.planks).toBe(1)
			expect(sawmill.processBuffer('planks')).toBe(0)
		})
	})

	it('cancelling load and unload steps releases storage bookkeeping without changing buffers', async () => {
		await withSawmill({ wood: 1 }, ({ work, sawmill }) => {
			const load = work.transformStep()
			load?.cancel('test.cancel.load')
			expect(sawmill.storage.stock.wood).toBe(1)
			expect(sawmill.storage.available('wood')).toBe(1)
			expect(sawmill.processBuffer('wood')).toBe(0)

			sawmill.setProcessBuffer('planks', 1)
			const unload = work.transformStep()
			unload?.cancel('test.cancel.unload')
			expect(sawmill.storage.allocated('planks')).toBe(0)
			expect(sawmill.storage.stock.planks ?? 0).toBe(0)
			expect(sawmill.processBuffer('planks')).toBe(1)
		})
	})

	it('saves and loads partial process buffers', async () => {
		const engine = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		const restored = new TestEngine({ terrainSeed: 1234, characterCount: 0 })
		await engine.init()
		await restored.init()
		try {
			engine.loadScenario({
				hives: [
					{
						name: 'SaveTransformProcess',
						alveoli: [{ coord: [0, 0], alveolus: 'sawmill', goods: {} }],
					},
				],
			})
			const sawmill = engine.game.hex.getTile({ q: 0, r: 0 })?.content
			if (!(sawmill instanceof TransformAlveolus)) throw new Error('expected sawmill')
			sawmill.setProcessBuffer('wood', 0.4)
			sawmill.setProcessBuffer('planks', 0.6)

			restored.loadScenario(engine.game.saveGameData())
			const loaded = restored.game.hex.getTile({ q: 0, r: 0 })?.content
			if (!(loaded instanceof TransformAlveolus)) throw new Error('expected restored sawmill')
			expect(loaded.processBuffer('wood')).toBeCloseTo(0.4)
			expect(loaded.processBuffer('planks')).toBeCloseTo(0.6)
		} finally {
			await restored.destroy()
			await engine.destroy()
		}
	})
})
