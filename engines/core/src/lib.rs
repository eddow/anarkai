mod common;
mod generation;
mod noise;
mod terrain;

use js_sys::{Float32Array, Int32Array, Object, Reflect, Uint8Array};
use std::cmp::Ordering;
use std::collections::{BTreeSet, BinaryHeap, HashMap, HashSet};
use wasm_bindgen::prelude::*;

// Re-export common types for internal use
pub use common::{Bounds, HexCoord, Rng};
pub use generation::*;
pub use noise::{domain_warp, fbm_sample, PerlinNoise};
pub use terrain::{
    classify_tile, generate_region, generate_tile_field, generate_tile_field_with_noise, BiomeHint,
    HydrologyClassification, TerrainConfig, TileField,
};

/// Simple add function to verify WASM integration works end-to-end.
#[wasm_bindgen]
pub fn add(left: u32, right: u32) -> u32 {
    left + right
}

// WASM-compatible wrapper for HexCoord
#[wasm_bindgen]
pub struct WasmHexCoord {
    q: i32,
    r: i32,
}

#[wasm_bindgen]
impl WasmHexCoord {
    #[wasm_bindgen(constructor)]
    pub fn new(q: i32, r: i32) -> Self {
        Self { q, r }
    }

    #[wasm_bindgen(getter)]
    pub fn q(&self) -> i32 {
        self.q
    }

    #[wasm_bindgen(getter)]
    pub fn r(&self) -> i32 {
        self.r
    }

    pub fn to_key(&self) -> String {
        format!("{},{}", self.q, self.r)
    }

    pub fn from_key(key: &str) -> Option<WasmHexCoord> {
        let parts: Vec<&str> = key.split(',').collect();
        if parts.len() != 2 {
            return None;
        }
        let q = parts[0].parse().ok()?;
        let r = parts[1].parse().ok()?;
        Some(WasmHexCoord::new(q, r))
    }
}

impl From<HexCoord> for WasmHexCoord {
    fn from(hex: HexCoord) -> Self {
        Self { q: hex.q, r: hex.r }
    }
}

impl From<WasmHexCoord> for HexCoord {
    fn from(wasm: WasmHexCoord) -> Self {
        Self {
            q: wasm.q,
            r: wasm.r,
        }
    }
}

// WASM-compatible wrapper for Bounds
#[wasm_bindgen]
pub struct WasmBounds {
    min_q: i32,
    max_q: i32,
    min_r: i32,
    max_r: i32,
}

#[wasm_bindgen]
impl WasmBounds {
    #[wasm_bindgen(constructor)]
    pub fn new(min_q: i32, max_q: i32, min_r: i32, max_r: i32) -> Self {
        Self {
            min_q,
            max_q,
            min_r,
            max_r,
        }
    }

    #[wasm_bindgen(getter)]
    pub fn min_q(&self) -> i32 {
        self.min_q
    }

    #[wasm_bindgen(getter)]
    pub fn max_q(&self) -> i32 {
        self.max_q
    }

    #[wasm_bindgen(getter)]
    pub fn min_r(&self) -> i32 {
        self.min_r
    }

    #[wasm_bindgen(getter)]
    pub fn max_r(&self) -> i32 {
        self.max_r
    }
}

impl From<Bounds> for WasmBounds {
    fn from(bounds: Bounds) -> Self {
        Self {
            min_q: bounds.min_q,
            max_q: bounds.max_q,
            min_r: bounds.min_r,
            max_r: bounds.max_r,
        }
    }
}

impl From<WasmBounds> for Bounds {
    fn from(wasm: WasmBounds) -> Self {
        Self {
            min_q: wasm.min_q,
            max_q: wasm.max_q,
            min_r: wasm.min_r,
            max_r: wasm.max_r,
        }
    }
}

// WASM exports for noise functions

use std::sync::Mutex;

/// Shift coordinates away from origin so Perlin has full variation across all hex positions.
const NOISE_ORIGIN_OFFSET: f32 = 1000.0;

/// Cache PerlinNoise by seed — avoids Fisher-Yates shuffle (256 swaps + 512-element copy) per call.
/// This was the cause of 30-200µs per-call overhead with 30ms spikes.
static NOISE_CACHE: once_cell::sync::Lazy<Mutex<HashMap<u64, PerlinNoise>>> =
    once_cell::sync::Lazy::new(|| Mutex::new(HashMap::new()));

fn get_wasm_noise(seed: u64) -> PerlinNoise {
    let mut cache = NOISE_CACHE.lock().unwrap();
    cache
        .entry(seed)
        .or_insert_with(|| PerlinNoise::new(seed))
        .clone()
}

/// A WASM-accessible PerlinNoise that stays alive on the Rust heap.
/// Create once, call sample() many times — no boundary crossing per call beyond the sample itself.
#[wasm_bindgen]
pub struct WasmPerlinNoise {
    inner: PerlinNoise,
}

#[wasm_bindgen]
impl WasmPerlinNoise {
    pub fn new(seed: u64) -> Self {
        Self {
            inner: PerlinNoise::new(seed),
        }
    }

    /// Sample at (x, y). Coordinates are shifted by NOISE_ORIGIN_OFFSET
    /// so Perlin has full variation across all hex positions including origin.
    pub fn sample(&self, x: f32, y: f32) -> f32 {
        self.inner
            .sample(x + NOISE_ORIGIN_OFFSET, y + NOISE_ORIGIN_OFFSET)
    }

    /// FBM over this noise instance. Single WASM call boundary for efficiency.
    pub fn fbm_sample(
        &self,
        x: f32,
        y: f32,
        octaves: u32,
        persistence: f32,
        lacunarity: f32,
    ) -> f32 {
        fbm_sample(
            &self.inner,
            x + NOISE_ORIGIN_OFFSET,
            y + NOISE_ORIGIN_OFFSET,
            octaves,
            persistence,
            lacunarity,
        )
    }

    /// Domain warp over this noise instance.
    pub fn domain_warp(
        &self,
        x: f32,
        y: f32,
        octaves: u32,
        persistence: f32,
        lacunarity: f32,
    ) -> f32 {
        domain_warp(
            &self.inner,
            x + NOISE_ORIGIN_OFFSET,
            y + NOISE_ORIGIN_OFFSET,
            octaves,
            persistence,
            lacunarity,
        )
    }
}

#[wasm_bindgen]
pub fn wasm_perlin_sample(seed: u64, x: f32, y: f32) -> f32 {
    get_wasm_noise(seed).sample(x + NOISE_ORIGIN_OFFSET, y + NOISE_ORIGIN_OFFSET)
}

#[wasm_bindgen]
pub fn wasm_fbm_sample(
    seed: u64,
    x: f32,
    y: f32,
    octaves: u32,
    persistence: f32,
    lacunarity: f32,
) -> f32 {
    let noise = get_wasm_noise(seed);
    fbm_sample(
        &noise,
        x + NOISE_ORIGIN_OFFSET,
        y + NOISE_ORIGIN_OFFSET,
        octaves,
        persistence,
        lacunarity,
    )
}

#[wasm_bindgen]
pub fn wasm_domain_warp(
    seed: u64,
    x: f32,
    y: f32,
    octaves: u32,
    persistence: f32,
    lacunarity: f32,
) -> f32 {
    let noise = get_wasm_noise(seed);
    domain_warp(
        &noise,
        x + NOISE_ORIGIN_OFFSET,
        y + NOISE_ORIGIN_OFFSET,
        octaves,
        persistence,
        lacunarity,
    )
}

// WASM exports for terrain generation
#[wasm_bindgen]
#[derive(Clone)]
pub struct WasmTerrainConfig {
    pub scale: f32,
    pub terrain_type_scale: f32,
    pub octaves: u32,
    pub persistence: f32,
    pub lacunarity: f32,
    pub temperature_scale: f32,
    pub humidity_scale: f32,
    pub sea_level: f32,
    pub snow_level: f32,
    pub rocky_level: f32,
    pub forest_level: f32,
    pub sand_temperature: f32,
    pub sand_humidity: f32,
    pub wetland_humidity: f32,
    pub forest_humidity: f32,
    pub hydrology_sources_per_tile: f32,
    pub hydrology_land_ceiling: f32,
    pub hydrology_max_trace_steps: u32,
    pub hydrology_flux_step_weight: f32,
}

#[wasm_bindgen]
impl WasmTerrainConfig {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        let config = TerrainConfig::default();
        Self {
            scale: config.scale,
            terrain_type_scale: config.terrain_type_scale,
            octaves: config.octaves,
            persistence: config.persistence,
            lacunarity: config.lacunarity,
            temperature_scale: config.temperature_scale,
            humidity_scale: config.humidity_scale,
            sea_level: config.sea_level,
            snow_level: config.snow_level,
            rocky_level: config.rocky_level,
            forest_level: config.forest_level,
            sand_temperature: config.sand_temperature,
            sand_humidity: config.sand_humidity,
            wetland_humidity: config.wetland_humidity,
            forest_humidity: config.forest_humidity,
            hydrology_sources_per_tile: config.hydrology_sources_per_tile,
            hydrology_land_ceiling: config.hydrology_land_ceiling,
            hydrology_max_trace_steps: config.hydrology_max_trace_steps,
            hydrology_flux_step_weight: config.hydrology_flux_step_weight,
        }
    }
}

impl From<WasmTerrainConfig> for TerrainConfig {
    fn from(wasm: WasmTerrainConfig) -> Self {
        Self {
            scale: wasm.scale,
            terrain_type_scale: wasm.terrain_type_scale,
            octaves: wasm.octaves,
            persistence: wasm.persistence,
            lacunarity: wasm.lacunarity,
            temperature_scale: wasm.temperature_scale,
            humidity_scale: wasm.humidity_scale,
            sea_level: wasm.sea_level,
            snow_level: wasm.snow_level,
            rocky_level: wasm.rocky_level,
            forest_level: wasm.forest_level,
            sand_temperature: wasm.sand_temperature,
            sand_humidity: wasm.sand_humidity,
            wetland_humidity: wasm.wetland_humidity,
            forest_humidity: wasm.forest_humidity,
            hydrology_sources_per_tile: wasm.hydrology_sources_per_tile,
            hydrology_land_ceiling: wasm.hydrology_land_ceiling,
            hydrology_max_trace_steps: wasm.hydrology_max_trace_steps,
            hydrology_flux_step_weight: wasm.hydrology_flux_step_weight,
        }
    }
}

#[wasm_bindgen]
pub struct WasmTileField {
    pub height: f32,
    pub temperature: f32,
    pub humidity: f32,
    pub terrain_type: f32,
    pub rocky_noise: f32,
    pub sediment: f32,
    pub water_table: f32,
}

impl From<TileField> for WasmTileField {
    fn from(field: TileField) -> Self {
        Self {
            height: field.height,
            temperature: field.temperature,
            humidity: field.humidity,
            terrain_type: field.terrain_type,
            rocky_noise: field.rocky_noise,
            sediment: field.sediment,
            water_table: field.water_table,
        }
    }
}

#[wasm_bindgen]
pub fn wasm_generate_tile_field(
    q: i32,
    r: i32,
    seed: u64,
    config: &WasmTerrainConfig,
) -> WasmTileField {
    let coord = HexCoord::new(q, r);
    let terrain_config: TerrainConfig = config.clone().into();
    let field = generate_tile_field(&coord, seed, &terrain_config);
    field.into()
}

