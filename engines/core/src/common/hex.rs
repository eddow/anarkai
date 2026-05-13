use serde::{Deserialize, Serialize};

/// Axial hex coordinate (q, r)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct HexCoord {
    pub q: i32,
    pub r: i32,
}

impl HexCoord {
    pub fn new(q: i32, r: i32) -> Self {
        Self { q, r }
    }

    /// Convert axial to cube coordinates (q, r, s)
    pub fn to_cube(&self) -> (i32, i32, i32) {
        let s = -self.q - self.r;
        (self.q, self.r, s)
    }

    /// Convert cube coordinates to axial
    pub fn from_cube(q: i32, r: i32, _s: i32) -> Self {
        Self { q, r }
    }

    /// Get the 6 neighbors of this hex
    pub fn neighbors(&self) -> [HexCoord; 6] {
        const DIRECTIONS: [(i32, i32); 6] = [
            (1, 0),  // East
            (1, -1), // Northeast
            (0, -1), // Northwest
            (-1, 0), // West
            (-1, 1), // Southwest
            (0, 1),  // Southeast
        ];

        DIRECTIONS.map(|(dq, dr)| HexCoord::new(self.q + dq, self.r + dr))
    }

    /// Get neighbor in specific direction (0-5)
    pub fn neighbor(&self, direction: u8) -> Option<HexCoord> {
        if direction >= 6 {
            return None;
        }

        const DIRECTIONS: [(i32, i32); 6] = [
            (1, 0),  // East
            (1, -1), // Northeast
            (0, -1), // Northwest
            (-1, 0), // West
            (-1, 1), // Southwest
            (0, 1),  // Southeast
        ];

        let (dq, dr) = DIRECTIONS[direction as usize];
        Some(HexCoord::new(self.q + dq, self.r + dr))
    }

    /// Calculate distance to another hex (Manhattan distance in cube coords)
    pub fn distance(&self, other: &HexCoord) -> i32 {
        let (q1, r1, s1) = self.to_cube();
        let (q2, r2, s2) = other.to_cube();
        ((q1 - q2).abs() + (r1 - r2).abs() + (s1 - s2).abs()) / 2
    }

    /// Get all hexes in a ring at given radius
    pub fn ring(&self, radius: i32) -> Vec<HexCoord> {
        if radius == 0 {
            return vec![*self];
        }

        let mut results = Vec::with_capacity((6 * radius) as usize);
        let mut hex = *self;

        // Move to starting position on ring
        for _ in 0..radius {
            hex = hex.neighbor(4).unwrap(); // Southwest
        }

        // Walk around the ring
        for direction in 0..6 {
            for _ in 0..radius {
                results.push(hex);
                hex = hex.neighbor(direction).unwrap();
            }
        }

        results
    }

    /// Get all hexes within given radius (inclusive)
    pub fn within_radius(&self, radius: i32) -> Vec<HexCoord> {
        let mut results = Vec::new();
        for q in -radius..=radius {
            let r1 = (-radius).max(-q - radius);
            let r2 = radius.min(-q + radius);
            for r in r1..=r2 {
                results.push(HexCoord::new(self.q + q, self.r + r));
            }
        }
        results
    }

    /// Convert to string key for map storage
    pub fn to_key(&self) -> String {
        format!("{},{}", self.q, self.r)
    }

    /// Parse from string key
    pub fn from_key(key: &str) -> Option<Self> {
        let parts: Vec<&str> = key.split(',').collect();
        if parts.len() != 2 {
            return None;
        }
        let q = parts[0].parse().ok()?;
        let r = parts[1].parse().ok()?;
        Some(HexCoord::new(q, r))
    }
}

/// Bounding box for hex coordinates
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Bounds {
    pub min_q: i32,
    pub max_q: i32,
    pub min_r: i32,
    pub max_r: i32,
}

impl Bounds {
    pub fn new(min_q: i32, max_q: i32, min_r: i32, max_r: i32) -> Self {
        Self {
            min_q,
            max_q,
            min_r,
            max_r,
        }
    }

    /// Check if a hex is within bounds
    pub fn contains(&self, hex: &HexCoord) -> bool {
        hex.q >= self.min_q && hex.q <= self.max_q && hex.r >= self.min_r && hex.r <= self.max_r
    }

    /// Get all hexes within bounds
    pub fn hexes(&self) -> Vec<HexCoord> {
        let mut results = Vec::new();
        for q in self.min_q..=self.max_q {
            for r in self.min_r..=self.max_r {
                let s = -q - r;
                let min_s = (-self.max_q - self.max_r).min(-self.min_q - self.min_r);
                let max_s = (-self.max_q - self.max_r).max(-self.min_q - self.min_r);
                if s >= min_s && s <= max_s {
                    results.push(HexCoord::new(q, r));
                }
            }
        }
        results
    }

