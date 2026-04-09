import type { Tile } from 'ssh/board/tile'
import { blackBoxLog, traceNeeds } from 'ssh/debug'
import type { Game } from 'ssh/game'
import type { GoodType, Job } from 'ssh/types/base'
import type { AxialCoord } from 'ssh/utils'
import { toAxialCoord } from 'ssh/utils/position'
import {
	activityDurations,
	applyNeedRate,
	characterEvolutionRates,
	characterTriggerLevels,
	maxWalkTime,
	needUpdate,
	residentialRecoveryRates,
} from '../../../assets/constants'
import { goods as goodsCatalog } from '../../../assets/game-content'

/** Tunable weights for projected-discomfort scoring (not final balance). */
export const activityUtilityConfig = {
	hungerPos: 4,
	hungerNeg: 1,
	fatiguePos: 3,
	fatigueNeg: 1,
	tirednessPos: 3,
	tirednessNeg: 1,
	exponent: 2,
	/** Penalty per simulated second of activity (travel + dwell). */
	timeCostPerSecond: 0.08,
	/** Rough work segment for projection when real duration is unknown. */
	workHorizonSeconds: 8,
	/** Midpoint of restMin/restMax for wander/home ponder. */
	wanderRestSeconds: (activityDurations.restMin + activityDurations.restMax) / 2,
	/** Prefer previous pick if within this utility gap (reduces thrash). */
	hysteresis: 0.03,
	/**
	 * Added to `bestWork` / `assignedWork` utility when {@link ActivityPlanningCharacter.keepWorking}
	 * is true. Without it, **wander** often wins: its projection ends with a `rest` segment that
	 * recovers fatigue, while **work** projects 8s of `work` activity that worsens needs — so raw
	 * `penaltyBefore - penaltyAfter` favors strolling. This bias keeps employable pawns from picking
	 * walk when a job path exists (tune with playtests).
	 */
	workPreferenceWhenFit: 0.55,
} as const

export type NextActivityKind = 'eat' | 'home' | 'drop' | 'assignedWork' | 'bestWork' | 'wander'

/**
 * How `Character.findAction` chose the script: from the post-hysteresis ranked list, or
 * `fallback-wander` when every `tryScriptForActivityKind` returned falsy (planner still ranked
 * higher utilities, but execution could not start — stale job, no path, guards, etc.).
 */
export type PlannerFindActionSource = 'ranked' | 'fallback-wander'

export interface PlannerFindActionSnapshot {
	ranked: ReadonlyArray<{ kind: NextActivityKind; utility: number }>
	outcome: { kind: NextActivityKind; source: PlannerFindActionSource }
}

export interface ActivityScore {
	kind: NextActivityKind
	utility: number
	timeSeconds: number
	penaltyBefore: number
	penaltyAfter: number
	detail: Record<string, unknown>
}

/** Minimal surface for utility planning (avoids circular import with `character.ts`). */
export interface ActivityPlanningCharacter {
	readonly name?: string
	readonly hunger: number
	readonly fatigue: number
	readonly tiredness: number
	readonly position: { q: number; r: number } | { x: number; y: number }
	readonly carry: { availables: Partial<Record<GoodType, number>> }
	readonly carriedFood: GoodType | undefined
	readonly scriptsContext: {
		find: {
			food(): unknown
			freeSpot(): unknown
			wanderingTile(): unknown
		}
	}
	readonly game: Game
	/** Same idea as `Character.keepWorking`: still fit enough that rest at home should not outrank jobs. */
	readonly keepWorking: boolean
	resolveBestJobMatch(): { job: Job; targetTile: Tile; path: AxialCoord[] } | false
	readonly assignedAlveolus?: { tile: Tile }
}

function needPenaltySingle(
	value: number,
	posWeight: number,
	negWeight: number,
	exponent: number
): number {
	return posWeight * Math.max(value, 0) ** exponent + negWeight * Math.max(-value, 0) ** exponent
}

export function totalNeedPenalty(
	hunger: number,
	fatigue: number,
	tiredness: number,
	c: typeof activityUtilityConfig = activityUtilityConfig
): number {
	return (
		needPenaltySingle(hunger, c.hungerPos, c.hungerNeg, c.exponent) +
		needPenaltySingle(fatigue, c.fatiguePos, c.fatigueNeg, c.exponent) +
		needPenaltySingle(tiredness, c.tirednessPos, c.tirednessNeg, c.exponent)
	)
}

