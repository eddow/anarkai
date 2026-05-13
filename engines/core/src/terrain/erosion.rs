use crate::common::{HexCoord, Rng};
use serde::{Deserialize, Serialize};

/// Erosion configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErosionConfig {
    /// Number of droplets to simulate
    pub droplet_count: u32,
    /// Maximum steps a droplet can take
    pub max_steps: u32,
    /// Amount of sediment a droplet can carry
    pub sediment_capacity: f32,
    /// Rate at which sediment is deposited
    pub deposition_rate: f32,
    /// Rate at which sediment is eroded
    pub erosion_rate: f32,
    /// Evaporation rate (water loss per step)
    pub evaporation_rate: f32,
    /// Minimum slope for erosion
    pub min_slope: f32,
}

impl Default for ErosionConfig {
    fn default() -> Self {
        Self {
            droplet_count: 500,
            max_steps: 100,
            sediment_capacity: 4.0,
            deposition_rate: 0.3,
            erosion_rate: 0.1,
            evaporation_rate: 0.01,
            min_slope: 0.001,
        }
    }
}

/// Erosion result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErosionResult {
    /// Eroded elevation values
    pub elevation: Vec<(String, f32)>,
    /// Sediment deposition per tile
    pub sediment: Vec<(String, f32)>,
}

/// Water droplet for erosion simulation
struct Droplet {
    x: f32,
    y: f32,
    velocity: (f32, f32),
    water: f32,
    sediment: f32,
}

/// Simulate hydraulic erosion on elevation map
pub fn simulate_erosion(
    elevation: &[(String, f32)],
    seed: u64,
    config: &ErosionConfig,
) -> ErosionResult {
    if elevation.is_empty() {
        return ErosionResult {
            elevation: elevation.to_vec(),
            sediment: Vec::new(),
        };
    }

    // Convert elevation to mutable map
    let mut elevation_map: std::collections::HashMap<String, f32> =
        elevation.iter().cloned().collect();
    let mut sediment_map: std::collections::HashMap<String, f32> = std::collections::HashMap::new();

    let mut rng = Rng::from_seed(seed);

    // Simulate droplets
    for _ in 0..config.droplet_count {
        // Spawn droplet at random location
        let spawn_idx = rng.range_i32(0, elevation.len() as i32) as usize;
        let spawn_key = &elevation[spawn_idx].0;

        // Parse spawn coordinate (simplified - assume we can get world coords)
        let spawn_hex = if let Some(h) = HexCoord::from_key(spawn_key) {
            h
        } else {
            continue;
        };

        let mut droplet = Droplet {
            x: spawn_hex.q as f32,
            y: spawn_hex.r as f32,
            velocity: (0.0, 0.0),
            water: 1.0,
            sediment: 0.0,
        };

        // Simulate droplet path
        for _step in 0..config.max_steps {
            // Get current position elevation
            let current_key = format!("{},{}", droplet.x.floor() as i32, droplet.y.floor() as i32);
            let current_elevation = elevation_map.get(&current_key).copied().unwrap_or(0.0);

            // Find steepest descent neighbor
            let (steepest_key, steepest_slope) =
                find_steepest_descent(&elevation_map, droplet.x, droplet.y, config.min_slope);

            // If no steepest descent found, stop
            if steepest_key.is_none() || steepest_slope < config.min_slope {
                // Deposit remaining sediment
                if let Some(key) = &steepest_key {
                    let current_sediment = sediment_map.get(key).copied().unwrap_or(0.0);
                    sediment_map.insert(key.clone(), current_sediment + droplet.sediment);
                }
                break;
            }

            let steepest_key = steepest_key.unwrap();
            let steepest_elevation = elevation_map.get(&steepest_key).copied().unwrap_or(0.0);

            // Calculate sediment capacity
            let slope_diff = current_elevation - steepest_elevation;
            let capacity = config.sediment_capacity * droplet.water * slope_diff;

            // Deposit or erode sediment
            if droplet.sediment > capacity {
                // Deposit excess sediment
                let deposit = (droplet.sediment - capacity) * config.deposition_rate;
                droplet.sediment -= deposit;

                let current_sediment = sediment_map.get(&current_key).copied().unwrap_or(0.0);
                sediment_map.insert(current_key.clone(), current_sediment + deposit);

                // Increase elevation at current position
                let current_elev = elevation_map.get(&current_key).copied().unwrap_or(0.0);
                elevation_map.insert(current_key.clone(), current_elev + deposit);
            } else {
                // Erode sediment
                let erode = (capacity - droplet.sediment).min(config.erosion_rate);
                droplet.sediment += erode;

                // Decrease elevation at current position
                let current_elev = elevation_map.get(&current_key).copied().unwrap_or(0.0);
                elevation_map.insert(current_key.clone(), (current_elev - erode).max(-1.0));
            }

            // Update velocity and position
            droplet.velocity.0 += slope_diff * 0.1;
            droplet.velocity.1 += slope_diff * 0.1;

            // Move droplet
            let parts: Vec<&str> = steepest_key.split(',').collect();
            if parts.len() == 2 {
                if let (Ok(q), Ok(r)) = (parts[0].parse::<i32>(), parts[1].parse::<i32>()) {
                    droplet.x = q as f32;
                    droplet.y = r as f32;
                }
            }

            // Evaporate water
            droplet.water *= 1.0 - config.evaporation_rate;

            if droplet.water < 0.01 {
                // Deposit remaining sediment
                let current_sediment = sediment_map.get(&current_key).copied().unwrap_or(0.0);
                sediment_map.insert(current_key.clone(), current_sediment + droplet.sediment);
                break;
            }
        }
    }

    // Convert results back to vectors
    let elevation_result: Vec<(String, f32)> = elevation_map.into_iter().collect();
    let sediment_result: Vec<(String, f32)> = sediment_map.into_iter().collect();

    ErosionResult {
        elevation: elevation_result,
        sediment: sediment_result,
    }
}

