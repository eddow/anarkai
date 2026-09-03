import { reactive } from 'mutts'
import { type RoadPatch, type RoadType, roadBorderEndpointCoords } from 'ssh/board/roads'
import type { ProjectSourcingMode, ProjectSourcingPolicy } from 'ssh/commerce/commerce-model'
import type { Game } from 'ssh/game'
import {
	type HivePlan,
	type HivePlanEntry,
	type HivePlanStructuralIssue,
	type HivePlanValidationProgress,
	hivePlanCenterOffset,
	hivePlanFingerprint,
	hivePlanValidationRequirements,
	mirrorHivePlanCoord,
	rotateHivePlanCoord,
	validateHivePlanStructure,
} from 'ssh/hive-plan'
import type { GoodType } from 'ssh/types/base'
import type { AxialCoord } from 'ssh/utils/axial'

export type ProjectStage = 'draft' | 'working' | 'archived'
export type ProjectArchiveReason = 'manual' | 'obsolete'

/**
 * A project entry is a concrete alveolus placed at an **absolute** board
 * coordinate. It shares {@link HivePlanEntry}'s shape (whose coords are
 * **relative** template coordinates); the owning container distinguishes them.
 */
export type ProjectEntry = HivePlanEntry

/**
 * A project is a concrete construction undertaking on the board: a set of
 * **placed** alveoli (absolute coords) plus roads. It owns the lifecycle stage
 * and the aggregate bill. A project is authored by stamping hive-plan templates
 * onto the board; the stamped alveoli become project entries (the project
 * stores the alveoli, not the template).
 */
export interface Project {
	name: string
	stage: ProjectStage
	entries: ProjectEntry[]
	roads: RoadPatch[]
	/** Tiles planned for demolition (existing board structures to remove on commit). */
	demolitions: Array<readonly [number, number]>
	/** Existing road segments (border midpoints) planned for demolition on commit. */
	roadDemolitions: RoadPatch[]
	/** Per-good sourcing policy (auto / take / buy), edited in the project detail. */
	sourcing: ProjectSourcingPolicy
	validationProgress: HivePlanValidationProgress
	knownnessFingerprint: string
	archiveReason?: ProjectArchiveReason
}

export interface SerializedProject extends Project {}

/**
 * The effective sourcing mode for a good on a project: the project's per-good
 * override, or `'auto'` (internal-first, external fallback) when unset or the
 * project is absent (spontaneous construction).
 */
export function projectSourcingMode(
	project: Project | undefined,
	good: GoodType
): ProjectSourcingMode {
	return project?.sourcing?.[good] ?? 'auto'
}

/** One live item in a project's construction progress (an alveolus entry or a road segment). */
export interface ProjectProgressItem {
	kind: 'alveolus' | 'road'
	label: string
	coord: readonly [number, number]
	/** `pending` = not materialized yet, `building` = shell working, `done` = finished. */
	state: 'pending' | 'building' | 'done'
	/** Seconds of construction work applied (building items only). */
	applied: number
	/** Total construction work seconds (building items only). */
	total: number
	/** Goods still missing for this item (materials not yet delivered). */
	remainingNeeds: Partial<Record<GoodType, number>>
}

/**
 * Live, board-derived construction progress for a project (not the frozen plan).
 * `completed`/`total` are the aggregate-bar numerator/denominator: `completed` is
 * the number of finished items plus each building item's `applied/total` fraction.
 */
export interface ProjectProgress {
	items: ProjectProgressItem[]
	completed: number
	total: number
	missingGoods: Partial<Record<GoodType, number>>
}

/**
 * The project bill = the template bill over the project's **absolute** entries
 * (foundation + variant ancestor chain summed). Novelty cost is measured against
 * the known template registry (the "known plans" memory).
 */
export function projectValidationRequirements(
	entries: readonly ProjectEntry[],
	knownPlans: readonly HivePlan[]
): HivePlanValidationProgress {
	return hivePlanValidationRequirements(entries, knownPlans)
}

/**
 * Position-independent dedupe key: normalize absolute entries to the origin,
 * then fingerprint the relative arrangement (rotation-invariant).
 */