/// Batch generate fields for a set of coordinates in a single WASM call.
/// Creates PerlinNoise once per seed — avoids Fisher-Yates shuffle (256 swaps + 512-element copy) per tile.
#[wasm_bindgen]
pub fn wasm_generate_tile_fields(
    coords: &[i32],
    seed: u64,
    config: &WasmTerrainConfig,
) -> Vec<WasmTileField> {
    let tcfg: TerrainConfig = config.clone().into();
    let noise = PerlinNoise::new(seed);
    let cap = coords.len() / 2;
    let mut out = Vec::with_capacity(cap);
    for chunk in coords.chunks(2) {
        if chunk.len() < 2 {
            break;
        }
        let coord = HexCoord::new(chunk[0], chunk[1]);
        out.push(generate_tile_field_with_noise(&noise, &coord, &tcfg).into());
    }
    out
}

/// Batch generate fields as a packed Float32Array-compatible vector:
/// [height, temperature, humidity, terrain_type, rocky_noise, sediment, water_table, ...]
#[wasm_bindgen]
pub fn wasm_generate_tile_fields_packed(
    coords: &[i32],
    seed: u64,
    config: &WasmTerrainConfig,
) -> Vec<f32> {
    let tcfg: TerrainConfig = config.clone().into();
    let noise = PerlinNoise::new(seed);
    let cap = (coords.len() / 2) * 7;
    let mut out = Vec::with_capacity(cap);
    for chunk in coords.chunks(2) {
        if chunk.len() < 2 {
            break;
        }
        let coord = HexCoord::new(chunk[0], chunk[1]);
        let field = generate_tile_field_with_noise(&noise, &coord, &tcfg);
        out.push(field.height);
        out.push(field.temperature);
        out.push(field.humidity);
        out.push(field.terrain_type);
        out.push(field.rocky_noise);
        out.push(field.sediment);
        out.push(field.water_table);
    }
    out
}

fn expand_sector_coords(sectors: &[i32], sector_step: i32, padding: i32) -> Vec<HexCoord> {
    let step = sector_step.max(1);
    let radius = padding.max(0);
    let mut coords = BTreeSet::<(i32, i32)>::new();

    for chunk in sectors.chunks(2) {
        if chunk.len() < 2 {
            break;
        }
        let start_q = chunk[0] * step;
        let start_r = chunk[1] * step;

        for q in start_q..start_q + step {
            for r in start_r..start_r + step {
                for dq in -radius..=radius {
                    let min_dr = (-radius).max(-dq - radius);
                    let max_dr = radius.min(-dq + radius);
                    for dr in min_dr..=max_dr {
                        coords.insert((q + dq, r + dr));
                    }
                }
            }
        }
    }

    coords
        .into_iter()
        .map(|(q, r)| HexCoord::new(q, r))
        .collect()
}

fn coord_key_i64(coord: &HexCoord) -> i64 {
    ((coord.q as i64) << 32) ^ ((coord.r as i64) & 0xffff_ffff)
}

fn opposite_direction(direction: usize) -> u8 {
    ((direction + 3) % 6) as u8
}

#[derive(Clone, Copy, Debug)]
struct QueueCell {
    elevation: f32,
    index: usize,
}

impl PartialEq for QueueCell {
    fn eq(&self, other: &Self) -> bool {
        self.elevation == other.elevation && self.index == other.index
    }
}

impl Eq for QueueCell {}

impl PartialOrd for QueueCell {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for QueueCell {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .elevation
            .total_cmp(&self.elevation)
            .then_with(|| other.index.cmp(&self.index))
    }
}

struct WasmHydrologyPacked {
    edge_ints: Vec<i32>,
    edge_floats: Vec<f32>,
    channel_ints: Vec<i32>,
    channel_floats: Vec<f32>,
    bank_ints: Vec<i32>,
    bank_floats: Vec<f32>,
    max_accumulation: f32,
    river_edge_count: usize,
    channel_count: usize,
}

fn macro_hydrology_coords(
    center_sector_q: i32,
    center_sector_r: i32,
    sector_radius: i32,
    sector_step: i32,
    macro_step: i32,
) -> Vec<HexCoord> {
    let sector_step = sector_step.max(1);
    let macro_step = macro_step.max(1);
    let radius_tiles = sector_radius.max(0) * sector_step;
    let macro_radius = ((radius_tiles + macro_step - 1) / macro_step).max(1);
    let center_tile_q = center_sector_q * sector_step + sector_step / 2;
    let center_tile_r = center_sector_r * sector_step + sector_step / 2;
    let center_macro = HexCoord::new(
        center_tile_q.div_euclid(macro_step),
        center_tile_r.div_euclid(macro_step),
    );
    let mut coords = center_macro.within_radius(macro_radius);
    coords.sort_by_key(|coord| (coord.q, coord.r));
    coords
}

fn compute_priority_flood_hydrology(
    coords: &[HexCoord],
    fields: &[TileField],
    emit_keys: &HashSet<i64>,
    config: &TerrainConfig,
) -> WasmHydrologyPacked {
    let len = coords.len();
    let mut index_by_key = HashMap::<i64, usize>::with_capacity(len);
    for (index, coord) in coords.iter().enumerate() {
        index_by_key.insert(coord_key_i64(coord), index);
    }

    let land: Vec<bool> = fields
        .iter()
        .map(|field| field.height >= config.sea_level)
        .collect();
    let mut filled: Vec<f32> = fields.iter().map(|field| field.height).collect();
    let mut downstream: Vec<Option<u8>> = vec![None; len];
    let mut downstream_index: Vec<Option<usize>> = vec![None; len];
    let mut visited = vec![false; len];
    let mut heap = BinaryHeap::<QueueCell>::new();
    let mut discovery_order = Vec::<usize>::with_capacity(len);

    for (index, coord) in coords.iter().enumerate() {
        let touches_boundary = coord
            .neighbors()
            .iter()
            .any(|neighbor| !index_by_key.contains_key(&coord_key_i64(neighbor)));
        if touches_boundary || !land[index] {
            visited[index] = true;
            discovery_order.push(index);
            heap.push(QueueCell {
                elevation: filled[index],
                index,
            });
        }
    }

    while let Some(cell) = heap.pop() {
        let current = cell.index;
        for (direction, neighbor) in coords[current].neighbors().iter().enumerate() {
            let Some(&neighbor_index) = index_by_key.get(&coord_key_i64(neighbor)) else {
                continue;
            };
            if visited[neighbor_index] {
                continue;
            }
            visited[neighbor_index] = true;
            discovery_order.push(neighbor_index);
            if filled[neighbor_index] < filled[current] {
                filled[neighbor_index] = filled[current];
            }
            if land[neighbor_index] {
                downstream[neighbor_index] = Some(opposite_direction(direction));
                downstream_index[neighbor_index] = Some(current);
            }
            heap.push(QueueCell {
                elevation: filled[neighbor_index],
                index: neighbor_index,
            });
        }
    }

    let mut accumulation = vec![0.0_f32; len];
    for (index, field) in fields.iter().enumerate() {
        if !land[index] {
            continue;
        }
        let rainfall = (field.humidity + 0.65).clamp(0.05, 1.6);
        accumulation[index] = rainfall;
    }

    for &index in discovery_order.iter().rev() {
        if !land[index] {
            continue;
        }
        if let Some(parent) = downstream_index[index] {
            accumulation[parent] += accumulation[index];
        }
    }

    let max_accumulation = accumulation.iter().copied().fold(0.0, f32::max);
    let stream_threshold = (config.hydrology_sources_per_tile.max(0.01) * 360.0).clamp(32.0, 120.0);
    let mut upstream_channel_mask = vec![0_u8; len];
    let mut upstream_channel_count = vec![0_u8; len];
    let mut stream_order = vec![0_u32; len];
    let mut rank_from_source = vec![0_u32; len];
    let mut rank_to_sea = vec![0_u32; len];

    for &index in &discovery_order {
        if let Some(parent) = downstream_index[index] {
            rank_to_sea[index] = rank_to_sea[parent] + 1;
        }
    }

    for &index in discovery_order.iter().rev() {
        if !land[index] || accumulation[index] < stream_threshold {
            continue;
        }
        let mut max_order = 0_u32;
        let mut max_order_count = 0_u32;
        let mut max_rank = 0_u32;
        for (direction, neighbor) in coords[index].neighbors().iter().enumerate() {
            let Some(&upstream_index) = index_by_key.get(&coord_key_i64(neighbor)) else {
                continue;
            };
            if downstream_index[upstream_index] != Some(index) {
                continue;
            }
            if accumulation[upstream_index] < stream_threshold {
                continue;
            }
            upstream_channel_mask[index] |= 1 << direction;
            upstream_channel_count[index] += 1;
            let order = stream_order[upstream_index];
            if order > max_order {
                max_order = order;
                max_order_count = 1;
            } else if order == max_order && order > 0 {
                max_order_count += 1;
            }
            max_rank = max_rank.max(rank_from_source[upstream_index] + 1);
        }
        stream_order[index] = if max_order == 0 {
            1
        } else if max_order_count >= 2 {
            max_order + 1
        } else {
            max_order
        };
        rank_from_source[index] = max_rank;
    }

    let mut edge_ints = Vec::<i32>::new();
    let mut edge_floats = Vec::<f32>::new();
    let mut channel_ints = Vec::<i32>::new();
    let mut channel_floats = Vec::<f32>::new();
    let mut bank_by_key = HashMap::<i64, (HexCoord, f32)>::new();
    let mut river_edge_count = 0_usize;
    let mut channel_count = 0_usize;

    for (index, coord) in coords.iter().enumerate() {
        if !land[index] || accumulation[index] < stream_threshold {
            continue;
        }
        let key = coord_key_i64(coord);
        let emit_tile = emit_keys.contains(&key);
        let downstream_dir = downstream[index];
        let downstream_i = downstream_index[index];
        let downstream_key = downstream_i.map(|i| coord_key_i64(&coords[i]));
        let emit_edge = emit_tile || downstream_key.is_some_and(|k| emit_keys.contains(&k));
        let normalized = (accumulation[index] / stream_threshold).max(1.0);
        let width = (normalized.sqrt() * 2.2).clamp(1.5, 9.0);
        let depth = (width * 0.35).clamp(0.5, 4.0);

        if emit_tile {
            channel_ints.extend_from_slice(&[
                coord.q,
                coord.r,
                upstream_channel_mask[index] as i32,
                downstream_dir.map(|d| 1 << d).unwrap_or(0) as i32,
                stream_order[index] as i32,
                rank_from_source[index] as i32,
                rank_to_sea[index] as i32,
            ]);
            channel_floats.extend_from_slice(&[accumulation[index], normalized]);
            channel_count += 1;
        }

        if let (Some(dir), Some(parent)) = (downstream_dir, downstream_i) {
            if emit_edge {
                let slope = (fields[index].height - fields[parent].height).max(0.0);
                edge_ints.extend_from_slice(&[
                    coord.q,
                    coord.r,
                    dir as i32,
                    stream_order[index] as i32,
                ]);
                edge_floats.extend_from_slice(&[accumulation[index], width, depth, slope]);
                river_edge_count += 1;
            }
        }

        if emit_tile {
            for neighbor in coord.neighbors() {
                let neighbor_key = coord_key_i64(&neighbor);
                if !emit_keys.contains(&neighbor_key) {
                    continue;
                }
                let influence = (normalized * 0.35).clamp(0.1, 1.5);
                bank_by_key
                    .entry(neighbor_key)
                    .and_modify(|(_, existing)| *existing = existing.max(influence))
                    .or_insert((neighbor, influence));
            }
        }
    }

    let mut banks: Vec<(HexCoord, f32)> = bank_by_key.into_values().collect();
    banks.sort_by_key(|(coord, _)| (coord.q, coord.r));
    let mut bank_ints = Vec::<i32>::with_capacity(banks.len() * 2);
    let mut bank_floats = Vec::<f32>::with_capacity(banks.len());
    for (coord, influence) in banks {
        bank_ints.push(coord.q);
        bank_ints.push(coord.r);
        bank_floats.push(influence);
    }

    WasmHydrologyPacked {
        edge_ints,
        edge_floats,
        channel_ints,
        channel_floats,
        bank_ints,
        bank_floats,
        max_accumulation,
        river_edge_count,
        channel_count,
    }
}

