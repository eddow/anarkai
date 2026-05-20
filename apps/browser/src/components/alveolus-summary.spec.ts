import { describe, expect, it } from 'vitest'
import { summarizeHiveGoodsRelations } from './alveolus-summary'

describe('summarizeHiveGoodsRelations', () => {
	it('keeps build-site demand visible alongside storage provide', () => {
		const summary = summarizeHiveGoodsRelations([
			{
				name: 'storage',
				action: { type: 'storage' },
				goodsRelations: {
					planks: { advertisement: 'provide', priority: '0-store' },
				},
				stock: { planks: 3 },
			},
			{
				name: 'build.storage',
				target: 'storage',
				goodsRelations: {
					planks: { advertisement: 'demand', priority: '2-use' },
				},
			},
		])

		expect(summary).toEqual([
			{
				goodType: 'planks',
				advertisement: 'demand',
				priority: '2-use',
				quantity: 3,
				types: ['build.storage'],
			},
			{
				goodType: 'planks',
				advertisement: 'provide',
				priority: '0-store',
				quantity: 3,
				types: ['storage'],
			},
		])
	})

	it('merges matching ads and keeps the highest priority', () => {
		const summary = summarizeHiveGoodsRelations([
			{
				name: 'storage.a',
				action: { type: 'storage' },
				goodsRelations: {
					wood: { advertisement: 'provide', priority: '0-store' },
				},
				stock: { wood: 2 },
			},
			{
				name: 'vehicle-dock:wheelbarrow-1',
				goodsRelations: {
					wood: { advertisement: 'provide', priority: '2-use' },
				},
				stock: { wood: 1 },
			},
		])

		expect(summary).toEqual([
			{
				goodType: 'wood',
				advertisement: 'provide',
				priority: '2-use',
				quantity: 3,
				types: ['storage', 'vehicle-dock:wheelbarrow-1'],
			},
		])
	})
})
