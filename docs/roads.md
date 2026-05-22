# Roads

This note records the current road model, the landed Roads v1/v1.5 behavior, and the deferred lane/corridor
ideas.

## Current Movement

The engine currently uses two different movement shapes.

Character walking is tile-to-tile. A walkable tile exposes neighboring tile centers through
`Tile.walkNeighbors`, and `HexBoard.findPathForCharacter` pathfinds over those tile coordinates. The cost is
charged from the destination tile's `effectiveWalkTime`, then adjusted by `HexBoard.walkTimeBetween`.

Roads affect this walking graph by reducing the cost only when the move crosses a roaded border. Entering or
leaving a tile through a non-road border receives no road benefit.

Convey/logistics movement is different. A convey path starts on the provider tile, moves to one of that
alveolus' border gates, can hop from border gate to border gate through relay alveoli, then ends on the
demander tile.

So:

- normal walking is effectively center-to-center today
- convey already has border nodes
- convey can move `border 0 -> border 2` through an alveolus without putting the tile center in the path

That means roads should start from the walking model, not from convey. Convey's border-to-border graph is
useful precedent, but mixing it into roads would add complexity before roads need it.

## Terms

For one tile, `C` is the tile center. A road segment lives on a border and connects the centers of the two
tiles touching that border:

```text
tile center A <-> shared border <-> tile center B
```

Equivalently, one border-owned road is two visual half-roads meeting at the border midpoint, but mechanically
it is one edge between adjacent tile centers.

## Scale

Roads use the working world scale from [`./world-representation.md`](./world-representation.md):

```text
hex side = 3 meters, about 10 feet
```

That makes one tile about:

```text
23.4 m2
```

This scale fits several existing gameplay assumptions:

- A person crossing another person inside the same tile needs coordination.
- It is plausible that one worker can make another wait before passing through a busy tile.
- A hive/alveolus tile reads as a small building-sized footprint rather than a city block.
- A road width capped at one hex side is at most about `3m`, or roughly `10ft`, which fits paths, cart roads,
  and narrow service roads.

The mismatch is deposits. Some deposits are currently represented with many trees or a visually dense resource
cluster, and `23.4 m2` still cannot literally contain that many full-size trees. Treat those as symbolic resource
sprites or visible samples of a larger deposit, not as literal object counts inside the tile.

If deposits later need physical realism, they should be rendered as sparse individuals, clustered canopies, or
multi-tile resource patches. The road scale does not need to inherit the current deposit sprite density.

## Road Model

Store road presence on borders. A roaded border creates one improved movement edge between the two adjacent
tile centers.

Consequences:

- Simple data model: one road segment per border.
- Simple movement model: still compatible with current tile-to-tile walking.
- A road bonus applies only when crossing that specific border.
- Going off-road means crossing a non-road border, so the road benefit is lost immediately.
- V1 has two road kinds: `path` and `asphalt`. Future road kinds can be ranked per border, for example track
  < dirt road < paved road.

This is the landed Roads v1 model.

## Landed Roads V1/V1.5

Roads v1 is a single pedestrian/wheelbarrow lane.

Implemented:

- `road:path` and `road:asphalt` authoring tools in the palette.
- Drag from one tile to another to preview the straightest tile trace.
- Blue planning highlight for valid trace tiles and a straight preview line from drag start to drag end.
- Red highlight for forbidden trace tiles, and a red line if the whole trace cannot be built.
- Instant commit on mouse release when the trace is valid.
- Shift keeps the road tool selected after commit, matching zone authoring behavior.
- Border-owned road storage on `HexBoard`, persisted in saves as grouped road coordinates:

  ```ts
  roads: { path: [[q, r], ...] }
  ```

- Legacy array-shaped road saves still load.
- Pathfinding/walking cost is reduced for roaded border crossings.
- Textured Pixi road rendering is baked into terrain sectors from per-tile transparent road textures.
- Road material textures are runtime-sized before sampling. `path` uses `brick_moss`; `asphalt` uses
  `asphalt`.
- Chopsaw starts with a sample `path` road from `-3,1` to `1,1`.
- Generated settlement roads are emitted as `asphalt`.

Road building constraints:

- Empty generated terrain is allowed.
- Ordinary unbuilt land is allowed.
- `freight_bay` alveoli are allowed.
- Other hive/alveolus tiles are forbidden.
- Residential zones, completed dwellings, and residential/building projects are forbidden.
- The highlighted tile trace is authoritative: if any trace tile is forbidden, the drop has no effect.

Deferred:

- multiple lanes
- lane direction markings
- builder/project workflow for roads
- physical multi-hex road corridors
- road rank/material effects beyond the current `path` and `asphalt` types

Current materials use these existing seamless textures:

```text
engines/pixi/assets/roads/brick_moss.jpg
engines/pixi/assets/roads/asphalt.jpg
```

This keeps the first road useful for walking and wheelbarrows without turning it into a full traffic system.

## Authoring Tool

