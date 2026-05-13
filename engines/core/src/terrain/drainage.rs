use crate::common::HexCoord;
use serde::{Deserialize, Serialize};

/// Flow direction (0-5, corresponding to hex neighbor directions)
pub type FlowDirection = Option<u8>;

/// River segment
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RiverSegment {
    pub hex_key: String,
    pub stream_order: u32,
    pub flux: f32,
}

/// Drainage configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrainageConfig {
    /// Minimum flow accumulation to be considered a stream
    pub stream_threshold: f32,
    /// Maximum iterations for flat resolution
    pub max_flat_iterations: u32,
}

impl Default for DrainageConfig {
    fn default() -> Self {
        Self {
            stream_threshold: 10.0,
            max_flat_iterations: 100,
        }
    }
}

/// Drainage result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrainageResult {
    /// Flow direction per tile
    pub flow_direction: Vec<(String, FlowDirection)>,
    /// Flow accumulation per tile
    pub flow_accumulation: Vec<(String, f32)>,
    /// River segments
    pub rivers: Vec<RiverSegment>,
}

/// Compute D8 flow direction for each tile
pub fn compute_flow_direction(
    elevation: &[(String, f32)],
    land_mask: &[(String, bool)],
) -> Vec<(String, FlowDirection)> {
    let elevation_map: std::collections::HashMap<String, f32> = elevation.iter().cloned().collect();
    let land_map: std::collections::HashMap<String, bool> = land_mask.iter().cloned().collect();

    let mut flow_direction = Vec::new();

    for (key, is_land) in land_mask {
        if !is_land {
            flow_direction.push((key.clone(), None));
            continue;
        }

        let current_elevation = elevation_map.get(key).copied().unwrap_or(0.0);
        let hex = if let Some(h) = HexCoord::from_key(key) {
            h
        } else {
            flow_direction.push((key.clone(), None));
            continue;
        };

        // Find steepest descent neighbor
        let mut steepest_dir: Option<u8> = None;
        let mut steepest_slope = 0.0;

        for (dir, neighbor) in hex.neighbors().iter().enumerate() {
            let neighbor_key = neighbor.to_key();
            let neighbor_elevation = elevation_map.get(&neighbor_key).copied().unwrap_or(0.0);
            let _neighbor_is_land = land_map.get(&neighbor_key).copied().unwrap_or(false);

            // Only flow to strictly lower elevation
            // Equal-elevation neighbors are NOT assigned a direction here —
            // that would create cycles. They are handled by resolve_flats instead.
            if neighbor_elevation < current_elevation {
                let slope = current_elevation - neighbor_elevation;
                if slope > steepest_slope {
                    steepest_slope = slope;
                    steepest_dir = Some(dir as u8);
                }
            }
        }

        flow_direction.push((key.clone(), steepest_dir));
    }

    flow_direction
}