export function projectFingerprint(entries: readonly ProjectEntry[]): string {
	if (entries.length === 0) return ''
	const minQ = Math.min(...entries.map((entry) => entry.coord[0]))
	const minR = Math.min(...entries.map((entry) => entry.coord[1]))
	const normalized = entries.map((entry) => ({
		...entry,
		coord: [entry.coord[0] - minQ, entry.coord[1] - minR] as const,
	}))
	return hivePlanFingerprint(normalized)
}

/** Structural validation for a project's placed entries. */
export function validateProjectStructure(
	game: Pick<Game, 'configurationManager'>,
	entries: readonly ProjectEntry[]
): HivePlanStructuralIssue[] {
	if (entries.length === 0) {
		return [{ code: 'empty', message: 'Add at least one alveolus.' }]
	}
	return validateHivePlanStructure(game, entries)
}

/**
 * Stamp a hive-plan template into absolute project entries: optionally mirror,
 * rotate, then offset by `anchor` (which is the plan's **centroid**, so the
 * hovered tile becomes the plan's center). The template's relative entries
 * become absolute board coordinates — the alveoli become part of the project.
 */
export function stampHivePlanEntries(
	hivePlan: HivePlan,
	anchor: AxialCoord,
	rotation: number,
	mirror: boolean
): ProjectEntry[] {
	const center = hivePlanCenterOffset(hivePlan.entries, rotation, mirror)
	return hivePlan.entries.map((entry) => {
		let coord: readonly [number, number] = [entry.coord[0], entry.coord[1]]
		if (mirror) coord = mirrorHivePlanCoord(coord)
		const rotated = rotateHivePlanCoord(coord, rotation)
		return {
			...entry,
			coord: [anchor.q + rotated.q - center.q, anchor.r + rotated.r - center.r] as const,
		}
	})
}

/** Shallow-clone project entries so edits never alias live state. */
function cloneEntries(entries: readonly ProjectEntry[]): ProjectEntry[] {
	return entries.map((entry) => ({ ...entry }))
}

/** Shallow-clone road patches. */
function cloneRoads(roads: readonly RoadPatch[]): RoadPatch[] {
	return roads.map((road) => ({ ...road }))
}

/** Shallow-clone demolition tile coords. */
function cloneDemolitions(
	demolitions: readonly (readonly [number, number])[]
): Array<readonly [number, number]> {
	return demolitions.map((coord) => [coord[0], coord[1]] as const)
}

/**
 * Recover the two endpoint tile coordinates of a road border from its midpoint
 * coordinate. Delegates to {@link roadBorderEndpointCoords}.
 */
function roadBorderEndpointTiles(
	coord: readonly [number, number]
): [readonly [number, number], readonly [number, number]] {
	return roadBorderEndpointCoords(coord)
}

/** A display "road" = one connected component of the same road type. */
export interface RoadGroup {
	type: RoadType
	coords: ReadonlyArray<readonly [number, number]>
}

/**
 * Group a project's roads into connected components per road type — "1 road =
 * same type and connected". Two road borders are connected when they share a
 * common endpoint tile. This is a display grouping (not a storage rule).
 */
export function groupRoadsByConnectedType(roads: readonly RoadPatch[]): RoadGroup[] {
	// Union-find over road indices, per type.
	const groups: RoadGroup[] = []
	const byType = new Map<RoadType, Array<{ index: number; coord: readonly [number, number] }>>()
	for (let i = 0; i < roads.length; i++) {
		const road = roads[i]
		const list = byType.get(road.type) ?? []
		list.push({ index: i, coord: road.coord })
		byType.set(road.type, list)
	}

	const parent = new Map<number, number>()
	const find = (x: number): number => {
		let root = x
		while (parent.get(root) !== undefined && parent.get(root) !== root) {
			root = parent.get(root)!
		}
		// Path compression.
		let cur = x
		while (parent.get(cur) !== undefined && parent.get(cur) !== cur) {
			const next = parent.get(cur)!
			parent.set(cur, root)
			cur = next
		}
		return root
	}
	const union = (a: number, b: number) => {
		const ra = find(a)
		const rb = find(b)
		if (ra !== rb) parent.set(rb, ra)
	}

	for (const [type, roadsOfType] of byType) {
		// Build endpoint-tile → road-index adjacency for union-find.
		const tileToRoads = new Map<string, number[]>()
		for (const { index, coord } of roadsOfType) {
			for (const tile of roadBorderEndpointTiles(coord)) {
				const key = `${tile[0]},${tile[1]}`
				const list = tileToRoads.get(key) ?? []
				list.push(index)
				tileToRoads.set(key, list)
			}
		}
		for (const indices of tileToRoads.values()) {
			for (let i = 1; i < indices.length; i++) union(indices[0], indices[i])
		}
		// Collect connected components.
		const byRoot = new Map<number, Array<readonly [number, number]>>()
		for (const { index, coord } of roadsOfType) {
			const root = find(index)
			const list = byRoot.get(root) ?? []
			list.push(coord)
			byRoot.set(root, list)
		}
		for (const coords of byRoot.values()) groups.push({ type, coords })
	}
	return groups
}

