import { alveoli, construction } from 'engine-rules'
import { reactive } from 'mutts'
import type { Tile } from 'ssh/board/tile'
import { createConstructionShell } from 'ssh/construction-shell'
import {
	type ConstructionSiteState,
	createConstructionSiteState,
	resolveAlveolusVariant,
} from 'ssh/construction-state'
import type { Game } from 'ssh/game'
import type { AlveolusType, GoodType } from 'ssh/types/base'
import { type AxialCoord, axial } from 'ssh/utils/axial'

export interface HivePlanEntry {
	coord: readonly [number, number]
	alveolusType: AlveolusType
	/** Dot-separated variant path (e.g., "wood.extra") for variant-capable alveoli. */
	variant?: string
	configuration?: {
		ref: Ssh.ConfigurationReference
		individual?: Ssh.AlveolusConfiguration
	}
}

export interface HivePlanValidationProgress {
	workSecondsApplied: number
	workSecondsRequired: number
	requiredGoods: Partial<Record<GoodType, number>>
	/**
	 * Legacy frozen field — always empty for projects. The bill is the expected
	 * totals (`requiredGoods`); live delivered/missing state comes from
	 * `Game.projectProgress` aggregating shell `remainingNeeds`, not from here.
	 */
	deliveredGoods: Partial<Record<GoodType, number>>
}

export interface HivePlan {
	name: string
	entries: HivePlanEntry[]
	knownnessFingerprint: string
}

export interface HivePlanStructuralIssue {
	code: 'empty' | 'disconnected' | 'invalid-alveolus' | 'missing-configuration'
	message: string
	coord?: readonly [number, number]
	groups?: string[][]
}

export interface HivePlanPlacementCell {
	entry: HivePlanEntry
	tile?: Tile
	coord: AxialCoord
	valid: boolean
	reason?: string
}

export interface HivePlanPlacementPreview {
	plan: HivePlan
	anchor: AxialCoord
	rotation: number
	cells: HivePlanPlacementCell[]
	valid: boolean
}

export const hivePlanNeighborOffsets: readonly AxialCoord[] = [
	{ q: 1, r: 0 },
	{ q: 1, r: -1 },
	{ q: 0, r: -1 },
	{ q: -1, r: 0 },
	{ q: -1, r: 1 },
	{ q: 0, r: 1 },
]

export function hivePlanCoordKey(coord: readonly [number, number] | AxialCoord): string {
	const q = 'q' in coord ? coord.q : coord[0]
	const r = 'r' in coord ? coord.r : coord[1]
	return `${q},${r}`
}

export function hivePlanEntryAt(
	entries: readonly HivePlanEntry[],
	coord: readonly [number, number] | AxialCoord
): HivePlanEntry | undefined {
	const key = hivePlanCoordKey(coord)
	return entries.find((entry) => hivePlanCoordKey(entry.coord) === key)
}

export function hivePlanVisibleCandidateCoords(entries: readonly HivePlanEntry[]): AxialCoord[] {
	if (entries.length === 0) return [{ q: 0, r: 0 }]
	const occupied = new Set(entries.map((entry) => hivePlanCoordKey(entry.coord)))
	const candidates = new Map<string, AxialCoord>()
	for (const entry of entries) {
		const [q, r] = entry.coord
		for (const offset of hivePlanNeighborOffsets) {
			const coord = { q: q + offset.q, r: r + offset.r }
			const key = hivePlanCoordKey(coord)
			if (!occupied.has(key)) candidates.set(key, coord)
		}
	}
	return [...candidates.values()].sort((a, b) => a.r - b.r || a.q - b.q)
}

function cloneHivePlanEntry(entry: HivePlanEntry): HivePlanEntry {
	return {
		...entry,
		coord: [entry.coord[0], entry.coord[1]] as const,
		configuration: entry.configuration
			? {
					ref: { ...entry.configuration.ref },
					individual: entry.configuration.individual
						? { ...entry.configuration.individual }
						: undefined,
				}
			: undefined,
	}
}