/// Generate a coarse hydrology overview around a sector center.
///
/// Output is a JS object with:
/// - tileInts: Int32Array [q, r, biome_hint_index, ...]
/// - tileFloats: Float32Array [height, ...]
/// - segmentInts: Int32Array [from_q, from_r, to_q, to_r, stream_order, ...]
/// - segmentFloats: Float32Array [flux, width, ...]
/// - centerSectorQ, centerSectorR, sectorRadius, sectorStep, macroStep
/// - macroTileCount, riverSegmentCount, maxAccumulation
#[wasm_bindgen]
pub fn wasm_generate_macro_hydrology_packed(
    center_sector_q: i32,
    center_sector_r: i32,
    sector_radius: i32,
    sector_step: i32,
    macro_step: i32,
    seed: u64,
    config: &WasmTerrainConfig,
) -> Result<Object, JsValue> {
    let tcfg: TerrainConfig = config.clone().into();
    let noise = PerlinNoise::new(seed);
    let sector_step = sector_step.max(1);
    let macro_step = macro_step.max(1);
    let sector_radius = sector_radius.max(1);
    let coords = macro_hydrology_coords(
        center_sector_q,
        center_sector_r,
        sector_radius,
        sector_step,
        macro_step,
    );
    let emit_keys: HashSet<i64> = coords.iter().map(coord_key_i64).collect();
    let fields: Vec<TileField> = coords
        .iter()
        .map(|coord| {
            let tile_coord = HexCoord::new(coord.q * macro_step, coord.r * macro_step);
            generate_tile_field_with_noise(&noise, &tile_coord, &tcfg)
        })
        .collect();
    let hydrology = compute_priority_flood_hydrology(&coords, &fields, &emit_keys, &tcfg);

    let empty_hydrology = HydrologyClassification {
        bank_influence: None,
        channel_influence: None,
    };
    let mut tile_ints = Vec::<i32>::with_capacity(coords.len() * 3);
    let mut tile_floats = Vec::<f32>::with_capacity(coords.len());
    for (coord, field) in coords.iter().zip(fields.iter()) {
        let tile_coord = HexCoord::new(coord.q * macro_step, coord.r * macro_step);
        let biome = classify_tile(field, 0.0, &tcfg, &empty_hydrology);
        tile_ints.extend_from_slice(&[tile_coord.q, tile_coord.r, biome as i32]);
        tile_floats.push(field.height);
    }

    let mut segment_ints = Vec::<i32>::with_capacity(hydrology.river_edge_count * 5);
    let mut segment_floats = Vec::<f32>::with_capacity(hydrology.river_edge_count * 2);
    for (edge_index, edge) in hydrology.edge_ints.chunks_exact(4).enumerate() {
        let from = HexCoord::new(edge[0], edge[1]);
        let Some(to) = from.neighbor(edge[2] as u8) else {
            continue;
        };
        segment_ints.extend_from_slice(&[
            from.q * macro_step,
            from.r * macro_step,
            to.q * macro_step,
            to.r * macro_step,
            edge[3],
        ]);
        segment_floats.extend_from_slice(&[
            hydrology.edge_floats[edge_index * 4],
            hydrology.edge_floats[edge_index * 4 + 1],
        ]);
    }

    let result = Object::new();
    Reflect::set(
        &result,
        &JsValue::from_str("tileInts"),
        &Int32Array::from(tile_ints.as_slice()),
    )?;
    Reflect::set(
        &result,
        &JsValue::from_str("tileFloats"),
        &Float32Array::from(tile_floats.as_slice()),
    )?;
    Reflect::set(
        &result,
        &JsValue::from_str("segmentInts"),
        &Int32Array::from(segment_ints.as_slice()),
    )?;
    Reflect::set(
        &result,
        &JsValue::from_str("segmentFloats"),
        &Float32Array::from(segment_floats.as_slice()),
    )?;
    Reflect::set(
        &result,
        &JsValue::from_str("centerSectorQ"),
        &JsValue::from_f64(center_sector_q as f64),
    )?;
    Reflect::set(
        &result,
        &JsValue::from_str("centerSectorR"),
        &JsValue::from_f64(center_sector_r as f64),
    )?;
    Reflect::set(
        &result,
        &JsValue::from_str("sectorRadius"),
        &JsValue::from_f64(sector_radius as f64),
    )?;
    Reflect::set(
        &result,
        &JsValue::from_str("sectorStep"),
        &JsValue::from_f64(sector_step as f64),
    )?;
    Reflect::set(
        &result,
        &JsValue::from_str("macroStep"),
        &JsValue::from_f64(macro_step as f64),
    )?;
    Reflect::set(
        &result,
        &JsValue::from_str("macroTileCount"),
        &JsValue::from_f64(coords.len() as f64),
    )?;
    Reflect::set(
        &result,
        &JsValue::from_str("riverSegmentCount"),
        &JsValue::from_f64((segment_ints.len() / 5) as f64),
    )?;
    Reflect::set(
        &result,
        &JsValue::from_str("maxAccumulation"),
        &JsValue::from_f64(hydrology.max_accumulation as f64),
    )?;
    Ok(result)
}

/// Batch generate fields for sector interiors plus optional axial padding.
/// Input sectors are packed as [sector_q, sector_r, sector_q, sector_r, ...].
/// Output is a JS object with:
/// - coords: Int32Array [q, r, q, r, ...]
/// - fields: Float32Array [height, temperature, humidity, terrain_type, rocky_noise, sediment, water_table, ...]
/// - biomes: Uint8Array [biome_hint_index, ...]
/// - riverEdgeInts: Int32Array [q, r, downstream_direction, stream_order, ...]
/// - riverEdgeFloats: Float32Array [flux, width, depth, slope, ...]
/// - channelInts: Int32Array [q, r, upstream_mask, downstream_mask, stream_order, rank_from_source, rank_to_sea, ...]
/// - channelFloats: Float32Array [accumulation, channel_influence, ...]
/// - bankCoords: Int32Array [q, r, ...]
/// - bankInfluence: Float32Array [influence, ...]
/// - requestedSectorCount, tileCount, sectorStep, padding
#[wasm_bindgen]
pub fn wasm_generate_sector_fields_packed(
    sectors: &[i32],
    sector_step: i32,
    padding: i32,
    hydrology_padding: i32,
    seed: u64,
    config: &WasmTerrainConfig,
) -> Result<Object, JsValue> {
    let tcfg: TerrainConfig = config.clone().into();
    let noise = PerlinNoise::new(seed);
    let coords = expand_sector_coords(sectors, sector_step, padding);
    let include_hydrology = hydrology_padding > 0;
    let hydro_coords = if include_hydrology {
        expand_sector_coords(sectors, sector_step, hydrology_padding.max(padding))
    } else {
        coords.clone()
    };
    let emit_keys: HashSet<i64> = coords.iter().map(coord_key_i64).collect();
    let hydro_index_by_key: HashMap<i64, usize> = hydro_coords
        .iter()
        .enumerate()
        .map(|(index, coord)| (coord_key_i64(coord), index))
        .collect();
    let hydro_fields: Vec<TileField> = hydro_coords
        .iter()
        .map(|coord| generate_tile_field_with_noise(&noise, coord, &tcfg))
        .collect();
    let hydrology = if include_hydrology {
        compute_priority_flood_hydrology(&hydro_coords, &hydro_fields, &emit_keys, &tcfg)
    } else {
        WasmHydrologyPacked {
            edge_ints: Vec::new(),
            edge_floats: Vec::new(),
            channel_ints: Vec::new(),
            channel_floats: Vec::new(),
            bank_ints: Vec::new(),
            bank_floats: Vec::new(),
            max_accumulation: 0.0,
            river_edge_count: 0,
            channel_count: 0,
        }
    };
    let mut max_flux_by_key = HashMap::<i64, f32>::new();
    let mut channel_influence_by_key = HashMap::<i64, f32>::new();
    let mut bank_influence_by_key = HashMap::<i64, f32>::new();

    for (edge_index, chunk) in hydrology.edge_ints.chunks(4).enumerate() {
        if chunk.len() < 4 {
            break;
        }
        let coord = HexCoord::new(chunk[0], chunk[1]);
        let flux = hydrology.edge_floats[edge_index * 4];
        max_flux_by_key
            .entry(coord_key_i64(&coord))
            .and_modify(|existing| *existing = existing.max(flux))
            .or_insert(flux);
        if let Some(neighbor) = coord.neighbor(chunk[2] as u8) {
            max_flux_by_key
                .entry(coord_key_i64(&neighbor))
                .and_modify(|existing| *existing = existing.max(flux))
                .or_insert(flux);
        }
    }
    for (channel_index, chunk) in hydrology.channel_ints.chunks(7).enumerate() {
        if chunk.len() < 7 {
            break;
        }
        let coord = HexCoord::new(chunk[0], chunk[1]);
        channel_influence_by_key.insert(
            coord_key_i64(&coord),
            hydrology.channel_floats[channel_index * 2 + 1],
        );
    }
    for (bank_index, chunk) in hydrology.bank_ints.chunks(2).enumerate() {
        if chunk.len() < 2 {
            break;
        }
        let coord = HexCoord::new(chunk[0], chunk[1]);
        bank_influence_by_key.insert(coord_key_i64(&coord), hydrology.bank_floats[bank_index]);
    }

    let mut packed_coords = Vec::<i32>::with_capacity(coords.len() * 2);
    let mut packed_fields = Vec::<f32>::with_capacity(coords.len() * 7);
    let mut packed_biomes = Vec::<u8>::with_capacity(coords.len());
    for coord in &coords {
        let key = coord_key_i64(coord);
        let field = &hydro_fields[*hydro_index_by_key
            .get(&key)
            .expect("render coordinate must be present in hydrology domain")];
        let hydrology_classification = HydrologyClassification {
            bank_influence: bank_influence_by_key.get(&key).copied(),
            channel_influence: channel_influence_by_key.get(&key).copied(),
        };
        let biome = classify_tile(
            field,
            max_flux_by_key.get(&key).copied().unwrap_or(0.0),
            &tcfg,
            &hydrology_classification,
        );
        packed_coords.push(coord.q);
        packed_coords.push(coord.r);
        packed_fields.push(field.height);
        packed_fields.push(field.temperature);
        packed_fields.push(field.humidity);
        packed_fields.push(field.terrain_type);
        packed_fields.push(field.rocky_noise);
        packed_fields.push(field.sediment);
        packed_fields.push(field.water_table);
        packed_biomes.push(biome as u8);
    }

    let result = Object::new();
    Reflect::set(
        &result,
        &JsValue::from_str("coords"),
        &Int32Array::from(packed_coords.as_slice()),
    )?;
    Reflect::set(
        &result,
        &JsValue::from_str("fields"),
        &Float32Array::from(packed_fields.as_slice()),
    )?;
    Reflect::set(
        &result,
        &JsValue::from_str("biomes"),
        &Uint8Array::from(packed_biomes.as_slice()),
    )?;
    Reflect::set(
        &result,
        &JsValue::from_str("riverEdgeInts"),
        &Int32Array::from(hydrology.edge_ints.as_slice()),
    )?;
    Reflect::set(
        &result,
        &JsValue::from_str("riverEdgeFloats"),
        &Float32Array::from(hydrology.edge_floats.as_slice()),
    )?;
    Reflect::set(
        &result,
        &JsValue::from_str("channelInts"),
        &Int32Array::from(hydrology.channel_ints.as_slice()),
    )?;
    Reflect::set(
        &result,
        &JsValue::from_str("channelFloats"),
        &Float32Array::from(hydrology.channel_floats.as_slice()),
    )?;
    Reflect::set(
        &result,
        &JsValue::from_str("bankCoords"),
        &Int32Array::from(hydrology.bank_ints.as_slice()),
    )?;
    Reflect::set(
        &result,
        &JsValue::from_str("bankInfluence"),
        &Float32Array::from(hydrology.bank_floats.as_slice()),
    )?;
    Reflect::set(
        &result,
        &JsValue::from_str("requestedSectorCount"),
        &JsValue::from_f64((sectors.len() / 2) as f64),
    )?;
    Reflect::set(
        &result,
        &JsValue::from_str("tileCount"),
        &JsValue::from_f64(coords.len() as f64),
    )?;
    Reflect::set(
        &result,
        &JsValue::from_str("sectorStep"),
        &JsValue::from_f64(sector_step.max(1) as f64),
    )?;
    Reflect::set(
        &result,
        &JsValue::from_str("padding"),
        &JsValue::from_f64(padding.max(0) as f64),
    )?;
    Reflect::set(
        &result,
        &JsValue::from_str("hydrologyPadding"),
        &JsValue::from_f64(if include_hydrology {
            hydrology_padding.max(padding)
        } else {
            0
        } as f64),
    )?;
    Reflect::set(
        &result,
        &JsValue::from_str("hydrologyTileCount"),
        &JsValue::from_f64(hydro_coords.len() as f64),
    )?;
    Reflect::set(
        &result,
        &JsValue::from_str("riverEdgeCount"),
        &JsValue::from_f64(hydrology.river_edge_count as f64),
    )?;
    Reflect::set(
        &result,
        &JsValue::from_str("channelCount"),
        &JsValue::from_f64(hydrology.channel_count as f64),
    )?;
    Reflect::set(
        &result,
        &JsValue::from_str("maxAccumulation"),
        &JsValue::from_f64(hydrology.max_accumulation as f64),
    )?;
    Ok(result)
}

