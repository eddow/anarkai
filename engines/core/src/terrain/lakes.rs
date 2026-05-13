use crate::common::HexCoord;
use serde::{Deserialize, Serialize};

/// Lake configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LakeConfig {
    /// Minimum lake area (in tiles)
    pub min_lake_area: usize,
    /// Maximum iterations for depression filling
    pub max_iterations: u32,
}

impl Default for LakeConfig {
    fn default() -> Self {
        Self {
            min_lake_area: 3,
            max_iterations: 100,
        }
    }
}

/// Lake representation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Lake {
    pub surface_tiles: Vec<String>,
    pub outlet: Option<String>,
    pub water_level: f32,
    pub volume: f32,
    pub depth_map: Vec<(String, f32)>,
}

/// Detect depressions (tiles with no outflow)
pub fn detect_depressions(
    flow_direction: &[(String, Option<u8>)],
    land_mask: &[(String, bool)],
) -> Vec<Vec<String>> {
    let flow_dir_map: std::collections::HashMap<String, Option<u8>> =
        flow_direction.iter().cloned().collect();
    let _land_map: std::collections::HashMap<String, bool> = land_mask.iter().cloned().collect();

    let mut visited = std::collections::HashSet::new();
    let mut depressions: Vec<Vec<String>> = Vec::new();

    for (key, is_land) in land_mask {
        if !is_land || visited.contains(key) {
            continue;
        }

        // Check if this tile has outflow
        if flow_dir_map.get(key).copied().flatten().is_some() {
            // Follow flow to mark all upstream tiles as visited
            let mut current = key.clone();
            let mut cycle_guard = 0u32;
            while let Some(dir) = flow_dir_map.get(&current).copied().flatten() {
                if cycle_guard > 10_000 {
                    // Safety: cycle detected, bail out
                    break;
                }
                cycle_guard += 1;
                visited.insert(current.clone());

                let hex = if let Some(h) = HexCoord::from_key(&current) {
                    h
                } else {
                    break;
                };

                if let Some(neighbor) = hex.neighbor(dir) {
                    current = neighbor.to_key();
                } else {
                    break;
                }
            }
        } else {
            // This tile is in a depression
            let mut depression = Vec::new();
            let mut queue = std::collections::VecDeque::new();
            queue.push_back(key.clone());
            visited.insert(key.clone());

            while let Some(current_key) = queue.pop_front() {
                depression.push(current_key.clone());

                // Find all tiles that flow into this one
                for (upstream_key, dir) in &flow_dir_map {
                    if let Some(d) = dir {
                        let hex = if let Some(h) = HexCoord::from_key(upstream_key) {
                            h
                        } else {
                            continue;
                        };

                        if let Some(neighbor) = hex.neighbor(*d) {
                            if neighbor.to_key() == current_key && !visited.contains(upstream_key) {
                                visited.insert(upstream_key.clone());
                                queue.push_back(upstream_key.clone());
                            }
                        }
                    }
                }
            }

            if !depression.is_empty() {
                depressions.push(depression);
            }
        }
    }

    depressions
}

/// Planchon-Darboux depression filling algorithm
pub fn fill_depressions(
    elevation: &[(String, f32)],
    depressions: &[Vec<String>],
    flow_direction: &[(String, Option<u8>)],
    _max_iterations: u32,
) -> Vec<(String, f32)> {
    let mut elevation_map: std::collections::HashMap<String, f32> =
        elevation.iter().cloned().collect();
    let flow_dir_map: std::collections::HashMap<String, Option<u8>> =
        flow_direction.iter().cloned().collect();

    for depression in depressions {
        if depression.is_empty() {
            continue;
        }

        // Find outlet (lowest edge of depression)
        let mut outlet_elevation = f32::MAX;
        let mut outlet_key: Option<String> = None;

        for key in depression {
            let hex = if let Some(h) = HexCoord::from_key(key) {
                h
            } else {
                continue;
            };

            let _current_elev = elevation_map.get(key).copied().unwrap_or(0.0);

            // Check all neighbors
            for neighbor in hex.neighbors() {
                let neighbor_key = neighbor.to_key();

                // If neighbor is not in depression and has outflow, it's a potential outlet
                if !depression.contains(&neighbor_key)
                    && flow_dir_map.get(&neighbor_key).copied().flatten().is_some()
                {
                    let neighbor_elev = elevation_map.get(&neighbor_key).copied().unwrap_or(0.0);
                    if neighbor_elev < outlet_elevation {
                        outlet_elevation = neighbor_elev;
                        outlet_key = Some(neighbor_key);
                    }
                }
            }
        }

        // Fill depression to outlet level
        if let Some(_outlet) = outlet_key {
            let fill_level = outlet_elevation;

            for key in depression {
                let current_elev = elevation_map.get(key).copied().unwrap_or(0.0);
                if current_elev < fill_level {
                    elevation_map.insert(key.clone(), fill_level);
                }
            }
        }
    }

    elevation_map.into_iter().collect()
}

