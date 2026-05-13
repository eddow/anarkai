#![allow(dead_code)]
use crate::common::HexCoord;
use crate::terrain::{BiomeHint, DrainageResult, Lake, TileField};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

/// Industry types for production suitability
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum IndustryType {
    Agriculture,
    Forestry,
    Mining,
    Fishing,
    Manufacturing,
}

/// Affordance data for a single tile
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Affordance {
    pub hex_key: String,
    /// How suitable this tile is for building (0-1, higher is better)
    pub buildability: f32,
    /// How suitable this tile is for roads (0-1, higher is better)
    pub roadability: f32,
    /// How suitable this tile is for settlements (0-1, higher is better)
    pub settlement_suitability: f32,
    /// Production suitability per industry type
    pub production_suitability: HashMap<String, f32>,
    /// Distance to nearest water source (0-1, normalized)
    pub water_access: f32,
}

/// Affordance configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AffordanceConfig {
    /// Maximum slope for building (normalized 0-1)
    pub max_build_slope: f32,
    /// Maximum slope for roads (normalized 0-1)
    pub max_road_slope: f32,
    /// Bonus for water proximity (0-1)
    pub water_proximity_bonus: f32,
    /// Penalty for steep slopes (0-1)
    pub slope_penalty: f32,
    /// Penalty for difficult biomes (0-1)
    pub biome_penalty: f32,
    /// Water crossing cost multiplier (0-1, lower is better)
    pub water_crossing_cost: f32,
}

impl Default for AffordanceConfig {
    fn default() -> Self {
        Self {
            max_build_slope: 0.3,
            max_road_slope: 0.5,
            water_proximity_bonus: 0.2,
            slope_penalty: 0.5,
            biome_penalty: 0.3,
            water_crossing_cost: 0.7,
        }
    }
}

/// Calculate slope between two adjacent tiles
fn calculate_slope(
    tile: &TileField,
    neighbors: &HashMap<String, &TileField>,
    hex: &HexCoord,
) -> f32 {
    let mut max_slope: f32 = 0.0;
    let neighbor_keys: Vec<String> = hex.neighbors().iter().map(|h| h.to_key()).collect();

    for key in &neighbor_keys {
        if let Some(neighbor_tile) = neighbors.get(key) {
            let height_diff = (tile.height - neighbor_tile.height).abs();
            // Normalize slope (assuming typical height range of -0.5 to 0.5)
            let slope = (height_diff / 1.0).min(1.0);
            max_slope = max_slope.max(slope);
        }
    }

    max_slope
}

/// Get biome penalty based on biome type
fn get_biome_penalty(biome: BiomeHint) -> f32 {
    match biome {
        BiomeHint::Ocean => 1.0,     // Cannot build on ocean
        BiomeHint::Lake => 0.9,      // Very difficult
        BiomeHint::RiverBank => 0.3, // Moderate difficulty
        BiomeHint::Wetland => 0.7,   // Difficult
        BiomeHint::Sand => 0.4,      // Moderate
        BiomeHint::Grass => 0.0,     // No penalty
        BiomeHint::Forest => 0.2,    // Slight penalty (clearing needed)
        BiomeHint::Rocky => 0.8,     // Very difficult
        BiomeHint::Snow => 1.0,      // Cannot build
    }
}

/// Calculate buildability score for a tile
pub fn buildability(
    _tile: &TileField,
    biome: BiomeHint,
    slope: f32,
    water_access: f32,
    config: &AffordanceConfig,
) -> f32 {
    // Start with base score
    let mut score = 1.0;

    // Apply slope penalty
    if slope > config.max_build_slope {
        score *= (1.0 - config.slope_penalty) * (1.0 - (slope - config.max_build_slope));
    }

    // Apply biome penalty
    let biome_penalty = get_biome_penalty(biome);
    score *= 1.0 - (config.biome_penalty * biome_penalty);

    // Apply water proximity bonus (but not too close to avoid flooding)
    if water_access > 0.1 && water_access < 0.8 {
        score *= 1.0 + config.water_proximity_bonus * (1.0 - water_access.abs() * 2.0);
    }

    // Clamp to 0-1
    score.clamp(0.0, 1.0)
}

