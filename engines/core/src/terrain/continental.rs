#![allow(dead_code)]
use crate::common::{HexCoord, Rng};
use serde::{Deserialize, Serialize};

/// Plate kind
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PlateKind {
    Oceanic,
    Continental,
}

/// Plate boundary type
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BoundaryType {
    Convergent,
    Divergent,
    Transform,
}

/// Tectonic plate
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Plate {
    pub id: u32,
    pub center: HexCoord,
    pub velocity: (f32, f32),
    pub kind: PlateKind,
}

/// Result of continental generation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContinentalLayer {
    pub plates: Vec<Plate>,
    pub plate_ids: Vec<(String, u32)>, // (hex_key, plate_id)
}

/// Generate tectonic plates using Lloyd-relaxed random points
pub fn generate_plates(seed: u64, count: usize, bounds: &crate::common::Bounds) -> Vec<Plate> {
    let mut rng = Rng::from_seed(seed);
    let mut plates = Vec::with_capacity(count);

    // Generate initial plate centers using random points
    let mut centers: Vec<HexCoord> = Vec::with_capacity(count);
    let hexes = bounds.hexes();

    if hexes.is_empty() {
        return plates;
    }

    // Randomly select initial centers
    for _i in 0..count {
        let idx = rng.range_i32(0, hexes.len() as i32) as usize;
        centers.push(hexes[idx].clone());
    }

    // Lloyd relaxation: move each point to the centroid of its Voronoi region
    for _iteration in 0..3 {
        let mut new_centers = vec![HexCoord::new(0, 0); count];
        let mut counts = vec![0usize; count];

        for hex in &hexes {
            // Find nearest center
            let mut min_dist = i32::MAX;
            let mut nearest_idx = 0;

            for (idx, center) in centers.iter().enumerate() {
                let dist = hex.distance(center);
                if dist < min_dist {
                    min_dist = dist;
                    nearest_idx = idx;
                }
            }

            new_centers[nearest_idx].q += hex.q;
            new_centers[nearest_idx].r += hex.r;
            counts[nearest_idx] += 1;
        }

        // Compute centroids
        for (i, (center, count)) in new_centers.iter_mut().zip(counts.iter()).enumerate() {
            if *count > 0 {
                center.q /= *count as i32;
                center.r /= *count as i32;
            } else {
                // Keep original if no points assigned
                *center = centers[i].clone();
            }
        }

        centers = new_centers;
    }

    // Create plates with random velocities and kinds
    for (i, center) in centers.iter().enumerate() {
        let velocity = (rng.range_f32(-0.1, 0.1), rng.range_f32(-0.1, 0.1));
        let kind = if rng.next_f32() < 0.4 {
            PlateKind::Oceanic
        } else {
            PlateKind::Continental
        };

        plates.push(Plate {
            id: i as u32,
            center: center.clone(),
            velocity,
            kind,
        });
    }

    plates
}

/// Determine which plate a hex belongs to and compute continental mask
pub fn continental_mask(plates: &[Plate], hex: &HexCoord) -> (bool, f32, Option<u32>) {
    if plates.is_empty() {
        return (false, 0.0, None);
    }

    // Find nearest plate
    let mut min_dist = i32::MAX;
    let mut nearest_plate = &plates[0];

    for plate in plates {
        let dist = hex.distance(&plate.center);
        if dist < min_dist {
            min_dist = dist;
            nearest_plate = plate;
        }
    }

    // Determine if land based on plate kind
    let is_land = nearest_plate.kind == PlateKind::Continental;

    // Base elevation: continental plates are higher
    let base_elevation = if is_land {
        0.1 // Continental plates start above sea level
    } else {
        -0.2 // Oceanic plates start below sea level
    };

    (is_land, base_elevation, Some(nearest_plate.id))
}

/// Generate continental layer for a region
pub fn generate_continents(
    bounds: &crate::common::Bounds,
    seed: u64,
    plate_count: usize,
) -> ContinentalLayer {
    let plates = generate_plates(seed, plate_count, bounds);
    let mut plate_ids = Vec::new();

    for hex in bounds.hexes() {
        let (_, _, plate_id) = continental_mask(&plates, &hex);
        if let Some(id) = plate_id {
            plate_ids.push((hex.to_key(), id));
        }
    }

    ContinentalLayer { plates, plate_ids }
}

