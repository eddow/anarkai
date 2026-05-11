# Border Road Rendering

Roads should live on tile borders rather than on tile centers. A tile may still participate in road
movement, but the road advantage is earned by traversing roaded border connections, not by merely standing
on a road-marked tile.

This note sketches the geometry, sprite options, and how the number of cases grows.

## Border Numbering

Each hex has six borders numbered clockwise:

```text
        0
    5       1
    4       2
        3
```

Border `0` is adjacent to `1` and `5`. If a route enters through `0`, it may exit through `2`, `3`, or `4`,
but not through adjacent borders `1` or `5`. A direct U-turn back out through `0` is a pathing behavior,
not a through-road shape.

This gives three kinds of border pair:

| Pair type | Count per hex | Examples from `0` | Road shape |
| --- | ---: | --- | --- |
| Adjacent | 6 | `0-1`, `0-5` | invalid as a through connection |
| Skip-one | 6 | `0-2`, `0-4` | curve |
| Opposite | 3 | `0-3` | straight |

So there are `15` possible unordered border pairs (`6 choose 2`), but only `9` valid through-road
connections:

- `6` curve orientations: `0-2`, `1-3`, `2-4`, `3-5`, `4-0`, `5-1`
- `3` straight orientations: `0-3`, `1-4`, `2-5`

If borders `0` and `3` are roaded, the tile draws a straight. If `0` and `2` are roaded, it draws a curve.
If `0`, `2`, and `3` are roaded, it draws both the `0-2` curve and the `0-3` straight, producing a
bifurcation near border `0` or near the tile center depending on the art style.

## Movement Interpretation

The path graph should eventually move from tile-to-tile costs to transition costs:

- tile center -> border midpoint
- border midpoint -> tile center
- border midpoint -> compatible border midpoint through the tile

Road benefit applies only to road-bearing transitions. Leaving a road through an off-road border loses the
road advantage immediately.

The rendering can mirror that model: draw roads as connections between border ports, not as a generic tile
overlay.

## Sprite Strategies

### 1. Pair Sprites

Draw one sprite per valid border pair and compose all needed pairs on the tile.

For one road width and one surface style, the maximum authored orientation set is:

| Shape | Orientations | Notes |
| --- | ---: | --- |
| Curve | 6 | `i` to `i+2` |
| Straight | 3 | `i` to `i+3` |
| Junction/cap overlays | small fixed set | hides seams where pieces overlap |

Total base connection sprites: `9 * widths * surfaces`.

If runtime rotation is acceptable, this can shrink to roughly:

- `1` curve source sprite
- `1` straight source sprite
- a few center/port cap sprites

Pair sprites keep pathing and visuals aligned. Adjacent roaded borders do not accidentally connect because
no `0-1` or `0-5` piece exists.

The tradeoff is overlap management. A tile with `0`, `2`, and `3` draws `0-2` plus `0-3`; those pieces need
a clean merge at the shared border port. Thin roads are easier here. Full-border-width roads may need masks
or a junction overlay to avoid muddy overpaint.

### 2. Port And Junction Sprites

Draw a road stub from each roaded border toward the center, then draw a center junction.

This is cheap:

- `6` port orientations per width/surface, or `1` rotated port sprite
- a small junction set by degree

But it is semantically dangerous. If borders `0` and `1` are roaded, two stubs may meet and visually imply a
connection that pathing forbids. This can be mitigated by making stubs stop before the center and only adding
center connectors for valid pairs, but at that point the system becomes pair-sprite rendering again.

This approach may still work for very abstract, thin paths where visual exactness matters less.

### 3. Pre-Generated Tile Masks

Generate a complete road image for each subset of roaded borders.

There are `2^6 = 64` possible roaded-border subsets:

| Roaded borders in tile | Cases |
| ---: | ---: |
| 0 | 1 |
| 1 | 6 |
| 2 | 15 |
| 3 | 20 |
| 4 | 15 |
| 5 | 6 |
| 6 | 1 |

Those 64 cases do not all draw the same number of connection pieces. Across all subsets of a given size,
the total number of pair pieces is:

```text
9 * choose(4, roadedBorderCount - 2)
```

That works because each of the 9 valid pairs is present whenever the subset includes that pair plus any
remaining borders chosen from the other 4 borders.

| Roaded borders in tile | Cases | Total pair pieces across those cases | Pieces per case |
| ---: | ---: | ---: | --- |
| 0 | 1 | 0 | 0 |
| 1 | 6 | 0 | 0 |
| 2 | 15 | 9 | 0-1 |
| 3 | 20 | 36 | 1-3 |
| 4 | 15 | 54 | 3-4 |
| 5 | 6 | 36 | 6 |
| 6 | 1 | 9 | 9 |

So the direct asset count is:

```text
64 * widths * surfaces * states
```

With two widths, one surface, and one state, that is `128` sprites. Add dirt/paved/gravel surfaces and it
becomes `384`. Add normal/damaged/wet states and it becomes `1152`.

Using rotation/reflection symmetry, the 64 subsets collapse to 13 canonical hex patterns, but the renderer
still needs either runtime transforms or a generated orientation atlas. The 13 canonical patterns are good
for tooling, previews, and tests, but not necessarily a reason to author by hand.

Pre-generation gives the cleanest art for full-width roads and complicated junctions. The cost is asset
growth whenever width, surface, damage, season, tint, or construction state multiplies the set.

## Widths

Two road widths are enough to test the model:

| Width | Meaning | Rendering implication |
| --- | --- | --- |
| Thin, about half border width | foot paths, tracks, narrow service roads | pair sprites compose well |
| Full border width | paved/major road, vehicle-friendly route | pre-generated masks or strong junction overlays are safer |

Thin roads should be the first implementation target because their compositing failure modes are smaller.
Full-width roads can follow once the movement semantics are proven.

## Recommended First Pass

Start with pair sprites and runtime composition:

1. Store road presence on borders.
2. For each hex, collect the six roaded borders around it.
3. Emit every valid non-adjacent pair among those borders.
4. Draw curve or straight sprites for those pairs.
5. Draw a cap/junction overlay at any port or center where multiple pieces meet.

For a roaded subset `S`, the number of drawn connection pieces is:

```text
validPairs(S) = count of unordered pairs in S whose cyclic distance is 2 or 3
```

Examples:

| Roaded borders | Valid pieces | Drawn result |
| --- | ---: | --- |
| `{0}` | 0 | road end/port marker only, if desired |
| `{0, 1}` | 0 | two adjacent dead ends, no through connection |
| `{0, 2}` | 1 | one curve |
| `{0, 3}` | 1 | one straight |
| `{0, 2, 3}` | 2 | curve plus straight bifurcation |
| `{0, 2, 3, 4}` | 4 | dense junction |
| `{0, 1, 2, 3, 4, 5}` | 9 | all valid curves and straights |

This gives exact visual correspondence with routing while keeping the initial sprite count low:

```text
(6 curve orientations + 3 straight orientations + caps) * widths * surfaces
```

or, with runtime rotation:

```text
(1 curve source + 1 straight source + caps) * widths * surfaces
```

Pre-generated 64-case masks remain a good later option for polished full-width roads, but they should be a
rendering optimization/art upgrade rather than the first data model.
