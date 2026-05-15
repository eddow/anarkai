//! Population generation module
//!
//! Handles the placement of characters on the game board during initialization.

use crate::common::HexCoord;
use std::collections::HashSet;

/// Generates positions for characters on the game board
///
/// This function determines where to place characters based on terrain and distance
/// from a central origin point. It follows a deterministic algorithm that:
/// 1. Filters out water tiles (terrain_kind == 0)
/// 2. Filters tiles outside the specified radius range
/// 3. Sorts eligible tiles by distance to origin (ascending)
/// 4. Selects up to character_count tiles for character placement
///
/// # Arguments
/// * `seed` - Random seed for deterministic generation (currently unused but reserved for future use)
/// * `character_count` - Maximum number of character positions to generate
/// * `coords` - Slice of all hex coordinates on the board
/// * `terrain_kinds` - Slice of terrain kinds corresponding to each coordinate (0 = water)
/// * `min_radius` - Minimum distance from origin for character placement
/// * `max_radius` - Maximum distance from origin for character placement
/// * `origin` - Central origin coordinate for distance calculations
///
/// # Returns
/// A vector of HexCoord positions where characters should be placed
///
/// # Panics
/// Panics if coords and terrain_kinds have different lengths
pub fn generate_character_positions(
    seed: u32,
    character_count: u32,
    coords: &[HexCoord],
    terrain_kinds: &[u8],
    min_radius: i32,
    max_radius: i32,
    origin: HexCoord,
) -> Vec<HexCoord> {
    assert_eq!(
        coords.len(),
        terrain_kinds.len(),
        "coords and terrain_kinds must have the same length"
    );

    // Filter eligible tiles: not water AND within radius range
    let mut eligible: Vec<(HexCoord, i32)> = coords
        .iter()
        .zip(terrain_kinds.iter())
        .filter(|(coord, terrain_kind)| {
            // Filter out water tiles (terrain_kind == 0)
            if **terrain_kind == 0 {
                return false;
            }

            // Filter tiles outside the radius range
            let distance = coord.distance(&origin);
            distance >= min_radius && distance <= max_radius
        })
        .map(|(coord, _)| {
            let distance = coord.distance(&origin);
            (*coord, distance)
        })
        .collect();

    // Sort eligible tiles by distance to origin (ascending)
    eligible.sort_by_key(|(_, distance)| *distance);

    // Collect up to character_count positions
    let max_count = character_count as usize;
    let result: Vec<HexCoord> = eligible
        .into_iter()
        .take(max_count)
        .map(|(coord, _)| coord)
        .collect();

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn population_determinism_matches_typescript() {
        // Test case 1: Basic scenario with mixed terrain
        let coords = vec![
            HexCoord::new(0, 0),  // origin, distance 0
            HexCoord::new(1, 0),  // grass, distance 1
            HexCoord::new(0, 1),  // grass, distance 1
            HexCoord::new(2, 0),  // water (excluded)
            HexCoord::new(1, 1),  // grass, distance 2
            HexCoord::new(-1, 0), // grass, distance 1
            HexCoord::new(0, -1), // forest, distance 1
            HexCoord::new(3, 0),  // water (excluded)
            HexCoord::new(2, 1),  // sand, distance 3
            HexCoord::new(-2, 0), // rocky, distance 2
        ];
        let terrain_kinds = vec![1, 1, 1, 0, 1, 1, 2, 0, 3, 4]; // grass, grass, grass, water, grass, grass, forest, water, sand, rocky
        let min_radius = 1;
        let max_radius = 2;
        let origin = HexCoord::new(0, 0);
        let character_count = 3;

        let result = generate_character_positions(
            42,
            character_count,
            &coords,
            &terrain_kinds,
            min_radius,
            max_radius,
            origin,
        );

        // Should pick the 3 closest non-water tiles within radius range
        assert_eq!(result.len(), 3);
        // Verify they're the expected coords (sorted by distance)
        assert_eq!(result[0], HexCoord::new(1, 0));
        assert_eq!(result[1], HexCoord::new(0, 1));
        assert_eq!(result[2], HexCoord::new(-1, 0));
    }

    #[test]
    fn population_determinism_with_different_terrain_types() {
        // Test with all terrain types except water
        let coords = vec![
            HexCoord::new(1, 0),  // grass
            HexCoord::new(0, 1),  // forest
            HexCoord::new(-1, 0), // sand
            HexCoord::new(0, -1), // rocky
            HexCoord::new(2, 0),  // snow
            HexCoord::new(1, 1),  // concrete
            HexCoord::new(-2, 0), // grass (farther)
        ];
        let terrain_kinds = vec![1, 2, 3, 4, 5, 6, 1];
        let min_radius = 0;
        let max_radius = 5;
        let origin = HexCoord::new(0, 0);
        let character_count = 5;

        let result = generate_character_positions(
            123,
            character_count,
            &coords,
            &terrain_kinds,
            min_radius,
            max_radius,
            origin,
        );

        // Should pick the 5 closest tiles (all at distance 1)
        assert_eq!(result.len(), 5);
        assert_eq!(result[0], HexCoord::new(1, 0));
        assert_eq!(result[1], HexCoord::new(0, 1));
        assert_eq!(result[2], HexCoord::new(-1, 0));
        assert_eq!(result[3], HexCoord::new(0, -1));
        assert_eq!(result[4], HexCoord::new(2, 0));
    }

    #[test]
    fn population_empty_coords() {
        // Test empty input
        let result = generate_character_positions(42, 5, &[], &[], 0, 10, HexCoord::new(0, 0));
        assert_eq!(result.len(), 0);
    }

    #[test]
    fn population_zero_character_count() {
        let coords = vec![HexCoord::new(1, 0), HexCoord::new(0, 1)];
        let terrain_kinds = vec![1, 1];
        let result = generate_character_positions(
            42,
            0,
            &coords,
            &terrain_kinds,
            0,
            10,
            HexCoord::new(0, 0),
        );
        assert_eq!(result.len(), 0);
    }

    #[test]
    fn population_all_water_tiles() {
        let coords = vec![
            HexCoord::new(0, 0),
            HexCoord::new(1, 0),
            HexCoord::new(0, 1),
        ];
        let terrain_kinds = vec![0, 0, 0]; // all water
        let result = generate_character_positions(
            42,
            2,
            &coords,
            &terrain_kinds,
            0,
            10,
            HexCoord::new(0, 0),
        );
        assert_eq!(result.len(), 0);
    }

    #[test]
    fn population_no_eligible_tiles_outside_radius() {
        let coords = vec![
            HexCoord::new(0, 0), // origin, distance 0
            HexCoord::new(1, 0), // grass, distance 1
            HexCoord::new(2, 0), // grass, distance 2
            HexCoord::new(3, 0), // grass, distance 3
        ];
        let terrain_kinds = vec![1, 1, 1, 1];
        let min_radius = 4; // All tiles are closer than min_radius
        let max_radius = 10;
        let origin = HexCoord::new(0, 0);
        let character_count = 2;

        let result = generate_character_positions(
            42,
            character_count,
            &coords,
            &terrain_kinds,
            min_radius,
            max_radius,
            origin,
        );

        // No tiles within the radius range
        assert_eq!(result.len(), 0);
    }

    #[test]
    fn population_no_eligible_tiles_inside_radius() {
        let coords = vec![
            HexCoord::new(0, 0), // origin, distance 0
            HexCoord::new(1, 0), // grass, distance 1
            HexCoord::new(2, 0), // grass, distance 2
            HexCoord::new(3, 0), // grass, distance 3
        ];
        let terrain_kinds = vec![1, 1, 1, 1];
        let min_radius = 0;
        let max_radius = 0; // Only tiles at distance 0
        let origin = HexCoord::new(0, 0);
        let character_count = 2;

        let result = generate_character_positions(
            42,
            character_count,
            &coords,
            &terrain_kinds,
            min_radius,
            max_radius,
            origin,
        );

        // Only origin is at distance 0
        assert_eq!(result.len(), 1);
        assert_eq!(result[0], HexCoord::new(0, 0));
    }

    #[test]
    fn population_more_requested_than_eligible() {
        let coords = vec![
            HexCoord::new(1, 0),  // grass, distance 1
            HexCoord::new(0, 1),  // grass, distance 1
            HexCoord::new(-1, 0), // grass, distance 1
        ];
        let terrain_kinds = vec![1, 1, 1];
        let min_radius = 0;
        let max_radius = 10;
        let origin = HexCoord::new(0, 0);
        let character_count = 10; // More than available

        let result = generate_character_positions(
            42,
            character_count,
            &coords,
            &terrain_kinds,
            min_radius,
            max_radius,
            origin,
        );

        // Should return all eligible tiles
        assert_eq!(result.len(), 3);
    }

    #[test]
    fn population_determinism_same_seed_same_result() {
        let coords = vec![
            HexCoord::new(1, 0),
            HexCoord::new(0, 1),
            HexCoord::new(-1, 0),
            HexCoord::new(0, -1),
            HexCoord::new(2, 0),
            HexCoord::new(1, 1),
        ];
        let terrain_kinds = vec![1, 1, 1, 1, 1, 1];
        let min_radius = 0;
        let max_radius = 10;
        let origin = HexCoord::new(0, 0);
        let character_count = 3;

        let result1 = generate_character_positions(
            42,
            character_count,
            &coords,
            &terrain_kinds,
            min_radius,
            max_radius,
            origin,
        );

        let result2 = generate_character_positions(
            42,
            character_count,
            &coords,
            &terrain_kinds,
            min_radius,
            max_radius,
            origin,
        );

        // Same inputs should produce same outputs
        assert_eq!(result1, result2);
    }

    #[test]
    fn population_determinism_different_seed_same_result() {
        // Note: The current implementation doesn't use the seed for randomness,
        // so different seeds should produce the same result
        let coords = vec![
            HexCoord::new(1, 0),
            HexCoord::new(0, 1),
            HexCoord::new(-1, 0),
            HexCoord::new(0, -1),
        ];
        let terrain_kinds = vec![1, 1, 1, 1];
        let min_radius = 0;
        let max_radius = 10;
        let origin = HexCoord::new(0, 0);
        let character_count = 2;

        let result1 = generate_character_positions(
            42,
            character_count,
            &coords,
            &terrain_kinds,
            min_radius,
            max_radius,
            origin,
        );

        let result2 = generate_character_positions(
            999,
            character_count,
            &coords,
            &terrain_kinds,
            min_radius,
            max_radius,
            origin,
        );

        // Different seeds should produce same result (no randomness currently)
        assert_eq!(result1, result2);
    }

    #[test]
    fn population_excludes_origin_when_min_radius_greater_than_zero() {
        let coords = vec![
            HexCoord::new(0, 0),  // origin
            HexCoord::new(1, 0),  // distance 1
            HexCoord::new(0, 1),  // distance 1
            HexCoord::new(-1, 0), // distance 1
        ];
        let terrain_kinds = vec![1, 1, 1, 1];
        let min_radius = 1; // Exclude origin
        let max_radius = 10;
        let origin = HexCoord::new(0, 0);
        let character_count = 5;

        let result = generate_character_positions(
            42,
            character_count,
            &coords,
            &terrain_kinds,
            min_radius,
            max_radius,
            origin,
        );

        // Origin should not be in results
        assert!(!result.contains(&HexCoord::new(0, 0)));
        assert_eq!(result.len(), 3);
    }

    #[test]
    fn population_mixed_water_and_land() {
        let coords = vec![
            HexCoord::new(0, 0),  // water
            HexCoord::new(1, 0),  // grass
            HexCoord::new(0, 1),  // water
            HexCoord::new(-1, 0), // forest
            HexCoord::new(0, -1), // water
            HexCoord::new(2, 0),  // grass
        ];
        let terrain_kinds = vec![0, 1, 0, 2, 0, 1];
        let min_radius = 0;
        let max_radius = 10;
        let origin = HexCoord::new(0, 0);
        let character_count = 10;

        let result = generate_character_positions(
            42,
            character_count,
            &coords,
            &terrain_kinds,
            min_radius,
            max_radius,
            origin,
        );

        // Should only return non-water tiles
        assert_eq!(result.len(), 3);
        assert!(result.contains(&HexCoord::new(1, 0)));
        assert!(result.contains(&HexCoord::new(-1, 0)));
        assert!(result.contains(&HexCoord::new(2, 0)));
    }

    #[test]
    fn population_exact_radius_boundary() {
        let coords = vec![
            HexCoord::new(0, 0), // distance 0
            HexCoord::new(1, 0), // distance 1
            HexCoord::new(2, 0), // distance 2
            HexCoord::new(3, 0), // distance 3
            HexCoord::new(4, 0), // distance 4
        ];
        let terrain_kinds = vec![1, 1, 1, 1, 1];
        let min_radius = 2;
        let max_radius = 3;
        let origin = HexCoord::new(0, 0);
        let character_count = 10;

        let result = generate_character_positions(
            42,
            character_count,
            &coords,
            &terrain_kinds,
            min_radius,
            max_radius,
            origin,
        );

        // Should only include tiles at distance 2 and 3
        assert_eq!(result.len(), 2);
        assert!(result.contains(&HexCoord::new(2, 0)));
        assert!(result.contains(&HexCoord::new(3, 0)));
    }
}
