use crate::common::HexCoord;
use crate::noise::{fbm_sample, PerlinNoise};
use serde::{Deserialize, Serialize};

/// Mountain configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MountainConfig {
    /// Base uplift at plate boundaries
    pub base_uplift: f32,
    /// Distance decay factor (higher = faster decay)
    pub decay_factor: f32,
    /// Ridge noise scale
    pub ridge_scale: f32,
    /// Ridge noise amplitude
    pub ridge_amplitude: f32,
}

impl Default for MountainConfig {
    fn default() -> Self {
        Self {
            base_uplift: 0.3,
            decay_factor: 0.1,
            ridge_scale: 0.05,
            ridge_amplitude: 0.15,
        }
    }
}

/// Generate mountain elevation at a hex based on plate boundaries
pub fn fault_uplift(
    hex: &HexCoord,
    plate_boundary_distance: f32,
    config: &MountainConfig,
    noise: &PerlinNoise,
) -> f32 {
    // Gaussian decay from plate boundary
    let decay = (-config.decay_factor * plate_boundary_distance).exp();

    // Base uplift with decay
    let base = config.base_uplift * decay;

    // Add ridge noise along the boundary
    let x = hex.q as f32 * config.ridge_scale;
    let y = hex.r as f32 * config.ridge_scale;
    let ridge = fbm_sample(noise, x, y, 3, 0.5, 2.0) * config.ridge_amplitude * decay;

    base + ridge
}

/// Generate mountain elevation for a region
pub fn generate_mountains(
    _bounds: &crate::common::Bounds,
    seed: u64,
    base_elevation: &[(String, f32)], // (hex_key, base_elevation)
    config: &MountainConfig,
) -> Vec<(String, f32)> {
    let noise = PerlinNoise::new(seed);
    let mut results = Vec::new();

    // Find elevation gradient to identify potential mountain ranges
    let mut max_elevation = f32::MIN;
    let mut min_elevation = f32::MAX;

    for (_, elevation) in base_elevation {
        max_elevation = max_elevation.max(*elevation);
        min_elevation = min_elevation.min(*elevation);
    }

    let elevation_range = max_elevation - min_elevation;

    for (hex_key, base_elev) in base_elevation {
        // Mountains form at high elevation gradients
        // Calculate normalized elevation (0-1)
        let normalized = if elevation_range > 0.0 {
            (base_elev - min_elevation) / elevation_range
        } else {
            0.0
        };

        // Mountains are more likely at higher elevations
        let mountain_probability = normalized.powf(2.0);

        // Parse hex coordinate
        if let Some(hex) = HexCoord::from_key(hex_key) {
            // Distance from "plate boundary" (simulated by elevation gradient)
            let boundary_distance = (1.0 - normalized) * 10.0;

            // Generate mountain uplift
            let uplift = if mountain_probability > 0.3 {
                fault_uplift(&hex, boundary_distance, config, &noise) * mountain_probability
            } else {
                0.0
            };

            // Blend with base elevation (mountains only increase elevation)
            let mountain_elevation = base_elev.max(base_elev + uplift);
            results.push((hex_key.clone(), mountain_elevation));
        }
    }

    results
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fault_uplift() {
        let config = MountainConfig::default();
        let noise = PerlinNoise::new(42);
        let hex = HexCoord::new(0, 0);

        // Test that uplift decreases with distance
        let uplift_near = fault_uplift(&hex, 0.0, &config, &noise);
        let uplift_far = fault_uplift(&hex, 10.0, &config, &noise);

        assert!(uplift_near > uplift_far);
    }

    #[test]
    fn test_generate_mountains() {
        let bounds = crate::common::Bounds::new(-2, 2, -2, 2);
        let config = MountainConfig::default();

        // Create some base elevations
        let base_elevation: Vec<(String, f32)> =
            bounds.hexes().iter().map(|h| (h.to_key(), 0.0)).collect();

        let results = generate_mountains(&bounds, 42, &base_elevation, &config);

        // Should return elevation for all hexes
        assert_eq!(results.len(), base_elevation.len());

        // All elevations should be >= base elevation (0.0)
        for (_, elev) in &results {
            assert!(*elev >= 0.0);
        }
    }

    #[test]
    fn test_mountain_config_default() {
        let config = MountainConfig::default();
        assert_eq!(config.base_uplift, 0.3);
        assert_eq!(config.decay_factor, 0.1);
    }
}