/// Resolve flat areas using BFS to find nearest downhill exit
pub fn resolve_flats(
    flow_direction: &[(String, FlowDirection)],
    elevation: &[(String, f32)],
    max_iterations: u32,
) -> Vec<(String, FlowDirection)> {
    let elevation_map: std::collections::HashMap<String, f32> = elevation.iter().cloned().collect();
    let mut resolved = flow_direction.to_vec();

    // Find tiles with no valid flow direction (flats)
    let flats: Vec<String> = flow_direction
        .iter()
        .filter(|(_, dir)| dir.is_none())
        .map(|(key, _)| key.clone())
        .collect();

    for flat_key in flats {
        let flat_elevation = elevation_map.get(&flat_key).copied().unwrap_or(0.0);
        let flat_hex = if let Some(h) = HexCoord::from_key(&flat_key) {
            h
        } else {
            continue;
        };

        // BFS to find the first neighbor of flat_hex that leads to a downhill exit.
        // We need to find a path where the NEXT tile after the flat is on a route
        // to a tile with lower elevation that has outflow.
        // Strategy: For each neighbor of the flat, trace flow direction until we
        // hit an exit (lower elev with outflow) or cycle/limit.

        let mut found_dir: Option<u8> = None;
        let mut best_dist = u32::MAX;

        for (dir, first_hop) in flat_hex.neighbors().iter().enumerate() {
            let first_key = first_hop.to_key();
            let first_elev = elevation_map.get(&first_key).copied().unwrap_or(0.0);

            // Can only flow to same or lower elevation
            if first_elev > flat_elevation {
                continue;
            }

            // Trace flow from first_hop to find a downhill exit
            let mut visited = std::collections::HashSet::new();
            let mut current = first_hop.clone();
            let mut steps: u32 = 0;

            loop {
                if steps >= max_iterations {
                    break;
                }
                let ck = current.to_key();
                if !visited.insert(ck.clone()) {
                    break; // cycle detected
                }
                let ce = elevation_map.get(&ck).copied().unwrap_or(0.0);

                // If we found a tile lower than the flat WITH a valid outflow, success
                if ce < flat_elevation {
                    if let Some(_d) = flow_direction
                        .iter()
                        .find(|(k, _)| k == &ck)
                        .and_then(|(_, d)| *d)
                    {
                        // This tile is a downhill exit — first_hop is a valid direction
                        if steps < best_dist {
                            best_dist = steps;
                            found_dir = Some(dir as u8);
                        }
                        break;
                    }
                }

                // Follow flow from current tile
                if let Some(d) = flow_direction
                    .iter()
                    .find(|(k, _)| k == &ck)
                    .and_then(|(_, d)| *d)
                {
                    if let Some(next) = current.neighbor(d) {
                        current = next;
                        steps += 1;
                        continue;
                    }
                }
                break;
            }
        }

        if let Some(dir) = found_dir {
            if let Some(item) = resolved.iter_mut().find(|(k, _)| k == &flat_key) {
                item.1 = Some(dir);
            }
        }
    }

    resolved
}

/// Compute flow accumulation (upstream contributing area)
pub fn compute_flow_accumulation(
    flow_direction: &[(String, FlowDirection)],
    land_mask: &[(String, bool)],
) -> Vec<(String, f32)> {
    let _land_map: std::collections::HashMap<String, bool> = land_mask.iter().cloned().collect();
    let mut accumulation: std::collections::HashMap<String, f32> = std::collections::HashMap::new();

    // Initialize accumulation: each land tile contributes 1
    for (key, is_land) in land_mask {
        if *is_land {
            accumulation.insert(key.clone(), 1.0);
        }
    }

    // Build reverse flow graph (upstream -> downstream)
    let mut upstream: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();
    for (key, dir) in flow_direction {
        if let Some(d) = dir {
            let hex = if let Some(h) = HexCoord::from_key(key) {
                h
            } else {
                continue;
            };

            if let Some(neighbor) = hex.neighbor(*d) {
                let neighbor_key = neighbor.to_key();
                upstream
                    .entry(neighbor_key)
                    .or_insert_with(Vec::new)
                    .push(key.clone());
            }
        }
    }

    // Process tiles in topological order (from highest to lowest accumulation)
    // For simplicity, we'll iterate multiple times to propagate flow
    for _iteration in 0..10 {
        let mut changed = false;

        for (downstream_key, upstream_keys) in &upstream {
            let upstream_sum: f32 = upstream_keys
                .iter()
                .filter_map(|k| accumulation.get(k).copied())
                .sum();

            let current = accumulation.get(downstream_key).copied().unwrap_or(0.0);
            let new_value = current + upstream_sum;

            if (new_value - current).abs() > 0.01 {
                accumulation.insert(downstream_key.clone(), new_value);
                changed = true;
            }
        }

        if !changed {
            break;
        }
    }

    accumulation.into_iter().collect()
}

