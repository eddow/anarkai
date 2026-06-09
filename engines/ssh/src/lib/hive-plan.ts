import { alveoli } from 'engine-rules'
import { reactive } from 'mutts'
import type { Tile } from 'ssh/board/tile'
import { createConstructionShell } from 'ssh/construction-shell'
import { type ConstructionSiteState, createConstructionSiteState } from 'ssh/construction-state'
import type { Game } from 'ssh/game'
import type { AlveolusType, GoodType } from 'ssh/types/base'
import { type AxialCoord, axial } from 'ssh/utils/axial'

export type HivePlanStage = 'draft' | 'validating' | 'working' | 'archived'
export type HivePlanArchiveReason = 'manual' | 'obsolete'

export interface HivePlanEntry {
	roleId: string
	coord: readonly [number, number]
	alveolusType: AlveolusType
	/** Dot-separated variant path (e.g., "wood.extra") for variant-capable alveoli. */
	variantId?: string
	configuration?: {
		ref: Ssh.ConfigurationReference
		individual?: Ssh.AlveolusConfiguration
	}
}

export interface HivePlanValidationProgress {
	workSecondsApplied: number
	workSecondsRequired: number
	requiredGoods: Partial<Record<GoodType, number>>
	deliveredGoods: Partial<Record<GoodType, number>>
}

export interface HivePlan {
	id: string
	name: string
	version: number
	stage: HivePlanStage
	entries: HivePlanEntry[]
	createdFromPlanIds: string[]
	validationProgress: HivePlanValidationProgress
	knownnessFingerprint: string
	archiveReason?: HivePlanArchiveReason
	replacedByPlanId?: string
}

export interface SerializedHivePlan extends HivePlan {}

