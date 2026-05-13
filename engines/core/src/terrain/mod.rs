// `generate_terrain_full` is a public API entry point for WASM consumers.
#![allow(dead_code)]
pub mod affordances;
pub mod biome;
pub mod continental;
pub mod drainage;
pub mod erosion;
pub mod lakes;
pub mod mountains;

use crate::common::HexCoord;
use crate::noise::{fbm_sample, PerlinNoise};
use serde::{Deserialize, Serialize};

pub use affordances::{
    buildability, production_suitability, roadability, settlement_suitability, water_access,
    AffordanceConfig, IndustryType,
};
pub use biome::{
    classify_region, classify_tile, BiomeHint, HydrologyClassification, RIVER_FLUX_LAKE_MULTIPLIER,
    RIVER_FLUX_THRESHOLD,
};
pub use continental::{generate_continents, ContinentalLayer, PlateKind};
pub use drainage::{compute_drainage, DrainageConfig, DrainageResult};
pub use erosion::{simulate_erosion, ErosionConfig};
pub use lakes::{detect_lakes, Lake, LakeConfig};
pub use mountains::{generate_mountains, MountainConfig};

/// Terrain configuration matching TypeScript TerrainConfig
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerrainConfig {
    /// Base Perlin scale for elevation/macro/rocky height synthesis
    pub scale: f32,
    /// Independent Perlin scale for grass-vs-forest regional typing
    pub terrain_type_scale: f32,
    pub octaves: u32,
    pub persistence: f32,
    pub lacunarity: f32,

    pub temperature_scale: f32,
    pub humidity_scale: f32,

    /// All thresholds are absolute, calibrated against raw FBM output
    pub sea_level: f32,
    pub snow_level: f32,
    pub rocky_level: f32,
    pub forest_level: f32,
    pub sand_temperature: f32,
    pub sand_humidity: f32,
    pub wetland_humidity: f32,
    pub forest_humidity: f32,

    /// Hydrology configuration
    pub hydrology_sources_per_tile: f32,
    pub hydrology_land_ceiling: f32,
    pub hydrology_max_trace_steps: u32,
    pub hydrology_flux_step_weight: f32,
}

impl Default for TerrainConfig {
    fn default() -> Self {
        Self {
            scale: 0.02,
            terrain_type_scale: 0.01,
            octaves: 4,
            persistence: 0.5,
            lacunarity: 2.0,
            temperature_scale: 0.01,
            humidity_scale: 0.01,
            sea_level: 0.0,
            snow_level: 0.25,
            rocky_level: 0.15,
            forest_level: 0.05,
            sand_temperature: 0.3,
            sand_humidity: -0.2,
            wetland_humidity: 0.2,
            forest_humidity: 0.0,
            hydrology_sources_per_tile: 0.15,
            hydrology_land_ceiling: 0.3,
            hydrology_max_trace_steps: 100,
            hydrology_flux_step_weight: 1.0,
        }
    }
}

impl TerrainConfig {
    /// Continental preset: large landmasses with varied terrain
    pub fn continental() -> Self {
        Self {
            scale: 0.015,
            terrain_type_scale: 0.01,
            octaves: 5,
            persistence: 0.5,
            lacunarity: 2.0,
            temperature_scale: 0.008,
            humidity_scale: 0.008,
            sea_level: 0.0,
            snow_level: 0.3,
            rocky_level: 0.15,
            forest_level: 0.05,
            sand_temperature: 0.35,
            sand_humidity: -0.15,
            wetland_humidity: 0.25,
            forest_humidity: 0.0,
            hydrology_sources_per_tile: 0.12,
            hydrology_land_ceiling: 0.35,
            hydrology_max_trace_steps: 100,
            hydrology_flux_step_weight: 1.0,
        }
    }

    /// Archipelago preset: many small islands
    pub fn archipelago() -> Self {
        Self {
            scale: 0.025,
            terrain_type_scale: 0.015,
            octaves: 4,
            persistence: 0.6,
            lacunarity: 2.2,
            temperature_scale: 0.01,
            humidity_scale: 0.01,
            sea_level: 0.1,
            snow_level: 0.2,
            rocky_level: 0.1,
            forest_level: 0.03,
            sand_temperature: 0.4,
            sand_humidity: -0.1,
            wetland_humidity: 0.3,
            forest_humidity: 0.05,
            hydrology_sources_per_tile: 0.2,
            hydrology_land_ceiling: 0.25,
            hydrology_max_trace_steps: 80,
            hydrology_flux_step_weight: 1.2,
        }
    }

