# River Sprite Specification

Rivers are drawn per hex tile from hydrology edge directions. Each tile has six edge indices
(`0` through `5`), and the active edge set determines which sprite family to render plus a
rotation step in multiples of 60 degrees.

## Authoring Rules

- Use transparent PNG sprites in the same flat-top hex orientation as `hexSides` / `cartesian(..., tileSize)`.
- Author one canonical orientation per topology; runtime rotation should handle equivalent edge patterns.
- Keep a safe margin inside the hex so rotated sprites do not bleed into neighboring tiles.
- Use width bands (`narrow`, `medium`, `wide`) when hydrology edge width should change the visual weight.
- Keep river mouths and delta fans visually confined to the land hex; neighboring water tiles remain water terrain.

## Logical Sprite Set

1. **Body straight, 180 degrees:** two opposite active edges.
2. **Body acute bend, 60 degrees:** two adjacent active edges.
3. **Body obtuse bend, 120 degrees:** two active edges with one skipped side between them.
4. **Three-way symmetric fork:** pattern `0-2-4`, up to rotation.
5. **Three-way arc plus stub:** pattern `0-1-2`, up to rotation.
6. **Three-way skew:** pattern `0-1-3`, up to rotation.
7. **Four-way type A:** four consecutive active edges; adjacent dry wedge.
8. **Four-way type B:** two opposite dry edges.
9. **Four-way type C:** dry edges separated by one river edge.
10. **Five-way hub:** one dry edge.
11. **Six-way hub:** all edges active.
12. **Headwater terminal:** single upstream edge, spring-like cap.
13. **Mouth / estuary terminal:** single land edge opening to water.
14. **Delta fan terminal:** optional stronger sediment fan for high-flux mouths.
15. **Inland dead-end pool:** single edge ending in an inland sink.
16. **Optional longitudinal strip:** stretchable strip for long straight runs.
17. **Optional bank / foam decal:** sparse single-edge accent overlay.

## Classifier Cheat Sheet

| Active edge count | Pattern, up to rotation | Sprite |
| ---: | --- | --- |
| 2 | opposite, distance 3 | body straight |
| 2 | adjacent, distance 1 | body acute bend |
| 2 | skip-one, distance 2 | body obtuse bend |
| 3 | `0-2-4` | symmetric fork |
| 3 | `0-1-2` | arc plus stub |
| 3 | `0-1-3` | skew |
| 4 | adjacent dry wedge | four-way A |
| 4 | opposite dry edges | four-way B |
| 4 | dry edges distance 2 | four-way C |
| 5 | any five edges | five-way hub |
| 6 | all edges | six-way hub |

Terminals use the single-edge hydrology context: source/headwater, mouth/estuary, delta, or inland sink.

## Naming Convention

Use a stable stem plus width suffix when exporting separate width bands:

```text
rivers/body_straight_180__narrow.png
rivers/body_straight_180__medium.png
rivers/body_straight_180__wide.png
rivers/body_bend_60__narrow.png
rivers/junction_fork_symmetric__medium.png
rivers/terminal_headwater__wide.png
```

If sprites move into an atlas, keep the same stem names for frame ids so renderer lookup remains stable.