export interface HivePlanStructuralIssue {
	code: 'empty' | 'disconnected' | 'duplicate-role' | 'invalid-alveolus' | 'missing-configuration'
	message: string
	roleId?: string
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

function nextRoleId(entries: readonly HivePlanEntry[], alveolusType: AlveolusType): string {
	const used = new Set(entries.map((entry) => entry.roleId))
	const base = alveolusType.replace(/[^a-z0-9_]+/gi, '_') || 'role'
	let index = entries.length + 1
	let roleId = `${base}-${index}`
	while (used.has(roleId)) roleId = `${base}-${++index}`
	return roleId
}

export function applyHivePlanToolAction(
	entries: readonly HivePlanEntry[],
	action: string,
	coord: readonly [number, number] | AxialCoord
): { entries: HivePlanEntry[]; changed: boolean; selectedRoleId?: string } {
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
			selectedRoleId: existing?.roleId,
		}
	}
	const alveolusType = action.slice('build:'.length) as AlveolusType
	if (existing) {
		return {
			entries: entries.map((entry) =>
				hivePlanCoordKey(entry.coord) === targetKey
					? {
							...cloneHivePlanEntry(entry),
							alveolusType,
							configuration: entry.alveolusType === alveolusType ? entry.configuration : undefined,
						}
					: cloneHivePlanEntry(entry)
			),
			changed: existing.alveolusType !== alveolusType,
			selectedRoleId: existing.roleId,
		}
	}
	const entry: HivePlanEntry = {
		roleId: nextRoleId(entries, alveolusType),
		coord: target,
		alveolusType,
	}
	return {
		entries: [...entries.map(cloneHivePlanEntry), entry],
		changed: true,
		selectedRoleId: entry.roleId,
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
			const variant = entry.variantId ? `#${entry.variantId}` : ''
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

export function hivePlanValidationRequirements(
	entries: readonly HivePlanEntry[],
	knownPlans: readonly HivePlan[]
): HivePlanValidationProgress {
	const novelty = hivePlanNoveltyCost(entries, knownPlans)
	return {
		workSecondsApplied: 0,
		workSecondsRequired: Math.max(4, entries.length * 3 + novelty),
		requiredGoods: { charcoal: Math.max(1, Math.ceil((entries.length + novelty) / 3)) as number },
		deliveredGoods: {},
	}
}

export function validateHivePlanStructure(
	game: Pick<Game, 'configurationManager'>,
	entries: readonly HivePlanEntry[]
): HivePlanStructuralIssue[] {
	const issues: HivePlanStructuralIssue[] = []
	if (entries.length === 0) issues.push({ code: 'empty', message: 'Add at least one alveolus.' })

	const roleIds = new Set<string>()
	for (const entry of entries) {
		if (roleIds.has(entry.roleId)) {
			issues.push({
				code: 'duplicate-role',
				message: `Duplicate role id "${entry.roleId}".`,
				roleId: entry.roleId,
			})
		}
		roleIds.add(entry.roleId)
		if (!alveoli[entry.alveolusType as keyof typeof alveoli]) {
			issues.push({
				code: 'invalid-alveolus',
				message: `Unknown alveolus type "${entry.alveolusType}".`,
				roleId: entry.roleId,
			})
		}
		const ref = entry.configuration?.ref
		if (ref?.scope === 'named' && ref.name) {
			const found = game.configurationManager.getNamedConfiguration(entry.alveolusType, ref.name)
			if (!found) {
				issues.push({
					code: 'missing-configuration',
					message: `Missing named configuration "${ref.name}".`,
					roleId: entry.roleId,
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
	if (groups.length > 1) {
		issues.push({
			code: 'disconnected',
			message: 'All plan alveoli must form one connected hive.',
			groups,
		})
	}
	return issues
}

function makePlanId(name: string, existing: readonly HivePlan[]): string {
	const base =
		name
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '') || 'hive-plan'
	let id = base
	let n = 2
	const ids = new Set(existing.map((plan) => plan.id))
	while (ids.has(id)) id = `${base}-${n++}`
	return id
}

@reactive
export class HivePlanCollection {
	public plans: HivePlan[] = []

	constructor(private readonly game: Game) {}

	get workingPlans(): HivePlan[] {
		return this.plans.filter((plan) => plan.stage === 'working')
	}

	get archivedPlans(): HivePlan[] {
		return this.plans.filter((plan) => plan.stage === 'archived')
	}

	get validatingPlans(): HivePlan[] {
		return this.plans.filter((plan) => plan.stage === 'validating')
	}

	get draftPlans(): HivePlan[] {
		return this.plans.filter((plan) => plan.stage === 'draft')
	}

	find(id: string | undefined): HivePlan | undefined {
		return id ? this.plans.find((plan) => plan.id === id) : undefined
	}

	findDuplicate(entries: readonly HivePlanEntry[], exceptId?: string): HivePlan | undefined {
		if (entries.length === 0) return undefined
		const fingerprint = hivePlanFingerprint(entries)
		return this.plans.find(
			(plan) => plan.id !== exceptId && plan.knownnessFingerprint === fingerprint
		)
	}

	createDraft(name: string, entries: readonly HivePlanEntry[]): HivePlan {
		const existing = this.findDuplicate(entries)
		if (existing) return existing
		const plan = reactive({
			id: makePlanId(name, this.plans),
			name,
			version: 1,
			stage: 'draft' as HivePlanStage,
			entries: entries.map((entry) => ({ ...entry })),
			createdFromPlanIds: [],
			validationProgress: hivePlanValidationRequirements(entries, this.plans),
			knownnessFingerprint: hivePlanFingerprint(entries),
		}) as HivePlan
		this.plans = [...this.plans, plan]
		return plan
	}

	updateDraft(id: string, patch: { name?: string; entries?: readonly HivePlanEntry[] }): HivePlan {
		const plan = this.find(id)
		if (!plan) throw new Error(`Unknown hive plan "${id}"`)
		if (plan.stage !== 'draft') throw new Error('Only draft plans can be edited')
		const entries = patch.entries ?? plan.entries
		const duplicate = this.findDuplicate(entries, id)
		if (duplicate) return duplicate
		if (patch.name !== undefined) plan.name = patch.name
		if (patch.entries) plan.entries = patch.entries.map((entry) => ({ ...entry }))
		plan.knownnessFingerprint = hivePlanFingerprint(plan.entries)
		plan.validationProgress = hivePlanValidationRequirements(
			plan.entries,
			this.plans.filter((candidate) => candidate.id !== plan.id)
		)
		return plan
	}

	sendToValidation(
		id: string
	): { ok: true; plan: HivePlan } | { ok: false; issues: HivePlanStructuralIssue[] } {
		const plan = this.find(id)
		if (!plan) return { ok: false, issues: [{ code: 'empty', message: 'Unknown plan.' }] }
		const issues = validateHivePlanStructure(this.game, plan.entries)
		if (issues.length > 0) return { ok: false, issues }
		plan.validationProgress = hivePlanValidationRequirements(
			plan.entries,
			this.plans.filter((candidate) => candidate.id !== plan.id)
		)
		plan.stage = 'validating'
		this.game.invalidateWorkPlanning('hive-plan.validation')
		return { ok: true, plan }
	}

	archive(
		id: string,
		reason: HivePlanArchiveReason = 'manual',
		replacedByPlanId?: string
	): boolean {
		const plan = this.find(id)
		if (!plan) return false
		plan.stage = 'archived'
		plan.archiveReason = reason
		plan.replacedByPlanId = replacedByPlanId
		this.game.invalidateWorkPlanning('hive-plan.archive')
		return true
	}

	unarchive(id: string): boolean {
		const plan = this.find(id)
		if (!plan) return false
		plan.stage = 'draft'
		plan.archiveReason = undefined
		plan.replacedByPlanId = undefined
		return true
	}

	applyResearchWork(plan: HivePlan, seconds: number): void {
		const progress = plan.validationProgress
		progress.workSecondsApplied = Math.min(
			progress.workSecondsRequired,
			progress.workSecondsApplied + Math.max(0, seconds)
		)
		if (progress.workSecondsApplied >= progress.workSecondsRequired) {
			plan.stage = 'working'
			this.game.invalidateWorkPlanning('hive-plan.working')
		}
	}

	serialize(): SerializedHivePlan[] {
		return this.plans.map((plan) => ({
			...plan,
			entries: plan.entries.map((entry) => ({ ...entry })),
			createdFromPlanIds: [...plan.createdFromPlanIds],
			validationProgress: {
				...plan.validationProgress,
				requiredGoods: { ...plan.validationProgress.requiredGoods },
				deliveredGoods: { ...plan.validationProgress.deliveredGoods },
			},
		}))
	}

	deserialize(plans: readonly SerializedHivePlan[] | undefined): void {
		this.plans = (plans ?? []).map((plan) =>
			reactive({
				...plan,
				entries: plan.entries.map((entry) => ({ ...entry })),
				knownnessFingerprint: plan.knownnessFingerprint || hivePlanFingerprint(plan.entries),
				validationProgress: {
					...plan.validationProgress,
					workSecondsApplied: plan.validationProgress?.workSecondsApplied ?? 0,
					workSecondsRequired: plan.validationProgress?.workSecondsRequired ?? 0,
					requiredGoods: { ...(plan.validationProgress?.requiredGoods ?? {}) },
					deliveredGoods: { ...(plan.validationProgress?.deliveredGoods ?? {}) },
				},
			})
		) as HivePlan[]
	}
}

export function previewHivePlanPlacement(
	game: Game,
	plan: HivePlan,
	anchor: AxialCoord,
	rotation: number
): HivePlanPlacementPreview {
	const seen = new Set<string>()
	const cells = plan.entries.map((entry) => {
		const relative = rotateHivePlanCoord(entry.coord, rotation)
		const coord = { q: anchor.q + relative.q, r: anchor.r + relative.r }
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
		const c = rotateHivePlanCoord(entry.coord, rotation)
		return { ...entry, coord: [c.q, c.r] as const }
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
		variantId: entry.variantId,
	})
	constructionSite.phase = 'waiting_materials'
	const shell = createConstructionShell(tile, constructionSite)
	Object.assign(shell, {
		hivePlanId: plan.id,
		hivePlanVersion: plan.version,
		planRoleId: entry.roleId,
		planConfiguration: entry.configuration ? { ...entry.configuration } : undefined,
	})
	return shell
}