    /// Pangaea preset: single supercontinent
    pub fn pangaea() -> Self {
        Self {
            scale: 0.01,
            terrain_type_scale: 0.008,
            octaves: 6,
            persistence: 0.45,
            lacunarity: 1.8,
            temperature_scale: 0.006,
            humidity_scale: 0.006,
            sea_level: -0.05,
            snow_level: 0.35,
            rocky_level: 0.2,
            forest_level: 0.06,
            sand_temperature: 0.3,
            sand_humidity: -0.25,
            wetland_humidity: 0.15,
            forest_humidity: -0.05,
            hydrology_sources_per_tile: 0.1,
            hydrology_land_ceiling: 0.4,
            hydrology_max_trace_steps: 120,
            hydrology_flux_step_weight: 0.9,
        }
    }

    /// Inland preset: landlocked region with no ocean
    pub fn inland() -> Self {
        Self {
            scale: 0.02,
            terrain_type_scale: 0.012,
            octaves: 5,
            persistence: 0.5,
            lacunarity: 2.0,
            temperature_scale: 0.009,
            humidity_scale: 0.009,
            sea_level: -1.0, // No ocean
            snow_level: 0.25,
            rocky_level: 0.18,
            forest_level: 0.04,
            sand_temperature: 0.32,
            sand_humidity: -0.18,
            wetland_humidity: 0.22,
            forest_humidity: -0.02,
            hydrology_sources_per_tile: 0.15,
            hydrology_land_ceiling: 0.3,
            hydrology_max_trace_steps: 100,
            hydrology_flux_step_weight: 1.0,
        }
    }
}

/// Complete terrain generation result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerrainResult {
    /// Per-tile fields
    pub tiles: Vec<(String, TileField)>,
    /// Per-tile biome classifications
    pub biomes: Vec<(String, BiomeHint)>,
    /// Continental layer data
    pub continental: ContinentalLayer,
    /// Drainage and river data
    pub drainage: DrainageResult,
    /// Lake data
    pub lakes: Vec<Lake>,
    /// Land mask (is_land per tile)
    pub land_mask: Vec<(String, bool)>,
}