/// Determine plate boundary type between two plates based on their velocities
///
/// # Arguments
/// * `plate1` - First plate
/// * `plate2` - Second plate
///
/// # Returns
/// The boundary type (convergent, divergent, or transform)
pub fn determine_boundary_type(plate1: &Plate, plate2: &Plate) -> BoundaryType {
    // Calculate relative velocity
    let rel_vx = plate1.velocity.0 - plate2.velocity.0;
    let rel_vy = plate1.velocity.1 - plate2.velocity.1;

    // Calculate vector from plate1 to plate2
    let dx = plate2.center.q as f32 - plate1.center.q as f32;
    let dy = plate2.center.r as f32 - plate1.center.r as f32;

    // Normalize direction vector
    let dist = (dx * dx + dy * dy).sqrt();
    if dist < 0.001 {
        return BoundaryType::Transform; // Plates at same position
    }
    let dir_x = dx / dist;
    let dir_y = dy / dist;

    // Calculate dot product of relative velocity with direction.
    // rel_v = v1 - v2  is velocity of plate1 relative to plate2.
    // dir   = unit vector from plate1 toward plate2.
    //
    // dot_product > 0: plate1 moves toward plate2 → convergent
    // dot_product < 0: plate1 moves away from plate2 → divergent
    // dot_product ≈ 0: lateral motion → transform
    let dot_product = rel_vx * dir_x + rel_vy * dir_y;

    const DIVERGENT_THRESHOLD: f32 = -0.01;
    const CONVERGENT_THRESHOLD: f32 = 0.01;

    if dot_product > CONVERGENT_THRESHOLD {
        BoundaryType::Convergent
    } else if dot_product < DIVERGENT_THRESHOLD {
        BoundaryType::Divergent
    } else {
        BoundaryType::Transform
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::common::Bounds;

    #[test]
    fn test_determine_boundary_type_convergent() {
        let plate1 = Plate {
            id: 0,
            center: HexCoord::new(0, 0),
            velocity: (0.1, 0.0), // Moving right
            kind: PlateKind::Continental,
        };
        let plate2 = Plate {
            id: 1,
            center: HexCoord::new(5, 0), // To the right
            velocity: (-0.1, 0.0),       // Moving left (toward plate1)
            kind: PlateKind::Oceanic,
        };

        let boundary_type = determine_boundary_type(&plate1, &plate2);
        assert_eq!(boundary_type, BoundaryType::Convergent);
    }

    #[test]
    fn test_determine_boundary_type_divergent() {
        let plate1 = Plate {
            id: 0,
            center: HexCoord::new(0, 0),
            velocity: (-0.1, 0.0), // Moving left
            kind: PlateKind::Continental,
        };
        let plate2 = Plate {
            id: 1,
            center: HexCoord::new(5, 0), // To the right
            velocity: (0.1, 0.0),        // Moving right (away from plate1)
            kind: PlateKind::Oceanic,
        };

        let boundary_type = determine_boundary_type(&plate1, &plate2);
        assert_eq!(boundary_type, BoundaryType::Divergent);
    }

    #[test]
    fn test_determine_boundary_type_transform() {
        let plate1 = Plate {
            id: 0,
            center: HexCoord::new(0, 0),
            velocity: (0.0, 0.1), // Moving up
            kind: PlateKind::Continental,
        };
        let plate2 = Plate {
            id: 1,
            center: HexCoord::new(5, 0), // To the right
            velocity: (0.0, 0.1),        // Also moving up (parallel)
            kind: PlateKind::Oceanic,
        };

        let boundary_type = determine_boundary_type(&plate1, &plate2);
        assert_eq!(boundary_type, BoundaryType::Transform);
    }

    #[test]
    fn test_generate_plates_count() {
        let bounds = crate::common::Bounds::new(-10, 10, -10, 10);
        let plates = generate_plates(42, 5, &bounds);

        assert_eq!(plates.len(), 5);
    }

    #[test]
    fn test_generate_plates_deterministic() {
        let bounds = crate::common::Bounds::new(-10, 10, -10, 10);

        let plates1 = generate_plates(42, 5, &bounds);
        let plates2 = generate_plates(42, 5, &bounds);

        assert_eq!(plates1.len(), plates2.len());
        for (p1, p2) in plates1.iter().zip(plates2.iter()) {
            assert_eq!(p1.id, p2.id);
            assert_eq!(p1.center, p2.center);
            assert_eq!(p1.kind, p2.kind);
        }
    }

    #[test]
    fn test_continental_mask() {
        let plates = vec![
            Plate {
                id: 0,
                center: HexCoord::new(0, 0),
                velocity: (0.0, 0.0),
                kind: PlateKind::Continental,
            },
            Plate {
                id: 1,
                center: HexCoord::new(10, 10),
                velocity: (0.0, 0.0),
                kind: PlateKind::Oceanic,
            },
        ];

        let hex = HexCoord::new(0, 0);
        let (is_land, elevation, plate_id) = continental_mask(&plates, &hex);

        assert!(is_land);
        assert!(elevation > 0.0);
        assert_eq!(plate_id, Some(0));
    }

    #[test]
    fn test_generate_continents() {
        let bounds = crate::common::Bounds::new(-5, 5, -5, 5);
        let layer = generate_continents(&bounds, 42, 3);

        assert_eq!(layer.plates.len(), 3);
        assert!(!layer.plate_ids.is_empty());
    }
}