Roads should be authored directly by the player, not generated by pathfinding.

The interaction is drag-and-drop, similar to zones:

1. Select a road tool.
2. Pointer down on the begin tile.
3. Drag to an end tile.
4. Show a preview trace between begin and end.
5. On release, commit road segments along that trace if every highlighted tile is road-compatible.

The trace should be the straightest possible hex trace between the two points. It is not a search path and
does not avoid obstacles. A good implementation is axial/cube line drawing:

```text
for i in 0..distance(start, end):
  t = i / distance
  point = round(lerp(cube(start), cube(end), t))
```

Then convert the tile trace to border-owned road segments:

```text
[tile0, tile1, tile2] -> [border(tile0,tile1), border(tile1,tile2)]
```

This matches the road model: road state lives on borders, while the user's gesture is expressed as a visible
tile-center trace.

The preview has two parts:

- the highlighted tile trace, which shows which tiles will be used for validation and border conversion
- a straight blue planning line from drag start to drag end, which is visual feedback only and does not
  determine storage

When the trace is invalid, only forbidden tiles turn red; the line also turns red so the failed drop is visible
at a glance.

## Rejected Direction: Rim And Border-Pair Roads

A richer model could add rim pieces, radial pieces, or explicit border-pair connections inside a tile. It can
represent:

- only rim/edge roads
- a direct `B0 -> B2` curve
- a direct `B0 -> B3` straight
- forbidden adjacent turns
- vehicle-only or foot-only turns

That richer graph is closer to convey, but it mixes two concerns: roads for walking/vehicles and internal
border-to-border convey movement. It would add path states and authoring complexity without a clear gameplay
need yet.

## Rejected Direction: Roaded Tiles

A tile has a road flag, and entering or crossing the tile gets a reduced cost.

This is easy, but it does not match the idea we want: the road bonus should depend on how the actor crosses
the tile, not merely on being inside a roaded tile.

This option is useful only as a throwaway prototype.

## Current Textured Rendering

Rendering treats each roaded border as two center-to-border contributions, one generated in each adjacent
tile's local road texture. Terrain sectors composite those road textures over terrain and below buildings,
resources, goods, vehicles, and characters.

When several road contributions overlap or meet, they are resolved per pixel. A higher-rank road can later
decide which material family is dominant, but the current blend is alpha-weighted rather than a hard
"winner only" overlay. For example, a future rank order could be:

```text
track < dirt road < paved road
```

The road edge alpha-fades so overlapping half-roads blend softly instead of creating hard seams.

### Alpha-Accumulation Idea

One possible per-pixel blend model:

1. Render road contributions for a roaded tile into a transparent tile-local texture.
2. For each pixel, add all contributing alpha values and clip to `1`.
3. Compute color as the alpha-weighted average of all contributors.

In formula form, for contributions `i` with color `ci` and alpha `ai`:

```text
alpha = min(1, sum(ai))
color = sum(ci * ai) / sum(ai)
```

If `sum(ai)` is `0`, the pixel is transparent.

This lets two dead-end sprites meet naturally: the fuzzy overlap becomes opaque enough to read as one joined
road, and mixed road materials blend by coverage rather than leaving a hard seam.

The current implementation uses generated tile textures so the alpha and color rules are explicit and stable.

### Rendering Alternatives

| Approach | Idea | Pros | Cons |
| --- | --- | --- | --- |
| Double dead-end sprites | two half sprites meet at the border | few assets, matches border-owned roads | needs blending/caps to hide seams |
| Per-roaded-tile compositing | render all road contributions for one tile into a tile sprite | exact alpha/color rule, easy cache invalidation per tile | needs custom composition step |
| Single border segment sprite | one sprite spans center-to-center across the border | simplest visual for one segment | harder to make junctions feel organic |
| Center cap overlays | draw segments, then draw small tile-center caps over joins | cheap seam cleanup | caps can look repetitive |
| Ranked material pass | resolve material family by highest rank, then blend contributions in that family | keeps upgrades visually coherent | can hide lower-rank texture abruptly |
| Masked composition | write road shapes into a mask, then shade by weighted contribution | clean joins and width control | more renderer work |
| Procedural strokes | generate geometry lines from the road graph | flexible, scalable widths | more code, less hand-painted texture |
| Prebaked junction tiles | choose complete tile images by connected borders | most polished | asset count grows quickly |

The landed first rendering pass is per-roaded-tile compositing. The sprite/prebaked-junction alternatives
remain useful if we later want authored materials or a lower CPU cost.

## Widths, Bands, And Lanes

Road width can mean several different things, and they should not be mixed too early.

For Roads v1, keep this simple:

```text
one road = one pedestrian/wheelbarrow lane
```

Everything below is future vocabulary, not first implementation scope.

### Visual Width

A road can be visually narrow or wide while still being one graph edge between two adjacent tile centers. This
is the cheapest interpretation:

```text
one border road = one movement edge
width = sprite/rendering parameter
```

