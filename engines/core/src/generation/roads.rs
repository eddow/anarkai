//! Settlement road generation via weighted pathfinding.
//!
//! Pure Rust — zero WASM dependencies. Compiles for both wasm32 and native targets.

use crate::common::HexCoord;
use std::collections::{BinaryHeap, HashMap, HashSet};

/// Internal node for Dijkstra priority queue.
#[derive(Clone, Debug)]
struct PathNode {
    coord: HexCoord,
    cost: f64,
    parent: Option<HexCoord>,
}

impl PartialEq for PathNode {
    fn eq(&self, other: &Self) -> bool {
        self.cost == other.cost && self.coord == other.coord
    }
}

impl Eq for PathNode {}

impl Ord for PathNode {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        other
            .cost
            .partial_cmp(&self.cost)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| self.coord.q.cmp(&other.coord.q))
            .then_with(|| self.coord.r.cmp(&other.coord.r))
    }
}

impl PartialOrd for PathNode {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

/// Returns a stable key for the border between two adjacent hexes.
/// Uses doubled coordinates so all border midpoints are integers.
fn border_key(a: &HexCoord, b: &HexCoord) -> (i32, i32) {
    // doubled midpoint: (a.q + b.q, a.r + b.r) — always even integer
    (a.q + b.q, a.r + b.r)
}

/// Compute the cost of crossing the border between tile `a` and tile `b`.
/// Both tiles must exist in tile_index.
///
/// Edge weights:
///   - Water:                           ∞ (impassable)
///   - Normal border:                   1.0
///   - Already-roaded border:           0.1
///   - River border (either tile):     10.0
fn border_cost(
    a: &HexCoord,
    b: &HexCoord,
    tile_index: &HashMap<HexCoord, usize>,
    terrain_kinds: &[u8],
    has_river: &[u8],
    existing_road_borders: &HashSet<(i32, i32)>,
) -> f64 {
    let a_idx = tile_index[a];
    let b_idx = tile_index[b];

    // Water is impassable
    if terrain_kinds[a_idx] == 0 || terrain_kinds[b_idx] == 0 {
        return f64::INFINITY;
    }

    let key = border_key(a, b);

    // Existing road → huge discount
    if existing_road_borders.contains(&key) {
        return 0.1;
    }

    // River penalty for either tile
    if has_river[a_idx] == 1 || has_river[b_idx] == 1 {
        return 10.0;
    }

    1.0
}

/// Find the lowest-cost path from start to goal using Dijkstra.
///
/// Edge weights:
///   - Water:                           ∞ (impassable)
///   - Normal border:                   1.0
///   - Already-roaded border:           0.1
///   - River border (either tile):     10.0
///
/// The 10.0 river penalty means Dijkstra will explore up to ~10 non-river
/// tiles before choosing a river crossing. This naturally handles the
/// "try to find a crossing within a radius, then give up" behavior.
fn find_road_path(
    start: &HexCoord,
    goal: &HexCoord,
    tile_index: &HashMap<HexCoord, usize>,
    terrain_kinds: &[u8],
    has_river: &[u8],
    existing_road_borders: &HashSet<(i32, i32)>,
) -> Option<Vec<HexCoord>> {
    use std::collections::HashMap;

    // Priority queue: (cost, coord)
    let mut queue = BinaryHeap::new();
    queue.push(PathNode {
        coord: *start,
        cost: 0.0,
        parent: None,
    });

    // Track best known cost for each tile
    let mut best_cost: HashMap<HexCoord, f64> = HashMap::new();
    best_cost.insert(*start, 0.0);

    // Track parent for path reconstruction
    let mut parent: HashMap<HexCoord, HexCoord> = HashMap::new();

    while let Some(node) = queue.pop() {
        if node.coord == *goal {
            // Reconstruct path
            let mut path = vec![node.coord];
            let mut current = node.coord;
            while let Some(&p) = parent.get(&current) {
                path.push(p);
                current = p;
            }
            path.reverse();
            return Some(path);
        }

        // Skip if we've found a better path to this node
        if let Some(&best) = best_cost.get(&node.coord) {
            if node.cost > best {
                continue;
            }
        }

        // Explore neighbors
        for neighbor in node.coord.neighbors() {
            if !tile_index.contains_key(&neighbor) {
                continue;
            }

            let cost = border_cost(
                &node.coord,
                &neighbor,
                tile_index,
                terrain_kinds,
                has_river,
                existing_road_borders,
            );

            if cost == f64::INFINITY {
                continue;
            }

            let new_cost = node.cost + cost;

            if let Some(&best) = best_cost.get(&neighbor) {
                if new_cost >= best {
                    continue;
                }
            }

            best_cost.insert(neighbor, new_cost);
            parent.insert(neighbor, node.coord);
            queue.push(PathNode {
                coord: neighbor,
                cost: new_cost,
                parent: Some(node.coord),
            });
        }
    }

    None // No path found
}

/// Convert a tile-center trace to doubled border-midpoint coordinates.
///
/// trace = [tile0, tile1, tile2] → borders = [(t0_q+t1_q, t0_r+t1_r), (t1_q+t2_q, t1_r+t2_r)]
fn trace_to_border_coords(trace: &[HexCoord]) -> Vec<(i32, i32)> {
    let mut borders = Vec::with_capacity(trace.len().saturating_sub(1));
    for i in 1..trace.len() {
        let a = &trace[i - 1];
        let b = &trace[i];
        borders.push((a.q + b.q, a.r + b.r));
    }
    borders
}

/// Generate all road borders for a set of settlements.
///
/// Algorithm:
/// 1. For each settlement, add roads from center to all valid neighbors
///    (same as current TS behavior).
/// 2. For each settlement i (1..n), find the nearest already-processed
///    settlement, then find a weighted path between them via Dijkstra.
/// 3. Convert each path to border coordinates.
/// 4. The order respects the road-reuse discount: roads from earlier pairs
///    make later pairs cheaper to route along.
fn settlements_to_roads(
    _seed: u32,
    tile_index: &HashMap<HexCoord, usize>,
    terrain_kinds: &[u8],
    has_river: &[u8],
    settlement_coords: &[HexCoord],
) -> Vec<(i32, i32)> {
    let mut all_road_borders: HashSet<(i32, i32)> = HashSet::new();

    // Step 1: Local roads (center → neighbors)
    for center in settlement_coords {
        let Some(&c_idx) = tile_index.get(center) else {
            continue;
        };
        for neighbor in center.neighbors() {
            let Some(&n_idx) = tile_index.get(&neighbor) else {
                continue;
            };
            if terrain_kinds[n_idx] == 0 {
                continue; // skip water
            }
            let key = border_key(center, &neighbor);
            // Skip if either tile has a river
            if has_river[c_idx] == 1 || has_river[n_idx] == 1 {
                continue;
            }
            all_road_borders.insert(key);
        }
    }

    // Step 2: Inter-settlement roads
    for i in 1..settlement_coords.len() {
        let current = &settlement_coords[i];
        // Find nearest previous settlement
        let previous = settlement_coords[0..i]
            .iter()
            .min_by_key(|s| s.distance(current))
            .unwrap();

        // Find weighted path using Dijkstra
        if let Some(path) = find_road_path(
            previous,
            current,
            tile_index,
            terrain_kinds,
            has_river,
            &all_road_borders,
        ) {
            let borders = trace_to_border_coords(&path);
            all_road_borders.extend(borders);
        }
    }

    // Return sorted for determinism
    let mut result: Vec<_> = all_road_borders.into_iter().collect();
    result.sort();
    result
}

/// Generate road borders between settlements using weighted pathfinding.
///
/// # Arguments
/// * `seed`          - Deterministic seed (reserved for future tie-breaking)
/// * `coords`        - Slice of all tile coordinates
/// * `terrain_kinds` - Terrain type per tile (0=water, 1=plains, 2=forest, ...)
/// * `has_river`     - River presence flag per tile (0=no, 1=yes; includes
///                      river edges OR channel tile OR bank influence)
/// * `settlement_coords` - Settlement center coordinates (ordered high→low score)
///
/// # Returns
/// * `Vec<(i32, i32)>` — doubled border-midpoint coordinates
///   (e.g., border between (0,0) and (1,0) → [(1, 0)])
///   Caller divides by 2 to get midpoint storage format.
pub fn generate_settlement_roads(
    seed: u32,
    coords: &[HexCoord],
    terrain_kinds: &[u8],
    has_river: &[u8],
    settlement_coords: &[HexCoord],
) -> Vec<(i32, i32)> {
    // Build tile index
    let mut tile_index: HashMap<HexCoord, usize> = HashMap::new();
    for (i, coord) in coords.iter().enumerate() {
        tile_index.insert(*coord, i);
    }

    settlements_to_roads(
        seed,
        &tile_index,
        terrain_kinds,
        has_river,
        settlement_coords,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_coord(q: i32, r: i32) -> HexCoord {
        HexCoord::new(q, r)
    }

    #[test]
    fn test_border_key() {
        // Adjacent tiles
        let a = make_coord(0, 0);
        let b = make_coord(1, 0);
        assert_eq!(border_key(&a, &b), (1, 0));

        // Symmetric
        assert_eq!(border_key(&b, &a), (1, 0));

        // Another pair
        let c = make_coord(0, 1);
        assert_eq!(border_key(&a, &c), (0, 1));
    }

    #[test]
    fn test_border_cost() {
        let coords = vec![
            make_coord(0, 0),
            make_coord(1, 0),
            make_coord(2, 0),
            make_coord(0, 1),
        ];
        let terrain_kinds = vec![1, 1, 0, 1]; // last is water
        let has_river = vec![0, 0, 0, 0];
        let mut tile_index: HashMap<HexCoord, usize> = HashMap::new();
        for (i, coord) in coords.iter().enumerate() {
            tile_index.insert(*coord, i);
        }
        let existing_roads = HashSet::new();

        // Normal border
        let a = make_coord(0, 0);
        let b = make_coord(1, 0);
        assert_eq!(
            border_cost(
                &a,
                &b,
                &tile_index,
                &terrain_kinds,
                &has_river,
                &existing_roads
            ),
            1.0
        );

        // Water border
        let c = make_coord(2, 0);
        assert_eq!(
            border_cost(
                &b,
                &c,
                &tile_index,
                &terrain_kinds,
                &has_river,
                &existing_roads
            ),
            f64::INFINITY
        );

        // Road reuse
        let mut road_borders = HashSet::new();
        road_borders.insert((1, 0));
        assert_eq!(
            border_cost(
                &a,
                &b,
                &tile_index,
                &terrain_kinds,
                &has_river,
                &road_borders
            ),
            0.1
        );

        // River penalty
        let has_river = vec![1, 0, 0, 0];
        assert_eq!(
            border_cost(
                &a,
                &b,
                &tile_index,
                &terrain_kinds,
                &has_river,
                &existing_roads
            ),
            10.0
        );
    }

    #[test]
    fn test_trace_to_border_coords() {
        let trace = vec![make_coord(0, 0), make_coord(1, 0), make_coord(2, 0)];
        let borders = trace_to_border_coords(&trace);
        assert_eq!(borders, vec![(1, 0), (3, 0)]);
    }

    #[test]
    fn test_find_road_path_simple() {
        let coords = vec![make_coord(0, 0), make_coord(1, 0), make_coord(2, 0)];
        let terrain_kinds = vec![1, 1, 1];
        let has_river = vec![0, 0, 0];
        let mut tile_index: HashMap<HexCoord, usize> = HashMap::new();
        for (i, coord) in coords.iter().enumerate() {
            tile_index.insert(*coord, i);
        }
        let existing_roads = HashSet::new();

        let start = make_coord(0, 0);
        let goal = make_coord(2, 0);

        let path = find_road_path(
            &start,
            &goal,
            &tile_index,
            &terrain_kinds,
            &has_river,
            &existing_roads,
        );

        assert!(path.is_some());
        let path = path.unwrap();
        assert_eq!(path.len(), 3);
        assert_eq!(path[0], start);
        assert_eq!(path[2], goal);
    }

    #[test]
    fn test_find_road_path_water_blocked() {
        let coords = vec![make_coord(0, 0), make_coord(1, 0), make_coord(2, 0)];
        let terrain_kinds = vec![1, 0, 1]; // middle is water
        let has_river = vec![0, 0, 0];
        let mut tile_index: HashMap<HexCoord, usize> = HashMap::new();
        for (i, coord) in coords.iter().enumerate() {
            tile_index.insert(*coord, i);
        }
        let existing_roads = HashSet::new();

        let start = make_coord(0, 0);
        let goal = make_coord(2, 0);

        let path = find_road_path(
            &start,
            &goal,
            &tile_index,
            &terrain_kinds,
            &has_river,
            &existing_roads,
        );

        // No path through water
        assert!(path.is_none());
    }

    #[test]
    fn test_find_road_path_road_reuse() {
        let coords = vec![
            make_coord(0, 0),
            make_coord(1, 0),
            make_coord(2, 0),
            make_coord(1, -1),
        ];
        let terrain_kinds = vec![1, 1, 1, 1];
        let has_river = vec![0, 0, 0, 0];
        let mut tile_index: HashMap<HexCoord, usize> = HashMap::new();
        for (i, coord) in coords.iter().enumerate() {
            tile_index.insert(*coord, i);
        }

        // Add existing road from (0,0) to (1,0)
        let mut existing_roads = HashSet::new();
        existing_roads.insert((1, 0));

        let start = make_coord(0, 0);
        let goal = make_coord(2, 0);

        let path = find_road_path(
            &start,
            &goal,
            &tile_index,
            &terrain_kinds,
            &has_river,
            &existing_roads,
        );

        assert!(path.is_some());
        let path = path.unwrap();
        // Path should go through (1,0) because road reuse is cheap
        assert!(path.contains(&make_coord(1, 0)));
    }

    #[test]
    fn test_generate_settlement_roads_local() {
        let coords = vec![
            make_coord(0, 0),
            make_coord(1, 0),
            make_coord(0, 1),
            make_coord(-1, 1),
        ];
        let terrain_kinds = vec![1, 1, 1, 1];
        let has_river = vec![0, 0, 0, 0];
        let settlement_coords = vec![make_coord(0, 0)];

        let roads =
            generate_settlement_roads(42, &coords, &terrain_kinds, &has_river, &settlement_coords);

        // Local roads to all neighbors
        assert_eq!(roads.len(), 6); // 6 neighbors, all valid
    }

    #[test]
    fn test_generate_settlement_roads_inter_settlement() {
        let coords = vec![
            make_coord(0, 0),
            make_coord(1, 0),
            make_coord(2, 0),
            make_coord(3, 0),
        ];
        let terrain_kinds = vec![1, 1, 1, 1];
        let has_river = vec![0, 0, 0, 0];
        let settlement_coords = vec![make_coord(0, 0), make_coord(3, 0)];

        let roads =
            generate_settlement_roads(42, &coords, &terrain_kinds, &has_river, &settlement_coords);

        // Should have local roads for both settlements + inter-settlement road
        assert!(roads.len() > 0);
    }

    #[test]
    fn test_generate_settlement_roads_single_settlement() {
        let coords = vec![make_coord(0, 0), make_coord(1, 0), make_coord(0, 1)];
        let terrain_kinds = vec![1, 1, 1];
        let has_river = vec![0, 0, 0];
        let settlement_coords = vec![make_coord(0, 0)];

        let roads =
            generate_settlement_roads(42, &coords, &terrain_kinds, &has_river, &settlement_coords);

        // Only local roads, no inter-settlement
        assert!(roads.len() > 0);
    }
}
