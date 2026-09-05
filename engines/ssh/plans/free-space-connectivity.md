# Free-space connectivity & entrance reachability on placement

Status: design + implemented (2026-09-05). See `engines/ssh/src/lib/board/space-connectivity.ts`.

> Placing a structure (alveolus / shop / house — anything **not** traversable) can
> dead-lock the board in **two independent** ways. They are two different functions,
> reused for hive placement, shop/house building **and** NPC growth.

## Two lock-ups, two functions

### A. Free-space partition (`placementConnectsFreeSpace`)

Placing the footprint **S** can cut the walkable ground into disconnected regions, so
characters/vehicles can no longer travel from one side to the other. This is purely about
**free space** — every structure is just an impassable wall.

- Lemma (F connected before placement): `F \ S` stays connected ⟺ the free cells on the
  boundary ring of `S` remain mutually connected within `F \ S`. One local flood suffices —
  no global connectivity recompute.
- Empty ring is a **vacuous `ok`** here: it means `S` was the last free pocket, which is a
  *structure* lock-up, caught by B below — not a free-space partition.

### B. Footprint reachability (`placementKeepsFootprintReachable`)

A building is reachable iff **any** of its footprint tiles keeps ≥1 free neighbour
(a shop is entered via any of its tiles — there are no door tiles).

Two sub-cases, both "the building lost its last free neighbour":

1. The **new** footprint `S` is boxed-in (no tile of `S` has a free neighbour).
2. An **existing** neighbour building adjacent to `S` becomes walled-in. E.g. alveolus A is surrounded
   by alveoli except one free tile; filling that tile walls A in — but `F \ S` is still connected
   (A was never free space). This is the case that is **not** covered by A.

Call pattern: `placementConnectsFreeSpace` **once** per proposed footprint, plus
`placementKeepsFootprintReachable` once for the new footprint itself and once per
neighbour building footprint (see `checkPlacementConnectivity` /
`validateFootprintConnectivity`).

So: **A and B are independent.** A can pass while B fails (wall-in a neighbour) and B can pass
while A fails (cut a corridor without walling anything in).

## Model

- **Free / traversable** = a tile a character/vehicle can walk across:
  `!tile.isBlockingSpace && tile.effectiveWalkTime < ∞`. (Water and off-board are not traversable.)
- **Roads do not affect connectivity** — they only reduce *cost* across a border, never create a
  tile adjacency. A road ends at a freight bay; it does not make the bay traversable. So the
  connectivity flood ignores roads entirely (cost belongs to A\* pathfinding, reachability to the
  flood).

## API

```ts
interface BoardTopology {
  neighbors(coord: AxialCoord): readonly AxialCoord[]   // 6 axial neighbours (may be off-board)
  isTraversable(coord: AxialCoord): boolean             // walkable ground (false for off-board/water/structure)
}

placementConnectsFreeSpace(board, used): { ok: true } | { ok: false, reason: 'partitions-free-space' }
placementKeepsFootprintReachable(board, used, footprint): boolean
checkPlacementConnectivity(board, used, neighbourFootprints): { ok, partitionsFreeSpace, selfBoxedIn, walledNeighbours }
validateFootprintConnectivity(hex, used): check + { victims }  // hex-aware: collects neighbour footprints
```

`used` = the **plan's full footprint** — the tile being placed *plus* the rest of the
draft's already-planned entries (planned entries are not on the board yet, so the
caller passes the whole new wall set). **Board walkability is live-board only**: the
topology does **not** fold any project's planned entries. A plan's own walls arrive
through `used`; **other** projects' entries are deliberately ignored — plans never
cross-check each other, each is validated against the live board + its own footprint
only (internal consistency). A plan that later becomes stale because the board moved
is re-validated wholesale when re-opened, not here. Neighbour footprints are collected
from the board via `collectAdjacentBuildingFootprints` (a `Shop` exposes its multi-tile
`footprint`; single-tile contents contribute their own tile).

## Algorithm

- **A** — build the boundary ring (free neighbours of `used`), flood from one ring seed through
  free space (blocked by `used`), **early-exit** once the whole ring is reached. Unreached ring
  ⇒ `partitions-free-space`.
  - **Infinite board.** The walkable ground is unbounded but all *blocking* cells are finite, so
    `F \ used` has exactly one **open** component plus finite pockets. The check becomes "every ring
    cell is in the open component"; a ring cell is **locked** when its component never reaches
    `BoardTopology.leadsToInfinity` (the materialized frontier). Without `leadsToInfinity` (a finite
    world) it falls back to "every ring cell in one component". The flood is bounded either way —
    `isTraversable === false` at the known-world edge, so it never walks off to infinity.
  - The failure result carries `locked`: the free ring tiles trapped in closed pockets — exactly the
    cells the player would clear to reconnect the board.
- **B** — for each entrance tile, open ⟺ some neighbour is free and `∉ used`; O(6) per entrance.
  Collect the blocked entrances.

## Cost & caching (decided)

- **No per-tile accessibility cache** — component labels are cheap under merges but expensive under
  splits, and placement *is* the split-causing operation. The ring flood is already the "partial
  computation": pocket-bounded + early-exit.
- **Token-level memo only** — reuse `Game.transitRevision` to memoize per-tile walkability/neighbour
  arrays (as `memoizedVehicleTransitNeighbors` already does for vehicles); re-flood only when the
  token advances. ⚠️ road build/remove must bump it (same caveat as
  `vehicle-maintenance-reachability-perf.md`).

## Caller glue (structure-specific, NOT in the pure functions)

- `boardTopologyFromHex(hex)` adapts `HexBoard` (neighbours + **live-board-only**
  walkability — no project entries folded; a plan's own walls are the `used` arg).
- Neighbour collection: `collectAdjacentBuildingFootprints(hex, used)` gathers the
  whole footprint of every adjacent board building (`tile.isBlockingSpace`
  distinguishes a structure from water, which has no footprint).
- Ghost UX (`apps/browser/src/widgets/game.tsx` + `placement-preview-overlay.ts`):
  the pending placement is forbidden like a generic conflict, but walled-in victims
  get dark-purple markers (`0x8b5cf6`/`0x4c1d95`) **beside** the footprint — never on it.

## Open questions

- [ ] Rejection UX: hard block (player placement, with a marker reusing `site`/claim-index errors)
      vs defer (NPC growth).
- [ ] Confirm no corner-cut cases for non-convex / holed shop-house footprints (hex has no diagonals).
- [ ] Relationship to the claim index: partition + entrance are *distinct* from cross-project claim
      conflicts — all must pass before a placement is committed.

## TL;DR

Placing a non-traversable footprint breaks things in two independent ways: it can partition the free
space (A) or wall in a structure's entrance (B — including existing neighbours, not just the new one).
Both reduce to a local check; A is one boundary-ring flood, B is O(6) per entrance. No global cache —
only the existing `transitRevision` memo. Same functions for alveoli, shops, houses, and NPC growth.