export function applyHivePlanToolAction(
	entries: readonly HivePlanEntry[],
	action: string,
	coord: readonly [number, number] | AxialCoord
): { entries: HivePlanEntry[]; changed: boolean; selectedCoord?: readonly [number, number] } {
	const target = 'q' in coord ? ([coord.q, coord.r] as const) : ([coord[0], coord[1]] as const)
	const targetKey = hivePlanCoordKey(target)
	const existing = entries.find((entry) => hivePlanCoordKey(entry.coord) === targetKey)
	if (action === 'bulldoze') {
		if (!existing) return { entries: entries.map(cloneHivePlanEntry), changed: false }
		return {
			entries: entries
				.filter((entry) => hivePlanCoordKey(entry.coord) !== targetKey)
				.map(cloneHivePlanEntry),
			changed: true,
		}
	}
	if (!action.startsWith('build:')) {
		return {
			entries: entries.map(cloneHivePlanEntry),
			changed: false,
			selectedCoord: existing ? target : undefined,
		}
	}
	// Build action may carry a variant path: `build:<type>[#<variant.path>]` (e.g.
	// `build:pile#wood.extra`). `#` separates the type from the dot-separated variant.
	const raw = action.slice('build:'.length)
	const hashIdx = raw.indexOf('#')
	const alveolusType = (hashIdx >= 0 ? raw.slice(0, hashIdx) : raw) as AlveolusType
	const variant = hashIdx >= 0 ? raw.slice(hashIdx + 1) : undefined
	if (existing) {
		const sameType = existing.alveolusType === alveolusType && existing.variant === variant
		return {
			entries: entries.map((entry) =>
				hivePlanCoordKey(entry.coord) === targetKey
					? {
							...cloneHivePlanEntry(entry),
							alveolusType,
							variant,
							configuration: sameType ? entry.configuration : undefined,
						}
					: cloneHivePlanEntry(entry)
			),
			changed: !sameType,
			selectedCoord: target,
		}
	}
	const entry: HivePlanEntry = {
		coord: target,
		alveolusType,
		variant,
	}
	return {
		entries: [...entries.map(cloneHivePlanEntry), entry],
		changed: true,
		selectedCoord: target,
	}
}

function rotateOnce(coord: AxialCoord): AxialCoord {
	return { q: -coord.r, r: coord.q + coord.r }
}

export function rotateHivePlanCoord(
	coord: readonly [number, number],
	rotation: number
): AxialCoord {
	let next = { q: coord[0], r: coord[1] }
	for (let i = 0; i < ((rotation % 6) + 6) % 6; i++) next = rotateOnce(next)
	return next
}

/** Reflect a relative coord across the q=r diagonal (one of the six axial reflections). */
export function mirrorHivePlanCoord(coord: readonly [number, number]): readonly [number, number] {
	return [coord[1], coord[0]]
}

/**
 * The centroid of a hive plan, rounded to the nearest tile. Placement uses this
 * as the plan's "center" — the hovered tile becomes the plan's center, not its
 * `[0,0]` extreme.
 *
 * The centroid is computed **once** on the base (unmirrored, unrotated) shape
 * and rounded, then the same mirror/rotation is applied to that rounded center.
 * Mirroring and rotating integer coords are exact, so the "handle" tile under
 * the cursor is stable across rotate/mirror — rounding the already-transformed
 * centroid would shift the whole shape by up to a tile.
 */
export function hivePlanCenterOffset(
	entries: readonly HivePlanEntry[],
	rotation: number,
	mirror: boolean
): AxialCoord {
	if (entries.length === 0) return { q: 0, r: 0 }
	let q = 0
	let r = 0
	for (const entry of entries) {
		q += entry.coord[0]
		r += entry.coord[1]
	}
	const base = axial.round({ q: q / entries.length, r: r / entries.length })
	let coord: readonly [number, number] = [base.q, base.r]
	if (mirror) coord = mirrorHivePlanCoord(coord)
	return rotateHivePlanCoord(coord, rotation)
}