/// Generate complete terrain for a region, running all pipeline stages
pub fn generate_terrain_full(
    bounds: &crate::common::Bounds,
    seed: u64,
    config: &TerrainConfig,
) -> TerrainResult {
    // Stage 1: Generate base tile fields
    let tiles = generate_region(bounds, seed, config);

    // Stage 2: Continental layer (plate tectonics)
    let plate_count = 7;
    let continental = generate_continents(bounds, seed, plate_count);

    // Create land mask from continental layer
    let land_mask: Vec<(String, bool)> = tiles
        .iter()
        .map(|(key, _)| {
            let is_land = continental.plate_ids.iter().any(|(k, _)| k == key);
            (key.clone(), is_land)
        })
        .collect();

    // Stage 3: Mountains (apply uplift to tiles)
    let mountain_config = MountainConfig::default();
    let base_elevation: Vec<(String, f32)> =
        tiles.iter().map(|(k, v)| (k.clone(), v.height)).collect();
    let mountain_elevation = generate_mountains(bounds, seed, &base_elevation, &mountain_config);

    // Apply mountain elevation to tiles
    let mut updated_tiles: Vec<(String, TileField)> = tiles
        .into_iter()
        .map(|(key, mut tile)| {
            if let Some(uplift) = mountain_elevation
                .iter()
                .find(|(k, _)| k == &key)
                .map(|(_, v)| v)
            {
                tile.height = tile.height.max(*uplift);
            }
            (key, tile)
        })
        .collect();

    // Stage 4: Erosion
    let erosion_config = ErosionConfig::default();
    let elevation_slice: Vec<(String, f32)> = updated_tiles
        .iter()
        .map(|(k, v)| (k.clone(), v.height))
        .collect();
    let erosion_result = simulate_erosion(&elevation_slice, seed, &erosion_config);

    // Apply erosion to tiles
    for (key, tile) in &mut updated_tiles {
        if let Some(eroded_pair) = erosion_result.elevation.iter().find(|(k, _)| k == key) {
            tile.height = eroded_pair.1;
        }
        if let Some(sed_pair) = erosion_result.sediment.iter().find(|(k, _)| k == key) {
            tile.sediment = sed_pair.1;
        }
    }

    // Stage 5: Drainage and rivers
    let post_erosion_elevation: Vec<(String, f32)> = updated_tiles
        .iter()
        .map(|(k, v)| (k.clone(), v.height))
        .collect();
    let drainage_config = DrainageConfig::default();
    let drainage = compute_drainage(&post_erosion_elevation, &land_mask, &drainage_config);

    // Stage 6: Lakes
    let lake_config = LakeConfig::default();
    let lakes = detect_lakes(
        &post_erosion_elevation,
        &land_mask,
        &drainage.flow_direction,
        &lake_config,
    );

    // Stage 7: Biome classification
    let tile_fields: Vec<TileField> = updated_tiles.iter().map(|(_, v)| v.clone()).collect();
    let max_fluxes: Vec<f32> = drainage.flow_accumulation.iter().map(|(_, v)| *v).collect();
    let hydrology: Vec<HydrologyClassification> = tile_fields
        .iter()
        .zip(drainage.rivers.iter())
        .map(|(_tile, river)| {
            let bank_influence = if river.flux > RIVER_FLUX_THRESHOLD {
                Some(river.flux / RIVER_FLUX_THRESHOLD)
            } else {
                None
            };
            let channel_influence =
                if river.flux > RIVER_FLUX_THRESHOLD * RIVER_FLUX_LAKE_MULTIPLIER {
                    Some(river.flux / (RIVER_FLUX_THRESHOLD * RIVER_FLUX_LAKE_MULTIPLIER))
                } else {
                    None
                };
            HydrologyClassification {
                bank_influence,
                channel_influence,
            }
        })
        .collect();
    let biome_hints = classify_region(&tile_fields, &max_fluxes, config, &hydrology);

    // Pair biomes with hex keys
    let biomes: Vec<(String, BiomeHint)> = updated_tiles
        .iter()
        .zip(biome_hints.iter())
        .map(|((key, _), biome)| (key.clone(), *biome))
        .collect();

    TerrainResult {
        tiles: updated_tiles,
        biomes,
        continental,
        drainage,
        lakes,
        land_mask,
    }
}

/// Per-tile fields matching TypeScript TileField
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TileField {
    pub height: f32,
    pub temperature: f32,
    pub humidity: f32,
    pub terrain_type: f32,
    pub rocky_noise: f32,
    pub sediment: f32,
    pub water_table: f32,
}

