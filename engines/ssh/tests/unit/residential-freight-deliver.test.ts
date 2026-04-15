import { Alveolus } from 'ssh/board/content/alveolus'
import { BuildDwelling } from 'ssh/board/content/build-dwelling'
import { normalizeFreightLineDefinition } from 'ssh/freight/freight-line'
import { findFreightDeliverJob } from 'ssh/freight/residential-freight-deliver'
import { augmentFreightBayGoodsRelationsForResidential } from 'ssh/freight/residential-freight-requisition'
import { Game } from 'ssh/game/game'
import { StorageAlveolus } from 'ssh/hive/storage'
import { afterEach, describe, expect, it } from 'vitest'
import { distributeFreightLine } from '../freight-fixtures'

const freightBay = (hiveName: string, q: number, r: number) =>
	({
		kind: 'alveolus' as const,
		hiveName,
		alveolusType: 'freight_bay' as const,
		coord: [q, r] as const,
	})

describe('residential freight deliver', () => {
	let game: Game

	afterEach(() => {
		game.destroy()
	})

	it('finds a distribute-line freight bay job when the site still needs allowed goods', async () => {
		game = new Game(
			{ terrainSeed: 1201, characterCount: 0 },
			{
				tiles: [
					{ coord: [0, 0], terrain: 'concrete' },
					{ coord: [1, 0], terrain: 'concrete' },
					{ coord: [2, 0], terrain: 'concrete' },
					{ coord: [3, 0], terrain: 'concrete' },
				],
				hives: [
					{
						name: 'FreightHive',
						alveoli: [
							{ coord: [2, 0], alveolus: 'freight_bay' },
							{ coord: [3, 0], alveolus: 'engineer' },
						],
					},
				],
				freightLines: [
					normalizeFreightLineDefinition({
						id: 'dist-res',
						name: 'Residential distribute',
						stops: [
							{
								id: 'load',
								loadSelection: {
									goodRules: [
										{ goodType: 'wood', effect: 'allow' },
										{ goodType: 'planks', effect: 'allow' },
									],
									tagRules: [],
									defaultEffect: 'deny',
								},
								anchor: freightBay('FreightHive', 2, 0),
							},
							{ id: 'unload', anchor: freightBay('FreightHive', 2, 0) },
						],
					}),
				],
			}
		)
		await game.loaded
		game.ticker.stop()

		const siteTile = game.hex.getTile({ q: 0, r: 0 })!
		siteTile.zone = 'residential'
		siteTile.content = new BuildDwelling(siteTile, 'basic_dwelling')
		const site = siteTile.content
		expect(site).toBeInstanceOf(BuildDwelling)
		if (!(site instanceof BuildDwelling)) return
		site.storage.addGood('planks', 1)

		const bayTile = game.hex.getTile({ q: 2, r: 0 })!
		const bayContent = bayTile.content
		expect(bayContent).toBeInstanceOf(Alveolus)
		if (!(bayContent instanceof Alveolus)) return
		bayContent.storage.addGood('wood', 5)

		const character = game.population.createCharacter('Hauler', { q: 1, r: 0 })
		const job = findFreightDeliverJob(game, siteTile, character)
		expect(job?.job).toBe('freightDeliver')
		expect(job?.goodType).toBe('wood')
		expect(job?.quantity).toBe(2)
		expect(job?.pathToBay?.length).toBeGreaterThan(0)
		expect(job?.pathToSite?.length).toBeGreaterThan(0)

		const tileJob = siteTile.getJob(character)
		expect(tileJob?.job).toBe('freightDeliver')
	})

	it('adds distribute-line freight bay demand for missing construction goods', async () => {
		game = new Game(
			{ terrainSeed: 1202, characterCount: 0 },
			{
				tiles: [
					{ coord: [0, 0], terrain: 'concrete' },
					{ coord: [2, 0], terrain: 'concrete' },
					{ coord: [3, 0], terrain: 'concrete' },
				],
				hives: [
					{
						name: 'FreightHive',
						alveoli: [
							{ coord: [2, 0], alveolus: 'freight_bay' },
							{ coord: [3, 0], alveolus: 'engineer' },
						],
					},
				],
				freightLines: [
					normalizeFreightLineDefinition({
						id: 'dist-req',
						name: 'Residential distribute',
						stops: [
							{
								id: 'load',
								loadSelection: {
									goodRules: [
										{ goodType: 'wood', effect: 'allow' },
										{ goodType: 'planks', effect: 'allow' },
									],
									tagRules: [],
									defaultEffect: 'deny',
								},
								anchor: freightBay('FreightHive', 2, 0),
							},
							{ id: 'unload', anchor: freightBay('FreightHive', 2, 0) },
						],
					}),
				],
			}
		)
		await game.loaded
		game.ticker.stop()

		const siteTile = game.hex.getTile({ q: 0, r: 0 })
		if (!siteTile) throw new Error('expected tile 0,0 from generator')
		siteTile.zone = 'residential'
		siteTile.content = new BuildDwelling(siteTile, 'basic_dwelling')

		const bayTile = game.hex.getTile({ q: 2, r: 0 })!
		const bay = bayTile.content
		expect(bay).toBeInstanceOf(StorageAlveolus)
		if (!(bay instanceof StorageAlveolus)) return

		const relations: Record<string, { advertisement: 'demand' | 'provide'; priority: '2-use' }> = {}
		augmentFreightBayGoodsRelationsForResidential(game, bay, relations)
		expect(relations.wood?.advertisement).toBe('demand')
		expect(relations.planks?.advertisement).toBe('demand')
	})

	it('respects distribute-line radius for delivery jobs and requisition demand', async () => {
		game = new Game(
			{ terrainSeed: 1203, characterCount: 0 },
			{
				tiles: [
					{ coord: [0, 0], terrain: 'concrete' },
					{ coord: [1, 0], terrain: 'concrete' },
					{ coord: [2, 0], terrain: 'concrete' },
					{ coord: [3, 0], terrain: 'concrete' },
				],
				hives: [
					{
						name: 'FreightHive',
						alveoli: [
							{ coord: [2, 0], alveolus: 'freight_bay' },
							{ coord: [3, 0], alveolus: 'engineer' },
						],
					},
				],
				freightLines: [
					distributeFreightLine({
						id: 'dist-radius',
						name: 'Residential distribute',
						hiveName: 'FreightHive',
						coord: [2, 0],
						filters: ['wood'],
						unloadRadius: 1,
					}),
				],
			}
		)
		await game.loaded
		game.ticker.stop()

		const siteTile = game.hex.getTile({ q: 0, r: 0 })!
		siteTile.zone = 'residential'
		siteTile.content = new BuildDwelling(siteTile, 'basic_dwelling')

		const bayTile = game.hex.getTile({ q: 2, r: 0 })!
		const bay = bayTile.content
		expect(bay).toBeInstanceOf(StorageAlveolus)
		if (!(bay instanceof StorageAlveolus)) return
		bay.storage.addGood('wood', 5)

		const character = game.population.createCharacter('Hauler', { q: 1, r: 0 })
		expect(findFreightDeliverJob(game, siteTile, character)).toBeUndefined()

		const relations: Record<string, { advertisement: 'demand' | 'provide'; priority: '2-use' }> = {}
		augmentFreightBayGoodsRelationsForResidential(game, bay, relations)
		expect(relations.wood).toBeUndefined()
	})
})
