import { roadBorderAnchorCoord } from 'ssh/board/roads'
import type { Game } from 'ssh/game/game'
import type { Project } from 'ssh/project'
import { Version } from 'ssh/utils/cell'

/**
 * Runtime project-claim registry + event bus.
 *
 * A **claim** is a board cell a working project owns: an entry tile, a demolition
 * tile, a road border, or a road's anchor tile. The index records each working
 * project's derived claims and its bounding box, and emits a `projectClaims`
 * event on change. It is **not** a cross-project conflict detector — plans never
 * check each other; a project is validated against the live board + its own
 * footprint only (and re-checked against the board when re-opened).
 *
 * Claims are **derived** (not stored): the save format already carries
 * `entries` / `demolitions` / `roads` / `roadDemolitions`, and the index is
 * rebuilt from those on load. Runtime mutations (`commit`/`archive`/`unarchive`/
 * `removeDemolition`/`removeRoad`/…) call {@link ClaimIndex.sync} to diff the
 * derived claims and emit a `projectClaims` event.
 *
 * The event carries a **bounding box** per change so a listener (NPC growth,
 * multiplayer netcode, a future live-invalidation mirror) can dismiss most events
 * in O(1) — a tile-per-tile comparison runs only for box-overlapping candidates.
 */

// ── Bounding box ─────────────────────────────────────────────────────────────

/** Axis-aligned axial box over the claimed cells. Half-integer road borders are
 * included; the box is a tight superset, never a false-dismissal. */
export interface BoundingBox {
	minQ: number
	maxQ: number
	minR: number
	maxR: number
}

/** Standard AABB overlap. An "empty" box (`min > max`) overlaps nothing. */
export function boundingBoxesOverlap(a: BoundingBox, b: BoundingBox): boolean {
	return a.minQ <= b.maxQ && b.minQ <= a.maxQ && a.minR <= b.maxR && b.minR <= a.maxR
}

// ── Claim derivation ─────────────────────────────────────────────────────────

export type ClaimKind = 'tile' | 'road' | 'anchor'

/** One board cell a project claims. `key` is namespaced (`t:`/`r:`) so a tile and
 * a road border at the same coordinate never collide. */
export interface ProjectClaim {
	readonly project: Project
	readonly key: string
	readonly kind: ClaimKind
	readonly coord: readonly [number, number]
}

/**
 * The structured claims a project owns. This is the single derivation the index
 * consumes — entry tiles + demolition tiles + road borders + each road's anchor
 * tile (the anchor tile is the road construction site's footprint).
 */
export function projectClaims(project: Project): ProjectClaim[] {
	const claims: ProjectClaim[] = []
	for (const entry of project.entries) {
		claims.push({
			project,
			key: `t:${entry.coord[0]},${entry.coord[1]}`,
			kind: 'tile',
			coord: entry.coord,
		})
	}
	for (const dem of project.demolitions) {
		claims.push({ project, key: `t:${dem[0]},${dem[1]}`, kind: 'tile', coord: dem })
	}
	for (const road of project.roads) {
		claims.push({
			project,
			key: `r:${road.coord[0]},${road.coord[1]}`,
			kind: 'road',
			coord: road.coord,
		})
		const anchor = roadBorderAnchorCoord(road.coord)
		claims.push({ project, key: `t:${anchor[0]},${anchor[1]}`, kind: 'anchor', coord: anchor })
	}
	for (const road of project.roadDemolitions) {
		claims.push({
			project,
			key: `r:${road.coord[0]},${road.coord[1]}`,
			kind: 'road',
			coord: road.coord,
		})
	}
	return claims
}

/** The namespaced claim keys (a `Set` view of {@link projectClaims}). */
export function projectClaimKeys(project: Project): Set<string> {
	return new Set(projectClaims(project).map((claim) => claim.key))
}

/** The tight axis-aligned box over a set of claims (empty → an overlapping-nothing box). */
export function projectBoundingBox(claims: readonly ProjectClaim[]): BoundingBox {
	let minQ = Number.POSITIVE_INFINITY
	let maxQ = Number.NEGATIVE_INFINITY
	let minR = Number.POSITIVE_INFINITY
	let maxR = Number.NEGATIVE_INFINITY
	for (const claim of claims) {
		const [q, r] = claim.coord
		if (q < minQ) minQ = q
		if (q > maxQ) maxQ = q
		if (r < minR) minR = r
		if (r > maxR) maxR = r
	}
	return { minQ, maxQ, minR, maxR }
}

