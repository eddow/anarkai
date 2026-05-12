# World Representation

This note records the working scale and representation rules for the world. It is about what one hex means in
game terms, not only how it is drawn.

## Working Scale

Use a working physical scale of:

```text
hex side = 3 meters, about 10 feet
```

For a regular hexagon:

```text
area = (3 * sqrt(3) / 2) * side^2
```

With side `3m`, one tile is about:

```text
23.4 m2
```

This scale fits the current sprite view and the tile-occupancy model:

- A person crossing another person inside the same tile needs coordination.
- It is plausible that one worker can make another wait before passing through a busy tile.
- A hive/alveolus tile reads as a small building-sized footprint.
- Paths and narrow roads can be drawn at human scale without consuming whole districts.

## Representation Versus Literal Objects

At this scale, a tile still cannot literally contain many full-sized trees, rocks, or resource objects. Current
deposit visuals should be read as symbolic clusters, visible samples, or canopy/resource density, not literal
object counts inside `23.4 m2`.

If deposits later need stronger physical realism, use one of these approaches:

- sparse individual objects
- clustered canopies instead of one sprite per tree
- multi-tile resource patches
- density overlays rather than literal counts

The world scale should be set by movement, buildings, and road legibility; deposit sprites can adapt.

## Engine Scale Knobs

There are several different "scale" concepts in the codebase.

### Display Hex Size

The current visual/world coordinate hex size is:

```ts
// engines/ssh/src/lib/utils/varied.ts
export const tileSize = 30
```

Pixi and board coordinate conversion use this value as the hex size in engine world units/pixels. It is not
currently a meters value. With the working scale above, the interpretation is:

```text
30 engine units = 3 meters of hex side
10 engine units = 1 meter
```

Changing `tileSize` rescales rendered positions and hit-testing geometry.

### Terrain Noise Frequency

Terrain feature frequency is configured separately:

```ts
// engines/rules/src/world/terrain-defaults.ts
scale: 0.05
terrainTypeScale: 1.2
temperatureScale: 0.08
humidityScale: 0.08
```

These values affect generated terrain fields and biome/climate variation. They do not change the physical
meaning of one hex. To make terrain features broader or tighter, tune these terrain config values, especially
`scale` for height/detail and `terrainTypeScale` for biome region size.

## Roads And Lanes

Roads are border-owned center-to-center segments. A road on a border connects the centers of the two adjacent
tiles.

Roads v1 has only one pedestrian/wheelbarrow lane. Multi-lane roads and lane markings are deferred.

For road drawing, keep road width at or below one hex side unless a future feature explicitly needs wide
infrastructure corridors. With `side = 3m`, a max-width road is about `3m`, or roughly `10ft`, wide.

One candidate lane width is:

```text
laneWidth = (1 + S) / 2
```

where `S` is the distance between opposite summits in the chosen normalized tile texture space. This is a
rendering-space formula, not a change to the physical hex scale.

Vehicles currently read as tile-sized occupiers. A future lane should therefore be treated as vehicle-sized in
occupancy terms, even if its visual road band is drawn inside a generated road texture.

There are two possible lane rendering models:

| Model | Meaning | Consequence |
| --- | --- | --- |
| Full lane band | each lane has width `(1 + S) / 2` | lanes are physically legible and vehicle-sized, but multi-lane roads get wide quickly |
| Centerline plus attached lanes | base road length/width stays `1`; lane count is shown with markings/offsets | compact rendering, but lanes are more symbolic |

When lanes are added, prefer centerline plus attached lanes first. It keeps one border road compact while
still allowing bands, directions, and markings to express capacity. Use full lane bands only if lane occupancy
must be visually literal.

Bands/lanes should first be capacity metadata on one border-owned edge. A road with multiple bands does not
automatically occupy multiple hexes unless the player should care about the consumed land.
