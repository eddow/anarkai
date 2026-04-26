## Vehicles / cargo (Pixi)

- Wheelbarrow **cargo is drawn on `VehicleVisual`** via `vehicle.storage.renderedGoods()`, not on `CharacterVisual`. `Character.carry` is logic-only (driving seam); the renderer must not use it for goods.
- **`VehicleVisual` stays visible while driven**. While driving, **`CharacterVisual` is hidden** (not shown on the board); the **operator sprite is drawn on `VehicleVisual`** first (under the vehicle body sprite), then cargo on top.
- **Layer order**: `vehicles` (zIndex 45) sits between `looseGoods` and `characters` (zIndex 50), so standalone characters always paint above vehicles. Test stubs creating `renderer.layers` must include `vehicles: new RenderLayer()`.
