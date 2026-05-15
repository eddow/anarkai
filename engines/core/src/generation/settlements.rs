//! Settlement generation module
//!
//! Handles the placement and configuration of settlements on the game board.

use crate::common::HexCoord;
use crate::generation::{coord_hash, random01};

/// Terrain kind constants
pub const TERRAIN_WATER: u8 = 0;
pub const TERRAIN_PLAINS: u8 = 1;
pub const TERRAIN_FOREST: u8 = 2;
pub const TERRAIN_HILLS: u8 = 3;
pub const TERRAIN_MOUNTAINS: u8 = 4;
pub const TERRAIN_SNOW: u8 = 5;
pub const TERRAIN_CONCRETE: u8 = 6;

/// Settlement kind enumeration
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SettlementKind {
    Village,
    Town,
    City,
}

impl SettlementKind {
    /// Returns the radius for this settlement kind
    pub fn radius(self) -> i32 {
        match self {
            SettlementKind::City => 4,
            SettlementKind::Town => 3,
            SettlementKind::Village => 2,
        }
    }
}

/// Represents a placed settlement with its coordinate and score
#[derive(Debug, Clone)]
pub struct SettlementPlacement {
    pub coord: HexCoord,
    pub score: f64,
    pub kind: SettlementKind,
}

/// Settlement candidate for internal scoring
#[derive(Debug, Clone)]
struct SettlementCandidate {
    coord: HexCoord,
    score: f64,
    index: usize,
}

/// Scores a tile for settlement placement based on multiple factors.
///
/// # Arguments
/// * `seed` - Random seed for deterministic randomization
/// * `coord` - The hex coordinate to score
/// * `terrain_kind` - Terrain type index
/// * `has_water_access` - Whether the tile has access to water
/// * `has_river` - Whether the tile has a river
/// * `existing_settlements` - List of existing settlement coordinates
/// * `min_spacing` - Minimum distance required from existing settlements
///
/// # Returns
/// A score value (higher is better). Returns negative infinity for invalid tiles.
///
/// # Scoring factors
/// - Water access: +20 points
/// - River presence: +15 points
/// - Terrain: Plains (+10), Forest (+5), Hills (-5), Mountains (-10)
/// - Distance penalty: -1 point per tile closer than min_spacing to existing settlement
/// - Random jitter: Small random value for tie-breaking
pub fn score_settlement_tile(
    seed: u32,
    coord: &HexCoord,
    terrain_kind: u8,
    has_water_access: bool,
    has_river: bool,
    existing_settlements: &[HexCoord],
    min_spacing: i32,
) -> f64 {
    // Invalid terrains (water, snow) get negative infinity score
    if terrain_kind == TERRAIN_WATER || terrain_kind == TERRAIN_SNOW {
        return f64::NEG_INFINITY;
    }

    let mut score = 0.0;

    // Terrain scoring
    match terrain_kind {
        TERRAIN_PLAINS => score += 10.0,
        TERRAIN_FOREST => score += 5.0,
        TERRAIN_HILLS => score -= 5.0,
        TERRAIN_MOUNTAINS => score -= 10.0,
        TERRAIN_CONCRETE => score += 0.0, // Neutral
        _ => {}                           // Unknown terrain, neutral
    }

    // Water access bonus
    if has_water_access {
        score += 20.0;
    }

    // River bonus
    if has_river {
        score += 15.0;
    }

    // Distance penalty from existing settlements
    for existing in existing_settlements {
        let distance = coord.distance(existing);
        if distance < min_spacing {
            score -= (min_spacing - distance) as f64;
        }
    }

    // Add random jitter for tie-breaking (small value, 0-1 range)
    let hash = coord_hash(seed, coord, "settlement-candidate");
    let jitter = random01(hash) * 0.75;
    score += jitter;

    score
}

/// Determines the settlement kind based on score and index.
///
/// # Arguments
/// * `index` - The settlement's index in the sorted list (0 is highest score)
/// * `score` - The settlement's score
///
/// # Returns
/// The appropriate settlement kind
fn settlement_kind(index: usize, score: f64) -> SettlementKind {
    // First settlement with high score becomes a city
    if index == 0 && score >= 7.0 {
        SettlementKind::City
    } else if score >= 6.0 {
        SettlementKind::Town
    } else {
        SettlementKind::Village
    }
}