function configurationKey(entry: HivePlanEntry): string {
	const config = entry.configuration
	if (!config) return ''
	const individual = config.individual ? JSON.stringify(config.individual) : ''
	return `${config.ref.scope}:${config.ref.name ?? ''}:${individual}`
}

function normalizedEntryTokens(entries: readonly HivePlanEntry[], rotation: number): string[] {
	return entries
		.map((entry) => {
			const c = rotateHivePlanCoord(entry.coord, rotation)
			const variant = entry.variant ? `#${entry.variant}` : ''
			return `${c.q},${c.r}:${entry.alveolusType}${variant}:${configurationKey(entry)}`
		})
		.sort()
}

export function hivePlanFingerprint(entries: readonly HivePlanEntry[]): string {
	if (entries.length === 0) return ''
	let best = ''
	for (let rotation = 0; rotation < 6; rotation++) {
		const candidate = normalizedEntryTokens(entries, rotation).join('|')
		if (!best || candidate < best) best = candidate
	}
	return best
}

function patchTokens(entries: readonly HivePlanEntry[], rotation: number): Set<string> {
	const byCoord = new Map<string, HivePlanEntry>()
	for (const entry of entries) {
		const c = rotateHivePlanCoord(entry.coord, rotation)
		byCoord.set(hivePlanCoordKey(c), entry)
	}
	const tokens = new Set<string>()
	for (const [centerKey, entry] of byCoord) {
		const [q, r] = centerKey.split(',').map(Number)
		const neighbors = hivePlanNeighborOffsets
			.map((offset) => byCoord.get(`${q + offset.q},${r + offset.r}`)?.alveolusType ?? '.')
			.join(',')
		tokens.add(`${entry.alveolusType}[${neighbors}]`)
	}
	return tokens
}

export function hivePlanNoveltyCost(
	entries: readonly HivePlanEntry[],
	knownPlans: readonly HivePlan[]
): number {
	if (entries.length === 0) return 0
	const ownPatches = patchTokens(entries, 0)
	let bestKnown = 0
	for (const plan of knownPlans) {
		for (let rotation = 0; rotation < 6; rotation++) {
			const known = patchTokens(plan.entries, rotation)
			let matches = 0
			for (const token of ownPatches) if (known.has(token)) matches++
			bestKnown = Math.max(bestKnown, matches)
		}
	}
	const unknownPatches = Math.max(0, ownPatches.size - bestKnown)
	return entries.length * 2 + unknownPatches * 3
}

/** Add `qty` of `good` into a running bill of materials. */
function addBillGood(bill: Partial<Record<GoodType, number>>, good: GoodType, qty: number): void {
	if (qty <= 0) return
	bill[good] = (bill[good] ?? 0) + qty
}

/**
 * The real bill of materials for a hive plan: construction recipes summed over
 * every entry — the foundation concrete (one per built tile) plus the full
 * variant `ancestorChain` (root recipe + each variant hop). This replaces the
 * former survey-good (`charcoal`) stub so validating a plan consumes the same
 * materials its eventual construction will.
 */
function hivePlanRequiredGoods(
	entries: readonly HivePlanEntry[]
): Partial<Record<GoodType, number>> {
	const bill: Partial<Record<GoodType, number>> = {}
	for (const entry of entries) {
		for (const [good, qty] of Object.entries(construction.foundation.goods)) {
			addBillGood(bill, good as GoodType, qty)
		}
		const resolved = resolveAlveolusVariant(entry.alveolusType, entry.variant)
		for (const recipe of resolved?.ancestorChain ?? []) {
			for (const [good, qty] of Object.entries(recipe.goods)) {
				addBillGood(bill, good as GoodType, qty)
			}
		}
	}
	return bill
}

