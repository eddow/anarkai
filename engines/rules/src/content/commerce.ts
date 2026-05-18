export const commerce = {
	startingAccountBalanceVp: 200,
	procurement: {
		autoBuyNeededGoods: true,
		usePurchaseReserveVp: 20,
		bufferPurchaseReserveVp: 80,
		maxInFlightPerGood: 1,
		defaultBufferTargets: {
			concrete: 3,
		},
	},
} as const