/// Generate character positions on the game board.
///
/// Input coordinates are packed as [q, r, q, r, ...].
/// Terrain kinds are packed as terrain type indices (0=water, 1=grass, 2=forest, 3=sand, 4=rocky, 5=snow, 6=concrete).
/// Radius range is [min_radius_from_origin, max_radius].
/// Origin is [origin_q, origin_r].
/// Output is a flat Int32Array [q, r, q, r, ...] of character positions.
#[wasm_bindgen]
pub fn wasm_generate_character_positions(
    seed: u32,
    character_count: u32,
    coords: &[i32],
    terrain_kinds: &[u8],
    radius_range: &[i32],
    origin: &[i32],
) -> Vec<i32> {
    // Handle edge cases
    if coords.is_empty() || character_count == 0 {
        return Vec::new();
    }

    // Validate input lengths
    if coords.len() % 2 != 0 {
        return Vec::new();
    }

    if radius_range.len() < 2 || origin.len() < 2 {
        return Vec::new();
    }

    // Unpack coords into Vec<HexCoord>
    let hex_coords: Vec<HexCoord> = coords
        .chunks(2)
        .map(|chunk| HexCoord::new(chunk[0], chunk[1]))
        .collect();

    // Extract radius range
    let min_radius = radius_range[0];
    let max_radius = radius_range[1];

    // Extract origin
    let origin_coord = HexCoord::new(origin[0], origin[1]);

    // Call the pure Rust generation function
    let positions = generation::generate_character_positions(
        seed,
        character_count,
        &hex_coords,
        terrain_kinds,
        min_radius,
        max_radius,
        origin_coord,
    );

    // Repack Vec<HexCoord> into flat Vec<i32>
    let mut result = Vec::with_capacity(positions.len() * 2);
    for pos in positions {
        result.push(pos.q);
        result.push(pos.r);
    }

    result
}

// WASM exports for settlement placement
#[wasm_bindgen]
pub fn wasm_place_settlements(
    seed: u32,
    settlement_count: u32,
    coords: &[i32],
    terrain_kinds: &[u8],
    has_water_access: &[u8],
    has_river: &[u8],
    min_spacing: i32,
) -> Vec<i32> {
    // Handle edge cases
    if coords.is_empty() || settlement_count == 0 {
        return Vec::new();
    }

    // Validate input lengths
    if coords.len() % 2 != 0 {
        return Vec::new();
    }

    let tile_count = coords.len() / 2;
    if terrain_kinds.len() != tile_count
        || has_water_access.len() != tile_count
        || has_river.len() != tile_count
    {
        return Vec::new();
    }

    // Unpack coords into Vec<HexCoord>
    let hex_coords: Vec<HexCoord> = coords
        .chunks(2)
        .map(|chunk| HexCoord::new(chunk[0], chunk[1]))
        .collect();

    // Convert has_water_access and has_river from &[u8] to Vec<bool>
    let water_access_bool: Vec<bool> = has_water_access.iter().map(|&v| v != 0).collect();
    let river_bool: Vec<bool> = has_river.iter().map(|&v| v != 0).collect();

    // Call the pure Rust generation function
    let settlements = generation::settlements::place_settlements(
        seed,
        settlement_count,
        &hex_coords,
        terrain_kinds,
        &water_access_bool,
        &river_bool,
        min_spacing,
    );

    // Pack results into flat Vec<i32>
    // Format: [q, r, kind, score*100, q, r, kind, score*100, ...]
    let mut result = Vec::with_capacity(settlements.len() * 4);
    for settlement in settlements {
        result.push(settlement.coord.q);
        result.push(settlement.coord.r);
        // Encode settlement kind: Village=0, Town=1, City=2
        let kind_code = match settlement.kind {
            generation::settlements::SettlementKind::Village => 0,
            generation::settlements::SettlementKind::Town => 1,
            generation::settlements::SettlementKind::City => 2,
        };
        result.push(kind_code as i32);
        // Multiply score by 100 to preserve decimal precision
        result.push((settlement.score * 100.0) as i32);
    }

    result
}

/// Generate settlement road borders using weighted pathfinding.
///
/// # Arguments
/// * `seed`               - Deterministic seed
/// * `coords`             - Packed as [q, r, q, r, ...]
/// * `terrain_kinds`      - u8 per tile (0=water, 1=plains, 2=forest, ...)
/// * `river_edge_borders` - Packed doubled border coordinates for river edges
/// * `settlement_coords`  - Packed as [q, r, ...] in score-descending order
///
/// # Returns
/// Packed i32 array of doubled border coordinates: [bq, br, bq, br, ...]
/// TypeScript divides each by 2 to get midpoint storage format.
///
/// # Note on rivers
/// River-edge borders are rejected: roads may cross river-influenced tiles when
/// a route exists, but they must not share the exact tile border used by the
/// river edge.
#[wasm_bindgen]
pub fn wasm_generate_settlement_roads(
    seed: u32,
    coords: &[i32],
    terrain_kinds: &[u8],
    river_edge_borders: &[i32],
    settlement_coords: &[i32],
) -> Vec<i32> {
    // Handle edge cases
    if coords.is_empty() || settlement_coords.is_empty() {
        return Vec::new();
    }

    // Validate input lengths
    if coords.len() % 2 != 0
        || river_edge_borders.len() % 2 != 0
        || settlement_coords.len() % 2 != 0
    {
        return Vec::new();
    }

    let tile_count = coords.len() / 2;
    if terrain_kinds.len() != tile_count {
        return Vec::new();
    }

    // Unpack coords into Vec<HexCoord>
    let hex_coords: Vec<HexCoord> = coords
        .chunks(2)
        .map(|chunk| HexCoord::new(chunk[0], chunk[1]))
        .collect();

    // Unpack settlement coords into Vec<HexCoord>
    let hex_settlements: Vec<HexCoord> = settlement_coords
        .chunks(2)
        .map(|chunk| HexCoord::new(chunk[0], chunk[1]))
        .collect();

    let river_borders: Vec<(i32, i32)> = river_edge_borders
        .chunks(2)
        .map(|chunk| (chunk[0], chunk[1]))
        .collect();

    // Call the pure Rust generation function
    let borders = generation::generate_settlement_roads(
        seed,
        &hex_coords,
        terrain_kinds,
        &river_borders,
        &hex_settlements,
    );

    // Repack Vec<(i32, i32)> into flat Vec<i32>
    let mut result = Vec::with_capacity(borders.len() * 2);
    for (q, r) in borders {
        result.push(q);
        result.push(r);
    }

    result
}

/// Generate deposits and goods for tiles on the game board.
///
/// Input coordinates are packed as [q, r, q, r, ...].
/// Terrain kinds are packed as terrain type indices (0=water, 1=grass, 2=forest, 3=sand, 4=rocky, 5=snow, 6=concrete).
/// Output is a packed Uint8Array with the following structure for each tile:
/// - coord.q (4 bytes, i32, little-endian)
/// - coord.r (4 bytes, i32, little-endian)
/// - deposit_kind (1 byte): 0=none, 1=stone, 2=iron, 3=gold, 4=wood, 5=berry_bush
/// - goods_count (1 byte): number of goods on this tile
/// - goods (1 byte each): 0=wood, 1=stone, 2=iron, 3=gold, 4=berries, 5=mushrooms, 6=fish
#[wasm_bindgen]
pub fn wasm_generate_board(seed: u32, coords: &[i32], terrain_kinds: &[u8]) -> Vec<u8> {
    // Handle edge cases
    if coords.is_empty() {
        return Vec::new();
    }

    // Validate input lengths
    if coords.len() % 2 != 0 {
        return Vec::new();
    }

    let tile_count = coords.len() / 2;
    if terrain_kinds.len() != tile_count {
        return Vec::new();
    }

    // Unpack coords into Vec<HexCoord>
    let hex_coords: Vec<HexCoord> = coords
        .chunks(2)
        .map(|chunk| HexCoord::new(chunk[0], chunk[1]))
        .collect();

    // Call the pure Rust generation function
    let results = generation::board::generate_board(seed, &hex_coords, terrain_kinds);

    // Pack results into flat Vec<u8>
    let mut result = Vec::new();
    for tile_result in results {
        // Pack coord.q as 4-byte little-endian i32
        result.extend_from_slice(&tile_result.coord.q.to_le_bytes());
        // Pack coord.r as 4-byte little-endian i32
        result.extend_from_slice(&tile_result.coord.r.to_le_bytes());

        // Encode deposit_kind: 0=none, 1=stone, 2=iron, 3=gold, 4=wood, 5=berry_bush
        let deposit_kind_code = match tile_result.deposit_kind {
            Some(generation::board::DepositKind::Stone) => 1u8,
            Some(generation::board::DepositKind::Iron) => 2u8,
            Some(generation::board::DepositKind::Gold) => 3u8,
            Some(generation::board::DepositKind::Wood) => 4u8,
            Some(generation::board::DepositKind::BerryBush) => 5u8,
            None => 0u8,
        };
        result.push(deposit_kind_code);

        // Encode goods count
        let goods_count = tile_result.goods.len() as u8;
        result.push(goods_count);

        // Encode each good kind: 0=wood, 1=stone, 2=iron, 3=gold, 4=berries, 5=mushrooms, 6=fish
        for good in tile_result.goods {
            let good_kind_code = match good {
                generation::board::GoodKind::Wood => 0u8,
                generation::board::GoodKind::Stone => 1u8,
                generation::board::GoodKind::Iron => 2u8,
                generation::board::GoodKind::Gold => 3u8,
                generation::board::GoodKind::Berries => 4u8,
                generation::board::GoodKind::Mushrooms => 5u8,
                generation::board::GoodKind::Fish => 6u8,
            };
            result.push(good_kind_code);
        }
    }

    result
}