@reactive
export class ProjectCollection {
	public projects: Project[] = []

	constructor(private readonly game: Game) {}

	get workingProjects(): Project[] {
		return this.projects.filter((project) => project.stage === 'working')
	}

	get archivedProjects(): Project[] {
		return this.projects.filter((project) => project.stage === 'archived')
	}

	get draftProjects(): Project[] {
		return this.projects.filter((project) => project.stage === 'draft')
	}

	/** Register index of a project; -1 when not in this collection. */
	indexOf(project: Project): number {
		return this.projects.indexOf(project)
	}

	/** Resolve a project by its register position (append-only, serialized in order). */
	byIndex(index: number): Project | undefined {
		return this.projects[index]
	}

	findDuplicate(entries: readonly ProjectEntry[], exceptProject?: Project): Project | undefined {
		if (entries.length === 0) return undefined
		const fingerprint = projectFingerprint(entries)
		return this.projects.find(
			(project) => project !== exceptProject && project.knownnessFingerprint === fingerprint
		)
	}

	createDraft(name: string, entries: readonly ProjectEntry[] = []): Project {
		const existing = this.findDuplicate(entries)
		if (existing) return existing
		const project = reactive({
			name,
			stage: 'draft' as ProjectStage,
			entries: cloneEntries(entries),
			roads: [],
			demolitions: [],
			roadDemolitions: [],
			sourcing: {},
			validationProgress: projectValidationRequirements(entries, this.game.hivePlans.plans),
			knownnessFingerprint: projectFingerprint(entries),
		}) as Project
		this.projects = [...this.projects, project]
		return project
	}

	updateDraft(
		project: Project,
		patch: {
			name?: string
			entries?: readonly ProjectEntry[]
			roads?: readonly RoadPatch[]
			demolitions?: readonly (readonly [number, number])[]
			roadDemolitions?: readonly RoadPatch[]
			sourcing?: ProjectSourcingPolicy
		}
	): Project {
		if (project.stage !== 'draft') throw new Error('Only draft projects can be edited')
		const entries = patch.entries ? cloneEntries(patch.entries) : project.entries
		const duplicate = this.findDuplicate(entries, project)
		if (duplicate) return duplicate
		if (patch.name !== undefined) project.name = patch.name
		if (patch.entries) project.entries = entries
		if (patch.roads) project.roads = cloneRoads(patch.roads)
		if (patch.demolitions) project.demolitions = cloneDemolitions(patch.demolitions)
		if (patch.roadDemolitions) project.roadDemolitions = cloneRoads(patch.roadDemolitions)
		if (patch.sourcing) project.sourcing = { ...patch.sourcing }
		project.knownnessFingerprint = projectFingerprint(project.entries)
		project.validationProgress = projectValidationRequirements(
			project.entries,
			this.game.hivePlans.plans
		)
		return project
	}

	/**
	 * Commit a draft project: validate its placed entries, then freeze to `working`.
	 * Board materialization (construction shells + roads) is handled by
	 * {@link Game.commitProject}, which calls this as the freeze authority.
	 *
	 * NOTE: validation/research is deferred — the `engineer.research` study variant
	 * is not wired to projects yet (see plans/projects.md §Deferred).
	 */
	commit(
		project: Project
	): { ok: true; project: Project } | { ok: false; issues: HivePlanStructuralIssue[] } {
		if (project.stage !== 'draft') throw new Error('Only draft projects can be committed')
		const issues = validateProjectStructure(this.game, project.entries)
		if (issues.length > 0) return { ok: false, issues }
		project.stage = 'working'
		this.game.invalidateWorkPlanning('project.commit')
		return { ok: true, project }
	}