/// Places settlements on the board by scoring all valid tiles and selecting the best ones.
///
/// # Algorithm
/// 1. Score all valid tiles (non-water, non-snow)
/// 2. Sort by score (descending)
/// 3. Select top N tiles respecting min_spacing
/// 4. Return settlement placements with coords, scores, and kinds
///
/// # Arguments
/// * `seed` - Random seed for deterministic randomization
/// * `settlement_count` - Maximum number of settlements to place
/// * `coords` - List of all tile coordinates
/// * `terrain_kinds` - Terrain type for each tile
/// * `has_water_access` - Water access flag for each tile
/// * `has_river` - River presence flag for each tile
/// * `min_spacing` - Minimum distance between settlements
///
/// # Returns
/// A vector of settlement placements with coordinates, scores, and kinds
pub fn place_settlements(
    seed: u32,
    settlement_count: u32,
    coords: &[HexCoord],
    terrain_kinds: &[u8],
    has_water_access: &[bool],
    has_river: &[bool],
    min_spacing: i32,
) -> Vec<SettlementPlacement> {
    if coords.is_empty() || settlement_count == 0 {
        return Vec::new();
    }

    // Validate input arrays have matching lengths
    let tile_count = coords.len();
    if terrain_kinds.len() != tile_count
        || has_water_access.len() != tile_count
        || has_river.len() != tile_count
    {
        return Vec::new();
    }

    // Score all tiles
    let mut candidates: Vec<SettlementCandidate> = Vec::new();
    for (index, coord) in coords.iter().enumerate() {
        let score = score_settlement_tile(
            seed,
            coord,
            terrain_kinds[index],
            has_water_access[index],
            has_river[index],
            &[], // No existing settlements yet
            min_spacing,
        );

        // Only consider valid tiles (non-negative infinity)
        if score > f64::NEG_INFINITY {
            candidates.push(SettlementCandidate {
                coord: *coord,
                score,
                index,
            });
        }
    }

    // Sort by score descending
    candidates.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    // Select settlements respecting spacing constraints
    let mut settlements: Vec<SettlementPlacement> = Vec::new();
    let mut placed_coords: Vec<HexCoord> = Vec::new();

    for candidate in candidates {
        if settlements.len() >= settlement_count as usize {
            break;
        }

        // Check spacing against already placed settlements
        let valid_placement = placed_coords
            .iter()
            .all(|placed| candidate.coord.distance(placed) >= min_spacing);

        if valid_placement {
            let kind = settlement_kind(settlements.len(), candidate.score);
            settlements.push(SettlementPlacement {
                coord: candidate.coord,
                score: candidate.score,
                kind,
            });
            placed_coords.push(candidate.coord);
        }
    }

    settlements
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_terrain_scoring() {
        let coord = HexCoord::new(0, 0);

        // Plains should get +10
        let plains_score = score_settlement_tile(42, &coord, TERRAIN_PLAINS, false, false, &[], 7);
        assert!((plains_score - 10.0).abs() < 1.0); // Allow for random jitter

        // Forest should get +5
        let forest_score = score_settlement_tile(42, &coord, TERRAIN_FOREST, false, false, &[], 7);
        assert!((forest_score - 5.0).abs() < 1.0);

        // Hills should get -5
        let hills_score = score_settlement_tile(42, &coord, TERRAIN_HILLS, false, false, &[], 7);
        assert!((hills_score + 5.0).abs() < 1.0);

        // Mountains should get -10
        let mountains_score =
            score_settlement_tile(42, &coord, TERRAIN_MOUNTAINS, false, false, &[], 7);
        assert!((mountains_score + 10.0).abs() < 1.0);
    }

    #[test]
    fn test_water_access_bonus() {
        let coord = HexCoord::new(0, 0);

        let without_water = score_settlement_tile(42, &coord, TERRAIN_PLAINS, false, false, &[], 7);

        let with_water = score_settlement_tile(42, &coord, TERRAIN_PLAINS, true, false, &[], 7);

        // With water should be ~20 points higher
        assert!((with_water - without_water - 20.0).abs() < 1.0);
    }

    #[test]
    fn test_river_bonus() {
        let coord = HexCoord::new(0, 0);

        let without_river = score_settlement_tile(42, &coord, TERRAIN_PLAINS, false, false, &[], 7);

        let with_river = score_settlement_tile(42, &coord, TERRAIN_PLAINS, false, true, &[], 7);

        // With river should be ~15 points higher
        assert!((with_river - without_river - 15.0).abs() < 1.0);
    }

    #[test]
    fn test_combined_bonuses() {
        let coord = HexCoord::new(0, 0);

        let base_score = score_settlement_tile(42, &coord, TERRAIN_PLAINS, false, false, &[], 7);

        let full_bonus_score =
            score_settlement_tile(42, &coord, TERRAIN_PLAINS, true, true, &[], 7);

        // Plains (10) + Water (20) + River (15) = 45 total bonus
        assert!((full_bonus_score - base_score - 35.0).abs() < 1.0);
    }

    #[test]
    fn test_distance_penalty() {
        let coord = HexCoord::new(0, 0);
        let existing = HexCoord::new(3, 0); // Distance 3
        let min_spacing = 7;

        let without_existing =
            score_settlement_tile(42, &coord, TERRAIN_PLAINS, false, false, &[], min_spacing);

        let with_existing = score_settlement_tile(
            42,
            &coord,
            TERRAIN_PLAINS,
            false,
            false,
            &[existing],
            min_spacing,
        );

        // Penalty should be (7 - 3) = 4 points
        assert!((without_existing - with_existing - 4.0).abs() < 1.0);
    }

    #[test]
    fn test_invalid_terrains() {
        let coord = HexCoord::new(0, 0);

        // Water should get negative infinity
        let water_score = score_settlement_tile(42, &coord, TERRAIN_WATER, false, false, &[], 7);
        assert_eq!(water_score, f64::NEG_INFINITY);

        // Snow should get negative infinity
        let snow_score = score_settlement_tile(42, &coord, TERRAIN_SNOW, false, false, &[], 7);
        assert_eq!(snow_score, f64::NEG_INFINITY);
    }

    #[test]
    fn test_settlement_kind() {
        // First settlement with high score -> city
        assert_eq!(settlement_kind(0, 8.0), SettlementKind::City);

        // First settlement with medium score -> not city
        assert_eq!(settlement_kind(0, 5.0), SettlementKind::Village);

        // Second settlement with high score -> town
        assert_eq!(settlement_kind(1, 7.0), SettlementKind::Town);

        // Any settlement with score >= 6 -> town
        assert_eq!(settlement_kind(5, 6.5), SettlementKind::Town);

        // Low score -> village
        assert_eq!(settlement_kind(3, 4.0), SettlementKind::Village);
    }

    #[test]
    fn test_settlement_radius() {
        assert_eq!(SettlementKind::City.radius(), 4);
        assert_eq!(SettlementKind::Town.radius(), 3);
        assert_eq!(SettlementKind::Village.radius(), 2);
    }

    #[test]
    fn test_place_settlements_empty_input() {
        let result = place_settlements(42, 5, &[], &[], &[], &[], 7);
        assert!(result.is_empty());
    }

    #[test]
    fn test_place_settlements_zero_count() {
        let coords = vec![HexCoord::new(0, 0)];
        let terrain_kinds = vec![TERRAIN_PLAINS];
        let has_water_access = vec![false];
        let has_river = vec![false];

        let result = place_settlements(
            42,
            0,
            &coords,
            &terrain_kinds,
            &has_water_access,
            &has_river,
            7,
        );
        assert!(result.is_empty());
    }

    #[test]
    fn test_place_settlements_all_water() {
        let coords = vec![
            HexCoord::new(0, 0),
            HexCoord::new(1, 0),
            HexCoord::new(2, 0),
        ];
        let terrain_kinds = vec![TERRAIN_WATER, TERRAIN_WATER, TERRAIN_WATER];
        let has_water_access = vec![false, false, false];
        let has_river = vec![false, false, false];

        let result = place_settlements(
            42,
            3,
            &coords,
            &terrain_kinds,
            &has_water_access,
            &has_river,
            7,
        );
        assert!(result.is_empty());
    }

    #[test]
    fn test_place_settlements_basic() {
        let coords = vec![
            HexCoord::new(0, 0),
            HexCoord::new(10, 0),
            HexCoord::new(20, 0),
        ];
        let terrain_kinds = vec![TERRAIN_PLAINS, TERRAIN_FOREST, TERRAIN_PLAINS];
        let has_water_access = vec![true, false, false];
        let has_river = vec![false, true, false];

        let result = place_settlements(
            42,
            3,
            &coords,
            &terrain_kinds,
            &has_water_access,
            &has_river,
            7,
        );

        assert_eq!(result.len(), 3);
        // First should be (0,0) with water access (highest score)
        assert_eq!(result[0].coord, HexCoord::new(0, 0));
        // Second should be (10,0) with river
        assert_eq!(result[1].coord, HexCoord::new(10, 0));
        // Third should be (20,0) plain
        assert_eq!(result[2].coord, HexCoord::new(20, 0));
    }

    #[test]
    fn test_place_settlements_spacing() {
        let coords = vec![
            HexCoord::new(0, 0),
            HexCoord::new(3, 0),  // Too close to (0,0) with min_spacing=7
            HexCoord::new(15, 0), // Far enough
        ];
        let terrain_kinds = vec![TERRAIN_PLAINS, TERRAIN_PLAINS, TERRAIN_PLAINS];
        let has_water_access = vec![true, true, false];
        let has_river = vec![false, false, false];

        let result = place_settlements(
            42,
            3,
            &coords,
            &terrain_kinds,
            &has_water_access,
            &has_river,
            7,
        );

        // Should only place 2 settlements due to spacing
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].coord, HexCoord::new(0, 0));
        assert_eq!(result[1].coord, HexCoord::new(15, 0));
    }

    #[test]
    fn test_place_settlements_mismatched_arrays() {
        let coords = vec![HexCoord::new(0, 0)];
        let terrain_kinds = vec![TERRAIN_PLAINS, TERRAIN_FOREST]; // Wrong length
        let has_water_access = vec![false];
        let has_river = vec![false];

        let result = place_settlements(
            42,
            1,
            &coords,
            &terrain_kinds,
            &has_water_access,
            &has_river,
            7,
        );
        assert!(result.is_empty());
    }

    #[test]
    fn test_deterministic_scoring() {
        let coord = HexCoord::new(0, 0);

        let score1 = score_settlement_tile(42, &coord, TERRAIN_PLAINS, false, false, &[], 7);

        let score2 = score_settlement_tile(42, &coord, TERRAIN_PLAINS, false, false, &[], 7);

        // Same seed and coord should produce same score
        assert_eq!(score1, score2);
    }

    #[test]
    fn test_different_seeds_produce_different_scores() {
        let coord = HexCoord::new(0, 0);

        let score1 = score_settlement_tile(42, &coord, TERRAIN_PLAINS, false, false, &[], 7);

        let score2 = score_settlement_tile(123, &coord, TERRAIN_PLAINS, false, false, &[], 7);

        // Different seeds should produce different scores (due to random jitter)
        assert_ne!(score1, score2);
    }

    #[test]
    fn test_multiple_existing_settlements() {
        let coord = HexCoord::new(0, 0);
        let existing = vec![
            HexCoord::new(3, 0), // Distance 3
            HexCoord::new(0, 3), // Distance 3
        ];
        let min_spacing = 7;

        let score = score_settlement_tile(
            42,
            &coord,
            TERRAIN_PLAINS,
            false,
            false,
            &existing,
            min_spacing,
        );

        // Penalty should be (7-3) + (7-3) = 8 points total
        let expected_score = 10.0 - 8.0; // Plains base - penalties
        assert!((score - expected_score).abs() < 1.0);
    }

    #[test]
    fn test_concrete_terrain_neutral() {
        let coord = HexCoord::new(0, 0);

        let concrete_score =
            score_settlement_tile(42, &coord, TERRAIN_CONCRETE, false, false, &[], 7);

        // Concrete should have neutral base score (0), plus random jitter
        assert!(concrete_score >= 0.0 && concrete_score < 1.0);
    }
}