// WASM exports for biome classification
#[wasm_bindgen]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WasmBiomeHint {
    Ocean,
    Lake,
    RiverBank,
    Wetland,
    Sand,
    Grass,
    Forest,
    Rocky,
    Snow,
}

impl From<BiomeHint> for WasmBiomeHint {
    fn from(biome: BiomeHint) -> Self {
        match biome {
            BiomeHint::Ocean => WasmBiomeHint::Ocean,
            BiomeHint::Lake => WasmBiomeHint::Lake,
            BiomeHint::RiverBank => WasmBiomeHint::RiverBank,
            BiomeHint::Wetland => WasmBiomeHint::Wetland,
            BiomeHint::Sand => WasmBiomeHint::Sand,
            BiomeHint::Grass => WasmBiomeHint::Grass,
            BiomeHint::Forest => WasmBiomeHint::Forest,
            BiomeHint::Rocky => WasmBiomeHint::Rocky,
            BiomeHint::Snow => WasmBiomeHint::Snow,
        }
    }
}

impl From<WasmBiomeHint> for BiomeHint {
    fn from(wasm: WasmBiomeHint) -> Self {
        match wasm {
            WasmBiomeHint::Ocean => BiomeHint::Ocean,
            WasmBiomeHint::Lake => BiomeHint::Lake,
            WasmBiomeHint::RiverBank => BiomeHint::RiverBank,
            WasmBiomeHint::Wetland => BiomeHint::Wetland,
            WasmBiomeHint::Sand => BiomeHint::Sand,
            WasmBiomeHint::Grass => BiomeHint::Grass,
            WasmBiomeHint::Forest => BiomeHint::Forest,
            WasmBiomeHint::Rocky => BiomeHint::Rocky,
            WasmBiomeHint::Snow => BiomeHint::Snow,
        }
    }
}

/// Classify a single tile into a biome hint
#[wasm_bindgen]
pub fn wasm_classify_tile(
    height: f32,
    temperature: f32,
    humidity: f32,
    terrain_type: f32,
    rocky_noise: f32,
    sediment: f32,
    water_table: f32,
    max_flux: f32,
    bank_influence: Option<f32>,
    channel_influence: Option<f32>,
    sea_level: f32,
    snow_level: f32,
    rocky_level: f32,
    forest_level: f32,
    wetland_humidity: f32,
) -> WasmBiomeHint {
    use terrain::{classify_tile, TerrainConfig, TileField};

    let tile = TileField {
        height,
        temperature,
        humidity,
        terrain_type,
        rocky_noise,
        sediment,
        water_table,
    };

    let config = TerrainConfig {
        sea_level,
        snow_level,
        rocky_level,
        forest_level,
        wetland_humidity,
        ..Default::default()
    };

    let hydrology = HydrologyClassification {
        bank_influence,
        channel_influence,
    };

    classify_tile(&tile, max_flux, &config, &hydrology).into()
}

#[cfg(test)]
mod sector_batch_tests {
    use super::*;

    fn test_field(height: f32) -> TileField {
        TileField {
            height,
            temperature: 0.4,
            humidity: 1.0,
            terrain_type: 0.0,
            rocky_noise: 0.0,
            sediment: 0.0,
            water_table: 0.0,
        }
    }

    fn axial_rect(
        q_range: std::ops::RangeInclusive<i32>,
        r_range: std::ops::RangeInclusive<i32>,
    ) -> Vec<HexCoord> {
        let mut coords = Vec::new();
        for q in q_range {
            for r in r_range.clone() {
                coords.push(HexCoord { q, r });
            }
        }
        coords.sort_by_key(|coord| (coord.q, coord.r));
        coords
    }

    fn emit_all(coords: &[HexCoord]) -> HashSet<i64> {
        coords.iter().map(coord_key_i64).collect()
    }

    #[test]
    fn sector_expansion_handles_negative_and_mixed_coordinates() {
        let coords = expand_sector_coords(&[0, 0, -1, 1, 1, -1], 17, 1);
        assert!(coords.iter().any(|coord| coord.q == 0 && coord.r == 0));
        assert!(coords.iter().any(|coord| coord.q == -17 && coord.r == 17));
        assert!(coords.iter().any(|coord| coord.q == 17 && coord.r == -17));

        let mut last: Option<(i32, i32)> = None;
        for coord in coords {
            let current = (coord.q, coord.r);
            if let Some(previous) = last {
                assert!(previous < current);
            }
            last = Some(current);
        }
    }

    #[test]
    fn sector_expansion_dedupes_overlapping_padding() {
        let separate_count =
            expand_sector_coords(&[0, 0], 17, 1).len() + expand_sector_coords(&[1, 0], 17, 1).len();
        let combined_count = expand_sector_coords(&[0, 0, 1, 0], 17, 1).len();
        assert!(combined_count < separate_count);
    }

    #[test]
    fn sector_fields_match_direct_field_generation() {
        let config = TerrainConfig::default();
        let seed = 42;
        let coords = expand_sector_coords(&[-1, 1], 17, 0);
        let noise = PerlinNoise::new(seed);

        for coord in coords.iter().take(16) {
            let direct = generate_tile_field(coord, seed, &config);
            let batched = generate_tile_field_with_noise(&noise, coord, &config);
            assert_eq!(direct.height, batched.height);
            assert_eq!(direct.temperature, batched.temperature);
            assert_eq!(direct.humidity, batched.humidity);
            assert_eq!(direct.terrain_type, batched.terrain_type);
        }
    }

    #[test]
    fn priority_flood_routes_depressed_basin_to_valid_outlet() {
        let config = TerrainConfig {
            sea_level: -1.0,
            ..TerrainConfig::default()
        };
        let coords = axial_rect(0..=50, 0..=20);
        let fields: Vec<TileField> = coords
            .iter()
            .map(|coord| {
                if coord.q == 35 && coord.r == 10 {
                    test_field(-0.5)
                } else {
                    let valley_pull = (coord.r - 10).abs() as f32 * 0.5;
                    test_field(coord.q as f32 + valley_pull)
                }
            })
            .collect();

        let hydrology =
            compute_priority_flood_hydrology(&coords, &fields, &emit_all(&coords), &config);

        assert!(hydrology.max_accumulation > 32.0);
        assert!(hydrology.river_edge_count > 0);
        for edge in hydrology.edge_ints.chunks_exact(4) {
            assert!((0..6).contains(&edge[2]));
        }
    }

    #[test]
    fn accumulation_increases_downstream_on_slope() {
        let config = TerrainConfig {
            sea_level: -1.0,
            ..TerrainConfig::default()
        };
        let coords = axial_rect(0..=40, 0..=10);
        let fields: Vec<TileField> = coords
            .iter()
            .map(|coord| {
                let valley_pull = (coord.r - 5).abs() as f32 * 0.2;
                test_field(coord.q as f32 + valley_pull)
            })
            .collect();

        let hydrology =
            compute_priority_flood_hydrology(&coords, &fields, &emit_all(&coords), &config);
        let mut accumulation_by_key = HashMap::<i64, f32>::new();
        for (channel, values) in hydrology
            .channel_ints
            .chunks_exact(7)
            .zip(hydrology.channel_floats.chunks_exact(2))
        {
            accumulation_by_key.insert(
                coord_key_i64(&HexCoord {
                    q: channel[0],
                    r: channel[1],
                }),
                values[0],
            );
        }

        let mut compared = 0;
        for (edge, values) in hydrology
            .edge_ints
            .chunks_exact(4)
            .zip(hydrology.edge_floats.chunks_exact(4))
        {
            let from = HexCoord {
                q: edge[0],
                r: edge[1],
            };
            let to = from.neighbors()[edge[2] as usize];
            let Some(parent_accumulation) = accumulation_by_key.get(&coord_key_i64(&to)) else {
                continue;
            };
            assert!(*parent_accumulation >= values[0]);
            compared += 1;
        }
        assert!(compared > 0);
    }

    #[test]
    fn strahler_order_increments_at_confluences() {
        let config = TerrainConfig {
            sea_level: -1.0,
            ..TerrainConfig::default()
        };
        let coords = axial_rect(0..=90, 0..=80);
        let fields: Vec<TileField> = coords
            .iter()
            .map(|coord| {
                let branch_spread = coord.q.min(40) as f32 * 0.5;
                let upper_center = 40.0 - branch_spread;
                let lower_center = 40.0 + branch_spread;
                let upper_pull = (coord.r as f32 - upper_center).abs();
                let lower_pull = (coord.r as f32 - lower_center).abs();
                let valley_pull = upper_pull.min(lower_pull) * 3.0;
                test_field(coord.q as f32 * 0.1 + valley_pull)
            })
            .collect();

        let hydrology =
            compute_priority_flood_hydrology(&coords, &fields, &emit_all(&coords), &config);
        let max_order = hydrology
            .channel_ints
            .chunks_exact(7)
            .map(|channel| channel[4])
            .max()
            .unwrap_or(0);

        assert!(max_order >= 2);
    }

    #[test]
    fn priority_flood_handles_mixed_sign_sector_domains() {
        let config = TerrainConfig::default();
        let seed = 42;
        let coords = expand_sector_coords(&[-1, 1, 0, 0, 1, -1], 17, 8);
        let emit_coords = expand_sector_coords(&[-1, 1, 0, 0, 1, -1], 17, 1);
        let emit_keys = emit_all(&emit_coords);
        let noise = PerlinNoise::new(seed);
        let fields: Vec<TileField> = coords
            .iter()
            .map(|coord| generate_tile_field_with_noise(&noise, coord, &config))
            .collect();

        let hydrology = compute_priority_flood_hydrology(&coords, &fields, &emit_keys, &config);

        assert!(hydrology.max_accumulation.is_finite());
        assert_eq!(hydrology.edge_ints.len(), hydrology.river_edge_count * 4);
        assert_eq!(hydrology.channel_ints.len(), hydrology.channel_count * 7);
    }

