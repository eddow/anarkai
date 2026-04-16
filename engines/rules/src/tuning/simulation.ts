/** Virtual seconds per wall-clock second at speed factor 1. */
export const gameRootSpeed = 2

/**
 * Multiplicative speed factors by numeric control slot index.
 * Runtime defaults to index `1`; other slots are kept for saves / tooling compatibility.
 */
export const gameTimeSpeedFactors = [0, 0.2, 1, 4] as const

/** Skip tick if computed delta exceeds this (debugger / tab freeze guard). */
export const gameMaxTickDeltaSeconds = 1
