import type { HexBoard } from 'ssh/board/board'
import { type AxialCoord, axial } from 'ssh/utils/axial'

/**
 * Generic placement-connectivity checks — reusable for hive placement, shop/house
 * building and NPC growth. See `engines/ssh/plans/free-space-connectivity.md`.
 *
 * Two **independent** lock-ups, two functions:
 *
 * - {@link placementConnectsFreeSpace} — does occupying `used` partition the free
 *   (walkable) space? (A structure is just an impassable wall to this test.)
 *   Call **once** per proposed footprint.
 * - {@link placementKeepsFootprintReachable} — does a building footprint keep ≥1
 *   free neighbour on **any** of its tiles after occupying `used`? (A shop is
 *   reachable via any of its tiles — there are no door tiles.) Call **once per
 *   neighbour building** (alveoli/shops/houses) plus once for the new footprint
 *   itself (boxed-in check).
 *
 * Both are footprint-agnostic: they only read the board through {@link BoardTopology}
 * and the `used` / `footprint` the caller supplies. For the full per-placement
 * call pattern (partition once + reachability per neighbour + self), use
 * {@link validateFootprintConnectivity}.
 */

/** The board as seen by the checks: neighbours + walkability. Roads are irrelevant to
 * connectivity (they reduce cost, never add adjacency), so they are not modelled here. */
export interface BoardTopology {
	/** The 6 axial neighbours (may include off-board coords; `isTraversable` filters them). */
	neighbors(coord: AxialCoord): readonly AxialCoord[]
	/** Whether `coord` is walkable ground (false for off-board / water / any structure). */
	isTraversable(coord: AxialCoord): boolean
	/**
	 * Whether `coord` is walkable **and** opens onto the unbounded outside of the
	 * known world (e.g. a walkable tile at the materialized frontier of an otherwise
	 * infinite board). Absent ⇒ the world is finite and needs no infinity handling.
	 */
	leadsToInfinity?(coord: AxialCoord): boolean
}

export type FreeSpaceResult =
	| { ok: true }
	| { ok: false; reason: 'partitions-free-space'; locked: AxialCoord[] }
	| { ok: false; reason: 'completely-locked' }

export type EntranceResult =
	| { ok: true }
	| { ok: false; reason: 'entrance-blocked'; blocked: AxialCoord[] }

export type PlacementResult =
	| { ok: true }
	| {
			ok: false
			reason: 'partitions-free-space' | 'entrance-blocked'
			blocked?: AxialCoord[]
	  }

/** Value-based coord key (`"q,r"`), without `axial.key`'s in-place mutation of the coord. */
export function coordKey(coord: AxialCoord): string {
	return `${coord.q},${coord.r}`
}

/**
 * Does occupying `used` keep the free space connected? For connected free space F
 * before placement, `F \ used` is connected iff the free boundary ring of `used` is
 * mutually connected within `F \ used`.
 *
 * The board may be **infinite** (procedurally generated): the walkable ground is
 * unbounded, but all *blocking* cells are finite. In that case `F \ used` has exactly
 * one **open** (unbounded) component plus zero or more finite pockets, so the check
 * reduces to: **every ring cell lies in the open component**. A ring cell is "locked"
 * when its component never reaches {@link BoardTopology.leadsToInfinity}. When the
 * board provides no `leadsToInfinity` (a finite world), the check falls back to
 * "every ring cell in one component". Either way the flood is bounded by
 * `isTraversable === false` at the known-world edge — it never walks off to infinity.
 *
 * `locked` (on failure) is the free ring tiles trapped in closed pockets — the cells
 * the player would have to clear to keep the board connected.
 *
 * An **empty ring** is a vacuous `ok` here (the structure lock-up is {@link
 * placementKeepsFootprintReachable}'s job, not this test's).
 */