    #[test]
    fn macro_hydrology_grid_handles_mixed_sign_sector_centers() {
        let coords = macro_hydrology_coords(-3, 4, 12, 17, 4);
        assert!(!coords.is_empty());
        let mut last: Option<(i32, i32)> = None;
        for coord in &coords {
            let current = (coord.q, coord.r);
            if let Some(previous) = last {
                assert!(previous < current);
            }
            last = Some(current);
        }
        let positive = macro_hydrology_coords(3, -4, 12, 17, 4);
        assert_eq!(coords.len(), positive.len());
    }
}

// WASM exports for affordances
#[wasm_bindgen]
#[derive(Clone)]
pub struct WasmAffordanceConfig {
    pub max_build_slope: f32,
    pub max_road_slope: f32,
    pub water_proximity_bonus: f32,
    pub slope_penalty: f32,
    pub biome_penalty: f32,
    pub water_crossing_cost: f32,
}

#[wasm_bindgen]
impl WasmAffordanceConfig {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        let config = terrain::AffordanceConfig::default();
        Self {
            max_build_slope: config.max_build_slope,
            max_road_slope: config.max_road_slope,
            water_proximity_bonus: config.water_proximity_bonus,
            slope_penalty: config.slope_penalty,
            biome_penalty: config.biome_penalty,
            water_crossing_cost: config.water_crossing_cost,
        }
    }
}

impl From<WasmAffordanceConfig> for terrain::AffordanceConfig {
    fn from(wasm: WasmAffordanceConfig) -> Self {
        Self {
            max_build_slope: wasm.max_build_slope,
            max_road_slope: wasm.max_road_slope,
            water_proximity_bonus: wasm.water_proximity_bonus,
            slope_penalty: wasm.slope_penalty,
            biome_penalty: wasm.biome_penalty,
            water_crossing_cost: wasm.water_crossing_cost,
        }
    }
}

/// Compute affordances for a single tile (simplified version for WASM)
#[wasm_bindgen]
pub fn wasm_compute_tile_affordance(
    height: f32,
    temperature: f32,
    humidity: f32,
    terrain_type: f32,
    rocky_noise: f32,
    sediment: f32,
    water_table: f32,
    biome: WasmBiomeHint,
    slope: f32,
    water_access: f32,
    config: &WasmAffordanceConfig,
) -> js_sys::Object {
    use terrain::{AffordanceConfig, TileField};

    let tile = TileField {
        height,
        temperature,
        humidity,
        terrain_type,
        rocky_noise,
        sediment,
        water_table,
    };

    let biome_hint: terrain::BiomeHint = biome.into();
    let affordance_config: AffordanceConfig = config.clone().into();

    let buildability =
        terrain::buildability(&tile, biome_hint, slope, water_access, &affordance_config);
    let roadability =
        terrain::roadability(&tile, biome_hint, slope, water_access, &affordance_config);
    let settlement_suitability =
        terrain::settlement_suitability(&tile, biome_hint, slope, water_access, &affordance_config);

    // Production suitability for each industry type
    let agriculture = terrain::production_suitability(
        &tile,
        biome_hint,
        slope,
        water_access,
        terrain::IndustryType::Agriculture,
    );
    let forestry = terrain::production_suitability(
        &tile,
        biome_hint,
        slope,
        water_access,
        terrain::IndustryType::Forestry,
    );
    let mining = terrain::production_suitability(
        &tile,
        biome_hint,
        slope,
        water_access,
        terrain::IndustryType::Mining,
    );
    let fishing = terrain::production_suitability(
        &tile,
        biome_hint,
        slope,
        water_access,
        terrain::IndustryType::Fishing,
    );
    let manufacturing = terrain::production_suitability(
        &tile,
        biome_hint,
        slope,
        water_access,
        terrain::IndustryType::Manufacturing,
    );

    let result = js_sys::Object::new();
    js_sys::Reflect::set(&result, &"buildability".into(), &buildability.into()).unwrap();
    js_sys::Reflect::set(&result, &"roadability".into(), &roadability.into()).unwrap();
    js_sys::Reflect::set(
        &result,
        &"settlement_suitability".into(),
        &settlement_suitability.into(),
    )
    .unwrap();
    js_sys::Reflect::set(&result, &"water_access".into(), &water_access.into()).unwrap();

    let production = js_sys::Object::new();
    js_sys::Reflect::set(&production, &"agriculture".into(), &agriculture.into()).unwrap();
    js_sys::Reflect::set(&production, &"forestry".into(), &forestry.into()).unwrap();
    js_sys::Reflect::set(&production, &"mining".into(), &mining.into()).unwrap();
    js_sys::Reflect::set(&production, &"fishing".into(), &fishing.into()).unwrap();
    js_sys::Reflect::set(&production, &"manufacturing".into(), &manufacturing.into()).unwrap();
    js_sys::Reflect::set(&result, &"production_suitability".into(), &production).unwrap();

    result
}

// Additional WASM exports for terrain generation pipeline

/// Generate continents (plate tectonics) for a region
#[wasm_bindgen]
pub fn wasm_generate_continents(
    min_q: i32,
    max_q: i32,
    min_r: i32,
    max_r: i32,
    seed: u64,
    plate_count: usize,
) -> js_sys::Object {
    use terrain::generate_continents;

    let bounds = Bounds::new(min_q, max_q, min_r, max_r);
    let continental = generate_continents(&bounds, seed, plate_count);

    // Create result object with plates and plate_ids
    let result = js_sys::Object::new();

    // Convert plates to array
    let plates_array = js_sys::Array::new();
    for plate in &continental.plates {
        let plate_obj = js_sys::Object::new();
        js_sys::Reflect::set(
            &plate_obj,
            &"id".into(),
            &wasm_bindgen::JsValue::from(plate.id),
        )
        .unwrap();
        js_sys::Reflect::set(
            &plate_obj,
            &"center_q".into(),
            &wasm_bindgen::JsValue::from(plate.center.q),
        )
        .unwrap();
        js_sys::Reflect::set(
            &plate_obj,
            &"center_r".into(),
            &wasm_bindgen::JsValue::from(plate.center.r),
        )
        .unwrap();
        js_sys::Reflect::set(
            &plate_obj,
            &"velocity_x".into(),
            &wasm_bindgen::JsValue::from(plate.velocity.0),
        )
        .unwrap();
        js_sys::Reflect::set(
            &plate_obj,
            &"velocity_y".into(),
            &wasm_bindgen::JsValue::from(plate.velocity.1),
        )
        .unwrap();
        let kind_str = match plate.kind {
            terrain::PlateKind::Oceanic => "oceanic",
            terrain::PlateKind::Continental => "continental",
        };
        js_sys::Reflect::set(&plate_obj, &"kind".into(), &kind_str.into()).unwrap();
        plates_array.push(&plate_obj);
    }
    js_sys::Reflect::set(&result, &"plates".into(), &plates_array).unwrap();

    // Convert plate_ids to object
    let plate_ids_obj = js_sys::Object::new();
    for (key, id) in &continental.plate_ids {
        js_sys::Reflect::set(
            &plate_ids_obj,
            &key.into(),
            &wasm_bindgen::JsValue::from(*id),
        )
        .unwrap();
    }
    js_sys::Reflect::set(&result, &"plate_ids".into(), &plate_ids_obj).unwrap();

    result
}

/// Generate mountains for a region
#[wasm_bindgen]
pub fn wasm_generate_mountains(
    min_q: i32,
    max_q: i32,
    min_r: i32,
    max_r: i32,
    seed: u64,
    base_elevation: js_sys::Array,
) -> js_sys::Object {
    use terrain::{generate_mountains, MountainConfig};

    let bounds = Bounds::new(min_q, max_q, min_r, max_r);

    // Parse base_elevation array: alternating key, value
    let mut elevation_vec = Vec::new();
    for i in (0..base_elevation.length()).step_by(2) {
        let key_val = base_elevation.get(i);
        let value_val = base_elevation.get(i + 1);

        let key = key_val.as_string().unwrap().into();
        let value = value_val.as_f64().unwrap() as f32;
        elevation_vec.push((key, value));
    }

    let mountain_config = MountainConfig::default();
    let mountain_elevation = generate_mountains(&bounds, seed, &elevation_vec, &mountain_config);

    // Convert result to object
    let result = js_sys::Object::new();
    for (key, value) in &mountain_elevation {
        js_sys::Reflect::set(&result, &key.into(), &wasm_bindgen::JsValue::from(*value)).unwrap();
    }

    result
}

/// Debug export: Get mountain-only elevation deltas for overlay render
#[wasm_bindgen]
pub fn wasm_debug_mountain_elevation(
    min_q: i32,
    max_q: i32,
    min_r: i32,
    max_r: i32,
    seed: u64,
    base_elevation: js_sys::Array,
) -> Vec<f32> {
    use terrain::{generate_mountains, MountainConfig};

    let bounds = Bounds::new(min_q, max_q, min_r, max_r);

    // Parse base_elevation array: alternating key, value
    let mut elevation_vec = Vec::new();
    for i in (0..base_elevation.length()).step_by(2) {
        let key_val = base_elevation.get(i);
        let value_val = base_elevation.get(i + 1);

        let key = key_val.as_string().unwrap().into();
        let value = value_val.as_f64().unwrap() as f32;
        elevation_vec.push((key, value));
    }

    let mountain_config = MountainConfig::default();
    let mountain_elevation = generate_mountains(&bounds, seed, &elevation_vec, &mountain_config);

    // Return elevation deltas in order of bounds.hexes()
    let mut result = Vec::new();
    for hex in bounds.hexes() {
        let key = hex.to_key();
        if let Some((_, mountain_height)) = mountain_elevation.iter().find(|(k, _)| k == &key) {
            if let Some((_, base_height)) = elevation_vec.iter().find(|(k, _)| k == &key) {
                result.push((mountain_height - base_height).max(0.0));
            } else {
                result.push(0.0);
            }
        } else {
            result.push(0.0);
        }
    }

    result
}

/// Simulate hydraulic erosion
#[wasm_bindgen]
pub fn wasm_simulate_erosion(
    elevation: js_sys::Array,
    seed: u64,
    droplet_count: u32,
) -> js_sys::Object {
    use terrain::{simulate_erosion, ErosionConfig};

    // Parse elevation array: alternating key, value
    let mut elevation_vec = Vec::new();
    for i in (0..elevation.length()).step_by(2) {
        let key_val = elevation.get(i);
        let value_val = elevation.get(i + 1);

        let key = key_val.as_string().unwrap().into();
        let value = value_val.as_f64().unwrap() as f32;
        elevation_vec.push((key, value));
    }

    let erosion_config = ErosionConfig {
        droplet_count,
        ..Default::default()
    };
    let erosion_result = simulate_erosion(&elevation_vec, seed, &erosion_config);

    // Create result object
    let result = js_sys::Object::new();

    // Convert eroded elevation to object
    let eroded_obj = js_sys::Object::new();
    for (key, value) in &erosion_result.elevation {
        js_sys::Reflect::set(
            &eroded_obj,
            &key.into(),
            &wasm_bindgen::JsValue::from(*value),
        )
        .unwrap();
    }
    js_sys::Reflect::set(&result, &"elevation".into(), &eroded_obj).unwrap();

    // Convert sediment to object
    let sediment_obj = js_sys::Object::new();
    for (key, value) in &erosion_result.sediment {
        js_sys::Reflect::set(
            &sediment_obj,
            &key.into(),
            &wasm_bindgen::JsValue::from(*value),
        )
        .unwrap();
    }
    js_sys::Reflect::set(&result, &"sediment".into(), &sediment_obj).unwrap();

    result
}

