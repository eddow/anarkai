# Render Layers

`engine-pixi` now uses Pixi 8 `RenderLayer`s for world draw ordering.

This replaced the older manual scheme where plain `Container`s were used as layer buckets and ordering relied on container insertion plus `zIndex`.

## World Model

The renderer now separates:

- logical scene graph: `renderer.worldScene`
- draw-order layers: `renderer.layers.*`

`renderer.world` is still the camera root. It contains:

- `worldScene`: normal world parenting for transforms, lifecycle, and interaction
- `ground`
- `alveoli`
- `resources`
- `storedGoods`
- `looseGoods`
- `characters`

The world layer order is:

1. `ground`
2. `alveoli`
3. `resources`
4. `storedGoods`
5. `looseGoods`
6. `characters`

`ui` remains separate and is still attached directly to the stage in this pass.

## Important Rule

Do not use `RenderLayer` as a logical parent.

Visible objects must stay parented under `worldScene` or one of its descendants. `RenderLayer.attach(...)` is only for draw order.

The migration initially broke the board because some visuals were effectively treated as if the layer itself were their scene-graph parent. That caused world transforms and camera behavior to collapse toward the origin.

## Attachment Pattern

The correct pattern is:

1. Parent the object into the normal world scene.
2. Attach that object to the right `RenderLayer`.
3. Detach it explicitly on dispose.

`PixiGameRenderer` exposes:

- `attachToLayer(layer, child)`
- `detachFromLayer(layer, child)`

Use those helpers instead of calling `attach`/`detach` directly so the render-layer child list stays sorted when `sortableChildren` is enabled.

## Current Ownership

- terrain containers are parented in `worldScene` and attached to `ground`
- tile overlays are parented in `worldScene` and attached to `ground`
- alveolus roots are parented under their tile visuals and attached to `alveoli`
- stored-goods containers for alveoli are parented under the alveolus visual and attached to `storedGoods`
- unbuilt-land roots are parented under their tile visuals and attached to `resources`
- border roots are parented in `worldScene` and attached to `ground`
- border stored-goods containers are attached to `storedGoods`
- loose-goods manager root is parented in `worldScene`; its content container is attached to `looseGoods`
- character roots are parented in `worldScene` and attached to `characters`

## Same-Layer Ordering

`RenderLayer`s solve category ordering between systems.

They do not replace intra-layer depth sorting. Within a single layer we still use `zIndex`, generally derived from world `y`, so front/back overlap remains stable.

One special case is tile overlays: tile visuals live on the `ground` RenderLayer but their `zIndex` is offset far above terrain so zone/alveolus outlines do not disappear under terrain on negative-`y` tiles.

## Regressions Fixed During Migration

### Runtime build replacement

The build-site -> finished-alveolus path replaces tile content on the same tile/uid. We had to keep explicit cleanup on the `ssh` side so stale construction-site objects are removed before the replacement finishes.

### Border visuals

The old `BorderVisual` used to draw a small yellow line between adjacent alveoli. That line is now removed. Border visuals remain only for border-stored goods.

Full hex outlines are rendered by tile visuals, not border visuals.

### Loose goods

Loose goods disappeared temporarily after the migration because their root was no longer parented into the logical world scene. The fix was to keep the root in `worldScene` and attach only its render content to the `looseGoods` RenderLayer.

## Tests

`engine-pixi` has regression tests around this migration in:

- `src/renderers/alveolus-visual.test.ts`

The tests cover:

- loaded storage goods rendering into `storedGoods`
- build-site -> finished storage replacement without duplicate goods visuals
- render-layer sorting staying independent from attachment order

Run them with:

```bash
pnpm --filter engine-pixi test
```