/// Calculate roadability score for a tile
pub fn roadability(
    _tile: &TileField,
    biome: BiomeHint,
    slope: f32,
    _water_access: f32,
    config: &AffordanceConfig,
) -> f32 {
    // Start with base score
    let mut score = 1.0;

    // Apply slope penalty (roads can handle steeper slopes than buildings)
    if slope > config.max_road_slope {
        score *= (1.0 - config.slope_penalty * 0.5) * (1.0 - (slope - config.max_road_slope) * 0.5);
    }

    // Apply biome penalty (roads are more tolerant)
    let biome_penalty = get_biome_penalty(biome) * 0.5;
    score *= 1.0 - (config.biome_penalty * biome_penalty);

    // Water crossing cost
    if matches!(biome, BiomeHint::Ocean | BiomeHint::Lake) {
        score *= config.water_crossing_cost;
    }

    // Clamp to 0-1
    score.clamp(0.0, 1.0)
}

/// Calculate settlement suitability score for a tile
pub fn settlement_suitability(
    _tile: &TileField,
    biome: BiomeHint,
    slope: f32,
    water_access: f32,
    config: &AffordanceConfig,
) -> f32 {
    // Settlements prefer flat land near water with good biomes
    let flatness = 1.0 - slope;
    let water_bonus = if water_access < 0.3 {
        1.0 + config.water_proximity_bonus * (1.0 - water_access / 0.3)
    } else {
        1.0 - (water_access - 0.3) * 0.5
    };

    let biome_score = 1.0 - get_biome_penalty(biome);

    // Weighted combination
    let score = (flatness * 0.4 + water_bonus * 0.35 + biome_score * 0.25).clamp(0.0, 1.0);

    // Additional penalty for very high elevation (snow)
    if matches!(biome, BiomeHint::Snow) {
        score * 0.1
    } else {
        score
    }
}

/// Calculate production suitability for a specific industry
pub fn production_suitability(
    tile: &TileField,
    biome: BiomeHint,
    slope: f32,
    water_access: f32,
    industry: IndustryType,
) -> f32 {
    use IndustryType::*;
    match industry {
        IndustryType::Agriculture => {
            // Prefers flat, fertile land with water access
            let flatness = 1.0 - slope;
            let water_bonus = if water_access < 0.4 { 0.3 } else { 0.0 };
            let biome_score = match biome {
                BiomeHint::Grass => 1.0,
                BiomeHint::Forest => 0.7,    // Needs clearing
                BiomeHint::Wetland => 0.6,   // Needs drainage
                BiomeHint::Sand => 0.3,      // Poor soil
                BiomeHint::RiverBank => 0.9, // Good soil + water
                _ => 0.0,
            };
            (flatness * 0.4 + biome_score * 0.4 + water_bonus * 0.2).clamp(0.0, 1.0)
        }
        Forestry => {
            // Prefers forest areas
            let biome_score = match biome {
                BiomeHint::Forest => 1.0,
                BiomeHint::Grass => 0.3, // Can plant
                BiomeHint::Rocky => 0.1,
                _ => 0.0,
            };
            let slope_penalty = if slope > 0.5 { 0.5 } else { 0.0 };
            let result: f32 = biome_score * (1.0 - slope_penalty);
            result.clamp(0.0, 1.0)
        }
        Mining => {
            // Prefers rocky, elevated areas
            let biome_score = match biome {
                BiomeHint::Rocky => 1.0,
                BiomeHint::Snow => 0.7,  // Mountain resources
                BiomeHint::Grass => 0.2, // May have resources
                _ => 0.0,
            };
            let elevation_bonus = if tile.height > 0.1 { 0.3 } else { 0.0 };
            let result: f32 = biome_score + elevation_bonus;
            result.clamp(0.0, 1.0)
        }
        Fishing => {
            // Requires water access
            if matches!(biome, BiomeHint::Ocean | BiomeHint::Lake) {
                1.0
            } else if matches!(biome, BiomeHint::RiverBank) {
                0.7
            } else if water_access < 0.2 {
                0.5
            } else {
                0.0
            }
        }
        Manufacturing => {
            // Prefers flat land with water access (for transport/power)
            let flatness = 1.0 - slope;
            let water_bonus = if water_access < 0.5 { 0.3 } else { 0.0 };
            let biome_score = match biome {
                BiomeHint::Grass => 1.0,
                BiomeHint::Forest => 0.8,
                BiomeHint::Sand => 0.6,
                _ => 0.3,
            };
            (flatness * 0.4 + biome_score * 0.4 + water_bonus * 0.2).clamp(0.0, 1.0)
        }
    }
}

