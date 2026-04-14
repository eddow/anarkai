// Gameplay mechanics constants
// These control character behavior, survival mechanics, and game balance

import {
	activityDurations as activityDurationsRules,
	characterEvolutionRates as characterEvolutionRatesRules,
	characterTriggerLevels as characterTriggerLevelsRules,
	inputBufferSize as inputBufferSizeRules,
	maxWalkTime as maxWalkTimeRules,
	outputBufferSize as outputBufferSizeRules,
	residentialRecoveryRates as residentialRecoveryRatesRules,
	transformAlveolusStorageMultiplier as transformAlveolusStorageMultiplierRules,
} from 'engine-rules'

function cloneCharacterEvolutionRates(source: typeof characterEvolutionRatesRules): {
	[k in Ssh.NeedType]: Partial<Record<Ssh.ActivityType, number>> & {
		factor: number
		'*': number
	}
} {
	return {
		hunger: { ...source.hunger },
		tiredness: { ...source.tiredness },
		fatigue: { ...source.fatigue },
	}
}

function cloneCharacterTriggerLevels(source: typeof characterTriggerLevelsRules) {
	return {
		hunger: { ...source.hunger },
		tiredness: { ...source.tiredness },
		fatigue: { ...source.fatigue },
	}
}

/** Bounded need update: move `value` toward `target` (±1) with given `strength`. */
export function needUpdate(value: number, target: 1 | -1, strength: number): number {
	return target + (value - target) * Math.exp(-strength)
}

export function readCharacterEvolutionRate(
	rates: Partial<Record<Ssh.ActivityType, number>> & { factor: number; '*': number },
	activity: Ssh.ActivityType
): number {
	return (rates[activity] ?? rates['*'] ?? 0) * rates.factor
}

/**
 * Apply an activity-specific need rate over `dt` seconds.
 * Positive rate → drift toward +1 (worsening).
 * Negative rate → drift toward −1 (recovery).
 */
export function applyNeedRate(value: number, rate: number, dt: number): number {
	if (rate === 0) return value
	const target: 1 | -1 = rate > 0 ? 1 : -1
	return needUpdate(value, target, Math.abs(rate) * dt)
}

export const characterEvolutionRates = cloneCharacterEvolutionRates(characterEvolutionRatesRules)

export const characterTriggerLevels = cloneCharacterTriggerLevels(characterTriggerLevelsRules)

export const activityDurations = { ...activityDurationsRules }

/** Continuous recovery rates while standing on a reserved residential tile (all toward −1). */
export const residentialRecoveryRates = { ...residentialRecoveryRatesRules }

export const maxWalkTime = maxWalkTimeRules

// Storage and building constants
export const transformAlveolusStorageMultiplier = transformAlveolusStorageMultiplierRules
export const inputBufferSize = inputBufferSizeRules
export const outputBufferSize = outputBufferSizeRules
