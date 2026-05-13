use crate::terrain::{TerrainConfig, TileField};
use serde::{Deserialize, Serialize};

/// Biome hint for terrain classification
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BiomeHint {
    Ocean,
    Lake,
    RiverBank,
    Wetland,
    Sand,
    Grass,
    Forest,
    Rocky,
    Snow,
}

impl BiomeHint {
    /// Convert biome hint to string representation
    pub fn as_str(&self) -> &'static str {
        match self {
            BiomeHint::Ocean => "ocean",
            BiomeHint::Lake => "lake",
            BiomeHint::RiverBank => "river-bank",
            BiomeHint::Wetland => "wetland",
            BiomeHint::Sand => "sand",
            BiomeHint::Grass => "grass",
            BiomeHint::Forest => "forest",
            BiomeHint::Rocky => "rocky",
            BiomeHint::Snow => "snow",
        }
    }
}

/// Hydrology classification data for biome determination
#[derive(Debug, Clone, Copy, Default)]
pub struct HydrologyClassification {
    /// River bank influence (0-1+)
    pub bank_influence: Option<f32>,
    /// Channel influence (0-1+)
    pub channel_influence: Option<f32>,
}

/// Default biome classification thresholds (matching engine-rules)
pub const RIVER_FLUX_THRESHOLD: f32 = 5.0;
pub const RIVER_BANK_INFLUENCE_THRESHOLD: f32 = 1.1;
pub const CHANNEL_INFLUENCE_LAKE: f32 = 1.15;
pub const RIVER_FLUX_LAKE_MULTIPLIER: f32 = 2.0;
pub const WETLAND_RIVER_INFLUENCE: f32 = 0.35;

/// Classify a single tile into a biome hint based on its fields and hydrology
///
/// # Arguments
/// * `tile` - The tile field containing height, temperature, humidity, terrain_type
/// * `max_flux` - Maximum flux from neighboring edges
/// * `config` - Terrain configuration with thresholds
/// * `hydrology` - Optional hydrology classification data
///
/// # Returns
/// The biome hint for this tile
pub fn classify_tile(
    tile: &TileField,
    max_flux: f32,
    config: &TerrainConfig,
    hydrology: &HydrologyClassification,
) -> BiomeHint {
    let river_influence = hydrology.bank_influence.unwrap_or(0.0);
    let channel_influence = hydrology.channel_influence.unwrap_or(0.0);

    // Below sea level: distinguish ocean from lake based on flux
    if tile.height < config.sea_level {
        return if max_flux > RIVER_FLUX_THRESHOLD {
            BiomeHint::Lake
        } else {
            BiomeHint::Ocean
        };
    }

    // Channel-influenced lake (depression with significant inflow)
    if channel_influence > CHANNEL_INFLUENCE_LAKE
        && max_flux > RIVER_FLUX_THRESHOLD * RIVER_FLUX_LAKE_MULTIPLIER
        && tile.height <= config.forest_level
    {
        return BiomeHint::Lake;
    }

    // River bank (high flux or significant river influence)
    if max_flux > RIVER_FLUX_THRESHOLD || river_influence > RIVER_BANK_INFLUENCE_THRESHOLD {
        return BiomeHint::RiverBank;
    }

    // Wetland near rivers
    if river_influence > WETLAND_RIVER_INFLUENCE && tile.height < config.forest_level {
        return BiomeHint::Wetland;
    }

    // High elevation: rocky or snow
    if tile.height > config.rocky_level {
        return if tile.height > config.snow_level {
            BiomeHint::Snow
        } else {
            BiomeHint::Rocky
        };
    }

    // Low elevation: sand
    if tile.height <= config.forest_level {
        return BiomeHint::Sand;
    }

    // Wetland from high humidity
    if tile.humidity > config.wetland_humidity && tile.height < config.forest_level {
        return BiomeHint::Wetland;
    }

    // Forest from terrain type
    if tile.terrain_type > 0.0 {
        return BiomeHint::Forest;
    }

    // Default: grass
    BiomeHint::Grass
}

