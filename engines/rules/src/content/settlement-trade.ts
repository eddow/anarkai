export const settlementTrade = {
	goods: ['berries', 'concrete', 'mushrooms', 'wood', 'planks', 'stone'],
	constructionGoods: ['concrete', 'wood', 'planks', 'stone'],
	offerCounts: {
		village: 2,
		town: 3,
		city: 4,
	},
	priceMultipliers: {
		sell: {
			village: 1.2,
			town: 1,
			city: 0.9,
		},
		buy: {
			village: 0.95,
			town: 1.05,
			city: 1.15,
		},
	},
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
