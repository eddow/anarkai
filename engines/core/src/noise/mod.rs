use crate::common::{fade, grad, lerp, Rng};

/// 2D Perlin noise generator with seeded permutation table
#[derive(Clone)]
pub struct PerlinNoise {
    permutation: [u32; 512],
}

impl PerlinNoise {
    /// Create a new Perlin noise generator with a given seed
    pub fn new(seed: u64) -> Self {
        let mut rng = Rng::from_seed(seed);
        let mut perm: [u32; 256] = [0; 256];

        // Initialize permutation table
        for i in 0..256 {
            perm[i] = i as u32;
        }

        // Fisher-Yates shuffle
        for i in (1..256).rev() {
            let j = rng.range_i32(0, (i + 1) as i32) as usize;
            perm.swap(i, j);
        }

        // Duplicate for easy indexing
        let mut permutation = [0u32; 512];
        for i in 0..512 {
            permutation[i] = perm[i % 256];
        }

        Self { permutation }
    }

    /// Sample 2D Perlin noise at position (x, y)
    /// Uses standard two-level hash: p[p[x] + y]
    /// Returns value in approximately [-0.7, 0.7]
    pub fn sample(&self, x: f32, y: f32) -> f32 {
        let xi = x.floor() as i32;
        let yi = y.floor() as i32;
        let xf = x - xi as f32;
        let yf = y - yi as f32;

        let u = fade(xf);
        let v = fade(yf);

        // Standard two-level Perlin hash: p[p[x] + y]
        let ix = (xi & 255) as usize;
        let iy = (yi & 255) as usize;
        let ix1 = ((xi + 1) & 255) as usize;
        let iy1 = ((yi + 1) & 255) as usize;

        let aa = self.permutation[(self.permutation[ix] as usize + iy) % 512];
        let ab = self.permutation[(self.permutation[ix] as usize + iy1) % 512];
        let ba = self.permutation[(self.permutation[ix1] as usize + iy) % 512];
        let bb = self.permutation[(self.permutation[ix1] as usize + iy1) % 512];

        // Blend results from 4 corners
        let x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1.0, yf), u);
        let x2 = lerp(grad(ab, xf, yf - 1.0), grad(bb, xf - 1.0, yf - 1.0), u);

        lerp(x1, x2, v)
    }
}

/// Fractal Brownian Motion (FBM) over Perlin noise
///
/// # Arguments
/// * `noise` - The Perlin noise generator
/// * `x` - X coordinate
/// * `y` - Y coordinate
/// * `octaves` - Number of octaves (layers of noise)
/// * `persistence` - Amplitude multiplier per octave (0-1)
/// * `lacunarity` - Frequency multiplier per octave (>1)
///
/// # Returns
/// Normalized FBM value approximately in [-1, 1]
pub fn fbm_sample(
    noise: &PerlinNoise,
    x: f32,
    y: f32,
    octaves: u32,
    persistence: f32,
    lacunarity: f32,
) -> f32 {
    let mut total = 0.0f32;
    let mut amplitude = 1.0f32;
    let mut frequency = 1.0f32;
    let mut max_value = 0.0f32;

    for _ in 0..octaves {
        total += noise.sample(x * frequency, y * frequency) * amplitude;
        max_value += amplitude;
        amplitude *= persistence;
        frequency *= lacunarity;
    }

    // Normalize to approximately [-1, 1]
    total / max_value
}

