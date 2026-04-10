# `[q,r] -> terrain` Algorithm

This document describes the current algorithmic mapping from an axial hex coordinate `[q, r]` to terrain fields and then to biome-level terrain labels.

## Overview

The algorithm is deliberately split into two layers:

1. A deterministic per-tile function:
   `[seed, q, r] -> TileField`
2. Optional neighborhood-aware interpretation:
   `TileField + nearby context -> biome / river edges`

The first layer is the important one for streaming. A tile's raw fields must not change just because we generated a bigger region around it.

## Step 1: Axial hex to 2D sample space

In `src/fields/cpu.ts`, the axial coordinate is projected to a continuous 2D space:

```ts
const wx = q * 0.866
const wy = r + q * 0.5
```

This is the sampling-space embedding for the pointy-top axial grid used by the engine. It gives each hex a stable location in a plane where continuous noise can be sampled.

In compact form:

- `wx = q * sqrt(3) / 2`
- `wy = r + q / 2`

## Step 2: Rotate the sample space

To reduce obvious directional bias, the implementation samples the same coordinate in three orientations:

- unrotated
- rotated by `+pi/6`
- rotated by `-pi/6`

If we call the base point `(wx, wy)`, the rotated points are:

- `(x1, y1) = rotate(+30deg, wx, wy)`
- `(x2, y2) = rotate(-30deg, wx, wy)`

The code uses:

```ts
x1 = wx * COS1 - wy * SIN1
y1 = wx * SIN1 + wy * COS1
x2 = wx * COS2 - wy * SIN2
y2 = wx * SIN2 + wy * COS2
```

This is a cheap isotropy trick: instead of trusting one lattice orientation, we blend multiple views of the same location.

## Step 3: Sample seeded FBM noise

The noise base is seeded Perlin noise (`PerlinNoise`) combined with fractal Brownian motion (`fbm`).

For each sample point:

```ts
fbm(noise, x * scale, y * scale, octaves, persistence, lacunarity)
```

Where:

- `scale` controls feature size
- `octaves` controls detail layers
- `persistence` controls amplitude falloff per octave
- `lacunarity` controls frequency growth per octave

Because the permutation table is seeded, the result is deterministic for a given `seed`.

## Step 4: Build local relief

Local relief is the average of the three rotated FBM samples:

```ts
h0 = fbm(noise, wx * scale, wy * scale, ...)
h1 = fbm(noise, x1 * scale, y1 * scale, ...)
h2 = fbm(noise, x2 * scale, y2 * scale, ...)

localHeight = (h0 + h1 + h2) / 3
```

## Step 5: Build macro elevation

The engine also samples a second, much lower-frequency height field using the same rotated basis:

```ts
macroScale = scale * 0.22
macroHeight = mean(
  fbm(noise, wx * macroScale, wy * macroScale, 3, 0.55, 2.0),
  fbm(noise, x1 * macroScale, y1 * macroScale, 3, 0.55, 2.0),
  fbm(noise, x2 * macroScale, y2 * macroScale, 3, 0.55, 2.0)
)
```

This low-frequency field creates continuity: broad coasts, inland mass, and mountain regions instead of thin noisy streaks.

## Step 6: Blend the two height signals

The final height is a weighted blend:

```ts
height = localHeight * 0.58 + macroHeight * 0.32
```

So the current raw height function is:

`height(seed, q, r) = localRelief(seed, q, r) * 0.58 + macroElevation(seed, q, r) * 0.32`

Where:

- `P(seed)` is the seeded permutation table
- `S0`, `S+`, `S-` are the unrotated and rotated sample transforms

This value is not normalized against the current board. That is intentional.

## Step 7: Build `temperature`

Temperature uses another FBM sample, but on a mixed coordinate basis derived from the rotated positions:

```ts
temperature = fbm(
  noise,
  (wx * 0.9 + y1 * 0.1) * temperatureScale,
  (wy * 0.9 + x2 * 0.1) * temperatureScale,
  3,
  0.5,
  2.0
)
```

Notes:

- It uses fixed FBM settings: `3` octaves, persistence `0.5`, lacunarity `2.0`.
- It uses `temperatureScale` rather than the terrain `scale`.
- The mixed axes decorrelate temperature from pure height sampling.

