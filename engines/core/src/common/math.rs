// Many math utilities are provided for external WASM consumers.
#![allow(dead_code)]
/// Linear interpolation between a and b by t
#[inline]
pub fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + t * (b - a)
}

/// Smoothstep interpolation: 3t² - 2t³
#[inline]
pub fn smoothstep(t: f32) -> f32 {
    t * t * (3.0 - 2.0 * t)
}

/// Clamp value between min and max
#[inline]
pub fn clamp(value: f32, min: f32, max: f32) -> f32 {
    if value < min {
        min
    } else if value > max {
        max
    } else {
        value
    }
}

/// Remap value from [in_min, in_max] to [out_min, out_max]
#[inline]
pub fn remap(value: f32, in_min: f32, in_max: f32, out_min: f32, out_max: f32) -> f32 {
    let t = (value - in_min) / (in_max - in_min);
    lerp(out_min, out_max, t)
}

/// Remap and clamp value to output range
#[inline]
pub fn remap_clamp(value: f32, in_min: f32, in_max: f32, out_min: f32, out_max: f32) -> f32 {
    let t = clamp((value - in_min) / (in_max - in_min), 0.0, 1.0);
    lerp(out_min, out_max, t)
}

/// Fade function for Perlin noise: 6t⁵ - 15t⁴ + 10t³
#[inline]
pub fn fade(t: f32) -> f32 {
    t * t * t * (t * (t * 6.0 - 15.0) + 10.0)
}

/// Gradient function for 2D Perlin noise
#[inline]
pub fn grad(hash: u32, x: f32, y: f32) -> f32 {
    let h = (hash & 15) as i32;
    let u = if h < 8 { x } else { y };
    let v = if h < 4 {
        y
    } else if h == 12 || h == 14 {
        x
    } else {
        0.0
    };
    (if (h & 1) == 0 { u } else { -u }) + if (h & 2) == 0 { v } else { -v }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_lerp() {
        assert!((lerp(0.0, 10.0, 0.0) - 0.0).abs() < 1e-6);
        assert!((lerp(0.0, 10.0, 0.5) - 5.0).abs() < 1e-6);
        assert!((lerp(0.0, 10.0, 1.0) - 10.0).abs() < 1e-6);
    }

    #[test]
    fn test_smoothstep() {
        assert!((smoothstep(0.0) - 0.0).abs() < 1e-6);
        assert!((smoothstep(0.5) - 0.5).abs() < 1e-6);
        assert!((smoothstep(1.0) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn test_clamp() {
        assert_eq!(clamp(5.0, 0.0, 10.0), 5.0);
        assert_eq!(clamp(-5.0, 0.0, 10.0), 0.0);
        assert_eq!(clamp(15.0, 0.0, 10.0), 10.0);
    }

    #[test]
    fn test_remap() {
        assert!((remap(0.5, 0.0, 1.0, 0.0, 100.0) - 50.0).abs() < 1e-6);
        assert!((remap(0.0, 0.0, 1.0, -10.0, 10.0) - (-10.0)).abs() < 1e-6);
        assert!((remap(1.0, 0.0, 1.0, -10.0, 10.0) - 10.0).abs() < 1e-6);
    }

    #[test]
    fn test_remap_clamp() {
        assert!((remap_clamp(0.5, 0.0, 1.0, 0.0, 100.0) - 50.0).abs() < 1e-6);
        assert_eq!(remap_clamp(-0.5, 0.0, 1.0, 0.0, 100.0), 0.0);
        assert_eq!(remap_clamp(1.5, 0.0, 1.0, 0.0, 100.0), 100.0);
    }

    #[test]
    fn test_fade() {
        assert!((fade(0.0) - 0.0).abs() < 1e-6);
        assert!((fade(0.5) - 0.5).abs() < 1e-6);
        assert!((fade(1.0) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn test_grad() {
        // Test that grad returns reasonable values
        let val = grad(0, 1.0, 2.0);
        assert!(val.is_finite());
    }
}