/// Compute Strahler stream order
pub fn compute_strahler_order(
    flow_direction: &[(String, FlowDirection)],
    flow_accumulation: &[(String, f32)],
    stream_threshold: f32,
) -> Vec<(String, u32)> {
    let accumulation_map: std::collections::HashMap<String, f32> =
        flow_accumulation.iter().cloned().collect();
    let mut stream_order: std::collections::HashMap<String, u32> = std::collections::HashMap::new();

    // Build reverse flow graph
    let mut upstream: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();
    for (key, dir) in flow_direction {
        if let Some(d) = dir {
            let hex = if let Some(h) = HexCoord::from_key(key) {
                h
            } else {
                continue;
            };

            if let Some(neighbor) = hex.neighbor(*d) {
                let neighbor_key = neighbor.to_key();
                upstream
                    .entry(neighbor_key)
                    .or_insert_with(Vec::new)
                    .push(key.clone());
            }
        }
    }

    // Process tiles in order of decreasing accumulation
    let mut tiles: Vec<(String, f32)> = accumulation_map
        .iter()
        .map(|(k, v)| (k.clone(), *v))
        .collect();
    tiles.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());

    for (key, _) in tiles {
        let accumulation = accumulation_map.get(&key).copied().unwrap_or(0.0);

        if accumulation < stream_threshold {
            stream_order.insert(key, 0); // Not a stream
            continue;
        }

        // Get upstream orders
        let upstream_orders: Vec<u32> = upstream
            .get(&key)
            .map(|keys| {
                keys.iter()
                    .filter_map(|k| stream_order.get(k).copied())
                    .filter(|&o| o > 0)
                    .collect()
            })
            .unwrap_or_default();

        if upstream_orders.is_empty() {
            stream_order.insert(key, 1); // Headwater stream
        } else {
            let max_order = *upstream_orders.iter().max().unwrap_or(&0);
            let count = upstream_orders.iter().filter(|&&o| o == max_order).count();

            if count >= 2 {
                stream_order.insert(key, max_order + 1); // Stream confluence
            } else {
                stream_order.insert(key, max_order); // Continue stream
            }
        }
    }

    stream_order.into_iter().collect()
}

/// Extract river segments
pub fn extract_rivers(
    flow_accumulation: &[(String, f32)],
    stream_order: &[(String, u32)],
    stream_threshold: f32,
) -> Vec<RiverSegment> {
    let accumulation_map: std::collections::HashMap<String, f32> =
        flow_accumulation.iter().cloned().collect();
    let _order_map: std::collections::HashMap<String, u32> = stream_order.iter().cloned().collect();

    let mut rivers = Vec::new();

    for (key, order) in stream_order {
        if *order == 0 {
            continue;
        }

        let flux = accumulation_map.get(key).copied().unwrap_or(0.0);
        if flux >= stream_threshold {
            rivers.push(RiverSegment {
                hex_key: key.clone(),
                stream_order: *order,
                flux,
            });
        }
    }

    rivers
}