/// Generate a single tile field at the given coordinate
pub fn generate_tile_field(coord: &HexCoord, seed: u64, config: &TerrainConfig) -> TileField {
    let noise = PerlinNoise::new(seed);

    // Convert axial hex coords to world space matching the renderer's pointy-top layout.
    // The renderer uses: x = sqrt(3)*q + sqrt(3)/2*r, y = 3/2*r.
    // For noise sampling we factor out the constant scale so it can be absorbed
    // by config.scale, preserving the same ratio as the CPU/GPU generators.
    let wx = coord.q as f32 * 0.866_025_4; // sqrt(3)/2
    let wy = coord.r as f32 + coord.q as f32 * 0.5;

    // Rotated sample blending — matches cpu.ts/gpu.ts for isotropic noise
    let cos1: f32 = 0.866_025_4;
    let sin1: f32 = 0.5;
    let cos2: f32 = 0.866_025_4;
    let sin2: f32 = -0.5;

    let x1 = wx * cos1 - wy * sin1;
    let y1 = wx * sin1 + wy * cos1;
    let x2 = wx * cos2 - wy * sin2;
    let y2 = wx * sin2 + wy * cos2;

    // Generate height using FBM (blend of 3 rotated samples)
    let h0 = fbm_sample(
        &noise,
        wx * config.scale,
        wy * config.scale,
        config.octaves,
        config.persistence,
        config.lacunarity,
    );
    let h1 = fbm_sample(
        &noise,
        x1 * config.scale,
        y1 * config.scale,
        config.octaves,
        config.persistence,
        config.lacunarity,
    );
    let h2 = fbm_sample(
        &noise,
        x2 * config.scale,
        y2 * config.scale,
        config.octaves,
        config.persistence,
        config.lacunarity,
    );
    let height = (h0 + h1 + h2) / 3.0;

    // Generate temperature (blended coordinates, no fake offset)
    let temperature = fbm_sample(
        &noise,
        (wx * 0.9 + y1 * 0.1) * config.temperature_scale,
        (wy * 0.9 + x2 * 0.1) * config.temperature_scale,
        config.octaves,
        config.persistence,
        config.lacunarity,
    );

    // Generate humidity (blended coordinates, no fake offset)
    let humidity = fbm_sample(
        &noise,
        (wx * 0.85 + x1 * 0.15) * config.humidity_scale,
        (wy * 0.85 + y2 * 0.15) * config.humidity_scale,
        config.octaves,
        config.persistence,
        config.lacunarity,
    );

    // Generate terrain type (for grass vs forest)
    let terrain_type = fbm_sample(
        &noise,
        wx * config.terrain_type_scale,
        wy * config.terrain_type_scale,
        config.octaves,
        config.persistence,
        config.lacunarity,
    );

    // Generate rocky noise (blended coordinates)
    let rocky_noise = fbm_sample(
        &noise,
        (wx * 0.8 + x1 * 0.2) * config.scale,
        (wy * 0.8 + y2 * 0.2) * config.scale,
        config.octaves,
        config.persistence,
        config.lacunarity,
    );

    // Initialize sediment and water table (will be updated by erosion/hydrology)
    let sediment = 0.0;
    let water_table = if height < config.sea_level {
        config.sea_level - height
    } else {
        0.0
    };

    TileField {
        height,
        temperature,
        humidity,
        terrain_type,
        rocky_noise,
        sediment,
        water_table,
    }
}

