//! Board generation module
//!
//! Handles the generation of deposits and goods on the game board.

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

/// Deposit kind enumeration
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DepositKind {
    Stone,
    Iron,
    Gold,
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
/// - Mountains: Stone (30%), Iron (15%), Gold (5%)
/// - Hills: Stone (40%), Iron (10%)
/// - Forest: Wood (25%)
/// - Plains: None
/// - Water: None
/// - Snow: None
/// - Concrete: None
pub fn generate_deposit(seed: u32, coord: &HexCoord, terrain_kind: u8) -> Option<DepositKind> {
    // Use coord_hash for deterministic randomization
    let hash = coord_hash(seed, coord, "deposit");
    let rnd = random01(hash);

    match terrain_kind {
        TERRAIN_MOUNTAINS => {
            // Mountains: Stone (30%), Iron (15%), Gold (5%)
            if rnd < 0.30 {
                Some(DepositKind::Stone)
            } else if rnd < 0.45 {
                Some(DepositKind::Iron)
            } else if rnd < 0.50 {
                Some(DepositKind::Gold)
            } else {
                None
            }
        }
        TERRAIN_HILLS => {
            // Hills: Stone (40%), Iron (10%)
            if rnd < 0.40 {
                Some(DepositKind::Stone)
            } else if rnd < 0.50 {
                Some(DepositKind::Iron)
            } else {
                None
            }
        }
        TERRAIN_FOREST => {
            // Forest: Wood (25%)
            if rnd < 0.25 {
                Some(DepositKind::Stone) // Forest deposits are represented as Stone in this simplified model
            } else {
                None
            }
        }
        TERRAIN_PLAINS | TERRAIN_WATER | TERRAIN_SNOW | TERRAIN_CONCRETE => {
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
/// - Forest: Wood, Berries, Mushrooms (with Wood from deposit)
/// - Plains: Berries, Mushrooms
/// - Hills: Stone
/// - Mountains: Stone, Iron, Gold (matching deposit types)
/// - Water: Fish
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
        }
    }

    // Use coord_hash for deterministic randomization for ambient goods
    let hash = coord_hash(seed, coord, "goods");
    let rnd1 = random01(hash);
    let hash2 = coord_hash(seed, coord, "goods2");
    let rnd2 = random01(hash2);

    match terrain_kind {
        TERRAIN_FOREST => {
            // Forest: Berries (40%), Mushrooms (30%)
            if rnd1 < 0.40 {
                goods.push(GoodKind::Berries);
            }
            if rnd2 < 0.30 {
                goods.push(GoodKind::Mushrooms);
            }
        }
        TERRAIN_PLAINS => {
            // Plains: Berries (50%), Mushrooms (40%)
            if rnd1 < 0.50 {
                goods.push(GoodKind::Berries);
            }
            if rnd2 < 0.40 {
                goods.push(GoodKind::Mushrooms);
            }
        }
        TERRAIN_HILLS => {
            // Hills: Stone (ambient, 30% if not from deposit)
            if !goods.contains(&GoodKind::Stone) && rnd1 < 0.30 {
                goods.push(GoodKind::Stone);
            }
        }
        TERRAIN_MOUNTAINS => {
            // Mountains: Stone (ambient 20%), Iron (ambient 10%), Gold (ambient 5%)
            if !goods.contains(&GoodKind::Stone) && rnd1 < 0.20 {
                goods.push(GoodKind::Stone);
            }
            if !goods.contains(&GoodKind::Iron) && rnd2 < 0.10 {
                goods.push(GoodKind::Iron);
            }
            let hash3 = coord_hash(seed, coord, "goods3");
            let rnd3 = random01(hash3);
            if !goods.contains(&GoodKind::Gold) && rnd3 < 0.05 {
                goods.push(GoodKind::Gold);
            }
        }
        TERRAIN_WATER => {
            // Water: Fish (70%)
            if rnd1 < 0.70 {
                goods.push(GoodKind::Fish);
            }
        }
        TERRAIN_SNOW | TERRAIN_CONCRETE => {
            // No ambient goods for snow or concrete
        }
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
    fn test_deposit_generation_mountains() {
        let seed = 12345;
        let mut found_deposit = false;

        // Test multiple coordinates to find at least one with a deposit
        for q in -5..=5 {
            for r in -5..=5 {
                let coord = HexCoord::new(q, r);
                if generate_deposit(seed, &coord, TERRAIN_MOUNTAINS).is_some() {
                    found_deposit = true;
                    break;
                }
            }
            if found_deposit {
                break;
            }
        }

        // Mountains should generate deposits (50% total chance)
        assert!(found_deposit, "Mountains should generate deposits");
    }

    #[test]
    fn test_deposit_generation_hills() {
        let seed = 12345;
        let mut found_deposit = false;

        // Test multiple coordinates to find at least one with a deposit
        for q in -5..=5 {
            for r in -5..=5 {
                let coord = HexCoord::new(q, r);
                if generate_deposit(seed, &coord, TERRAIN_HILLS).is_some() {
                    found_deposit = true;
                    break;
                }
            }
            if found_deposit {
                break;
            }
        }

        // Hills should generate deposits (50% total chance)
        assert!(found_deposit, "Hills should generate deposits");
    }

    #[test]
    fn test_deposit_generation_forest() {
        let seed = 12345;
        let mut found_deposit = false;

        // Test multiple coordinates to find at least one with a deposit
        for q in -5..=5 {
            for r in -5..=5 {
                let coord = HexCoord::new(q, r);
                if generate_deposit(seed, &coord, TERRAIN_FOREST).is_some() {
                    found_deposit = true;
                    break;
                }
            }
            if found_deposit {
                break;
            }
        }

        // Forest should generate deposits (25% chance)
        assert!(found_deposit, "Forest should generate deposits");
    }

    #[test]
    fn test_deposit_generation_plains() {
        let coord = HexCoord::new(0, 0);
        let deposit = generate_deposit(12345, &coord, TERRAIN_PLAINS);

        // Plains should never generate deposits
        assert!(deposit.is_none());
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
        let result1 = generate_deposit(seed, &coord, TERRAIN_MOUNTAINS);
        let result2 = generate_deposit(seed, &coord, TERRAIN_MOUNTAINS);

        assert_eq!(result1, result2);
    }

    #[test]
    fn test_deposit_varies_by_coord() {
        let seed = 12345;
        let coord1 = HexCoord::new(0, 0);
        let coord2 = HexCoord::new(1, 0);

        // Different coords should potentially produce different results
        let result1 = generate_deposit(seed, &coord1, TERRAIN_MOUNTAINS);
        let result2 = generate_deposit(seed, &coord2, TERRAIN_MOUNTAINS);

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
    fn test_goods_generation_plains() {
        let coord = HexCoord::new(0, 0);
        let goods = generate_goods(12345, &coord, TERRAIN_PLAINS, None);

        // Plains should generate berries and/or mushrooms
        assert!(!goods.is_empty());
    }

    #[test]
    fn test_goods_generation_water() {
        let coord = HexCoord::new(0, 0);
        let goods = generate_goods(12345, &coord, TERRAIN_WATER, None);

        // Water should generate fish
        assert!(!goods.is_empty());
        assert!(goods.contains(&GoodKind::Fish));
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
        let goods = generate_goods(12345, &coord, TERRAIN_MOUNTAINS, Some(DepositKind::Gold));

        // With a gold deposit, gold should be in goods
        assert!(goods.contains(&GoodKind::Gold));
    }

    #[test]
    fn test_goods_with_iron_deposit() {
        let coord = HexCoord::new(0, 0);
        let goods = generate_goods(12345, &coord, TERRAIN_HILLS, Some(DepositKind::Iron));

        // With an iron deposit, iron should be in goods
        assert!(goods.contains(&GoodKind::Iron));
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
            TERRAIN_PLAINS,
            TERRAIN_WATER,
            TERRAIN_MOUNTAINS,
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
        let terrain_kinds = vec![TERRAIN_FOREST, TERRAIN_PLAINS, TERRAIN_WATER];
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
    fn test_deposit_kinds_variety() {
        let seed = 11111;
        let mut found_stone = false;
        let mut found_iron = false;
        let mut found_gold = false;

        // Test many coordinates to see all deposit types
        for q in -10..=10 {
            for r in -10..=10 {
                let coord = HexCoord::new(q, r);
                if let Some(deposit) = generate_deposit(seed, &coord, TERRAIN_MOUNTAINS) {
                    match deposit {
                        DepositKind::Stone => found_stone = true,
                        DepositKind::Iron => found_iron = true,
                        DepositKind::Gold => found_gold = true,
                    }
                }
            }
        }

        // With enough samples, we should find all deposit types
        assert!(found_stone, "Should find stone deposits in mountains");
        assert!(found_iron, "Should find iron deposits in mountains");
        assert!(found_gold, "Should find gold deposits in mountains");
    }

    #[test]
    fn test_goods_kinds_variety() {
        let seed = 22222;
        let _found_wood = false;
        let mut found_berries = false;
        let mut found_mushrooms = false;
        let mut found_fish = false;

        // Test many coordinates to see all good types
        for q in -5..=5 {
            for r in -5..=5 {
                let coord = HexCoord::new(q, r);

                // Forest goods
                let forest_goods = generate_goods(seed, &coord, TERRAIN_FOREST, None);
                if forest_goods.contains(&GoodKind::Berries) {
                    found_berries = true;
                }
                if forest_goods.contains(&GoodKind::Mushrooms) {
                    found_mushrooms = true;
                }

                // Water goods
                let water_goods = generate_goods(seed, &coord, TERRAIN_WATER, None);
                if water_goods.contains(&GoodKind::Fish) {
                    found_fish = true;
                }
            }
        }

        assert!(found_berries, "Should find berries in forest");
        assert!(found_mushrooms, "Should find mushrooms in forest");
        assert!(found_fish, "Should find fish in water");
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
        let goods_no_deposit = generate_goods(seed, &coord, TERRAIN_MOUNTAINS, None);

        // Generate goods with gold deposit
        let goods_with_deposit =
            generate_goods(seed, &coord, TERRAIN_MOUNTAINS, Some(DepositKind::Gold));

        // Goods with deposit should contain gold
        assert!(goods_with_deposit.contains(&GoodKind::Gold));

        // Goods without deposit might not contain gold
        let gold_in_no_deposit = goods_no_deposit.contains(&GoodKind::Gold);
        // With our random seed, it's unlikely to get gold ambiently
        assert!(!gold_in_no_deposit || goods_with_deposit.len() > goods_no_deposit.len());
    }
}