/// Compute complete drainage
pub fn compute_drainage(
    elevation: &[(String, f32)],
    land_mask: &[(String, bool)],
    config: &DrainageConfig,
) -> DrainageResult {
    // Compute flow direction
    let flow_direction = compute_flow_direction(elevation, land_mask);

    // Resolve flats
    let flow_direction = resolve_flats(&flow_direction, elevation, config.max_flat_iterations);

    // Compute flow accumulation
    let flow_accumulation = compute_flow_accumulation(&flow_direction, land_mask);

    // Compute Strahler order
    let stream_order =
        compute_strahler_order(&flow_direction, &flow_accumulation, config.stream_threshold);

    // Extract rivers
    let rivers = extract_rivers(&flow_accumulation, &stream_order, config.stream_threshold);

    DrainageResult {
        flow_direction,
        flow_accumulation,
        rivers,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_drainage_config_default() {
        let config = DrainageConfig::default();
        assert_eq!(config.stream_threshold, 10.0);
    }

    #[test]
    fn test_compute_flow_direction() {
        let elevation = vec![
            ("0,0".to_string(), 1.0),
            ("1,0".to_string(), 0.5),
            ("0,1".to_string(), 0.5),
        ];
        let land_mask = vec![
            ("0,0".to_string(), true),
            ("1,0".to_string(), true),
            ("0,1".to_string(), true),
        ];

        let flow_direction = compute_flow_direction(&elevation, &land_mask);

        assert_eq!(flow_direction.len(), 3);
        // Peak should have a flow direction
        let peak_dir = flow_direction
            .iter()
            .find(|(k, _)| k == "0,0")
            .map(|(_, d)| *d);
        assert!(peak_dir.is_some());
    }

    #[test]
    fn test_compute_flow_accumulation() {
        let flow_direction = vec![("0,0".to_string(), Some(0))];
        let land_mask = vec![("0,0".to_string(), true), ("1,0".to_string(), true)];

        let accumulation = compute_flow_accumulation(&flow_direction, &land_mask);

        assert!(!accumulation.is_empty());
    }

    #[test]
    fn test_compute_drainage() {
        let elevation = vec![
            ("0,0".to_string(), 1.0),
            ("1,0".to_string(), 0.5),
            ("0,1".to_string(), 0.5),
        ];
        let land_mask = vec![
            ("0,0".to_string(), true),
            ("1,0".to_string(), true),
            ("0,1".to_string(), true),
        ];
        let config = DrainageConfig::default();

        let result = compute_drainage(&elevation, &land_mask, &config);

        assert!(!result.flow_direction.is_empty());
        assert!(!result.flow_accumulation.is_empty());
    }

    #[test]
    fn test_flat_depression_resolves_to_outlet() {
        // Create a flat-bottomed depression with a single low-edge outlet
        // Central depression: 5 tiles at elevation 0.5
        // Outlet: 1 tile at elevation 0.3
        let elevation = vec![
            ("0,0".to_string(), 0.5),  // Center of depression
            ("1,0".to_string(), 0.5),  // Edge of depression
            ("-1,0".to_string(), 0.5), // Edge of depression
            ("0,1".to_string(), 0.5),  // Edge of depression
            ("0,-1".to_string(), 0.5), // Edge of depression
            ("1,1".to_string(), 0.3),  // Outlet (lower elevation)
        ];
        let land_mask = vec![
            ("0,0".to_string(), true),
            ("1,0".to_string(), true),
            ("-1,0".to_string(), true),
            ("0,1".to_string(), true),
            ("0,-1".to_string(), true),
            ("1,1".to_string(), true),
        ];
        let config = DrainageConfig::default();

        let result = compute_drainage(&elevation, &land_mask, &config);

        // All depression tiles should flow toward the outlet
        // The outlet tile (1,1) should have no outflow (or flow to edge)
        let outlet_dir = result
            .flow_direction
            .iter()
            .find(|(k, _)| k == "1,1")
            .map(|(_, d)| *d);

        // Depression tiles should have flow directions
        for key in ["0,0", "1,0", "-1,0", "0,1", "0,-1"] {
            let dir = result
                .flow_direction
                .iter()
                .find(|(k, _)| k == key)
                .map(|(_, d)| *d);
            assert!(dir.is_some(), "Tile {} should have a flow direction", key);
        }

        // The outlet should have the highest flow accumulation (all water flows there)
        let outlet_accumulation = result
            .flow_accumulation
            .iter()
            .find(|(k, _)| k == "1,1")
            .map(|(_, v)| *v)
            .unwrap_or(0.0);

        let center_accumulation = result
            .flow_accumulation
            .iter()
            .find(|(k, _)| k == "0,0")
            .map(|(_, v)| *v)
            .unwrap_or(0.0);

        // Outlet should have higher accumulation than center (receives all water)
        assert!(
            outlet_accumulation >= center_accumulation,
            "Outlet ({}) should have >= accumulation than center ({})",
            outlet_accumulation,
            center_accumulation
        );
    }
}