/// Calculate water access score (distance to nearest water source)
pub fn water_access(
    hex: &HexCoord,
    drainage: &DrainageResult,
    lakes: &[Lake],
    land_mask: &[(String, bool)],
    max_distance: u32,
) -> f32 {
    // Check if tile is already water
    let key = hex.to_key();
    if let Some(&is_land) = land_mask.iter().find(|(k, _)| k == &key).map(|(_, v)| v) {
        if !is_land {
            return 1.0; // Already on water
        }
    }

    // Collect all water tiles (rivers and lakes)
    let mut water_tiles = HashSet::new();

    // Add river tiles
    for river in &drainage.rivers {
        water_tiles.insert(river.hex_key.clone());
    }

    // Add lake surface tiles
    for lake in lakes {
        for tile_key in &lake.surface_tiles {
            water_tiles.insert(tile_key.clone());
        }
    }

    // BFS to find nearest water
    let mut visited = HashSet::new();
    let mut queue = std::collections::VecDeque::new();
    queue.push_back((hex.clone(), 0u32));
    visited.insert(key.clone());

    while let Some((current, dist)) = queue.pop_front() {
        if dist > max_distance {
            break;
        }

        if water_tiles.contains(&current.to_key()) {
            // Normalize distance: 0 = adjacent, 1 = max_distance
            return 1.0 - (dist as f32 / max_distance as f32);
        }

        for neighbor in current.neighbors() {
            let neighbor_key = neighbor.to_key();
            if !visited.contains(&neighbor_key) {
                visited.insert(neighbor_key.clone());
                queue.push_back((neighbor, dist + 1));
            }
        }
    }

    // No water found within max_distance
    0.0
}