export function hivePlanValidationRequirements(
	entries: readonly HivePlanEntry[],
	knownPlans: readonly HivePlan[]
): HivePlanValidationProgress {
	const novelty = hivePlanNoveltyCost(entries, knownPlans)
	return {
		workSecondsApplied: 0,
		workSecondsRequired: Math.max(4, entries.length * 3 + novelty),
		requiredGoods: hivePlanRequiredGoods(entries),
		deliveredGoods: {},
	}
}

export function validateHivePlanStructure(
	game: Pick<Game, 'configurationManager'>,
	entries: readonly HivePlanEntry[]
): HivePlanStructuralIssue[] {
	const issues: HivePlanStructuralIssue[] = []
	if (entries.length === 0) issues.push({ code: 'empty', message: 'Add at least one alveolus.' })

	for (const entry of entries) {
		if (!alveoli[entry.alveolusType as keyof typeof alveoli]) {
			issues.push({
				code: 'invalid-alveolus',
				message: `Unknown alveolus type "${entry.alveolusType}".`,
				coord: entry.coord,
			})
		}
		const ref = entry.configuration?.ref
		if (ref?.scope === 'named' && ref.name) {
			const found = game.configurationManager.getNamedConfiguration(entry.alveolusType, ref.name)
			if (!found) {
				issues.push({
					code: 'missing-configuration',
					message: `Missing named configuration "${ref.name}".`,
					coord: entry.coord,
				})
			}
		}
	}

	const byCoord = new Map(entries.map((entry) => [hivePlanCoordKey(entry.coord), entry]))
	const unseen = new Set(byCoord.keys())
	const groups: string[][] = []
	while (unseen.size > 0) {
		const first = unseen.values().next().value as string
		const queue = [first]
		const group: string[] = []
		unseen.delete(first)
		for (const key of queue) {
			group.push(key)
			const [q, r] = key.split(',').map(Number)
			for (const offset of hivePlanNeighborOffsets) {
				const next = `${q + offset.q},${r + offset.r}`
				if (!unseen.has(next)) continue
				unseen.delete(next)
				queue.push(next)
			}
		}
		groups.push(group)
	}
	// Disconnected entries are allowed: a project may span several hives and the
	// committed tree groups them via `groupProjectEntriesIntoHives`. Connectivity
	// is a display grouping, not a commit gate.
	return issues
}

/**
 * The hive-plan (template) registry: abstract, relative-coordinate designs that
 * projects stamp onto the board. Templates are **static** (no lifecycle stage) —
 * the "known plans" novelty memory reads this registry directly.
 */
@reactive
export class HivePlanCollection {
	public plans: HivePlan[] = []

	constructor(_game: Game) {}

	/** Register index of a plan; -1 when the plan is not in this collection. */
	indexOf(plan: HivePlan): number {
		return this.plans.indexOf(plan)
	}

	/** Resolve a plan by its register position (append-only, serialized in order). */
	byIndex(index: number): HivePlan | undefined {
		return this.plans[index]
	}

	findDuplicate(entries: readonly HivePlanEntry[], exceptPlan?: HivePlan): HivePlan | undefined {
		if (entries.length === 0) return undefined
		const fingerprint = hivePlanFingerprint(entries)
		return this.plans.find(
			(plan) => plan !== exceptPlan && plan.knownnessFingerprint === fingerprint
		)
	}

	create(name: string, entries: readonly HivePlanEntry[] = []): HivePlan {
		const existing = this.findDuplicate(entries)
		if (existing) return existing
		const plan = reactive({
			name,
			entries: entries.map((entry) => ({ ...entry })),
			knownnessFingerprint: hivePlanFingerprint(entries),
		}) as HivePlan
		this.plans = [...this.plans, plan]
		return plan
	}

