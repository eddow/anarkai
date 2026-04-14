/** Default implicit gather freight line reach (tiles). */
export const defaultGatherFreightRadius = 9

/** Gather runs are most worthwhile when they can pick up this many goods (vehicle-driven later). */
export const gatherTargetBatchSize = 2

/** Internal slotted storage for gather/freight bay alveolus: slots × capacity per slot. */
export const gatherFreightBayStorageSlots = 1
export const gatherFreightBayStorageCapacityPerSlot = 12

/** Harvest deposit search radius when no character context (NPC). */
export const harvestNpcSearchDistance = 6

/** Extra fatigue per axial step from character position to harvest target. */
export const harvestTravelFatiguePerStep = 2

/** Extra fatigue premium for harvest actions over base work time. */
export const harvestFatiguePremium = 2

/** Bounded poll when waiting on incoming convey goods (seconds). */
export const waitForIncomingGoodsPollSeconds = 0.3
