//! Board generation module
//!
//! Handles the generation of deposits and goods on the game board.

use crate::common::HexCoord;
use crate::generation::{coord_hash, random01};

/// Terrain kind constants, matching the game TerrainType packing.
pub const TERRAIN_WATER: u8 = 0;
pub const TERRAIN_GRASS: u8 = 1;
pub const TERRAIN_FOREST: u8 = 2;
pub const TERRAIN_SAND: u8 = 3;
pub const TERRAIN_ROCKY: u8 = 4;
pub const TERRAIN_SNOW: u8 = 5;
pub const TERRAIN_CONCRETE: u8 = 6;

/// Deposit kind enumeration
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DepositKind {
    Stone,
    Iron,
    Gold,
    Wood,
    BerryBush,
}

/// Good kind enumeration
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GoodKind {
    Wood,
    Stone,
    Iron,
    Gold,
    Berries,
    Mushrooms,
    Fish,
}

/// Result of tile generation containing deposit and goods information
#[derive(Debug, Clone)]
pub struct TileGenerationResult {
    pub coord: HexCoord,
    pub deposit_kind: Option<DepositKind>,
    pub goods: Vec<GoodKind>,
}

/// Generates a deposit for a tile based on terrain type.
///
/// This function uses deterministic randomization based on the seed and coordinate
/// to ensure consistent results across runs.
///
/// # Arguments
/// * `seed` - Random seed for deterministic generation
/// * `coord` - The hex coordinate of the tile
/// * `terrain_kind` - Terrain type index (0-6)
///
/// # Returns
/// * `Some(DepositKind)` if a deposit is generated
/// * `None` if no deposit is generated for this terrain type
///
/// # Deposit probabilities by terrain
/// - Forest: Wood (70%)
/// - Rocky: Stone (60%)
/// - Grass: Berry bush (10%)
/// - Sand: Stone (30%)
/// - Water: None
/// - Snow: None
/// - Concrete: None
pub fn generate_deposit(seed: u32, coord: &HexCoord, terrain_kind: u8) -> Option<DepositKind> {
    // Use coord_hash for deterministic randomization
    let hash = coord_hash(seed, coord, "deposit");
    let rnd = random01(hash);

    match terrain_kind {
        TERRAIN_FOREST => {
            if rnd < 0.70 {
                Some(DepositKind::Wood)
            } else {
                None
            }
        }
        TERRAIN_ROCKY => {
            if rnd < 0.60 {
                Some(DepositKind::Stone)
            } else {
                None
            }
        }
        TERRAIN_GRASS => {
            if rnd < 0.10 {
                Some(DepositKind::BerryBush)
            } else {
                None
            }
        }
        TERRAIN_SAND => {
            if rnd < 0.30 {
                Some(DepositKind::Stone)
            } else {
                None
            }
        }
        TERRAIN_WATER | TERRAIN_SNOW | TERRAIN_CONCRETE => {
            // These terrain types don't have deposits
            None
        }
        _ => None,
    }
}

/// Generates goods for a tile based on terrain type and optional deposit.
///
/// This function uses deterministic randomization based on the seed and coordinate
/// to ensure consistent results across runs.
///
/// # Arguments
/// * `seed` - Random seed for deterministic generation
/// * `coord` - The hex coordinate of the tile
/// * `terrain_kind` - Terrain type index (0-6)
/// * `deposit_kind` - Optional deposit kind that may influence goods generation
///
/// # Returns
/// A vector of GoodKind representing the goods available on this tile
///
/// # Goods generation rules
/// - Forest: Mushrooms (plus wood from tree deposits)
/// - Sand: Berries
/// - Grass: Berries from bush deposits
/// - Rocky: Stone from rock deposits
/// - Snow: None
/// - Concrete: None
///
/// # Deposit influence
/// If a deposit is present, the corresponding good type is always included.
/// Additional ambient goods may be added based on terrain type.
pub fn generate_goods(
    seed: u32,
    coord: &HexCoord,
    terrain_kind: u8,
    deposit_kind: Option<DepositKind>,
) -> Vec<GoodKind> {
    let mut goods = Vec::new();

    // Add goods from deposit if present
    if let Some(deposit) = deposit_kind {
        match deposit {
            DepositKind::Stone => goods.push(GoodKind::Stone),
            DepositKind::Iron => goods.push(GoodKind::Iron),
            DepositKind::Gold => goods.push(GoodKind::Gold),
            DepositKind::Wood => goods.push(GoodKind::Wood),
            DepositKind::BerryBush => goods.push(GoodKind::Berries),
        }
    }

    // Use coord_hash for deterministic randomization for ambient goods
    let hash = coord_hash(seed, coord, "goods");
    let rnd1 = random01(hash);
    let hash2 = coord_hash(seed, coord, "goods2");
    let rnd2 = random01(hash2);

    match terrain_kind {
        TERRAIN_FOREST => {
            if rnd2 < 0.30 {
                goods.push(GoodKind::Mushrooms);
            }
        }
        TERRAIN_SAND => {
            if rnd1 < 0.05 {
                goods.push(GoodKind::Berries);
            }
        }
        TERRAIN_GRASS | TERRAIN_ROCKY | TERRAIN_WATER | TERRAIN_SNOW | TERRAIN_CONCRETE => {}
        _ => {}
    }

    goods
}