	update(plan: HivePlan, patch: { name?: string; entries?: readonly HivePlanEntry[] }): HivePlan {
		const entries = patch.entries ?? plan.entries
		const duplicate = this.findDuplicate(entries, plan)
		if (duplicate) return duplicate
		if (patch.name !== undefined) plan.name = patch.name
		if (patch.entries) plan.entries = patch.entries.map((entry) => ({ ...entry }))
		plan.knownnessFingerprint = hivePlanFingerprint(plan.entries)
		return plan
	}

	remove(plan: HivePlan): boolean {
		const index = this.plans.indexOf(plan)
		if (index < 0) return false
		this.plans = this.plans.filter((candidate) => candidate !== plan)
		return true
	}

	serialize(): HivePlan[] {
		return this.plans.map((plan) => ({
			name: plan.name,
			entries: plan.entries.map((entry) => ({ ...entry })),
			knownnessFingerprint: plan.knownnessFingerprint,
		}))
	}

	deserialize(plans: readonly HivePlan[] | undefined): void {
		this.plans = (plans ?? []).map((plan) =>
			reactive({
				name: plan.name,
				entries: (plan.entries ?? []).map((entry) => ({ ...entry })),
				knownnessFingerprint: plan.knownnessFingerprint || hivePlanFingerprint(plan.entries ?? []),
			})
		) as HivePlan[]
	}
}

export function previewHivePlanPlacement(
	game: Game,
	plan: HivePlan,
	anchor: AxialCoord,
	rotation: number,
	mirror = false
): HivePlanPlacementPreview {
	const center = hivePlanCenterOffset(plan.entries, rotation, mirror)
	const seen = new Set<string>()
	const cells = plan.entries.map((entry) => {
		let relativeCoord: readonly [number, number] = [entry.coord[0], entry.coord[1]]
		if (mirror) relativeCoord = mirrorHivePlanCoord(relativeCoord)
		const relative = rotateHivePlanCoord(relativeCoord, rotation)
		const coord = {
			q: anchor.q + relative.q - center.q,
			r: anchor.r + relative.r - center.r,
		}
		const key = axial.key(coord)
		const tile = game.hex.getTile(coord)
		let valid = true
		let reason: string | undefined
		if (seen.has(key)) {
			valid = false
			reason = 'overlap'
		} else if (!tile) {
			valid = false
			reason = 'missing tile'
		} else if (!tile.canInteract(`build:${entry.alveolusType}`)) {
			valid = false
			reason = 'blocked'
		} else if (!tile.isClear) {
			valid = false
			reason = 'not clear'
		}
		seen.add(key)
		return { entry, tile, coord, valid, reason }
	})
	const rotatedEntries = plan.entries.map((entry) => {
		let relativeCoord: readonly [number, number] = [entry.coord[0], entry.coord[1]]
		if (mirror) relativeCoord = mirrorHivePlanCoord(relativeCoord)
		const c = rotateHivePlanCoord(relativeCoord, rotation)
		return { ...entry, coord: [c.q - center.q, c.r - center.r] as const }
	})
	const structurallyValid = validateHivePlanStructure(game, rotatedEntries).length === 0
	return {
		plan,
		anchor,
		rotation,
		cells,
		valid: structurallyValid && cells.every((cell) => cell.valid),
	}
}

export function createConstructionSiteForHivePlanEntry(
	tile: Tile,
	plan: HivePlan,
	entry: HivePlanEntry
) {
	const constructionSite: ConstructionSiteState = createConstructionSiteState({
		kind: 'alveolus',
		alveolusType: entry.alveolusType,
		variant: entry.variant,
	})
	constructionSite.phase = 'waiting_materials'
	const shell = createConstructionShell(tile, constructionSite)
	Object.assign(shell, {
		hivePlan: plan,
		planConfiguration: entry.configuration ? { ...entry.configuration } : undefined,
	})
	return shell
}