	archive(project: Project, reason: ProjectArchiveReason = 'manual'): boolean {
		project.stage = 'archived'
		project.archiveReason = reason
		this.game.invalidateWorkPlanning('project.archive')
		return true
	}

	unarchive(project: Project): boolean {
		project.stage = 'draft'
		project.archiveReason = undefined
		return true
	}

	/** Remove a completed tile demolition todo from a working project. */
	removeDemolition(project: Project, coord: readonly [number, number]): boolean {
		const key = `${coord[0]},${coord[1]}`
		const next = project.demolitions.filter((dem) => `${dem[0]},${dem[1]}` !== key)
		if (next.length === project.demolitions.length) return false
		project.demolitions = next
		this.game.invalidateWorkPlanning('project.demolition-done')
		return true
	}

	/** Remove a completed road demolition todo from a working project. */
	removeRoadDemolition(project: Project, coord: readonly [number, number]): boolean {
		const key = `${coord[0]},${coord[1]}`
		const next = project.roadDemolitions.filter(
			(road) => `${road.coord[0]},${road.coord[1]}` !== key
		)
		if (next.length === project.roadDemolitions.length) return false
		project.roadDemolitions = next
		this.game.invalidateWorkPlanning('project.road-demolition-done')
		return true
	}

	/** Remove a built road segment from a working project's pending build list. */
	removeRoad(project: Project, coord: readonly [number, number]): boolean {
		const key = `${coord[0]},${coord[1]}`
		const next = project.roads.filter((road) => `${road.coord[0]},${road.coord[1]}` !== key)
		if (next.length === project.roads.length) return false
		project.roads = next
		this.game.invalidateWorkPlanning('project.road-built')
		return true
	}

	/**
	 * Set a project's per-good sourcing mode. Editable in `draft` and `working`
	 * (sourcing quotas stay tunable while a project runs); `archived` is frozen.
	 */
	setSourcingMode(project: Project, good: GoodType, mode: ProjectSourcingMode): void {
		if (project.stage === 'archived') return
		project.sourcing = { ...project.sourcing, [good]: mode }
	}

	serialize(): SerializedProject[] {
		return this.projects.map((project) => ({
			...project,
			entries: project.entries.map((entry) => ({ ...entry })),
			roads: project.roads.map((road) => ({ ...road })),
			demolitions: project.demolitions.map((coord) => [coord[0], coord[1]] as const),
			roadDemolitions: project.roadDemolitions.map((road) => ({ ...road })),
			sourcing: { ...project.sourcing },
			validationProgress: {
				...project.validationProgress,
				requiredGoods: { ...project.validationProgress.requiredGoods },
				deliveredGoods: { ...project.validationProgress.deliveredGoods },
			},
		}))
	}

	deserialize(projects: readonly SerializedProject[] | undefined): void {
		this.projects = (projects ?? []).map((project) =>
			reactive({
				...project,
				entries: (project.entries ?? []).map((entry) => ({ ...entry })),
				roads: (project.roads ?? []).map((road) => ({ ...road })),
				demolitions: (project.demolitions ?? []).map((coord) => [coord[0], coord[1]] as const),
				roadDemolitions: (project.roadDemolitions ?? []).map((road) => ({ ...road })),
				sourcing: { ...(project.sourcing ?? {}) },
				knownnessFingerprint:
					project.knownnessFingerprint || projectFingerprint(project.entries ?? []),
				validationProgress: {
					workSecondsApplied: project.validationProgress?.workSecondsApplied ?? 0,
					workSecondsRequired: project.validationProgress?.workSecondsRequired ?? 0,
					requiredGoods: { ...(project.validationProgress?.requiredGoods ?? {}) },
					deliveredGoods: { ...(project.validationProgress?.deliveredGoods ?? {}) },
				},
			})
		) as Project[]
	}
}