export function placementConnectsFreeSpace(
	board: BoardTopology,
	used: readonly AxialCoord[]
): FreeSpaceResult {
	const usedKeys = new Set(used.map(coordKey))

	// Boundary ring: free neighbours of the footprint, deduplicated.
	const ring: AxialCoord[] = []
	const ringKeys = new Set<string>()
	for (const cell of used) {
		for (const n of board.neighbors(cell)) {
			const k = coordKey(n)
			if (usedKeys.has(k) || !board.isTraversable(n) || ringKeys.has(k)) continue
			ring.push(n)
			ringKeys.add(k)
		}
	}

	// No free neighbour → nothing to partition; the "boxed-in" lock-up is a B concern.
	if (ring.length === 0) return { ok: false, reason: 'completely-locked' }

	const hasInfinity = typeof board.leadsToInfinity === 'function'
	const leadsToInfinity = board.leadsToInfinity ?? (() => false)

	// Union-find over the free cells reachable from the ring (multi-source), so each
	// ring cell ends up in exactly one connected component, and a component is "open"
	// once any of its cells reaches infinity. The flood is bounded: `isTraversable`
	// is false beyond the known world.
	const parent = new Map<string, string>()
	const openRoots = new Set<string>()
	const find = (k: string): string => {
		let root = k
		while (parent.get(root) !== undefined && parent.get(root) !== root) {
			root = parent.get(root)!
		}
		let cur = k
		while (parent.get(cur) !== undefined && parent.get(cur) !== root) {
			const next = parent.get(cur)!
			parent.set(cur, root)
			cur = next
		}
		return root
	}
	const union = (a: string, b: string): void => {
		const ra = find(a)
		const rb = find(b)
		if (ra === rb) return
		parent.set(rb, ra)
		if (openRoots.has(rb)) openRoots.add(ra)
	}
	const makeRoot = (k: string) => {
		if (!parent.has(k)) parent.set(k, k)
	}

	const queue: AxialCoord[] = []
	const visited = new Set<string>()
	for (const cell of ring) {
		const k = coordKey(cell)
		makeRoot(k)
		if (!visited.has(k)) {
			visited.add(k)
			queue.push(cell)
		}
	}
	for (let i = 0; i < queue.length; i++) {
		const cell = queue[i]!
		const ck = coordKey(cell)
		if (leadsToInfinity(cell)) openRoots.add(find(ck))
		for (const n of board.neighbors(cell)) {
			const k = coordKey(n)
			if (usedKeys.has(k) || !board.isTraversable(n)) continue
			makeRoot(k)
			if (!visited.has(k)) {
				visited.add(k)
				queue.push(n)
			}
			union(k, ck)
		}
	}

	// A ring cell is locked when its component is not "safe": on an infinite board it
	// must be open; on a finite board it must match the first ring cell's component.
	const ringRoots = ring.map((cell) => find(coordKey(cell)))
	const mainRoot = hasInfinity
		? (ringRoots.find((root) => openRoots.has(root)) ?? ringRoots[0]!)
		: ringRoots[0]!

	const locked = ring
		.map((cell, i) => ({ cell, root: ringRoots[i]! }))
		.filter(({ root }) => root !== mainRoot)
		.map(({ cell }) => cell)

	return locked.length === 0 ? { ok: true } : { ok: false, reason: 'partitions-free-space', locked }
}

/**
 * Do all `entrances` keep ≥1 free neighbour after occupying `used`? An entrance is
 * open iff some neighbour is walkable and not part of `used`. This catches both the
 * new structure being boxed-in and an existing neighbour being walled-in.
 */
export function placementKeepsEntrancesReachable(
	board: BoardTopology,
	used: readonly AxialCoord[],
	entrances: readonly AxialCoord[]
): EntranceResult {
	const usedKeys = new Set(used.map(coordKey))
	const blocked: AxialCoord[] = []
	for (const entrance of entrances) {
		const open = board
			.neighbors(entrance)
			.some((n) => !usedKeys.has(coordKey(n)) && board.isTraversable(n))
		if (!open) blocked.push(entrance)
	}
	return blocked.length === 0 ? { ok: true } : { ok: false, reason: 'entrance-blocked', blocked }
}