/// Classify a region of tiles into biome hints
///
/// # Arguments
/// * `tiles` - Slice of tile fields
/// * `max_fluxes` - Maximum flux for each tile
/// * `config` - Terrain configuration
/// * `hydrology` - Hydrology classification for each tile
///
/// # Returns
/// Vector of biome hints, one per tile
pub fn classify_region(
    tiles: &[TileField],
    max_fluxes: &[f32],
    config: &TerrainConfig,
    hydrology: &[HydrologyClassification],
) -> Vec<BiomeHint> {
    tiles
        .iter()
        .zip(max_fluxes.iter())
        .zip(hydrology.iter())
        .map(|((tile, max_flux), h)| classify_tile(tile, *max_flux, config, h))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_config() -> TerrainConfig {
        TerrainConfig {
            sea_level: -0.1, // Below forest level to allow sand biome
            snow_level: 0.2,
            rocky_level: 0.1,
            forest_level: 0.0, // Above sea level
            sand_temperature: 0.3,
            sand_humidity: 0.3,
            wetland_humidity: 0.1,
            forest_humidity: 0.2,
            scale: 1.0,
            terrain_type_scale: 1.0,
            octaves: 4,
            persistence: 0.5,
            lacunarity: 2.0,
            temperature_scale: 1.0,
            humidity_scale: 1.0,
            hydrology_sources_per_tile: 0.1,
            hydrology_land_ceiling: 0.15,
            hydrology_max_trace_steps: 50,
            hydrology_flux_step_weight: 1.0,
        }
    }

    #[test]
    fn test_biome_hint_as_str() {
        assert_eq!(BiomeHint::Ocean.as_str(), "ocean");
        assert_eq!(BiomeHint::Lake.as_str(), "lake");
        assert_eq!(BiomeHint::RiverBank.as_str(), "river-bank");
        assert_eq!(BiomeHint::Wetland.as_str(), "wetland");
        assert_eq!(BiomeHint::Sand.as_str(), "sand");
        assert_eq!(BiomeHint::Grass.as_str(), "grass");
        assert_eq!(BiomeHint::Forest.as_str(), "forest");
        assert_eq!(BiomeHint::Rocky.as_str(), "rocky");
        assert_eq!(BiomeHint::Snow.as_str(), "snow");
    }

    #[test]
    fn test_classify_tile_ocean() {
        let config = create_test_config();
        let tile = TileField {
            height: -0.15, // Below sea level of -0.1
            temperature: 0.0,
            humidity: 0.0,
            terrain_type: 0.0,
            rocky_noise: 0.0,
            sediment: 0.0,
            water_table: 0.0,
        };
        let hydrology = HydrologyClassification::default();

        // Below sea level with low flux -> ocean
        assert_eq!(
            classify_tile(&tile, 0.0, &config, &hydrology),
            BiomeHint::Ocean
        );

        // Below sea level with high flux -> lake
        assert_eq!(
            classify_tile(&tile, 10.0, &config, &hydrology),
            BiomeHint::Lake
        );
    }

    #[test]
    fn test_classify_tile_lake_channel() {
        let config = create_test_config();
        let tile = TileField {
            height: -0.02, // Above sea level, below forest level
            temperature: 0.0,
            humidity: 0.0,
            terrain_type: 0.0,
            rocky_noise: 0.0,
            sediment: 0.0,
            water_table: 0.0,
        };
        let hydrology = HydrologyClassification {
            bank_influence: None,
            channel_influence: Some(1.2), // Above threshold
        };

        // Channel influence + high flux -> lake
        assert_eq!(
            classify_tile(&tile, 15.0, &config, &hydrology),
            BiomeHint::Lake
        );
    }

    #[test]
    fn test_classify_tile_river_bank() {
        let config = create_test_config();
        let tile = TileField {
            height: 0.05,
            temperature: 0.0,
            humidity: 0.0,
            terrain_type: 0.0,
            rocky_noise: 0.0,
            sediment: 0.0,
            water_table: 0.0,
        };

        // High flux -> river bank
        let hydrology = HydrologyClassification::default();
        assert_eq!(
            classify_tile(&tile, 10.0, &config, &hydrology),
            BiomeHint::RiverBank
        );

        // High river influence -> river bank
        let hydrology = HydrologyClassification {
            bank_influence: Some(1.5),
            channel_influence: None,
        };
        assert_eq!(
            classify_tile(&tile, 0.0, &config, &hydrology),
            BiomeHint::RiverBank
        );
    }

    #[test]
    fn test_classify_tile_wetland() {
        let config = create_test_config();
        let tile = TileField {
            height: -0.05, // Above sea level, below forest level
            temperature: 0.0,
            humidity: 0.0,
            terrain_type: 0.0,
            rocky_noise: 0.0,
            sediment: 0.0,
            water_table: 0.0,
        };

        // River influence -> wetland
        let hydrology = HydrologyClassification {
            bank_influence: Some(0.5), // Above wetland threshold
            channel_influence: None,
        };
        assert_eq!(
            classify_tile(&tile, 0.0, &config, &hydrology),
            BiomeHint::Wetland
        );

        // High humidity at low elevation -> sand (not wetland, because sand check comes first)
        // Note: This matches TypeScript behavior where humidity-based wetland check is
        // unreachable for tiles at or below forest_level
        let tile = TileField {
            height: -0.05, // Above sea level, below forest level
            temperature: 0.0,
            humidity: 0.2, // Above wetland humidity
            terrain_type: 0.0,
            rocky_noise: 0.0,
            sediment: 0.0,
            water_table: 0.0,
        };
        let hydrology = HydrologyClassification::default();
        assert_eq!(
            classify_tile(&tile, 0.0, &config, &hydrology),
            BiomeHint::Sand
        );
    }

    #[test]
    fn test_classify_tile_snow() {
        let config = create_test_config();
        let tile = TileField {
            height: 0.25, // Above snow level
            temperature: 0.0,
            humidity: 0.0,
            terrain_type: 0.0,
            rocky_noise: 0.0,
            sediment: 0.0,
            water_table: 0.0,
        };
        let hydrology = HydrologyClassification::default();

        assert_eq!(
            classify_tile(&tile, 0.0, &config, &hydrology),
            BiomeHint::Snow
        );
    }

    #[test]
    fn test_classify_tile_rocky() {
        let config = create_test_config();
        let tile = TileField {
            height: 0.15, // Above rocky level, below snow level
            temperature: 0.0,
            humidity: 0.0,
            terrain_type: 0.0,
            rocky_noise: 0.0,
            sediment: 0.0,
            water_table: 0.0,
        };
        let hydrology = HydrologyClassification::default();

        assert_eq!(
            classify_tile(&tile, 0.0, &config, &hydrology),
            BiomeHint::Rocky
        );
    }

    #[test]
    fn test_classify_tile_sand() {
        let config = create_test_config();
        let tile = TileField {
            height: -0.05, // Above sea level, at forest level
            temperature: 0.0,
            humidity: 0.0,
            terrain_type: 0.0,
            rocky_noise: 0.0,
            sediment: 0.0,
            water_table: 0.0,
        };
        let hydrology = HydrologyClassification::default();

        assert_eq!(
            classify_tile(&tile, 0.0, &config, &hydrology),
            BiomeHint::Sand
        );
    }

    #[test]
    fn test_classify_tile_forest() {
        let config = create_test_config();
        let tile = TileField {
            height: 0.05, // Above forest level
            temperature: 0.0,
            humidity: 0.0,
            terrain_type: 0.5, // Positive terrain type
            rocky_noise: 0.0,
            sediment: 0.0,
            water_table: 0.0,
        };
        let hydrology = HydrologyClassification::default();

        assert_eq!(
            classify_tile(&tile, 0.0, &config, &hydrology),
            BiomeHint::Forest
        );
    }

    #[test]
    fn test_classify_tile_grass() {
        let config = create_test_config();
        let tile = TileField {
            height: 0.05, // Above forest level
            temperature: 0.0,
            humidity: 0.0,
            terrain_type: 0.0,
            rocky_noise: 0.0,
            sediment: 0.0,
            water_table: 0.0,
        };
        let hydrology = HydrologyClassification::default();

        assert_eq!(
            classify_tile(&tile, 0.0, &config, &hydrology),
            BiomeHint::Grass
        );
    }

    #[test]
    fn test_classify_region() {
        let config = create_test_config();
        let tiles = vec![
            TileField {
                height: -0.15, // Below sea level
                temperature: 0.0,
                humidity: 0.0,
                terrain_type: 0.0,
                rocky_noise: 0.0,
                sediment: 0.0,
                water_table: 0.0,
            },
            TileField {
                height: 0.25,
                temperature: 0.0,
                humidity: 0.0,
                terrain_type: 0.0,
                rocky_noise: 0.0,
                sediment: 0.0,
                water_table: 0.0,
            },
            TileField {
                height: 0.05, // Above forest level
                temperature: 0.0,
                humidity: 0.0,
                terrain_type: 0.5,
                rocky_noise: 0.0,
                sediment: 0.0,
                water_table: 0.0,
            },
        ];
        let max_fluxes = vec![0.0, 0.0, 0.0];
        let hydrology = vec![
            HydrologyClassification::default(),
            HydrologyClassification::default(),
            HydrologyClassification::default(),
        ];

        let biomes = classify_region(&tiles, &max_fluxes, &config, &hydrology);

        assert_eq!(biomes[0], BiomeHint::Ocean);
        assert_eq!(biomes[1], BiomeHint::Snow);
        assert_eq!(biomes[2], BiomeHint::Forest);
    }

    #[test]
    fn test_classify_tile_deterministic() {
        let config = create_test_config();
        let tile = TileField {
            height: 0.05,
            temperature: 0.1,
            humidity: 0.2,
            terrain_type: 0.3,
            rocky_noise: 0.4,
            sediment: 0.5,
            water_table: 0.6,
        };
        let hydrology = HydrologyClassification {
            bank_influence: Some(0.5),
            channel_influence: Some(0.7),
        };

        let result1 = classify_tile(&tile, 3.0, &config, &hydrology);
        let result2 = classify_tile(&tile, 3.0, &config, &hydrology);

        assert_eq!(result1, result2);
    }

    #[test]
    fn test_lake_biome_classification() {
        // Test that lake-detected tiles return BiomeHint::Lake
        let config = create_test_config();

        // Test 1: Below sea level with high flux (lake vs ocean distinction)
        let lake_tile = TileField {
            height: -0.15, // Strictly below sea level (-0.1)
            temperature: 0.0,
            humidity: 0.0,
            terrain_type: 0.0,
            rocky_noise: 0.0,
            sediment: 0.0,
            water_table: 0.0,
        };
        let lake_hydrology = HydrologyClassification {
            bank_influence: Some(2.0), // High flux
            channel_influence: None,
        };

        let ocean_tile = TileField {
            height: -0.15, // Strictly below sea level (-0.1)
            temperature: 0.0,
            humidity: 0.0,
            terrain_type: 0.0,
            rocky_noise: 0.0,
            sediment: 0.0,
            water_table: 0.0,
        };
        let ocean_hydrology = HydrologyClassification {
            bank_influence: None, // No flux
            channel_influence: None,
        };

        // Lake should be classified as Lake (not Ocean) when flux is high
        let lake_biome = classify_tile(&lake_tile, 10.0, &config, &lake_hydrology);
        assert_eq!(
            lake_biome,
            BiomeHint::Lake,
            "Tile with high flux below sea level should be Lake"
        );

        // Ocean should be classified as Ocean when flux is low
        let ocean_biome = classify_tile(&ocean_tile, 0.0, &config, &ocean_hydrology);
        assert_eq!(
            ocean_biome,
            BiomeHint::Ocean,
            "Tile with no flux below sea level should be Ocean"
        );

        // Test 2: Channel-influenced depression (inland lake)
        let inland_lake_tile = TileField {
            height: 0.0, // At forest level, below rocky level
            temperature: 0.0,
            humidity: 0.0,
            terrain_type: 0.0,
            rocky_noise: 0.0,
            sediment: 0.0,
            water_table: 0.0,
        };
        let inland_lake_hydrology = HydrologyClassification {
            bank_influence: Some(3.0),
            channel_influence: Some(2.0), // High channel influence
        };

        let inland_lake_biome =
            classify_tile(&inland_lake_tile, 15.0, &config, &inland_lake_hydrology);
        assert_eq!(
            inland_lake_biome,
            BiomeHint::Lake,
            "Channel-influenced depression should be Lake"
        );
    }
}
