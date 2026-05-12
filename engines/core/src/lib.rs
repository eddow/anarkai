use wasm_bindgen::prelude::*;

/// Simple add function to verify WASM integration works end-to-end.
#[wasm_bindgen]
pub fn add(left: u32, right: u32) -> u32 {
    left + right
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn add_works() {
        assert_eq!(add(2, 2), 4);
    }

    #[test]
    fn add_large() {
        assert_eq!(add(1_000_000, 2_000_000), 3_000_000);
    }
}