/**
 * Does a building footprint stay reachable after occupying `used`? Reachable =
 * **any** footprint tile keeps ≥1 free neighbour (a shop is entered via any of
 * its tiles — there are no door tiles). Call once per neighbour building
 * (alveoli/shops/houses) plus once for the new footprint itself (boxed-in check).
 */
export function placementKeepsFootprintReachable(
	board: BoardTopology,
	used: readonly AxialCoord[],
	footprint: readonly AxialCoord[]
): boolean {
	const usedKeys = new Set(used.map(coordKey))
	for (const tile of footprint) {
		const open = board
			.neighbors(tile)
			.some((n) => !usedKeys.has(coordKey(n)) && board.isTraversable(n))
		if (open) return true
	}
	return false
}

/**
 * Adapt a {@link HexBoard} to {@link BoardTopology}. Walkability is **live board
 * only** — a tile is walkable when it is empty ground with finite walk time.
 *
 * A plan's **own** walls are **not** folded here: they arrive through the `used`
 * argument of {@link placementConnectsFreeSpace} / {@link checkPlacementConnectivity}
 * (the caller passes the plan's full footprint — existing entries + hover ghost).
 * Other projects' entries are deliberately **ignored** — plans never cross-check
 * each other; each plan is validated against the live board + its own footprint
 * only (internal consistency). A plan that later becomes stale because the board
 * moved is re-validated wholesale when re-opened, not here.
 *
 * `leadsToInfinity` treats a walkable tile at the materialized frontier (some axial
 * neighbour is not materialized) as opening onto the infinite outside.
 */
export function boardTopologyFromHex(hex: HexBoard): BoardTopology {
	return {
		neighbors: (coord) => axial.neighbors(coord),
		isTraversable: (coord) => {
			const tile = hex.getTile(coord)
			if (!tile) return false
			return !tile.isBlockingSpace && tile.effectiveWalkTime < Number.POSITIVE_INFINITY
		},
		leadsToInfinity: (coord) => {
			const tile = hex.getTile(coord)
			if (!tile || tile.isBlockingSpace) return false
			if (tile.effectiveWalkTime >= Number.POSITIVE_INFINITY) return false
			return axial.neighbors(coord).some((n) => !hex.getTile(n))
		},
	}
}

/**
 * Collect the footprints of existing **live board** buildings adjacent to `used`.
 * Each adjacent blocking tile contributes its whole building footprint (a `Shop`
 * exposes `footprint`; single-tile contents contribute their own tile), deduplicated
 * by footprint key. Tiles inside `used` are skipped — they are the new walls, not
 * existing neighbours. Planned entries are NOT buildings yet, so they are not
 * collected (they are the plan's own walls, passed via `used`).
 */
export function collectAdjacentBuildingFootprints(
	hex: HexBoard,
	used: readonly AxialCoord[]
): AxialCoord[][] {
	const usedKeys = new Set(used.map(coordKey))
	const seen = new Set<string>()
	const footprints: AxialCoord[][] = []
	// Normalize to plain `{q, r}` — `axial.neighbors` results may carry an extra
	// `key` prop (from `axial.key`'s in-place mutation), which breaks `toEqual`.
	const norm = (c: AxialCoord): AxialCoord => ({ q: c.q, r: c.r })
	const pushFootprint = (fp: readonly AxialCoord[]) => {
		const key = [...fp].map(coordKey).sort().join('|')
		if (seen.has(key)) return
		seen.add(key)
		footprints.push(fp.map(norm))
	}
	for (const cell of used) {
		for (const n of axial.neighbors(cell)) {
			if (usedKeys.has(coordKey(n))) continue
			const tile = hex.getTile(n)
			if (!tile || !tile.isBlockingSpace) continue
			const content = tile.content as { footprint?: unknown } | undefined
			const raw = content && Array.isArray(content.footprint) ? content.footprint : [n]
			const coords = (raw as readonly AxialCoord[]).filter(
				(c): c is AxialCoord => !!c && typeof c.q === 'number' && typeof c.r === 'number'
			)
			pushFootprint(coords.length > 0 ? coords : [n])
		}
	}
	return footprints
}