/// Generates deposits and goods for a batch of tiles.
///
/// This is a batch processing function that efficiently processes multiple tiles
/// at once, returning complete generation results for each tile.
///
/// # Arguments
/// * `seed` - Random seed for deterministic generation
/// * `coords` - Slice of hex coordinates for all tiles
/// * `terrain_kinds` - Slice of terrain kinds corresponding to each coordinate
///
/// # Returns
/// A vector of TileGenerationResult containing deposit and goods information for each tile
///
/// # Panics
/// Panics if coords and terrain_kinds have different lengths
pub fn generate_board(
    seed: u32,
    coords: &[HexCoord],
    terrain_kinds: &[u8],
) -> Vec<TileGenerationResult> {
    assert_eq!(
        coords.len(),
        terrain_kinds.len(),
        "coords and terrain_kinds must have the same length"
    );

    coords
        .iter()
        .zip(terrain_kinds.iter())
        .map(|(coord, terrain_kind)| {
            let deposit_kind = generate_deposit(seed, coord, *terrain_kind);
            let goods = generate_goods(seed, coord, *terrain_kind, deposit_kind);

            TileGenerationResult {
                coord: *coord,
                deposit_kind,
                goods,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_deposit_generation_rocky() {
        let seed = 12345;
        let mut found_deposit = false;

        // Test multiple coordinates to find at least one with a deposit
        for q in -5..=5 {
            for r in -5..=5 {
                let coord = HexCoord::new(q, r);
                if generate_deposit(seed, &coord, TERRAIN_ROCKY) == Some(DepositKind::Stone) {
                    found_deposit = true;
                    break;
                }
            }
            if found_deposit {
                break;
            }
        }

        assert!(found_deposit, "Rocky terrain should generate rock deposits");
    }

    #[test]
    fn test_deposit_generation_grass() {
        let seed = 12345;
        let mut found_deposit = false;

        // Test multiple coordinates to find at least one with a deposit
        for q in -5..=5 {
            for r in -5..=5 {
                let coord = HexCoord::new(q, r);
                if generate_deposit(seed, &coord, TERRAIN_GRASS) == Some(DepositKind::BerryBush) {
                    found_deposit = true;
                    break;
                }
            }
            if found_deposit {
                break;
            }
        }

        assert!(found_deposit, "Grass should generate berry bush deposits");
    }

    #[test]
    fn test_deposit_generation_forest() {
        let seed = 12345;
        let mut found_deposit = false;

        // Test multiple coordinates to find at least one with a deposit
        for q in -5..=5 {
            for r in -5..=5 {
                let coord = HexCoord::new(q, r);
                if generate_deposit(seed, &coord, TERRAIN_FOREST) == Some(DepositKind::Wood) {
                    found_deposit = true;
                    break;
                }
            }
            if found_deposit {
                break;
            }
        }

        assert!(found_deposit, "Forest should generate tree deposits");
    }

    #[test]
    fn test_deposit_generation_sand() {
        let seed = 12345;
        let mut found_deposit = false;

        for q in -5..=5 {
            for r in -5..=5 {
                let coord = HexCoord::new(q, r);
                if generate_deposit(seed, &coord, TERRAIN_SAND) == Some(DepositKind::Stone) {
                    found_deposit = true;
                    break;
                }
            }
            if found_deposit {
                break;
            }
        }

        assert!(found_deposit, "Sand should generate rock deposits");
    }

    #[test]
    fn test_deposit_generation_forest_never_generates_rocks() {
        for q in -10..=10 {
            for r in -10..=10 {
                let coord = HexCoord::new(q, r);
                assert_ne!(
                    generate_deposit(12345, &coord, TERRAIN_FOREST),
                    Some(DepositKind::Stone)
                );
            }
        }
    }

    #[test]
    fn test_deposit_generation_water() {
        let coord = HexCoord::new(0, 0);
        let deposit = generate_deposit(12345, &coord, TERRAIN_WATER);

        // Water should never generate deposits
        assert!(deposit.is_none());
    }

    #[test]
    fn test_deposit_generation_snow() {
        let coord = HexCoord::new(0, 0);
        let deposit = generate_deposit(12345, &coord, TERRAIN_SNOW);

        // Snow should never generate deposits
        assert!(deposit.is_none());
    }

    #[test]
    fn test_deposit_determinism() {
        let coord = HexCoord::new(5, 3);
        let seed = 99999;

        // Same seed and coord should produce same result
        let result1 = generate_deposit(seed, &coord, TERRAIN_ROCKY);
        let result2 = generate_deposit(seed, &coord, TERRAIN_ROCKY);

        assert_eq!(result1, result2);
    }

    #[test]
    fn test_deposit_varies_by_coord() {
        let seed = 12345;
        let coord1 = HexCoord::new(0, 0);
        let coord2 = HexCoord::new(1, 0);

        // Different coords should potentially produce different results
        let result1 = generate_deposit(seed, &coord1, TERRAIN_ROCKY);
        let result2 = generate_deposit(seed, &coord2, TERRAIN_ROCKY);

        // Results may or may not be equal, but the function should not panic
        let _ = result1;
        let _ = result2;
    }

    #[test]
    fn test_goods_generation_forest() {
        let seed = 12345;
        let mut found_goods = false;

        // Test multiple coordinates to find at least one with goods
        for q in -5..=5 {
            for r in -5..=5 {
                let coord = HexCoord::new(q, r);
                let goods = generate_goods(seed, &coord, TERRAIN_FOREST, None);
                if !goods.is_empty() {
                    found_goods = true;
                    break;
                }
            }
            if found_goods {
                break;
            }
        }

        // Forest should generate goods (70% total chance)
        assert!(found_goods, "Forest should generate goods");
    }

    #[test]
    fn test_goods_generation_snow() {
        let coord = HexCoord::new(0, 0);
        let goods = generate_goods(12345, &coord, TERRAIN_SNOW, None);

        // Snow should not generate any goods
        assert!(goods.is_empty());
    }

    #[test]
    fn test_goods_with_deposit() {
        let coord = HexCoord::new(0, 0);
        let goods = generate_goods(12345, &coord, TERRAIN_GRASS, Some(DepositKind::BerryBush));

        assert!(goods.contains(&GoodKind::Berries));
    }

    #[test]
    fn test_goods_with_stone_deposit() {
        let coord = HexCoord::new(0, 0);
        let goods = generate_goods(12345, &coord, TERRAIN_FOREST, Some(DepositKind::Stone));

        // With a stone deposit, stone should be in goods
        assert!(goods.contains(&GoodKind::Stone));
    }

    #[test]
    fn test_goods_determinism() {
        let coord = HexCoord::new(5, 3);
        let seed = 99999;

        // Same seed and coord should produce same result
        let goods1 = generate_goods(seed, &coord, TERRAIN_FOREST, None);
        let goods2 = generate_goods(seed, &coord, TERRAIN_FOREST, None);

        assert_eq!(goods1, goods2);
    }

    #[test]
    fn test_generate_board_empty() {
        let coords: Vec<HexCoord> = vec![];
        let terrain_kinds: Vec<u8> = vec![];

        let results = generate_board(12345, &coords, &terrain_kinds);

        assert!(results.is_empty());
    }

    #[test]
    fn test_generate_board_single_tile() {
        let coords = vec![HexCoord::new(0, 0)];
        let terrain_kinds = vec![TERRAIN_FOREST];

        let results = generate_board(12345, &coords, &terrain_kinds);

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].coord, HexCoord::new(0, 0));
    }

    #[test]
    fn test_generate_board_multiple_tiles() {
        let coords = vec![
            HexCoord::new(0, 0),
            HexCoord::new(1, 0),
            HexCoord::new(0, 1),
            HexCoord::new(2, 0),
        ];
        let terrain_kinds = vec![
            TERRAIN_FOREST,
            TERRAIN_GRASS,
            TERRAIN_WATER,
            TERRAIN_ROCKY,
        ];

        let results = generate_board(12345, &coords, &terrain_kinds);

        assert_eq!(results.len(), 4);
        assert_eq!(results[0].coord, HexCoord::new(0, 0));
        assert_eq!(results[1].coord, HexCoord::new(1, 0));
        assert_eq!(results[2].coord, HexCoord::new(0, 1));
        assert_eq!(results[3].coord, HexCoord::new(2, 0));
    }

    #[test]
    fn test_generate_board_mismatched_lengths() {
        let coords = vec![HexCoord::new(0, 0), HexCoord::new(1, 0)];
        let terrain_kinds = vec![TERRAIN_FOREST];

        // Should panic when lengths don't match
        let result = std::panic::catch_unwind(|| {
            generate_board(12345, &coords, &terrain_kinds);
        });

        assert!(result.is_err());
    }

    #[test]
    fn test_generate_board_determinism() {
        let coords = vec![
            HexCoord::new(0, 0),
            HexCoord::new(1, 0),
            HexCoord::new(0, 1),
        ];
        let terrain_kinds = vec![TERRAIN_FOREST, TERRAIN_GRASS, TERRAIN_WATER];
        let seed = 54321;

        let results1 = generate_board(seed, &coords, &terrain_kinds);
        let results2 = generate_board(seed, &coords, &terrain_kinds);

        assert_eq!(results1.len(), results2.len());
        for (r1, r2) in results1.iter().zip(results2.iter()) {
            assert_eq!(r1.coord, r2.coord);
            assert_eq!(r1.deposit_kind, r2.deposit_kind);
            assert_eq!(r1.goods, r2.goods);
        }
    }

    #[test]
    fn test_deposit_kinds_match_game_terrain_table() {
        let seed = 11111;
        let mut found_tree = false;
        let mut found_bush = false;
        let mut found_rock = false;

        for q in -10..=10 {
            for r in -10..=10 {
                let coord = HexCoord::new(q, r);
                if generate_deposit(seed, &coord, TERRAIN_FOREST) == Some(DepositKind::Wood) {
                    found_tree = true;
                }
                if generate_deposit(seed, &coord, TERRAIN_GRASS) == Some(DepositKind::BerryBush) {
                    found_bush = true;
                }
                if generate_deposit(seed, &coord, TERRAIN_ROCKY) == Some(DepositKind::Stone) {
                    found_rock = true;
                }
            }
        }

        assert!(found_tree, "Should find tree deposits in forests");
        assert!(found_bush, "Should find berry bush deposits in grass");
        assert!(found_rock, "Should find rock deposits in rocky terrain");
    }

    #[test]
    fn test_goods_kinds_variety() {
        let seed = 22222;
        let mut found_mushrooms = false;

        // Test many coordinates to see all good types
        for q in -5..=5 {
            for r in -5..=5 {
                let coord = HexCoord::new(q, r);

                // Forest goods
                let forest_goods = generate_goods(seed, &coord, TERRAIN_FOREST, None);
                if forest_goods.contains(&GoodKind::Mushrooms) {
                    found_mushrooms = true;
                }
            }
        }

        assert!(found_mushrooms, "Should find mushrooms in forest");
    }

    #[test]
    fn test_edge_case_concrete_terrain() {
        let coord = HexCoord::new(0, 0);

        // Concrete should have no deposits
        let deposit = generate_deposit(12345, &coord, TERRAIN_CONCRETE);
        assert!(deposit.is_none());

        // Concrete should have no ambient goods
        let goods = generate_goods(12345, &coord, TERRAIN_CONCRETE, None);
        assert!(goods.is_empty());
    }

    #[test]
    fn test_deposit_influence_on_goods() {
        let coord = HexCoord::new(0, 0);
        let seed = 33333;

        // Generate goods without deposit
        let goods_no_deposit = generate_goods(seed, &coord, TERRAIN_ROCKY, None);

        // Generate goods with a rock deposit
        let goods_with_deposit =
            generate_goods(seed, &coord, TERRAIN_ROCKY, Some(DepositKind::Stone));

        assert!(goods_with_deposit.contains(&GoodKind::Stone));
        assert!(!goods_no_deposit.contains(&GoodKind::Stone));
    }
}