/// Find steepest descent direction from current position
fn find_steepest_descent(
    elevation_map: &std::collections::HashMap<String, f32>,
    x: f32,
    y: f32,
    min_slope: f32,
) -> (Option<String>, f32) {
    let current_q = x.floor() as i32;
    let current_r = y.floor() as i32;
    let current_key = format!("{},{}", current_q, current_r);
    let current_elevation = elevation_map.get(&current_key).copied().unwrap_or(0.0);

    let mut steepest_key: Option<String> = None;
    let mut steepest_slope = 0.0;

    // Check all 6 neighbors
    let hex = HexCoord::new(current_q, current_r);
    for neighbor in hex.neighbors() {
        let neighbor_key = neighbor.to_key();
        let neighbor_elevation = elevation_map.get(&neighbor_key).copied().unwrap_or(0.0);

        let slope = current_elevation - neighbor_elevation;
        if slope > steepest_slope && slope > min_slope {
            steepest_slope = slope;
            steepest_key = Some(neighbor_key);
        }
    }

    (steepest_key, steepest_slope)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_erosion_config_default() {
        let config = ErosionConfig::default();
        assert_eq!(config.droplet_count, 500);
        assert_eq!(config.max_steps, 100);
    }

    #[test]
    fn test_simulate_erosion_empty() {
        let config = ErosionConfig::default();
        let result = simulate_erosion(&[], 42, &config);

        assert!(result.elevation.is_empty());
        assert!(result.sediment.is_empty());
    }

    #[test]
    fn test_simulate_erosion_deterministic() {
        let config = ErosionConfig {
            droplet_count: 100,
            ..Default::default()
        };

        let elevation = vec![
            ("0,0".to_string(), 0.5),
            ("1,0".to_string(), 0.3),
            ("0,1".to_string(), 0.4),
        ];

        let result1 = simulate_erosion(&elevation, 42, &config);
        let result2 = simulate_erosion(&elevation, 42, &config);

        assert_eq!(result1.elevation.len(), result2.elevation.len());

        // Sort results by key for consistent comparison
        let mut sorted1 = result1.elevation.clone();
        let mut sorted2 = result2.elevation.clone();
        sorted1.sort_by(|a, b| a.0.cmp(&b.0));
        sorted2.sort_by(|a, b| a.0.cmp(&b.0));

        for (e1, e2) in sorted1.iter().zip(sorted2.iter()) {
            assert_eq!(e1.0, e2.0);
            assert!((e1.1 - e2.1).abs() < 1e-6);
        }
    }

    #[test]
    fn test_simulate_erosion_reduces_peaks() {
        let config = ErosionConfig {
            droplet_count: 1000,
            ..Default::default()
        };

        let elevation = vec![
            ("0,0".to_string(), 1.0),
            ("1,0".to_string(), 0.0),
            ("0,1".to_string(), 0.0),
        ];

        let result = simulate_erosion(&elevation, 42, &config);

        // Peak should be reduced
        let peak_before = 1.0;
        let peak_after = result
            .elevation
            .iter()
            .find(|(k, _)| k == "0,0")
            .map(|(_, e)| *e)
            .unwrap_or(0.0);

        assert!(peak_after < peak_before);
    }
}
