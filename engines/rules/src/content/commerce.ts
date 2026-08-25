export const commerce = {
	startingAccountBalanceVp: 200,
	procurement: {
		autoBuyNeededGoods: true,
		usePurchaseReserveVp: 20,
		bufferPurchaseReserveVp: 80,
	},
	/**
	 * Transport automation — the single source of truth for spontaneous one-shot
	 * line creation. See `plans/spontaneous-lines.md`; the runtime policy is seeded
	 * from here into `Game.transportAutomation` (reactive) so it is tunable live.
	 */
	transportAutomation: {
		/** Spawn one-shot lines automatically (settlers) vs manual (simutrans). */
		autoSpawn: true,
		/** Auto-buy via outside delivery (the external branch of the internality slider). */
		autoBuy: true,
		/** Internality slider 0..1: 0 = buy locally, 1 = always self-haul. */
		internality: 0.5,
		/** Default reserve keep-target (stock held back from export). */
		reserve: { defaultReserve: 0 },
		/** Cooldown between spawn/sweep passes, seconds. */
		spawnCooldownSeconds: 2,
		/** Hard bound — max committed vehicle-hours (0 = no cap). Placeholder. */
		maxInternalTransfer: 0,
		/** Hard bound — min local provision floor (0 = no floor). Placeholder. */
		minLocalProvision: 0,
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
