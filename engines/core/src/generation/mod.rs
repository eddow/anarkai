//! Game generation modules
//!
//! Pure Rust implementation for game generation logic.
//! These modules are designed to be WASM-free for future server-side extraction.

pub mod board;
pub mod population;
pub mod roads;
pub mod settlements;

use crate::common::HexCoord;

/// FNV-based hash matching TypeScript's hashString implementation
///
/// This creates a deterministic hash value for a given coordinate and salt,
/// which is used for consistent random number generation across runs.
pub fn coord_hash(seed: u32, coord: &HexCoord, salt: &str) -> u64 {
    // FNV-1a hash constants
    const FNV_OFFSET_BASIS: u64 = 0xcbf29ce484222325;
    const FNV_PRIME: u64 = 0x100000001b3;

    let mut hash = FNV_OFFSET_BASIS;

    // Mix in the seed
    let seed_bytes = seed.to_le_bytes();
    for byte in seed_bytes {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(FNV_PRIME);
    }

    // Mix in the coordinate q
    let q_bytes = coord.q.to_le_bytes();
    for byte in q_bytes {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(FNV_PRIME);
    }

    // Mix in the coordinate r
    let r_bytes = coord.r.to_le_bytes();
    for byte in r_bytes {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(FNV_PRIME);
    }

    // Mix in the salt string
    for byte in salt.bytes() {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(FNV_PRIME);
    }

    hash
}

/// Converts a hash value to a float in the range [0, 1)
///
/// This matches TypeScript's behavior of converting a hash to a normalized value.
/// The divisor 4294967295 is u32::MAX, ensuring the result is in [0, 1).
pub fn random01(hash: u64) -> f64 {
    // Use the lower 32 bits for the conversion
    let hash_32 = (hash & 0xFFFFFFFF) as f64;
    hash_32 / 4294967295.0
}

// Re-export public functions from submodules
pub use board::{
    generate_board, generate_deposit, generate_goods, DepositKind, GoodKind, TileGenerationResult,
};
pub use population::generate_character_positions;
pub use roads::generate_settlement_roads;