/** Result of the per-placement connectivity call pattern. */
export interface PlacementConnectivityCheck {
	ok: boolean
	partitionsFreeSpace: boolean
	/** True when the footprint has no free neighbour at all (`completely-locked`). */
	completelyLocked: boolean
	/** Free ring tiles trapped in closed pockets (`partitions-free-space` locked). Purple these. */
	lockedTiles: AxialCoord[]
	selfBoxedIn: boolean
	walledNeighbours: AxialCoord[][]
}

/**
 * The per-placement call pattern: {@link placementConnectsFreeSpace} **once** for
 * `used`, plus {@link placementKeepsFootprintReachable} once for the new footprint
 * itself (boxed-in) and once per neighbour building footprint (walled-in).
 */
export function checkPlacementConnectivity(
	board: BoardTopology,
	used: readonly AxialCoord[],
	neighbourFootprints: readonly (readonly AxialCoord[])[]
): PlacementConnectivityCheck {
	const free = placementConnectsFreeSpace(board, used)
	const partitionsFreeSpace = !free.ok
	const completelyLocked = !free.ok && free.reason === 'completely-locked'
	const lockedTiles = !free.ok && free.reason === 'partitions-free-space' ? [...free.locked] : []
	const selfBoxedIn = !placementKeepsFootprintReachable(board, used, used)
	const walledNeighbours = neighbourFootprints
		.filter((fp) => !placementKeepsFootprintReachable(board, used, fp))
		.map((fp) => [...fp])
	return {
		ok: !partitionsFreeSpace && !selfBoxedIn && walledNeighbours.length === 0,
		partitionsFreeSpace,
		completelyLocked,
		lockedTiles,
		selfBoxedIn,
		walledNeighbours,
	}
}

/**
 * Hex-aware convenience: build the topology (live board only), collect adjacent
 * building footprints, and run {@link checkPlacementConnectivity}. `used` must be
 * the plan's **full footprint** (existing entries + the new ghost) — those are the
 * plan's own walls, and the only "planned" tiles that block. Other projects' entries
 * are ignored (plans don't cross-check). `victims` is the flattened walled-neighbour
 * tiles for purple markers.
 */
export function validateFootprintConnectivity(
	hex: HexBoard,
	used: readonly AxialCoord[]
): PlacementConnectivityCheck & { victims: AxialCoord[] } {
	const board = boardTopologyFromHex(hex)
	const neighbours = collectAdjacentBuildingFootprints(hex, used)
	const check = checkPlacementConnectivity(board, used, neighbours)
	return { ...check, victims: check.walledNeighbours.flat() }
}

/**
 * Purple-marker tiles for a refused placement: `completely-locked` ⇒ the whole
 * footprint; `partitions-free-space` ⇒ `lockedTiles`; walled neighbours always
 * included. Empty when the placement is fine.
 */
export function purpleMarkerTiles(
	hex: HexBoard,
	used: readonly AxialCoord[]
): { reason: string | undefined; purple: AxialCoord[] } {
	if (used.length === 0) return { reason: undefined, purple: [] }
	const check = validateFootprintConnectivity(hex, used)
	if (check.ok) return { reason: undefined, purple: [] }
	if (check.completelyLocked) return { reason: 'completely locked', purple: [...used] }
	if (check.partitionsFreeSpace)
		return {
			reason: 'partitions free space',
			purple: [...check.lockedTiles, ...check.walledNeighbours.flat()],
		}
	if (check.selfBoxedIn) return { reason: 'boxed-in', purple: [...used] }
	return {
		reason: `walls-in ${check.walledNeighbours.length} building(s)`,
		purple: [...check.walledNeighbours.flat()],
	}
}
