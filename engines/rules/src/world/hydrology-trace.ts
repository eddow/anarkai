export const defaultHydrologyTraceConstants = {
	minTerminalPathLength: 1,
	/** Added once in `transitionCost` before uphill/missed/non-descending terms. */
	pathTransitionBase: 1,
	/** When `uphill > 0`, contributes `inner + (uphill * linear)²` to the cost. */
	uphillPenaltyInner: 1,
	uphillLinearFactor: 24,
	missedDescentLinearFactor: 18,
	nonDescendingPenalty: 0.75,
	trimSeaEntryOceanNeighborThreshold: 4,
	edgeFluxWidthSqrtScale: 1.8,
	edgeFluxWidthOffset: 0.35,
	edgeFluxDepthCap: 8,
	edgeFluxDepthFluxScale: 0.08,
	edgeFluxDepthSlopeScale: 0.5,
	channelDownstreamWeightBase: 0.8,
	channelHighDownstreamThreshold: 1.25,
	outerBankInfluenceScale: 0.38,
} as const
