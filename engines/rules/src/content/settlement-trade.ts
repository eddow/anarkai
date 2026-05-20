export const settlementTrade = {
	goods: ['berries', 'concrete', 'mushrooms', 'wood', 'planks', 'stone'],
	constructionGoods: ['concrete', 'wood', 'planks', 'stone'],
	basicMaterialGoods: ['concrete', 'planks', 'stone', 'wood'],
	offerCounts: {
		village: 2,
		town: 3,
		city: 4,
	},
	priceMultipliers: {
		village: 1.08,
		town: 1,
		city: 0.94,
	},
	priceJitter: 0.18,
	scoreWeights: {
		initialBase: 1,
		initialJitter: 0.25,
		nearbyRadiusExtra: 3,
		forestSellWood: 2.2,
		forestSellBerries: 1.4,
		forestSellMushrooms: 1.2,
		rockySellStone: 2.4,
		buyConstructionGood: 1.6,
		nonVillageFoodBuy: 0.8,
	},
} as const
