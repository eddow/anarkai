import { activityUtilityConfig, goods as goodsCatalog } from 'engine-rules'
import type { Tile } from 'ssh/board/tile'
import type { Game } from 'ssh/game'
import type { GoodType, Job } from 'ssh/types/base'
import { type AxialCoord, axial } from 'ssh/utils'
import { toAxialCoord } from 'ssh/utils/position'
import {
	activityDurations,
	applyNeedRate,
	characterEvolutionRates,
	characterTriggerLevels,
	maxWalkTime,
	needUpdate,
	readCharacterEvolutionRate,
	residentialRecoveryRates,
} from '../../../assets/constants'
import { blackBoxLog, traceNeeds } from '../dev/debug.ts'

export { activityUtilityConfig }

export type NextActivityKind = 'eat' | 'home' | 'assignedWork' | 'bestWork' | 'wander'

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

/**
 * Minimal surface for utility planning (avoids circular import with `character.ts`).
 * Does not include transport/carry: need scoring uses paths and needs only, not inventory state.
 */
export interface ActivityPlanningCharacter {
	readonly name?: string
	readonly hunger: number
	readonly fatigue: number
	readonly tiredness: number
	readonly position: { q: number; r: number } | { x: number; y: number }
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
	bestPersonalFood(): GoodType | undefined
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
		h: readCharacterEvolutionRate(characterEvolutionRates.hunger, activity),
		f: readCharacterEvolutionRate(characterEvolutionRates.fatigue, activity),
		t: readCharacterEvolutionRate(characterEvolutionRates.tiredness, activity),
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

/** Best edible good type on a tile (storage stock or loose goods with satiation strength), if any. */
function bestFoodAt(character: ActivityPlanningCharacter, coord: AxialCoord): GoodType | undefined {
	const hex = character.game.hex
	let best: { type: GoodType; strength: number } | undefined

	const tile = hex.getTile(coord)
	if (tile) {
		const storage = tile.content?.storage
		const goodsMap = storage?.stock || {}
		for (const [good] of Object.entries(goodsMap) as [GoodType, number][]) {
			if (!storage || storage.available(good as GoodType) < 1) continue
			const strength = satiationForGood(good as GoodType)
			if (strength > 0 && (!best || strength > best.strength))
				best = { type: good as GoodType, strength }
		}
	}

	for (const looseGood of hex.looseGoods.getGoodsAt(coord)) {
		if (!looseGood.available || looseGood.isRemoved) continue
		const strength = satiationForGood(looseGood.goodType)
		if (strength > 0 && (!best || strength > best.strength))
			best = { type: looseGood.goodType, strength }
	}
	return best?.type
}

/**
 * Nearest food-bearing tile by O(1) hex distance (NO Dijkstra). Phase 0: selection only needs a walk
 * LENGTH for the `eat` utility; `goEat` re-pathfinds the real path at execution. A near-but-walled-off
 * food tile resolves at execution (self-correcting, same trade-off as `tailorProposedJob`).
 */
function nearestFood(
	character: ActivityPlanningCharacter
): { good: GoodType; distance: number } | undefined {
	const hex = character.game.hex
	const start = toAxialCoord(character.position)
	if (!start) return undefined
	let best: { good: GoodType; distance: number } | undefined
	for (const tile of hex.tilesAround(start, maxWalkTime)) {
		const coord = toAxialCoord(tile.position)
		if (!coord) continue
		const good = bestFoodAt(character, coord)
		if (!good) continue
		const distance = axial.distance(start, coord)
		if (!best || distance < best.distance) best = { good, distance }
	}
	return best
}

/**
 * Walk length for the wander activity score, computed as hex distance (no pathfinding). Phase 0: the
 * wander projection only needs a walk length; `goWander` re-runs `find.wanderingTile()` at execution,
 * which picks the real target and pathfinds. Mirrors `find.wanderingTile`'s 2–5-tile walkable scan so
 * the "no walkable tile" signal is preserved.
 */
function wanderDistance(character: ActivityPlanningCharacter): number | undefined {
	const hex = character.game.hex
	const start = toAxialCoord(character.position)
	if (!start) return undefined
	const distance = 2 + character.game.random() * 3 // 2–5 tiles, same as find.wanderingTile
	const walkable: AxialCoord[] = []
	for (let q = -Math.ceil(distance); q <= Math.ceil(distance); q++) {
		for (let r = -Math.ceil(distance); r <= Math.ceil(distance); r++) {
			const coord = axial.linear({ q, r }, start)
			if (axial.distance(start, coord) < 2) continue
			const tile = hex.getTile(coord)
			if (tile?.content && Number.isFinite(tile.effectiveWalkTime)) walkable.push(coord)
		}
	}
	if (walkable.length === 0) return undefined
	const index = Math.floor(character.game.random(walkable.length))
	return axial.distance(start, walkable[index])
}

function nearestUnreservedHomePath(character: ActivityPlanningCharacter):
	| {
			pathLen: number
	  }
	| undefined {
	const hex = character.game.hex
	const zm = hex.zoneManager
	const start = toAxialCoord(character.position)
	if (!start) return undefined
	const residential = zm.listUnreservedResidentialCoords()
	if (residential.length === 0) return undefined
	// Phase 0 (pathfind-to-score → hex-distance score): the home projection only needs a walk LENGTH
	// to rank activities, and `goHome` re-pathfinds at execution (`find.homeTile`). The Dijkstra here
	// (`findNearestForCharacter`) was the same redundant per-replan pathfind Phase 0 removed for work.
	// Score by O(1) hex distance to the nearest unreserved residential coord; a near-but-walled-off
	// target resolves at execution (self-correcting, same trade-off as `tailorProposedJob`).
	let minDistance = Number.POSITIVE_INFINITY
	for (const coord of residential) {
		const distance = axial.distance(start, coord)
		if (distance < minDistance) minDistance = distance
	}
	return { pathLen: minDistance }
}

/**
 * Score feasible activities for utility (projected discomfort drop minus time cost).
 * Call inside `inert()` — uses pathfinding via character context.
 *
 * @param bestWorkMatch Optional precomputed best-work match (already ranked by the caller). When
 *   provided, avoids re-running `resolveBestJobMatch()` (a full candidate scan) inside this call.
 *   `findAction` passes it because it has already ranked candidates for the snapshot.
 */
export function computeActivityScores(
	character: ActivityPlanningCharacter,
	bestWorkMatch?: { job: Job; targetTile: Tile; path: AxialCoord[] } | false
): ActivityScore[] {
	const c = activityUtilityConfig
	const h0 = character.hunger
	const f0 = character.fatigue
	const t0 = character.tiredness
	const scores: ActivityScore[] = []

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
	if (wantsEat) {
		const personalFood = character.bestPersonalFood()
		// Phase 0 (no pathfinding in selection): score the `eat` activity by hex distance to the
		// nearest food tile (`nearestFood` is a bounded O(R²) scan), not a `findNearestForCharacter`
		// Dijkstra. `goEat` → `find.food()` re-pathfinds the real path at execution.
		const nearest = personalFood ? undefined : nearestFood(character)
		const good = personalFood ?? nearest?.good
		if (good) {
			const pathLen = personalFood ? 0 : (nearest?.distance ?? 0)
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

	const assignedTile = character.assignedAlveolus?.tile
	const assignedJob = assignedTile?.content?.getJob?.(character as any)
	if (assignedTile && assignedJob) {
		// Phase 0 (pathfind-to-score → hex-distance score): the `assignedWork` projection only needs a
		// walk LENGTH to rank, and `tryScriptForActivityKind` re-pathfinds at execution. Score by O(1)
		// hex distance; a near-but-walled-off assignment resolves at execution (self-correcting).
		const start = toAxialCoord(character.position)
		const target = toAxialCoord(assignedTile.position)
		const pathLen = start && target ? axial.distance(start, target) : 0
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

	const best = bestWorkMatch === undefined ? character.resolveBestJobMatch() : bestWorkMatch
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
	// Phase 0: score by hex distance (wanderDistance), no pathfinding; `goWander` re-pathfinds at execution.
	const wanderPathLen = wanderDistance(character)
	if (wanderPathLen !== undefined) {
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
					const walkDt = travelTimeSeconds(wanderPathLen)
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
 * work and a job path exists — try eat/home/work first; fallback wander remains if all fail.
 */
export function excludeWanderAfterWanderWhenEmployable(
	ranked: ActivityScore[],
	lastPicked: NextActivityKind | undefined,
	character: Pick<ActivityPlanningCharacter, 'keepWorking' | 'resolveBestJobMatch'>,
	bestWorkMatch?: { job: Job; targetTile: Tile; path: AxialCoord[] } | false
): ActivityScore[] {
	if (lastPicked !== 'wander' || !character.keepWorking) return ranked
	const hasJob = bestWorkMatch === undefined ? character.resolveBestJobMatch() : bestWorkMatch
	if (!hasJob) return ranked
	return ranked.filter((s) => s.kind !== 'wander')
}