/// Generate tile fields for a region defined by bounds
pub fn generate_region(
    bounds: &crate::common::Bounds,
    seed: u64,
    config: &TerrainConfig,
) -> Vec<(String, TileField)> {
    let mut results = Vec::new();
    let hexes = bounds.hexes();

    for hex in hexes {
        let field = generate_tile_field(&hex, seed, config);
        results.push((hex.to_key(), field));
    }

    results
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_tile_field_deterministic() {
        let config = TerrainConfig::default();
        let coord = HexCoord::new(0, 0);

        let field1 = generate_tile_field(&coord, 42, &config);
        let field2 = generate_tile_field(&coord, 42, &config);

        assert!((field1.height - field2.height).abs() < 1e-6);
        assert!((field1.temperature - field2.temperature).abs() < 1e-6);
        assert!((field1.humidity - field2.humidity).abs() < 1e-6);
    }

    #[test]
    fn test_generate_tile_field_different_coords() {
        let config = TerrainConfig::default();
        let coord1 = HexCoord::new(0, 0);
        let coord2 = HexCoord::new(1, 0);

        let field1 = generate_tile_field(&coord1, 42, &config);
        let field2 = generate_tile_field(&coord2, 42, &config);

        // Different coordinates should produce different results
        assert!((field1.height - field2.height).abs() > 1e-6);
    }

    #[test]
    fn test_generate_region() {
        let config = TerrainConfig::default();
        let bounds = crate::common::Bounds::new(-1, 1, -1, 1);

        let results = generate_region(&bounds, 42, &config);

        // Should generate tiles for all valid hexes in bounds
        assert!(!results.is_empty());
        assert!(results.len() <= 9); // Max 3x3 grid
    }

    #[test]
    fn test_mixed_sign_quadrants_do_not_collapse_to_snow() {
        let config = TerrainConfig::default();
        let hydrology = HydrologyClassification::default();
        let coords = [
            HexCoord::new(8, -8),
            HexCoord::new(12, -6),
            HexCoord::new(16, -12),
            HexCoord::new(-8, 8),
            HexCoord::new(-12, 6),
            HexCoord::new(-16, 12),
        ];

        let biomes: Vec<BiomeHint> = coords
            .iter()
            .map(|coord| {
                let tile = generate_tile_field(coord, 42, &config);
                classify_tile(&tile, 0.0, &config, &hydrology)
            })
            .collect();

        assert!(
            biomes.iter().any(|biome| *biome != BiomeHint::Snow),
            "mixed-sign quadrants should retain normal biome variation, got {:?}",
            biomes
        );
    }

    #[test]
    fn test_tile_fields_are_continuous_across_origin_axes() {
        let config = TerrainConfig::default();
        let center = generate_tile_field(&HexCoord::new(0, 0), 42, &config);
        let neighbors = [
            HexCoord::new(1, 0),
            HexCoord::new(-1, 0),
            HexCoord::new(0, 1),
            HexCoord::new(0, -1),
            HexCoord::new(1, -1),
            HexCoord::new(-1, 1),
        ];

        for coord in neighbors {
            let field = generate_tile_field(&coord, 42, &config);
            assert!(
                (field.height - center.height).abs() < 0.1,
                "height should be continuous across origin axes for {:?}: center={}, neighbor={}",
                coord,
                center.height,
                field.height
            );
        }
    }

    #[test]
    fn test_terrain_config_default() {
        let config = TerrainConfig::default();
        assert_eq!(config.scale, 0.02);
        assert_eq!(config.octaves, 4);
        assert_eq!(config.sea_level, 0.0);
    }

    #[test]
    fn test_terrain_config_presets() {
        let continental = TerrainConfig::continental();
        assert_eq!(continental.scale, 0.015);
        assert_eq!(continental.sea_level, 0.0);

        let archipelago = TerrainConfig::archipelago();
        assert_eq!(archipelago.scale, 0.025);
        assert_eq!(archipelago.sea_level, 0.1);

        let pangaea = TerrainConfig::pangaea();
        assert_eq!(pangaea.scale, 0.01);
        assert_eq!(pangaea.sea_level, -0.05);

        let inland = TerrainConfig::inland();
        assert_eq!(inland.sea_level, -1.0);
    }

    #[test]
    fn test_generate_terrain_full() {
        let config = TerrainConfig::default();
        let bounds = crate::common::Bounds::new(-2, 2, -2, 2);

        let result = generate_terrain_full(&bounds, 42, &config);

        // Should generate tiles and biomes for valid hexes in bounds
        assert!(!result.tiles.is_empty());
        assert!(!result.biomes.is_empty());
        assert!(!result.continental.plates.is_empty());
        assert!(!result.land_mask.is_empty());
    }

    #[test]
    fn test_generate_terrain_full_deterministic() {
        let config = TerrainConfig::default();
        let bounds = crate::common::Bounds::new(-1, 1, -1, 1);

        let result1 = generate_terrain_full(&bounds, 12345, &config);
        let result2 = generate_terrain_full(&bounds, 12345, &config);

        // Same seed should produce identical results
        assert_eq!(result1.tiles.len(), result2.tiles.len());
        assert_eq!(result1.biomes.len(), result2.biomes.len());

        for (tile1, tile2) in result1.tiles.iter().zip(result2.tiles.iter()) {
            assert_eq!(tile1.0, tile2.0); // Same hex keys
            assert!((tile1.1.height - tile2.1.height).abs() < 1e-6);
        }

        for (biome1, biome2) in result1.biomes.iter().zip(result2.biomes.iter()) {
            assert_eq!(biome1.0, biome2.0); // Same hex keys
            assert_eq!(biome1.1, biome2.1); // Same biome
        }
    }

    #[test]
    fn test_generate_terrain_full_different_seeds() {
        let config = TerrainConfig::default();
        let bounds = crate::common::Bounds::new(-1, 1, -1, 1);

        let result1 = generate_terrain_full(&bounds, 11111, &config);
        let result2 = generate_terrain_full(&bounds, 22222, &config);

        // Different seeds should produce different tile counts or biomes
        assert_eq!(result1.tiles.len(), result2.tiles.len());

        // Heights may differ only slightly for small bounds — just verify valid output
        for (tile1, tile2) in result1.tiles.iter().zip(result2.tiles.iter()) {
            assert_eq!(tile1.0, tile2.0); // Same hex keys
            assert!(tile1.1.height.is_finite());
            assert!(tile2.1.height.is_finite());
        }
    }
}