    /// Get width in hexes
    pub fn width(&self) -> i32 {
        self.max_q - self.min_q + 1
    }

    /// Get height in hexes
    pub fn height(&self) -> i32 {
        self.max_r - self.min_r + 1
    }

    /// Get total number of hexes
    pub fn count(&self) -> usize {
        self.hexes().len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hex_coord_creation() {
        let hex = HexCoord::new(3, -2);
        assert_eq!(hex.q, 3);
        assert_eq!(hex.r, -2);
    }

    #[test]
    fn test_to_cube() {
        let hex = HexCoord::new(1, -2);
        let (q, r, s) = hex.to_cube();
        assert_eq!(q, 1);
        assert_eq!(r, -2);
        assert_eq!(s, 1);
    }

    #[test]
    fn test_from_cube() {
        let hex = HexCoord::from_cube(1, -2, 1);
        assert_eq!(hex.q, 1);
        assert_eq!(hex.r, -2);
    }

    #[test]
    fn test_neighbors() {
        let hex = HexCoord::new(0, 0);
        let neighbors = hex.neighbors();
        assert_eq!(neighbors.len(), 6);
        assert!(neighbors.contains(&HexCoord::new(1, 0)));
        assert!(neighbors.contains(&HexCoord::new(1, -1)));
        assert!(neighbors.contains(&HexCoord::new(0, -1)));
        assert!(neighbors.contains(&HexCoord::new(-1, 0)));
        assert!(neighbors.contains(&HexCoord::new(-1, 1)));
        assert!(neighbors.contains(&HexCoord::new(0, 1)));
    }

    #[test]
    fn test_neighbor_direction() {
        let hex = HexCoord::new(0, 0);
        assert_eq!(hex.neighbor(0), Some(HexCoord::new(1, 0)));
        assert_eq!(hex.neighbor(1), Some(HexCoord::new(1, -1)));
        assert_eq!(hex.neighbor(2), Some(HexCoord::new(0, -1)));
        assert_eq!(hex.neighbor(3), Some(HexCoord::new(-1, 0)));
        assert_eq!(hex.neighbor(4), Some(HexCoord::new(-1, 1)));
        assert_eq!(hex.neighbor(5), Some(HexCoord::new(0, 1)));
        assert_eq!(hex.neighbor(6), None);
    }

    #[test]
    fn test_distance() {
        let a = HexCoord::new(0, 0);
        let b = HexCoord::new(3, -2);
        assert_eq!(a.distance(&b), 3);

        let c = HexCoord::new(-1, 1);
        assert_eq!(a.distance(&c), 1);
    }

    #[test]
    fn test_distance_symmetry() {
        let a = HexCoord::new(2, -1);
        let b = HexCoord::new(-3, 2);
        assert_eq!(a.distance(&b), b.distance(&a));
    }

    #[test]
    fn test_ring() {
        let center = HexCoord::new(0, 0);
        let ring = center.ring(1);
        assert_eq!(ring.len(), 6);

        let ring = center.ring(2);
        assert_eq!(ring.len(), 12);
    }

    #[test]
    fn test_within_radius() {
        let center = HexCoord::new(0, 0);
        let hexes = center.within_radius(1);
        assert_eq!(hexes.len(), 7); // center + 6 neighbors

        let hexes = center.within_radius(2);
        assert_eq!(hexes.len(), 19);
    }

    #[test]
    fn test_to_from_key() {
        let hex = HexCoord::new(3, -2);
        let key = hex.to_key();
        assert_eq!(key, "3,-2");

        let parsed = HexCoord::from_key(&key);
        assert_eq!(parsed, Some(hex));
    }

    #[test]
    fn test_bounds_contains() {
        let bounds = Bounds::new(-5, 5, -5, 5);
        assert!(bounds.contains(&HexCoord::new(0, 0)));
        assert!(bounds.contains(&HexCoord::new(5, 5)));
        assert!(!bounds.contains(&HexCoord::new(6, 0)));
    }

    #[test]
    fn test_bounds_hexes() {
        let bounds = Bounds::new(-1, 1, -1, 1);
        let hexes = bounds.hexes();
        assert!(hexes.contains(&HexCoord::new(0, 0)));
        assert!(hexes.contains(&HexCoord::new(1, 0)));
        assert!(hexes.contains(&HexCoord::new(0, 1)));
    }
}
