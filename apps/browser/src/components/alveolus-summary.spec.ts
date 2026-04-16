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
				types: ['build.storage'],
			},
			{
				goodType: 'planks',
				advertisement: 'provide',
				priority: '0-store',
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
			},
			{
				name: 'freight_bay',
				action: { type: 'road-fret', kind: 'slotted', capacity: 2, slots: 4 },
				goodsRelations: {
					wood: { advertisement: 'provide', priority: '2-use' },
				},
			},
		])

		expect(summary).toEqual([
			{
				goodType: 'wood',
				advertisement: 'provide',
				priority: '2-use',
				types: ['storage', 'road-fret'],
			},
		])
	})
})
