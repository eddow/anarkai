use rand::{Rng as RandTrait, RngCore, SeedableRng};
use rand_chacha::ChaCha8Rng;

/// Deterministic RNG wrapper for terrain generation
pub struct Rng {
    inner: ChaCha8Rng,
}

impl Rng {
    /// Create a new deterministic RNG from a u64 seed
    pub fn from_seed(seed: u64) -> Self {
        let mut seed_bytes = [0u8; 32];
        seed_bytes[0..8].copy_from_slice(&seed.to_le_bytes());
        Self {
            inner: ChaCha8Rng::from_seed(seed_bytes),
        }
    }

    /// Get next f32 in [0, 1)
    pub fn next_f32(&mut self) -> f32 {
        self.inner.next_u32() as f32 / u32::MAX as f32
    }

    /// Get next f64 in [0, 1)
    pub fn next_f64(&mut self) -> f64 {
        self.inner.next_u64() as f64 / u64::MAX as f64
    }

    /// Get next u32
    pub fn next_u32(&mut self) -> u32 {
        self.inner.next_u32()
    }

    /// Get next u64
    pub fn next_u64(&mut self) -> u64 {
        self.inner.next_u64()
    }

    /// Get random i32 in range [min, max)
    pub fn range_i32(&mut self, min: i32, max: i32) -> i32 {
        self.inner.gen_range(min..max)
    }

    /// Get random f32 in range [min, max)
    pub fn range_f32(&mut self, min: f32, max: f32) -> f32 {
        self.inner.gen_range(min..max)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rng_deterministic() {
        let mut rng1 = Rng::from_seed(42);
        let mut rng2 = Rng::from_seed(42);

        for _ in 0..100 {
            assert_eq!(rng1.next_f32(), rng2.next_f32());
            assert_eq!(rng1.next_u32(), rng2.next_u32());
        }
    }

    #[test]
    fn test_rng_different_seeds() {
        let mut rng1 = Rng::from_seed(42);
        let mut rng2 = Rng::from_seed(43);

        assert_ne!(rng1.next_f32(), rng2.next_f32());
    }

    #[test]
    fn test_rng_range() {
        let mut rng = Rng::from_seed(42);
        for _ in 0..100 {
            let val = rng.range_i32(10, 20);
            assert!(val >= 10 && val < 20);
        }
    }
}