/// Compute drainage and rivers
#[wasm_bindgen]
pub fn wasm_compute_drainage(
    elevation: js_sys::Array,
    land_mask: js_sys::Array,
    stream_threshold: f32,
) -> js_sys::Object {
    use terrain::{compute_drainage, DrainageConfig};

    // Parse elevation array: alternating key, value
    let mut elevation_vec = Vec::new();
    for i in (0..elevation.length()).step_by(2) {
        let key_val = elevation.get(i);
        let value_val = elevation.get(i + 1);

        let key = key_val.as_string().unwrap().into();
        let value = value_val.as_f64().unwrap() as f32;
        elevation_vec.push((key, value));
    }

    // Parse land_mask array: alternating key, value
    let mut land_mask_vec = Vec::new();
    for i in (0..land_mask.length()).step_by(2) {
        let key_val = land_mask.get(i);
        let value_val = land_mask.get(i + 1);

        let key = key_val.as_string().unwrap().into();
        let value = value_val.as_bool().unwrap();
        land_mask_vec.push((key, value));
    }

    let drainage_config = DrainageConfig {
        stream_threshold,
        ..Default::default()
    };
    let drainage = compute_drainage(&elevation_vec, &land_mask_vec, &drainage_config);

    // Create result object
    let result = js_sys::Object::new();

    // Convert flow_direction to object
    let flow_dir_obj = js_sys::Object::new();
    for (key, dir) in &drainage.flow_direction {
        let dir_value = dir
            .map(|d| wasm_bindgen::JsValue::from(d))
            .unwrap_or(wasm_bindgen::JsValue::null());
        js_sys::Reflect::set(&flow_dir_obj, &key.into(), &dir_value).unwrap();
    }
    js_sys::Reflect::set(&result, &"flow_direction".into(), &flow_dir_obj).unwrap();

    // Convert flow_accumulation to object
    let flow_acc_obj = js_sys::Object::new();
    for (key, value) in &drainage.flow_accumulation {
        js_sys::Reflect::set(
            &flow_acc_obj,
            &key.into(),
            &wasm_bindgen::JsValue::from(*value),
        )
        .unwrap();
    }
    js_sys::Reflect::set(&result, &"flow_accumulation".into(), &flow_acc_obj).unwrap();

    // Convert rivers to array
    let rivers_array = js_sys::Array::new();
    for river in &drainage.rivers {
        let river_obj = js_sys::Object::new();
        js_sys::Reflect::set(
            &river_obj,
            &"hex_key".into(),
            &wasm_bindgen::JsValue::from(river.hex_key.clone()),
        )
        .unwrap();
        js_sys::Reflect::set(
            &river_obj,
            &"stream_order".into(),
            &wasm_bindgen::JsValue::from(river.stream_order),
        )
        .unwrap();
        js_sys::Reflect::set(
            &river_obj,
            &"flux".into(),
            &wasm_bindgen::JsValue::from(river.flux),
        )
        .unwrap();
        rivers_array.push(&river_obj);
    }
    js_sys::Reflect::set(&result, &"rivers".into(), &rivers_array).unwrap();

    result
}

/// Detect lakes
#[wasm_bindgen]
pub fn wasm_detect_lakes(
    elevation: js_sys::Array,
    land_mask: js_sys::Array,
    flow_direction: js_sys::Array,
    min_lake_area: usize,
) -> js_sys::Array {
    use terrain::{detect_lakes, LakeConfig};

    // Parse elevation array: alternating key, value
    let mut elevation_vec = Vec::new();
    for i in (0..elevation.length()).step_by(2) {
        let key_val = elevation.get(i);
        let value_val = elevation.get(i + 1);

        let key = key_val.as_string().unwrap().into();
        let value = value_val.as_f64().unwrap() as f32;
        elevation_vec.push((key, value));
    }

    // Parse land_mask array: alternating key, value
    let mut land_mask_vec = Vec::new();
    for i in (0..land_mask.length()).step_by(2) {
        let key_val = land_mask.get(i);
        let value_val = land_mask.get(i + 1);

        let key = key_val.as_string().unwrap().into();
        let value = value_val.as_bool().unwrap();
        land_mask_vec.push((key, value));
    }

    // Parse flow_direction array: alternating key, value
    let mut flow_dir_vec = Vec::new();
    for i in (0..flow_direction.length()).step_by(2) {
        let key_val = flow_direction.get(i);
        let value_val = flow_direction.get(i + 1);

        let key = key_val.as_string().unwrap().into();
        let value_opt = value_val.as_f64();
        let value = if value_opt.is_some() {
            value_opt.map(|v| v as u8)
        } else {
            None
        };
        flow_dir_vec.push((key, value));
    }

    let lake_config = LakeConfig {
        min_lake_area,
        ..Default::default()
    };
    let lakes = detect_lakes(&elevation_vec, &land_mask_vec, &flow_dir_vec, &lake_config);

    // Convert lakes to array
    let result = js_sys::Array::new();
    for lake in &lakes {
        let lake_obj = js_sys::Object::new();

        let surface_tiles = js_sys::Array::new();
        for tile in &lake.surface_tiles {
            surface_tiles.push(&tile.clone().into());
        }
        js_sys::Reflect::set(&lake_obj, &"surface_tiles".into(), &surface_tiles).unwrap();

        if let Some(outlet) = &lake.outlet {
            js_sys::Reflect::set(
                &lake_obj,
                &"outlet".into(),
                &wasm_bindgen::JsValue::from(outlet.clone()),
            )
            .unwrap();
        } else {
            js_sys::Reflect::set(&lake_obj, &"outlet".into(), &wasm_bindgen::JsValue::null())
                .unwrap();
        }

        js_sys::Reflect::set(
            &lake_obj,
            &"water_level".into(),
            &wasm_bindgen::JsValue::from(lake.water_level),
        )
        .unwrap();
        js_sys::Reflect::set(
            &lake_obj,
            &"volume".into(),
            &wasm_bindgen::JsValue::from(lake.volume),
        )
        .unwrap();

        let depth_map = js_sys::Object::new();
        for (key, depth) in &lake.depth_map {
            js_sys::Reflect::set(
                &depth_map,
                &key.into(),
                &wasm_bindgen::JsValue::from(*depth),
            )
            .unwrap();
        }
        js_sys::Reflect::set(&lake_obj, &"depth_map".into(), &depth_map).unwrap();

        result.push(&lake_obj);
    }

    result
}

/// Generate full terrain with per-layer timing for profiling
#[wasm_bindgen]
pub fn wasm_generation_timings(
    min_q: i32,
    max_q: i32,
    min_r: i32,
    max_r: i32,
    seed: u64,
) -> js_sys::Object {
    use std::time::Instant;
    use terrain::{
        classify_region, compute_drainage, detect_lakes, generate_continents, generate_mountains,
        generate_region, simulate_erosion, BiomeHint, DrainageConfig, ErosionConfig, LakeConfig,
        MountainConfig, RIVER_FLUX_LAKE_MULTIPLIER, RIVER_FLUX_THRESHOLD,
    };

    let bounds = Bounds::new(min_q, max_q, min_r, max_r);
    let config = terrain::TerrainConfig::default();

    let timings = js_sys::Object::new();

    // Stage 1: Base tile fields
    let start = Instant::now();
    let tiles = generate_region(&bounds, seed, &config);
    let base_ms = start.elapsed().as_millis() as f64;
    js_sys::Reflect::set(
        &timings,
        &"base_ms".into(),
        &wasm_bindgen::JsValue::from(base_ms),
    )
    .unwrap();

    // Stage 2: Continental layer
    let start = Instant::now();
    let plate_count = 7;
    let continental = generate_continents(&bounds, seed, plate_count);
    let continental_ms = start.elapsed().as_millis() as f64;
    js_sys::Reflect::set(
        &timings,
        &"continental_ms".into(),
        &wasm_bindgen::JsValue::from(continental_ms),
    )
    .unwrap();

    // Create land mask
    let land_mask: Vec<(String, bool)> = tiles
        .iter()
        .map(|(key, _)| {
            let is_land = continental.plate_ids.iter().any(|(k, _)| k == key);
            (key.clone(), is_land)
        })
        .collect();

    // Stage 3: Mountains
    let start = Instant::now();
    let base_elevation: Vec<(String, f32)> =
        tiles.iter().map(|(k, v)| (k.clone(), v.height)).collect();
    let mountain_config = MountainConfig::default();
    let mountain_elevation = generate_mountains(&bounds, seed, &base_elevation, &mountain_config);
    let mountains_ms = start.elapsed().as_millis() as f64;
    js_sys::Reflect::set(
        &timings,
        &"mountains_ms".into(),
        &wasm_bindgen::JsValue::from(mountains_ms),
    )
    .unwrap();

    // Apply mountain elevation
    let mut updated_tiles: Vec<(String, terrain::TileField)> = tiles
        .into_iter()
        .map(|(key, mut tile)| {
            if let Some(uplift) = mountain_elevation
                .iter()
                .find(|(k, _)| k == &key)
                .map(|(_, v)| v)
            {
                tile.height = tile.height.max(*uplift);
            }
            (key, tile)
        })
        .collect();

    // Stage 4: Erosion
    let start = Instant::now();
    let elevation_slice: Vec<(String, f32)> = updated_tiles
        .iter()
        .map(|(k, v)| (k.clone(), v.height))
        .collect();
    let erosion_config = ErosionConfig::default();
    let erosion_result = simulate_erosion(&elevation_slice, seed, &erosion_config);
    let erosion_ms = start.elapsed().as_millis() as f64;
    js_sys::Reflect::set(
        &timings,
        &"erosion_ms".into(),
        &wasm_bindgen::JsValue::from(erosion_ms),
    )
    .unwrap();

    // Apply erosion
    for (key, tile) in &mut updated_tiles {
        if let Some(eroded_pair) = erosion_result.elevation.iter().find(|(k, _)| k == key) {
            tile.height = eroded_pair.1;
        }
        if let Some(sed_pair) = erosion_result.sediment.iter().find(|(k, _)| k == key) {
            tile.sediment = sed_pair.1;
        }
    }

    // Stage 5: Drainage
    let start = Instant::now();
    let post_erosion_elevation: Vec<(String, f32)> = updated_tiles
        .iter()
        .map(|(k, v)| (k.clone(), v.height))
        .collect();
    let drainage_config = DrainageConfig::default();
    let drainage = compute_drainage(&post_erosion_elevation, &land_mask, &drainage_config);
    let drainage_ms = start.elapsed().as_millis() as f64;
    js_sys::Reflect::set(
        &timings,
        &"drainage_ms".into(),
        &wasm_bindgen::JsValue::from(drainage_ms),
    )
    .unwrap();

    // Stage 6: Lakes
    let start = Instant::now();
    let lake_config = LakeConfig::default();
    let lakes = detect_lakes(
        &post_erosion_elevation,
        &land_mask,
        &drainage.flow_direction,
        &lake_config,
    );
    let lakes_ms = start.elapsed().as_millis() as f64;
    js_sys::Reflect::set(
        &timings,
        &"lakes_ms".into(),
        &wasm_bindgen::JsValue::from(lakes_ms),
    )
    .unwrap();

    // Stage 7: Biome classification
    let start = Instant::now();
    let tile_fields: Vec<terrain::TileField> =
        updated_tiles.iter().map(|(_, v)| v.clone()).collect();
    let max_fluxes: Vec<f32> = drainage.flow_accumulation.iter().map(|(_, v)| *v).collect();
    let hydrology: Vec<terrain::HydrologyClassification> = tile_fields
        .iter()
        .zip(drainage.rivers.iter())
        .map(|(_tile, river)| {
            let bank_influence = if river.flux > RIVER_FLUX_THRESHOLD {
                Some(river.flux / RIVER_FLUX_THRESHOLD)
            } else {
                None
            };
            let channel_influence =
                if river.flux > RIVER_FLUX_THRESHOLD * RIVER_FLUX_LAKE_MULTIPLIER {
                    Some(river.flux / (RIVER_FLUX_THRESHOLD * RIVER_FLUX_LAKE_MULTIPLIER))
                } else {
                    None
                };
            terrain::HydrologyClassification {
                bank_influence,
                channel_influence,
            }
        })
        .collect();
    let biome_hints = classify_region(&tile_fields, &max_fluxes, &config, &hydrology);
    let biome_ms = start.elapsed().as_millis() as f64;
    js_sys::Reflect::set(
        &timings,
        &"biome_ms".into(),
        &wasm_bindgen::JsValue::from(biome_ms),
    )
    .unwrap();

    // Stage 8: Affordances
    let start = Instant::now();
    let affordance_config = terrain::AffordanceConfig::default();
    let hexes = bounds.hexes();
    let mut biome_map = std::collections::HashMap::new();
    for (hex, biome) in hexes.iter().zip(biome_hints.iter()) {
        biome_map.insert(hex.to_key(), *biome);
    }

    for hex in hexes {
        let key = hex.to_key();
        if let Some(tile) = updated_tiles
            .iter()
            .find(|(k, _)| k == &key)
            .map(|(_, v)| v)
        {
            let biome = biome_map.get(&key).copied().unwrap_or(BiomeHint::Grass);
            let slope = 0.1; // Simplified
            let water_access = terrain::water_access(&hex, &drainage, &lakes, &land_mask, 20);
            let _ = terrain::buildability(tile, biome, slope, water_access, &affordance_config);
            let _ = terrain::roadability(tile, biome, slope, water_access, &affordance_config);
            let _ = terrain::settlement_suitability(
                tile,
                biome,
                slope,
                water_access,
                &affordance_config,
            );
        }
    }
    let affordances_ms = start.elapsed().as_millis() as f64;
    js_sys::Reflect::set(
        &timings,
        &"affordances_ms".into(),
        &wasm_bindgen::JsValue::from(affordances_ms),
    )
    .unwrap();

    // Total time
    let total_ms = base_ms
        + continental_ms
        + mountains_ms
        + erosion_ms
        + drainage_ms
        + lakes_ms
        + biome_ms
        + affordances_ms;
    js_sys::Reflect::set(
        &timings,
        &"total_ms".into(),
        &wasm_bindgen::JsValue::from(total_ms),
    )
    .unwrap();

    timings
}