/// Domain warping for organic shapes
///
/// Uses FBM to warp the input coordinates before sampling
pub fn domain_warp(
    noise: &PerlinNoise,
    x: f32,
    y: f32,
    octaves: u32,
    persistence: f32,
    lacunarity: f32,
) -> f32 {
    let warp_x = fbm_sample(noise, x, y, octaves, persistence, lacunarity);
    let warp_y = fbm_sample(
        noise,
        x + 100.0,
        y + 100.0,
        octaves,
        persistence,
        lacunarity,
    );
    fbm_sample(
        noise,
        x + warp_x,
        y + warp_y,
        octaves,
        persistence,
        lacunarity,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_perlin_deterministic() {
        let noise1 = PerlinNoise::new(42);
        let noise2 = PerlinNoise::new(42);

        for i in 0..100 {
            let x = i as f32 * 0.1;
            let y = i as f32 * 0.2;
            assert!((noise1.sample(x, y) - noise2.sample(x, y)).abs() < 1e-6);
        }
    }

    #[test]
    fn test_perlin_different_seeds() {
        let noise1 = PerlinNoise::new(42);
        let noise2 = PerlinNoise::new(43);

        // At least some samples should differ
        let mut diff_count = 0;
        for i in 0..100 {
            let x = i as f32 * 0.1;
            let y = i as f32 * 0.2;
            if (noise1.sample(x, y) - noise2.sample(x, y)).abs() > 1e-6 {
                diff_count += 1;
            }
        }
        assert!(diff_count > 50, "Seeds should produce different results");
    }

    #[test]
    fn test_perlin_range() {
        let noise = PerlinNoise::new(42);

        for i in 0..1000 {
            let x = i as f32 * 0.1;
            let y = i as f32 * 0.2;
            let val = noise.sample(x, y);
            // Perlin noise is not strictly bounded but should be reasonable
            assert!(val.is_finite(), "Perlin value should be finite: {}", val);
            // Most values should be in a reasonable range
            if i < 100 {
                // Just check first 100 are not extreme
                assert!(val.abs() < 10.0, "Perlin value extreme: {}", val);
            }
        }
    }

    #[test]
    fn test_perlin_integer_lattice_points_are_neutral() {
        let noise = PerlinNoise::new(42);

        for x in -3..=3 {
            for y in -3..=3 {
                let val = noise.sample(x as f32, y as f32);
                assert!(
                    val.abs() < 1e-6,
                    "Perlin value at integer lattice point ({}, {}) should be 0, got {}",
                    x,
                    y,
                    val
                );
            }
        }
    }

    #[test]
    fn test_perlin_is_continuous_around_origin_lattice_point() {
        let noise = PerlinNoise::new(42);

        let center = noise.sample(1000.0, 1000.0);
        let nearby = [
            noise.sample(999.99, 1000.0),
            noise.sample(1000.01, 1000.0),
            noise.sample(1000.0, 999.99),
            noise.sample(1000.0, 1000.01),
        ];

        for val in nearby {
            assert!(
                (val - center).abs() < 0.05,
                "Perlin sample near shifted origin should ease through the lattice point: center={}, nearby={}",
                center,
                val
            );
        }
    }

    #[test]
    fn test_fbm_deterministic() {
        let noise = PerlinNoise::new(42);

        let val1 = fbm_sample(&noise, 10.0, 20.0, 4, 0.5, 2.0);
        let val2 = fbm_sample(&noise, 10.0, 20.0, 4, 0.5, 2.0);

        assert!((val1 - val2).abs() < 1e-6);
    }

    #[test]
    fn test_fbm_range() {
        let noise = PerlinNoise::new(42);

        for i in 0..100 {
            let x = i as f32 * 0.1;
            let y = i as f32 * 0.2;
            let val = fbm_sample(&noise, x, y, 4, 0.5, 2.0);
            // FBM should be finite and reasonable
            assert!(val.is_finite(), "FBM value should be finite: {}", val);
        }
    }

    #[test]
    fn test_fbm_octaves_increase_detail() {
        let noise = PerlinNoise::new(42);

        // Test that different octave counts can produce different results
        let v1 = fbm_sample(&noise, 1.5, 2.7, 1, 0.5, 2.0);
        let v2 = fbm_sample(&noise, 1.5, 2.7, 4, 0.5, 2.0);
        let v3 = fbm_sample(&noise, 3.14, 2.71, 1, 0.5, 2.0);
        let v4 = fbm_sample(&noise, 3.14, 2.71, 4, 0.5, 2.0);

        // At least one pair should differ
        let diff1 = (v1 - v2).abs() > 1e-6;
        let diff2 = (v3 - v4).abs() > 1e-6;
        assert!(
            diff1 || diff2,
            "Different octaves should produce different results"
        );
    }

    #[test]
    fn test_domain_warp() {
        let noise = PerlinNoise::new(42);

        let val = domain_warp(&noise, 10.0, 20.0, 3, 0.5, 2.0);
        assert!(
            val >= -1.0 && val <= 1.0,
            "Domain warp value out of range: {}",
            val
        );
    }

    #[test]
    fn test_domain_warp_deterministic() {
        let noise = PerlinNoise::new(42);

        let val1 = domain_warp(&noise, 10.0, 20.0, 3, 0.5, 2.0);
        let val2 = domain_warp(&noise, 10.0, 20.0, 3, 0.5, 2.0);

        assert!((val1 - val2).abs() < 1e-6);
    }
}