function ratesFor(activity: Ssh.ActivityType): { h: number; f: number; t: number } {
	return {
		h: characterEvolutionRates.hunger[activity] ?? characterEvolutionRates.hunger['*'],
		f: characterEvolutionRates.fatigue[activity] ?? characterEvolutionRates.fatigue['*'],
		t: characterEvolutionRates.tiredness[activity] ?? characterEvolutionRates.tiredness['*'],
	}
}

function evolveSeconds(
	h: number,
	f: number,
	t: number,
	activity: Ssh.ActivityType,
	dt: number
): { h: number; f: number; t: number } {
	const { h: hr, f: fr, t: tr } = ratesFor(activity)
	return {
		h: applyNeedRate(h, hr, dt),
		f: applyNeedRate(f, fr, dt),
		t: applyNeedRate(t, tr, dt),
	}
}

function applyResidentialSeconds(h: number, f: number, t: number, dt: number) {
	return {
		h: applyNeedRate(h, -residentialRecoveryRates.hunger, dt),
		f: applyNeedRate(f, -residentialRecoveryRates.fatigue, dt),
		t: applyNeedRate(t, -residentialRecoveryRates.tiredness, dt),
	}
}

function travelTimeSeconds(pathLength: number): number {
	return pathLength * activityDurations.footWalkTime
}

function scoreFromProjection(
	kind: NextActivityKind,
	h0: number,
	f0: number,
	t0: number,
	project: (h: number, f: number, t: number) => { h: number; f: number; t: number; time: number },
	c: typeof activityUtilityConfig
): ActivityScore {
	const penaltyBefore = totalNeedPenalty(h0, f0, t0, c)
	const { h, f, t, time } = project(h0, f0, t0)
	const penaltyAfter = totalNeedPenalty(h, f, t, c)
	const utility = penaltyBefore - penaltyAfter - c.timeCostPerSecond * time
	return {
		kind,
		utility,
		timeSeconds: time,
		penaltyBefore,
		penaltyAfter,
		detail: { hunger: h, fatigue: f, tiredness: t },
	}
}

function satiationForGood(good: GoodType): number {
	const def: Ssh.GoodsDefinition = goodsCatalog[good]
	return def.satiationStrength ?? 0
}

function nearestUnreservedHomePath(character: ActivityPlanningCharacter):
	| {
			pathLen: number
	  }
	| undefined {
	const hex = character.game.hex
	const zm = hex.zoneManager
	const start = toAxialCoord(character.position)
	let bestLen = Number.POSITIVE_INFINITY
	for (const coord of zm.listUnreservedResidentialCoords()) {
		const path = hex.findPathForCharacter(start, coord, character as any, maxWalkTime, true)
		if (path && path.length < bestLen) bestLen = path.length
	}
	if (!Number.isFinite(bestLen)) return undefined
	return { pathLen: bestLen }
}

/**
 * Score feasible activities for utility (projected discomfort drop minus time cost).
 * Call inside `inert()` — uses pathfinding via character context.
 */