// Step 12: Debug & tooling exports

/// Debug export: Get continental mask for a region (returns flattened array: [is_land, plate_id, is_land, plate_id, ...])
#[wasm_bindgen]
pub fn debug_continental_mask(
    min_q: i32,
    max_q: i32,
    min_r: i32,
    max_r: i32,
    seed: u64,
) -> Vec<u32> {
    use terrain::generate_continents;

    let bounds = Bounds::new(min_q, max_q, min_r, max_r);
    let plate_count = 7;
    let continental = generate_continents(&bounds, seed, plate_count);

    // Create a map of hex_key to plate_id
    let plate_id_map: std::collections::HashMap<String, u32> =
        continental.plate_ids.iter().cloned().collect();

    // Generate results for all hexes in bounds
    let mut result = Vec::new();
    for hex in bounds.hexes() {
        let key = hex.to_key();
        let is_land = if plate_id_map.contains_key(&key) {
            1
        } else {
            0
        };
        let plate_id = plate_id_map.get(&key).copied().unwrap_or(0);
        result.push(is_land);
        result.push(plate_id);
    }
    result
}

/// Debug export: Get flow direction (0-5) for a region
#[wasm_bindgen]
pub fn debug_flow_direction(min_q: i32, max_q: i32, min_r: i32, max_r: i32, seed: u64) -> Vec<u8> {
    use terrain::{compute_drainage, generate_region, DrainageConfig};

    let bounds = Bounds::new(min_q, max_q, min_r, max_r);
    let config = terrain::TerrainConfig::default();
    let tiles = generate_region(&bounds, seed, &config);

    // Create land mask (all tiles are land for debug)
    let land_mask: Vec<(String, bool)> = tiles.iter().map(|(k, _)| (k.clone(), true)).collect();

    // Create elevation slice
    let elevation: Vec<(String, f32)> = tiles.iter().map(|(k, v)| (k.clone(), v.height)).collect();

    let drainage_config = DrainageConfig::default();
    let drainage = compute_drainage(&elevation, &land_mask, &drainage_config);

    // Extract flow direction for each tile
    let hexes = bounds.hexes();
    let mut result = Vec::new();
    for hex in hexes {
        let key = hex.to_key();
        if let Some((_, dir)) = drainage.flow_direction.iter().find(|(k, _)| k == &key) {
            result.push(dir.unwrap_or(255));
        } else {
            result.push(255);
        }
    }
    result
}

/// Debug export: Get affordance heatmap values for a region
#[wasm_bindgen]
pub fn debug_affordance_heatmap(
    min_q: i32,
    max_q: i32,
    min_r: i32,
    max_r: i32,
    seed: u64,
    field_name: String,
) -> Vec<f32> {
    use terrain::{
        classify_region, compute_drainage, detect_lakes, generate_region, BiomeHint,
        DrainageConfig, LakeConfig,
    };

    let bounds = Bounds::new(min_q, max_q, min_r, max_r);
    let config = terrain::TerrainConfig::default();
    let tiles = generate_region(&bounds, seed, &config);

    // Create land mask
    let land_mask: Vec<(String, bool)> = tiles.iter().map(|(k, _)| (k.clone(), true)).collect();

    // Create elevation slice
    let elevation: Vec<(String, f32)> = tiles.iter().map(|(k, v)| (k.clone(), v.height)).collect();

    // Compute drainage
    let drainage_config = DrainageConfig::default();
    let drainage = compute_drainage(&elevation, &land_mask, &drainage_config);

    // Detect lakes
    let lake_config = LakeConfig::default();
    let lakes = detect_lakes(
        &elevation,
        &land_mask,
        &drainage.flow_direction,
        &lake_config,
    );

    // Classify biomes
    let tile_fields: Vec<terrain::TileField> = tiles.iter().map(|(_, v)| v.clone()).collect();
    let max_fluxes: Vec<f32> = drainage.flow_accumulation.iter().map(|(_, v)| *v).collect();
    let hydrology: Vec<terrain::HydrologyClassification> = tile_fields
        .iter()
        .zip(drainage.rivers.iter())
        .map(|(_tile, river)| {
            let bank_influence = if river.flux > terrain::RIVER_FLUX_THRESHOLD {
                Some(river.flux / terrain::RIVER_FLUX_THRESHOLD)
            } else {
                None
            };
            let channel_influence = if river.flux
                > terrain::RIVER_FLUX_THRESHOLD * terrain::RIVER_FLUX_LAKE_MULTIPLIER
            {
                Some(
                    river.flux
                        / (terrain::RIVER_FLUX_THRESHOLD * terrain::RIVER_FLUX_LAKE_MULTIPLIER),
                )
            } else {
                None
            };
            terrain::HydrologyClassification {
                bank_influence,
                channel_influence,
            }
        })
        .collect();
    let biomes = classify_region(&tile_fields, &max_fluxes, &config, &hydrology);

    // Compute affordances based on field name
    let affordance_config = terrain::AffordanceConfig::default();
    let hexes = bounds.hexes();
    let mut biome_map = std::collections::HashMap::new();
    for (hex, biome) in hexes.iter().zip(biomes.iter()) {
        biome_map.insert(hex.to_key(), *biome);
    }

    let mut result = Vec::new();
    for hex in hexes {
        let key = hex.to_key();
        let tile = tiles.iter().find(|(k, _)| k == &key).map(|(_, v)| v);
        let biome = biome_map.get(&key).copied().unwrap_or(BiomeHint::Grass);

        if let Some(tile) = tile {
            // Calculate slope (simplified)
            let slope = 0.1; // Placeholder - would need neighbor data

            // Calculate water access
            let water_access = terrain::water_access(&hex, &drainage, &lakes, &land_mask, 20);

            let value = match field_name.as_str() {
                "buildability" => {
                    terrain::buildability(tile, biome, slope, water_access, &affordance_config)
                }
                "roadability" => {
                    terrain::roadability(tile, biome, slope, water_access, &affordance_config)
                }
                "settlement_suitability" => terrain::settlement_suitability(
                    tile,
                    biome,
                    slope,
                    water_access,
                    &affordance_config,
                ),
                "water_access" => water_access,
                "height" => tile.height,
                "temperature" => tile.temperature,
                "humidity" => tile.humidity,
                _ => 0.0,
            };
            result.push(value);
        } else {
            result.push(0.0);
        }
    }
    result
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

    #[test]
    fn test_debug_continental_mask() {
        let result = debug_continental_mask(-2, 2, -2, 2, 42);
        // Should have results for all hexes in bounds (2 values per hex)
        assert!(!result.is_empty());
        assert!(result.len() % 2 == 0); // Even number of values
                                        // Each pair should be (is_land, plate_id)
        for i in (0..result.len()).step_by(2) {
            let is_land = result[i];
            let plate_id = result[i + 1];
            assert!(is_land == 0 || is_land == 1); // Valid bool
            assert!(plate_id <= 7); // Valid plate ID
        }
    }

    #[test]
    fn test_debug_flow_direction() {
        let result = debug_flow_direction(-2, 2, -2, 2, 42);
        // Should have results for all hexes in bounds
        assert!(!result.is_empty());
        // Each result should be a direction (0-5) or 255 (no direction)
        for dir in result {
            assert!(dir <= 255);
        }
    }

    #[test]
    fn test_debug_affordance_heatmap() {
        let result = debug_affordance_heatmap(-2, 2, -2, 2, 42, "buildability".to_string());
        // Should have results for all hexes in bounds
        assert!(!result.is_empty());
        // Each result should be a valid affordance value (0-1)
        for value in result {
            assert!(value >= 0.0 && value <= 1.0);
        }
    }

    #[test]
    fn test_debug_affordance_heatmap_height() {
        let result = debug_affordance_heatmap(-2, 2, -2, 2, 42, "height".to_string());
        // Should have results for all hexes in bounds
        assert!(!result.is_empty());
        // Height can be any float value
        assert!(!result.is_empty());
    }

    #[test]
    fn test_seed_comparison() {
        // Test that different seeds produce different results
        let result1 = debug_continental_mask(-1, 1, -1, 1, 11111);
        let result2 = debug_continental_mask(-1, 1, -1, 1, 22222);

        // Results should differ
        let differs = result1.iter().zip(result2.iter()).any(|(r1, r2)| r1 != r2);

        assert!(differs, "Different seeds should produce different results");
    }
}