/// Compute affordances for a region of tiles
pub fn compute_affordances(
    tiles: &[(String, TileField)],
    biomes: &[(String, BiomeHint)],
    drainage: &DrainageResult,
    lakes: &[Lake],
    land_mask: &[(String, bool)],
    config: &AffordanceConfig,
) -> Vec<Affordance> {
    let tile_map: HashMap<String, &TileField> = tiles.iter().map(|(k, v)| (k.clone(), v)).collect();
    let biome_map: HashMap<String, BiomeHint> = biomes.iter().cloned().collect();

    let mut affordances = Vec::new();

    for (key, tile) in tiles {
        let hex = match HexCoord::from_key(key) {
            Some(h) => h,
            None => continue,
        };

        let biome = biome_map.get(key).copied().unwrap_or(BiomeHint::Grass);

        // Calculate slope
        let slope = calculate_slope(tile, &tile_map, &hex);

        // Calculate water access
        let water_access_score = water_access(&hex, drainage, lakes, land_mask, 20);

        // Calculate affordances
        let buildability_score = buildability(tile, biome, slope, water_access_score, config);
        let roadability_score = roadability(tile, biome, slope, water_access_score, config);
        let settlement_score =
            settlement_suitability(tile, biome, slope, water_access_score, config);

        // Calculate production suitability for all industry types
        let mut production_suitability_map = HashMap::new();
        for industry in [
            IndustryType::Agriculture,
            IndustryType::Forestry,
            IndustryType::Mining,
            IndustryType::Fishing,
            IndustryType::Manufacturing,
        ] {
            let score = production_suitability(tile, biome, slope, water_access_score, industry);
            // Use the serde serialization from the derive attribute
            let key = match industry {
                IndustryType::Agriculture => "agriculture".to_string(),
                IndustryType::Forestry => "forestry".to_string(),
                IndustryType::Mining => "mining".to_string(),
                IndustryType::Fishing => "fishing".to_string(),
                IndustryType::Manufacturing => "manufacturing".to_string(),
            };
            production_suitability_map.insert(key, score);
        }

        affordances.push(Affordance {
            hex_key: key.clone(),
            buildability: buildability_score,
            roadability: roadability_score,
            settlement_suitability: settlement_score,
            production_suitability: production_suitability_map,
            water_access: water_access_score,
        });
    }

    affordances
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_config() -> AffordanceConfig {
        AffordanceConfig::default()
    }

    #[test]
    fn test_buildability_flat_grass() {
        let config = create_test_config();
        let tile = TileField {
            height: 0.1,
            temperature: 0.2,
            humidity: 0.3,
            terrain_type: 0.0,
            rocky_noise: 0.0,
            sediment: 0.0,
            water_table: 0.0,
        };

        let score = buildability(&tile, BiomeHint::Grass, 0.0, 0.5, &config);
        assert!(score > 0.8, "Flat grass should be highly buildable");
    }

    #[test]
    fn test_buildability_steep_slope() {
        let config = create_test_config();
        let tile = TileField {
            height: 0.5,
            temperature: 0.2,
            humidity: 0.3,
            terrain_type: 0.0,
            rocky_noise: 0.0,
            sediment: 0.0,
            water_table: 0.0,
        };

        let score = buildability(&tile, BiomeHint::Grass, 0.8, 0.5, &config);
        assert!(score < 0.5, "Steep slope should reduce buildability");
    }

    #[test]
    fn test_buildability_ocean() {
        let config = create_test_config();
        let tile = TileField {
            height: -0.2,
            temperature: 0.2,
            humidity: 0.3,
            terrain_type: 0.0,
            rocky_noise: 0.0,
            sediment: 0.0,
            water_table: 0.0,
        };

        let score = buildability(&tile, BiomeHint::Ocean, 0.0, 1.0, &config);
        let grass_score = buildability(&tile, BiomeHint::Grass, 0.0, 0.5, &config);
        assert!(
            score < grass_score,
            "Ocean should have lower buildability than grass"
        );
    }

    #[test]
    fn test_roadability_tolerant() {
        let config = create_test_config();
        let tile = TileField {
            height: 0.3,
            temperature: 0.2,
            humidity: 0.3,
            terrain_type: 0.0,
            rocky_noise: 0.0,
            sediment: 0.0,
            water_table: 0.0,
        };

        let slope = 0.4;
        let build_score = buildability(&tile, BiomeHint::Grass, slope, 0.5, &config);
        let road_score = roadability(&tile, BiomeHint::Grass, slope, 0.5, &config);

        assert!(
            road_score > build_score,
            "Roads should be more tolerant of slopes"
        );
    }

    #[test]
    fn test_settlement_suitability_near_water() {
        let config = create_test_config();
        let tile = TileField {
            height: 0.1,
            temperature: 0.2,
            humidity: 0.3,
            terrain_type: 0.0,
            rocky_noise: 0.0,
            sediment: 0.0,
            water_table: 0.0,
        };

        let near_water = settlement_suitability(&tile, BiomeHint::Grass, 0.1, 0.1, &config);
        let far_water = settlement_suitability(&tile, BiomeHint::Grass, 0.1, 0.8, &config);

        assert!(near_water > far_water, "Settlements prefer water proximity");
    }

    #[test]
    fn test_production_suitability_agriculture() {
        let tile = TileField {
            height: 0.1,
            temperature: 0.2,
            humidity: 0.3,
            terrain_type: 0.0,
            rocky_noise: 0.0,
            sediment: 0.0,
            water_table: 0.0,
        };

        let grass_score =
            production_suitability(&tile, BiomeHint::Grass, 0.1, 0.2, IndustryType::Agriculture);
        let forest_score = production_suitability(
            &tile,
            BiomeHint::Forest,
            0.1,
            0.2,
            IndustryType::Agriculture,
        );
        let rocky_score =
            production_suitability(&tile, BiomeHint::Rocky, 0.1, 0.2, IndustryType::Agriculture);

        assert!(
            grass_score > forest_score,
            "Agriculture prefers grass over forest"
        );
        assert!(
            grass_score > rocky_score,
            "Agriculture prefers grass over rocky"
        );
    }

    #[test]
    fn test_production_suitability_forestry() {
        let tile = TileField {
            height: 0.1,
            temperature: 0.2,
            humidity: 0.3,
            terrain_type: 0.0,
            rocky_noise: 0.0,
            sediment: 0.0,
            water_table: 0.0,
        };

        let forest_score =
            production_suitability(&tile, BiomeHint::Forest, 0.1, 0.2, IndustryType::Forestry);
        let grass_score =
            production_suitability(&tile, BiomeHint::Grass, 0.1, 0.2, IndustryType::Forestry);

        assert!(forest_score > grass_score, "Forestry prefers forest");
    }

    #[test]
    fn test_production_suitability_mining() {
        let tile = TileField {
            height: 0.1,
            temperature: 0.2,
            humidity: 0.3,
            terrain_type: 0.0,
            rocky_noise: 0.0,
            sediment: 0.0,
            water_table: 0.0,
        };

        let rocky_score =
            production_suitability(&tile, BiomeHint::Rocky, 0.1, 0.2, IndustryType::Mining);
        let grass_score =
            production_suitability(&tile, BiomeHint::Grass, 0.1, 0.2, IndustryType::Mining);

        assert!(rocky_score > grass_score, "Mining prefers rocky terrain");
    }

    #[test]
    fn test_production_suitability_fishing() {
        let tile = TileField {
            height: 0.1,
            temperature: 0.2,
            humidity: 0.3,
            terrain_type: 0.0,
            rocky_noise: 0.0,
            sediment: 0.0,
            water_table: 0.0,
        };

        let ocean_score =
            production_suitability(&tile, BiomeHint::Ocean, 0.0, 1.0, IndustryType::Fishing);
        let grass_score =
            production_suitability(&tile, BiomeHint::Grass, 0.1, 0.8, IndustryType::Fishing);

        assert!(ocean_score > grass_score, "Fishing requires water");
    }

    #[test]
    fn test_water_access_on_water() {
        let drainage = DrainageResult {
            flow_direction: vec![],
            flow_accumulation: vec![],
            rivers: vec![],
        };
        let lakes = vec![];
        let land_mask = vec![("0,0".to_string(), false)];

        let hex = HexCoord::new(0, 0);
        let score = water_access(&hex, &drainage, &lakes, &land_mask, 20);

        assert_eq!(score, 1.0, "On water should have perfect water access");
    }

    #[test]
    fn test_compute_affordances() {
        let config = create_test_config();
        let tiles = vec![(
            "0,0".to_string(),
            TileField {
                height: 0.1,
                temperature: 0.2,
                humidity: 0.3,
                terrain_type: 0.0,
                rocky_noise: 0.0,
                sediment: 0.0,
                water_table: 0.0,
            },
        )];
        let biomes = vec![("0,0".to_string(), BiomeHint::Grass)];
        let drainage = DrainageResult {
            flow_direction: vec![],
            flow_accumulation: vec![],
            rivers: vec![],
        };
        let lakes = vec![];
        let land_mask = vec![("0,0".to_string(), true)];

        let result = compute_affordances(&tiles, &biomes, &drainage, &lakes, &land_mask, &config);

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].hex_key, "0,0");
        assert!(result[0].buildability > 0.0);
        assert!(result[0].roadability > 0.0);
        assert!(result[0].settlement_suitability > 0.0);
        assert!(!result[0].production_suitability.is_empty());
    }
}