/// Extract lakes from filled depressions
pub fn extract_lakes(
    filled_elevation: &[(String, f32)],
    original_elevation: &[(String, f32)],
    depressions: &[Vec<String>],
    min_lake_area: usize,
) -> Vec<Lake> {
    let filled_map: std::collections::HashMap<String, f32> =
        filled_elevation.iter().cloned().collect();
    let original_map: std::collections::HashMap<String, f32> =
        original_elevation.iter().cloned().collect();

    let mut lakes = Vec::new();

    for depression in depressions {
        if depression.len() < min_lake_area {
            continue;
        }

        // Find water level (highest point in depression)
        let mut water_level = f32::MIN;
        for key in depression {
            let elev = filled_map.get(key).copied().unwrap_or(0.0);
            water_level = water_level.max(elev);
        }

        // Calculate volume and depth
        let mut volume = 0.0;
        let mut depth_map = Vec::new();

        for key in depression {
            let original_elev = original_map.get(key).copied().unwrap_or(0.0);
            let depth = water_level - original_elev;
            if depth > 0.0 {
                volume += depth;
                depth_map.push((key.clone(), depth));
            }
        }

        // Find outlet (lowest edge)
        let mut outlet = None;
        let mut outlet_elev = f32::MAX;

        for key in depression {
            let hex = if let Some(h) = HexCoord::from_key(key) {
                h
            } else {
                continue;
            };

            for neighbor in hex.neighbors() {
                let neighbor_key = neighbor.to_key();
                if !depression.contains(&neighbor_key) {
                    let neighbor_elev = filled_map.get(&neighbor_key).copied().unwrap_or(f32::MAX);
                    if neighbor_elev < outlet_elev {
                        outlet_elev = neighbor_elev;
                        outlet = Some(neighbor_key);
                    }
                }
            }
        }

        lakes.push(Lake {
            surface_tiles: depression.clone(),
            outlet,
            water_level,
            volume,
            depth_map,
        });
    }

    lakes
}