export function computeActivityScores(character: ActivityPlanningCharacter): ActivityScore[] {
	const c = activityUtilityConfig
	const h0 = character.hunger
	const f0 = character.fatigue
	const t0 = character.tiredness
	const scores: ActivityScore[] = []
	const find = character.scriptsContext.find

	const push = (s: ActivityScore | undefined) => {
		if (!s) return
		if (character.keepWorking && (s.kind === 'bestWork' || s.kind === 'assignedWork')) {
			s.utility += c.workPreferenceWhenFit
		}
		scores.push(s)
	}

	// Match `selfCare.goEat`: do not plan eat when already satisfied, or `goEat` returns
	// immediately (falsy) and `findAction` can re-pick eat in the same tick → infinite fail.
	const wantsEat = h0 > characterTriggerLevels.hunger.satisfied
	const carried = character.carriedFood
	if (wantsEat && carried && satiationForGood(carried) > 0) {
		push(
			scoreFromProjection(
				'eat',
				h0,
				f0,
				t0,
				(h, f, t) => {
					let hh = h
					let ff = f
					let tt = t
					let time = 0
					const eatDt = activityDurations.eating
					;({ h: hh, f: ff, t: tt } = evolveSeconds(hh, ff, tt, 'eat', eatDt))
					hh = needUpdate(hh, -1, satiationForGood(carried))
					time += eatDt
					return { h: hh, f: ff, t: tt, time }
				},
				c
			)
		)
	} else if (wantsEat) {
		const found = find.food()
		if (
			found &&
			typeof found === 'object' &&
			found !== null &&
			'path' in found &&
			'good' in found
		) {
			const pathLen = Array.isArray((found as { path: AxialCoord[] }).path)
				? (found as { path: AxialCoord[] }).path.length
				: 0
			const good = (found as { good: GoodType }).good
			const strength = satiationForGood(good)
			if (strength > 0) {
				push(
					scoreFromProjection(
						'eat',
						h0,
						f0,
						t0,
						(h, f, t) => {
							let hh = h
							let ff = f
							let tt = t
							let time = 0
							const walkDt = travelTimeSeconds(pathLen)
							;({ h: hh, f: ff, t: tt } = evolveSeconds(hh, ff, tt, 'walk', walkDt))
							time += walkDt
							const eatDt = activityDurations.eating
							;({ h: hh, f: ff, t: tt } = evolveSeconds(hh, ff, tt, 'eat', eatDt))
							hh = needUpdate(hh, -1, strength)
							time += eatDt
							return { h: hh, f: ff, t: tt, time }
						},
						c
					)
				)
			}
		}
	}

	// Residential recovery makes the projected penalty drop sharply; work projections worsen needs over
	// `workHorizonSeconds`. Without a gate, `home` often beats real jobs even when workers are still fresh,
	// which reads as "everyone goHome + ponder" during busy phases (offload, etc.).
	const homePath = character.keepWorking ? undefined : nearestUnreservedHomePath(character)
	if (homePath) {
		push(
			scoreFromProjection(
				'home',
				h0,
				f0,
				t0,
				(h, f, t) => {
					let hh = h
					let ff = f
					let tt = t
					let time = 0
					const walkDt = travelTimeSeconds(homePath.pathLen)
					;({ h: hh, f: ff, t: tt } = evolveSeconds(hh, ff, tt, 'walk', walkDt))
					time += walkDt
					const restDt = c.wanderRestSeconds
					;({ h: hh, f: ff, t: tt } = evolveSeconds(hh, ff, tt, 'rest', restDt))
					;({ h: hh, f: ff, t: tt } = applyResidentialSeconds(hh, ff, tt, restDt))
					time += restDt
					return { h: hh, f: ff, t: tt, time }
				},
				c
			)
		)
	}

	if (Object.values(character.carry.availables).some((qty) => qty! > 0)) {
		const free = find.freeSpot()
		if (free && free !== false && Array.isArray(free)) {
			const pathLen = free.length
			push(
				scoreFromProjection(
					'drop',
					h0,
					f0,
					t0,
					(h, f, t) => {
						const walkDt = travelTimeSeconds(pathLen)
						const next = evolveSeconds(h, f, t, 'walk', walkDt)
						return { ...next, time: walkDt + activityDurations.handTransfer }
					},
					c
				)
			)
		}
	}

	const assignedTile = character.assignedAlveolus?.tile
	const assignedJob = assignedTile?.content?.getJob?.(character as any)
	if (assignedTile && assignedJob) {
		const isSame =
			toAxialCoord(assignedTile.position).q === toAxialCoord(character.position).q &&
			toAxialCoord(assignedTile.position).r === toAxialCoord(character.position).r
		const path = isSame
			? []
			: character.game.hex.findPathForCharacter(
					character.position,
					assignedTile.position,
					character as any,
					maxWalkTime,
					false
				)
		if (path) {
			const pathLen = path.length
			push(
				scoreFromProjection(
					'assignedWork',
					h0,
					f0,
					t0,
					(h, f, t) => {
						let hh = h
						let ff = f
						let tt = t
						let time = 0
						const walkDt = travelTimeSeconds(pathLen)
						;({ h: hh, f: ff, t: tt } = evolveSeconds(hh, ff, tt, 'walk', walkDt))
						time += walkDt
						const wk = c.workHorizonSeconds
						;({ h: hh, f: ff, t: tt } = evolveSeconds(hh, ff, tt, 'work', wk))
						time += wk
						return { h: hh, f: ff, t: tt, time }
					},
					c
				)
			)
		}
	}

	const best = character.resolveBestJobMatch()
	if (best) {
		const pathLen = best.path.length
		push(
			scoreFromProjection(
				'bestWork',
				h0,
				f0,
				t0,
				(h, f, t) => {
					let hh = h
					let ff = f
					let tt = t
					let time = 0
					const walkDt = travelTimeSeconds(pathLen)
					;({ h: hh, f: ff, t: tt } = evolveSeconds(hh, ff, tt, 'walk', walkDt))
					time += walkDt
					const wk = c.workHorizonSeconds
					;({ h: hh, f: ff, t: tt } = evolveSeconds(hh, ff, tt, 'work', wk))
					time += wk
					return { h: hh, f: ff, t: tt, time }
				},
				c
			)
		)
	}

	// Wander: walk + rest (see `workPreferenceWhenFit` — rest recovery can beat raw work scores).
	const dest = find.wanderingTile()
	if (
		dest &&
		typeof dest === 'object' &&
		dest !== null &&
		'path' in dest &&
		Array.isArray((dest as { path: AxialCoord[] | false }).path)
	) {
		const path = (dest as { path: AxialCoord[] }).path
		const pathLen = path.length
		push(
			scoreFromProjection(
				'wander',
				h0,
				f0,
				t0,
				(h, f, t) => {
					let hh = h
					let ff = f
					let tt = t
					let time = 0
					const walkDt = travelTimeSeconds(pathLen)
					;({ h: hh, f: ff, t: tt } = evolveSeconds(hh, ff, tt, 'walk', walkDt))
					time += walkDt
					const restDt = c.wanderRestSeconds
					;({ h: hh, f: ff, t: tt } = evolveSeconds(hh, ff, tt, 'rest', restDt))
					time += restDt
					return { h: hh, f: ff, t: tt, time }
				},
				c
			)
		)
	}

	logActivityScores(character, scores)
	return scores
}

