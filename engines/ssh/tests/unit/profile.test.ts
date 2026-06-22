import { disconnectAllProfiles, profile, profileLevels, setProfileLevel } from 'ssh/dev/debug'
import { namedProfile, type ProfileLevel } from 'ssh/dev/profile'
import { Game } from 'ssh/game/game'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { gatherFreightLine } from '../freight-fixtures'

describe('profile registry', () => {
	afterEach(() => {
		for (const key of Object.keys(profileLevels)) delete profileLevels[key]
		disconnectAllProfiles()
	})

	it('keeps disabled begin undefined without evaluating payload arguments', () => {
		let evaluated = false
		const payload = () => {
			evaluated = true
			return { value: 1 }
		}

		const sink = profile.disabledProbe
		sink.begin?.('disabled', payload)

		expect(sink.begin).toBeUndefined()
		expect(evaluated).toBe(false)
		expect(sink.read()).toContain('no profile samples')
	})

	it('records aggregate timings and nested parent labels', () => {
		let now = 0
		const sink = namedProfile('aggregate', {
			level: 'detail',
			time: () => now,
			slowThresholdMs: 0,
		})

		const endOuter = sink.begin?.('outer', { id: 'o' })
		now += 2
		const endInner = sink.begin?.('inner', () => ({ id: 'i' }))
		now += 3
		endInner?.({ result: 'ok' })
		now += 5
		endOuter?.()

		expect(sink.stats).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					label: 'outer',
					calls: 1,
					totalMs: 10,
					averageMs: 10,
					maxMs: 10,
				}),
				expect.objectContaining({
					label: 'inner',
					parentLabel: 'outer',
					calls: 1,
					totalMs: 3,
					averageMs: 3,
					maxMs: 3,
				}),
			])
		)
		const text = sink.read()
		expect(text).toContain('outer: calls=1')
		expect(text).toContain('outer > inner: calls=1')
		expect(text).toContain('start={"id":"i"}')
		expect(text).toContain('end={"result":"ok"}')
	})

	it('displays and resets aggregate summaries', () => {
		let now = 0
		const sink = namedProfile('display', { level: 'summary', time: () => now })
		const log = vi.spyOn(console, 'log').mockImplementation(() => {})
		try {
			const end = sink.begin?.('work')
			now += 1
			end?.()

			sink.display()

			expect(log).toHaveBeenCalledWith(expect.stringContaining('work: calls=1'))
			sink.reset()
			expect(sink.stats).toHaveLength(0)
		} finally {
			log.mockRestore()
		}
	})

	it('preserves proxy channel identity while changing levels', () => {
		const sink = profile.identityProbe
		expect(sink.begin).toBeUndefined()

		const enabled = setProfileLevel('identityProbe', 'summary')
		expect(enabled).toBe(sink)
		expect(profile.identityProbe).toBe(sink)
		expect(sink.begin).toBeDefined()

		const disabled = setProfileLevel('identityProbe', undefined)
		expect(disabled).toBe(sink)
		expect(sink.begin).toBeUndefined()
	})

	it('captures stack samples at stack level', () => {
		let now = 0
		const sink = namedProfile('stacked', {
			level: 'stack',
			time: () => now,
			slowThresholdMs: 0,
		})

		const end = sink.begin?.('stacked-work')
		now += 1
		end?.()

		expect(sink.stats[0]?.samples[0]?.stack).toContain('Error')
	})

	it('records proposed-job provider spans when enabled', async () => {
		const previousLevel = undefined as ProfileLevel | undefined
		setProfileLevel('proposedJobs', 'summary')
		const line = gatherFreightLine({
			id: 'PROFILE:vehicle',
			name: 'Profile vehicle',
			hiveName: 'H',
			coord: [1, 0],
			filters: ['wood'],
			radius: 2,
		})
		const game = new Game(
			{ terrainSeed: 42_204, characterCount: 0 },
			{
				tiles: [
					{ coord: [0, 0] as const, terrain: 'grass' as const },
					{ coord: [1, 0] as const, terrain: 'grass' as const },
				],
				hives: [
					{
						name: 'H',
						alveoli: [{ coord: [1, 0] as const, alveolus: 'sawmill' as const, goods: {} }],
					},
				],
				freightLines: [line],
				looseGoods: { wood: [[0, 0]] },
			}
		)
		await game.loaded
		game.ticker.stop()

		try {
			const vehicle = game.vehicles.createVehicle(
				'profile-vehicle',
				'wheelbarrow',
				{ q: 1, r: 0 },
				[line]
			)
			game.population.createCharacter('Worker', { q: 1, r: 0 })

			void vehicle.proposedJobs

			const text = profile.proposedJobs.read()
			expect(text).toContain('vehicle.proposedJobs')
			expect(text).toContain('vehicle.proposedJobs > collectVehicleProposedJobs')
		} finally {
			setProfileLevel('proposedJobs', previousLevel)
			game.destroy()
		}
	})

	it('profiles advertised vehicle jobs without character work-pick discovery', async () => {
		setProfileLevel('proposedJobs', 'summary')
		const line = gatherFreightLine({
			id: 'PROFILE:advertised-vehicle',
			name: 'Profile advertised vehicle',
			hiveName: 'H',
			coord: [1, 0],
			filters: ['wood'],
			radius: 2,
		})
		const game = new Game(
			{ terrainSeed: 42_205, characterCount: 0 },
			{
				tiles: [
					{ coord: [0, 0] as const, terrain: 'grass' as const },
					{ coord: [1, 0] as const, terrain: 'grass' as const },
				],
				hives: [
					{
						name: 'H',
						alveoli: [{ coord: [1, 0] as const, alveolus: 'freight_bay' as const, goods: {} }],
					},
				],
				freightLines: [line],
			}
		)
		await game.loaded
		game.ticker.stop()

		try {
			const vehicle = game.vehicles.createVehicle(
				'profile-advertised-vehicle',
				'wheelbarrow',
				{ q: 1, r: 0 },
				[line]
			)
			game.population.createCharacter('Worker', { q: 1, r: 0 })
			vehicle.beginLineService(line, line.stops[1]!)
			vehicle.dock()

			void vehicle.advertisedJobs

			const text = profile.proposedJobs.read()
			expect(text).toContain('vehicle.advertisedJobs')
			expect(text).not.toContain('collectVehicleWorkPicks')
		} finally {
			game.destroy()
		}
	})
})