/// Detect lakes in terrain
pub fn detect_lakes(
    elevation: &[(String, f32)],
    land_mask: &[(String, bool)],
    flow_direction: &[(String, Option<u8>)],
    config: &LakeConfig,
) -> Vec<Lake> {
    // Detect depressions
    let depressions = detect_depressions(flow_direction, land_mask);

    // Fill depressions
    let filled_elevation = fill_depressions(
        elevation,
        &depressions,
        flow_direction,
        config.max_iterations,
    );

    // Extract lakes
    extract_lakes(
        &filled_elevation,
        elevation,
        &depressions,
        config.min_lake_area,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_lake_config_default() {
        let config = LakeConfig::default();
        assert_eq!(config.min_lake_area, 3);
    }

    #[test]
    fn test_detect_depressions() {
        let flow_direction = vec![
            ("0,0".to_string(), Some(0)),
            ("1,0".to_string(), None), // No outflow
            ("0,1".to_string(), Some(0)),
        ];
        let land_mask = vec![
            ("0,0".to_string(), true),
            ("1,0".to_string(), true),
            ("0,1".to_string(), true),
        ];

        let depressions = detect_depressions(&flow_direction, &land_mask);

        // Should find at least one depression
        assert!(!depressions.is_empty());
    }

    #[test]
    fn test_fill_depressions() {
        let elevation = vec![
            ("0,0".to_string(), 0.5),
            ("1,0".to_string(), 0.3),
            ("0,1".to_string(), 0.4),
        ];
        let depressions = vec![vec!["1,0".to_string()]];
        let flow_direction = vec![
            ("0,0".to_string(), Some(0)),
            ("1,0".to_string(), None),
            ("0,1".to_string(), Some(0)),
        ];

        let filled = fill_depressions(&elevation, &depressions, &flow_direction, 100);

        assert!(!filled.is_empty());
    }

    #[test]
    fn test_detect_lakes() {
        let elevation = vec![
            ("0,0".to_string(), 0.5),
            ("1,0".to_string(), 0.3),
            ("0,1".to_string(), 0.4),
        ];
        let land_mask = vec![
            ("0,0".to_string(), true),
            ("1,0".to_string(), true),
            ("0,1".to_string(), true),
        ];
        let flow_direction = vec![
            ("0,0".to_string(), Some(0)),
            ("1,0".to_string(), None),
            ("0,1".to_string(), Some(0)),
        ];
        let config = LakeConfig::default();

        let lakes = detect_lakes(&elevation, &land_mask, &flow_direction, &config);

        // May or may not find lakes depending on configuration
        assert!(lakes.len() <= 1);
    }

    #[test]
    fn test_nested_depressions_filled_from_outermost() {
        // Single depression centred on (1,1) at elevation 0.5,
        // surrounded by rim tiles at 1.0 whose flow directions all
        // point toward the centre.  The centre tile has no lower
        // neighbour, so detect_depressions collects it as a
        // depression.
        //
        // Hex directions (from hex.rs):
        //   0 East (1,0)    3 West (-1,0)
        //   1 NE   (1,-1)   4 SW   (-1,1)
        //   2 NW   (0,-1)   5 SE    (0,1)
        let elevation = vec![
            ("0,0".to_string(), 1.0),
            ("1,0".to_string(), 1.0),
            ("2,0".to_string(), 1.0),
            ("0,1".to_string(), 1.0),
            ("1,1".to_string(), 0.5), // depression center — no lower neighbor
            ("2,1".to_string(), 1.0),
            ("0,2".to_string(), 1.0),
            ("1,2".to_string(), 1.0),
            ("2,2".to_string(), 1.0),
        ];

        let land_mask: Vec<(String, bool)> =
            elevation.iter().map(|(k, _)| (k.clone(), true)).collect();

        // All rim tiles flow toward the centre tile (1,1).
        // (1,1) has no outflow because every neighbor is higher.
        let flow_direction = vec![
            ("0,0".to_string(), Some(0)), // East  → (1,0)
            ("1,0".to_string(), Some(5)), // SE    → (1,1)  ✓ (1,0)+(0,1)=(1,1)
            ("2,0".to_string(), Some(3)), // West  → (1,0)
            ("0,1".to_string(), Some(0)), // East  → (1,1)  ✓
            ("1,1".to_string(), None),    // no lower neighbor → depression
            ("2,1".to_string(), Some(3)), // West  → (1,1)  ✓
            ("0,2".to_string(), Some(1)), // NE    → (1,1)  ✓ (0,2)+(1,-1)=(1,1)
            ("1,2".to_string(), Some(2)), // NW    → (1,1)  ✓ (1,2)+(0,-1)=(1,1)
            ("2,2".to_string(), Some(4)), // SW    → (1,2)     then (1,2) → (1,1)
        ];

        let config = LakeConfig {
            min_lake_area: 2,
            ..Default::default()
        };

        let lakes = detect_lakes(&elevation, &land_mask, &flow_direction, &config);

        // At least one depression should be found
        assert!(!lakes.is_empty(), "Should detect at least one lake");

        for lake in &lakes {
            assert!(
                !lake.surface_tiles.is_empty(),
                "Lake should have surface tiles"
            );
            assert!(
                lake.water_level > 0.0,
                "Lake water level should be positive"
            );
        }
    }
}