function logActivityScores(character: ActivityPlanningCharacter, scores: ActivityScore[]) {
	const name = character.name ?? 'character'
	const payload = {
		name,
		needs: { h: character.hunger, f: character.fatigue, t: character.tiredness },
		scores: scores.map((s) => ({
			kind: s.kind,
			utility: Math.round(s.utility * 1000) / 1000,
			time: Math.round(s.timeSeconds * 100) / 100,
		})),
	}
	traceNeeds('findNextActivity', payload)
	blackBoxLog.characterNeeds?.(
		`[characterNeeds] ${name}`,
		scores.map((s) => `${s.kind}:${s.utility.toFixed(3)}`).join(' | ')
	)
}

/**
 * Re-order so `preferred` is first if it exists and is within `hysteresis` of the top utility.
 * When the previous pick was `wander`, hysteresis is skipped so work/needs can preempt a stroll
 * as soon as their utility edges ahead (wander is filler, not a commitment).
 */
export function applyActivityHysteresis(
	scores: ActivityScore[],
	preferred: NextActivityKind | undefined,
	hysteresis: number
): ActivityScore[] {
	if (!preferred || scores.length === 0) return [...scores].sort((a, b) => b.utility - a.utility)
	const sorted = [...scores].sort((a, b) => b.utility - a.utility)
	const top = sorted[0]!
	const pref = sorted.find((s) => s.kind === preferred)
	if (!pref || pref === top) return sorted
	if (top.utility - pref.utility <= hysteresis) {
		return [pref, ...sorted.filter((s) => s !== pref)]
	}
	return sorted
}

/**
 * After a full wander → ponder cycle, avoid immediately choosing wander again while still fit for
 * work and a job path exists — try eat/home/drop/work first; fallback wander remains if all fail.
 */
export function excludeWanderAfterWanderWhenEmployable(
	ranked: ActivityScore[],
	lastPicked: NextActivityKind | undefined,
	character: Pick<ActivityPlanningCharacter, 'keepWorking' | 'resolveBestJobMatch'>
): ActivityScore[] {
	if (lastPicked !== 'wander' || !character.keepWorking) return ranked
	if (!character.resolveBestJobMatch()) return ranked
	return ranked.filter((s) => s.kind !== 'wander')
}