This is enough for tracks, footpaths, dirt roads, paved roads, and "major road" visuals if width only affects
appearance and speed.

### Capacity Width

A road can have bands or lanes as capacity metadata:

```text
one border road = one movement edge
lanes = throughput / congestion / allowed vehicle metadata
```

Examples:

- `1` band: path or one-cart road
- `2` bands: two-way cart road
- `4` bands: two bands in each direction

This does not require the road to occupy multiple hexes. It just changes traffic rules, congestion, or vehicle
eligibility on the same border-owned edge.

Vehicles currently read as occupying a whole tile, so a future lane is vehicle-sized in simulation terms.
Rendering does not have to make every lane fully physical. When lanes are added later, prefer:

```text
one compact road band + markings/offsets for lane count and direction
```

Instead of:

```text
one full-width band per lane
```

The full lane-band width candidate remains `(1 + S) / 2` in normalized texture space, but that should be used
only when a road needs to look physically lane-sized.

### Physical Width

A road can occupy more than one hex of map space. This is what "2 hex wide" or "4 hex wide" literally means.
At that point, it is no longer just one border road. It becomes a corridor or area:

```text
road corridor = several adjacent border edges and/or tile claims
```

A 2-hex-wide road would look less like a line and more like a strip of paved/cleared territory. A 4-hex-wide
road with two bands in each direction starts to behave like infrastructure occupying a district, not just a
path.

Consequences:

- It may need reservations/land claims, not just border flags.
- It may block or constrain building placement.
- It may need shoulders, medians, crossings, and entrances.
- Pathfinding might still use a centerline graph, while the map stores a wider occupied footprint.

### Current Preference

Start with visual width and capacity width on a single border-owned edge. Avoid physical multi-hex-wide roads
until there is a gameplay reason for roads to consume buildable territory.

That gives us:

- narrow roads and broad roads without changing pathfinding
- lanes/bands for future traffic simulation
- an upgrade path to large corridors later

If we want "two bands in each direction", model that first as lane metadata on one road edge. Only make it
physically 4 hexes wide if the player should care about the land consumed by the road.

## Tile-Baked Road Texture Generation

The renderer generates each tile's road texture procedurally when roads change or when the map loads. The
generated road texture is then used by the terrain sector renderer as an overlay above the terrain background.

The inputs per road endpoint are:

- the border center position in tile-local coordinates
- the corresponding `u, v` texture coordinate
- the road direction through that border
- road material, width, bands, and optional marking metadata

Each roaded border contributes a center-to-center band. For a regular hex, a wide band may need to overdraw
past the tile boundary into neighboring tile corners so adjacent tile-baked textures join without a visible
gap. This is expected: the road texture is a local contribution, not a strict "paint only inside this hex"
mask.

### Widths

There are at least two useful baseline widths:

| Width kind | Meaning |
| --- | --- |
| Path width | narrow trail or foot/cart path |
| Lane width | a full lane; for a hex with side `1` and center-to-corner distance `W`, one candidate is `1 + (W - 1) / 2` |

The exact lane formula can be tuned visually. The important point is that road width is not fixed by the
border graph; the renderer can choose how much territory the band visually occupies.

### Joining Bands

For each tile texture:

1. Collect all roaded borders touching the tile.
2. Convert each border center and road direction to tile-local `u, v`.
3. Draw each road band as a signed-distance field or alpha mask.
4. Accumulate alpha with clipping:

   ```text
   alpha = min(1, sum(ai))
   ```

5. Compute material color from the alpha-weighted contributors:

   ```text
   color = sum(ci * ai) / sum(ai)
   ```

6. Composite the generated road texture over terrain in the sector renderer.

This gives organic joins without requiring every junction to be an authored sprite. Two roads meeting at an
angle simply overlap in the tile-local texture and resolve through the alpha/color rule.

### Texture Sampling

Rather than using a flat road color, the renderer can sample from a material texture such as dirt, gravel, or
asphalt. For each road band:

- choose two stable random points in the material texture at a fixed distance
- use them to define a local sampling direction
- extract the road material from that texture in road-local coordinates

This gives repeated road segments variation while keeping them deterministic. The road edge alpha is still
computed geometrically, so the texture controls material grain, not road shape.

### Markings

Lane markings can be delayed. Later, the same generated texture pass can add markings from lane metadata:

- opposite directions: dotted line, solid line, or double line
- same direction lanes: dashed separators
- special lanes: colored or patterned separators

Markings should be a second pass over the already generated road alpha so they follow the band geometry and
do not need separate junction sprites.

## Current Preference

Use border-owned center-to-center road segments first.

That gives us:

- border-owned roads instead of tile-owned roads
- movement still compatible with current tile-to-tile walking
- a clean path to variable movement costs, already used by `path`
- room for visual width and lane/band metadata before physical multi-hex corridors
- a tile-baked rendering model that can grow toward multiple materials, ranks, bands, and markings

Open decision:

- Should future road rank affect only speed, or also which actors/vehicles are allowed?