// ── Event ────────────────────────────────────────────────────────────────────

/** One allocation/release change emitted via `GameEvents.projectClaims`. */
export interface ProjectClaimChange {
	readonly project: Project
	readonly kind: 'allocated' | 'released'
	readonly cells: ReadonlyArray<readonly [number, number]>
	readonly bounds: BoundingBox
}

// ── Index ────────────────────────────────────────────────────────────────────

/**
 * The runtime `cell → project` index, with a per-project bounding box for cheap
 * event dismissal. Non-reactive on purpose (kernel state): it is a plain `Map`
 * guarded by a bump-only {@link Version}; consumers observe change through the
 * `projectClaims` event or by re-deriving against the version.
 */
export class ClaimIndex {
	/** Bump-only change signal (advances only when a claim set actually changes). */
	readonly version = new Version()

	private claimsByProject = new Map<Project, Map<string, ProjectClaim>>()
	private boundsByProject = new Map<Project, BoundingBox>()

	constructor(private readonly game: Game) {}

	/**
	 * Diff a project's *derived* claims against its recorded claims and apply the
	 * delta — emitting one `projectClaims` event with the allocated and released
	 * cells. A non-working project owns no claims. Idempotent (no change → no emit).
	 */
	sync(project: Project): void {
		const active = project.stage === 'working'
		const next = active ? projectClaims(project) : []
		const nextByKey = new Map<string, ProjectClaim>()
		for (const claim of next) nextByKey.set(claim.key, claim)

		const prev = this.claimsByProject.get(project)
		const released: ProjectClaim[] = []
		const allocated: ProjectClaim[] = []
		if (prev) {
			for (const [key, claim] of prev) {
				if (!nextByKey.has(key)) released.push(claim)
			}
		}
		for (const [key, claim] of nextByKey) {
			if (!prev?.has(key)) allocated.push(claim)
		}

		if (next.length === 0) {
			this.claimsByProject.delete(project)
			this.boundsByProject.delete(project)
		} else {
			this.claimsByProject.set(project, nextByKey)
			this.boundsByProject.set(project, projectBoundingBox(next))
		}

		if (released.length > 0 || allocated.length > 0) {
			this.version.bump()
			const changes: ProjectClaimChange[] = []
			if (allocated.length > 0) {
				changes.push({
					project,
					kind: 'allocated',
					cells: allocated.map((claim) => claim.coord),
					bounds: projectBoundingBox(allocated),
				})
			}
			if (released.length > 0) {
				changes.push({
					project,
					kind: 'released',
					cells: released.map((claim) => claim.coord),
					bounds: projectBoundingBox(released),
				})
			}
			this.game.emit('projectClaims', changes)
		}
	}

	/**
	 * Rebuild the index from a set of projects (save/load). Bulk, non-emitting —
	 * consumers re-read against {@link version} instead.
	 */
	rebuild(projects: Iterable<Project>): void {
		this.claimsByProject.clear()
		this.boundsByProject.clear()
		for (const project of projects) {
			if (project.stage !== 'working') continue
			const claims = projectClaims(project)
			if (claims.length === 0) continue
			const byKey = new Map<string, ProjectClaim>()
			for (const claim of claims) byKey.set(claim.key, claim)
			this.claimsByProject.set(project, byKey)
			this.boundsByProject.set(project, projectBoundingBox(claims))
		}
		this.version.bump()
	}

	/** A project's recorded bounding box (undefined when it owns no claims). */
	boundsFor(project: Project): BoundingBox | undefined {
		return this.boundsByProject.get(project)
	}

	/** Projects whose bounding box overlaps `box` — the cheap event-dismissal filter. */
	projectsOverlapping(box: BoundingBox): Project[] {
		const out: Project[] = []
		for (const [project, bounds] of this.boundsByProject) {
			if (boundingBoxesOverlap(box, bounds)) out.push(project)
		}
		return out
	}
}
