export const commerce = {
	startingAccountBalanceVp: 200,
	procurement: {
		autoBuyNeededGoods: true,
		usePurchaseReserveVp: 20,
		bufferPurchaseReserveVp: 80,
	},
	/**
	 * Hybrid automatic price field tuning (the `PriceFieldTuning` shape).
	 * `price(p) = base_g · exp(−k · Σ effectiveFlow_s · w(dist))`, `w = max(0, 1−(d/R)²)`.
	 * Open numbers — placeholder values pending tuning.
	 */
	priceField: {
		/** elasticity `k` (price deviation per unit of rate field). */
		k: 0.05,
		/** stock-elasticity floor `α` (the 0.5 knob in `effectiveFlow`). */
		alpha: 0.5,
		/** influence radius `R` (≥ generation radius). */
		radius: 8,
		/** frontier fade radius (deviation → 0 at the generated edge). */
		fadeRadius: 12,
	},
} as const