## Step 8: Build `humidity`

Humidity follows the same idea with a slightly different blend:

```ts
humidity = fbm(
  noise,
  (wx * 0.85 + x1 * 0.15) * humidityScale,
  (wy * 0.85 + y2 * 0.15) * humidityScale,
  3,
  0.5,
  2.0
)
```

This keeps humidity deterministic per tile while avoiding a trivial copy of the height field.

## Step 9: Emit the raw tile field

The current generated tile is:

```ts
{
  height,
  temperature,
  humidity,
  sediment: 0,
  waterTable: 0
}
```

So, algorithmically:

`[q, r] -> { height, temperature, humidity, sediment: 0, waterTable: 0 }`

at the pure field-generation layer.

## Step 10: Classify terrain from raw fields

`src/classify.ts` turns the raw tile into a terrain label (`BiomeHint`).

Without hydrology, the decision order is roughly:

1. Below `seaLevel`:
   `ocean`
2. Above `snowLevel`:
   `snow`
3. Above `rockyLevel`:
   `rocky`
4. Hot and dry:
   `sand`
5. Wet and low:
   `wetland`
6. Wet enough and above `forestLevel`:
   `forest`
7. Otherwise:
   `grass`

With hydrology active, river and bank rules can override that interpretation:

- strong edge flux can produce `river-bank`
- strong channel influence can turn a low tile into `lake`
- bank influence can shift low, wet land into `wetland`

So the full mapping is more precisely:

- raw layer: `[seed, q, r] -> TileField`
- interpreted layer: `TileField (+ neighbors, optionally) -> BiomeHint`

## Step 11: Optional hydrology pass

Hydrology is not part of the pure `[q,r] -> TileField` function, but it matters for the final terrain result.

The current pass works like this:

1. A tile can become a spring only if:
   - it is above sea level
   - it passes a parity mask: `(q | r) & 1 === 0`
   - a seeded random test succeeds
2. The spring probability grows with land height between `seaLevel` and `hydrologyLandCeiling`.
3. From each spring, `traceFromSpring(...)` searches for a bounded downhill-ish path toward the sea.
4. Each traversed edge accumulates flux.
5. Nearby tiles receive bank/channel influence.
6. Biome classification is rerun with that extra context.

This means rivers are deterministic for a given generated tile set, but unlike raw tile fields they do depend on the generated neighborhood.

## Compact Formula

For the current CPU reference path, the pure terrain-field function is:

```text
f(seed, q, r) =
  let wx = q * sqrt(3)/2
  let wy = r + q/2
  let p0 = (wx, wy)
  let p1 = rotate(+30deg, p0)
  let p2 = rotate(-30deg, p0)

  let localHeight = mean(
    fbm(seed, p0 * scale, octaves, persistence, lacunarity),
    fbm(seed, p1 * scale, octaves, persistence, lacunarity),
    fbm(seed, p2 * scale, octaves, persistence, lacunarity)
  )

  let macroScale = scale * 0.22
  let macroHeight = mean(
    fbm(seed, p0 * macroScale, 3, 0.55, 2.0),
    fbm(seed, p1 * macroScale, 3, 0.55, 2.0),
    fbm(seed, p2 * macroScale, 3, 0.55, 2.0)
  )

  let height = localHeight * 0.58 + macroHeight * 0.32

  let temperature = fbm(
    seed,
    ((wx * 0.9 + p1.y * 0.1), (wy * 0.9 + p2.x * 0.1)) * temperatureScale,
    3, 0.5, 2.0
  )

  let humidity = fbm(
    seed,
    ((wx * 0.85 + p1.x * 0.15), (wy * 0.85 + p2.y * 0.15)) * humidityScale,
    3, 0.5, 2.0
  )

  return {
    height,
    temperature,
    humidity,
    sediment: 0,
    waterTable: 0
  }
```

## Why This Shape

The algorithm favors:

- determinism over board-relative normalization
- local computability over global post-processing
- soft variation via rotated noise blending instead of hard handcrafted masks

That is why the engine can safely say "the tile at `[q,r]` is generated from the seed and the coordinate alone" for raw terrain, while still allowing richer second-pass systems like hydrology to refine the final result.
