# Freight lines and routes (`engines/ssh`)

## Scope

Line freight routes **wheelbarrow** `VehicleEntity` instances along **freight lines**. The target model is an **exchange route**: an ordered list of **halts**, each halt being one step at a **bay tile** or in a **zone** (not both), and each halt may be configured to load, unload, or both.

Historical code and some helpers still use the word **stop** and the derived labels **gather** / **distribute**. Treat those as compatibility names for directional exchanges, not as separate line kinds.

## Data model

### Canonical shape (`FreightLineDefinition`)

- `id`, `name`
- `stops`: `ReadonlyArray<FreightStop>`
- planned: `cyclic?: boolean`

### Stop shape (`FreightStop`)

Each stop/halt has:

- `id`: string
- optional `loadSelection` / `unloadSelection`: layered `GoodSelectionPolicy` (good rules, tag rules, default allow/deny). Omitted or unrestricted policies are stripped on normalize. A halt may have both; this means the halt can source goods and satisfy needs when runtime candidates exist.

…and **exactly one** of:

- `anchor`: `FreightBayAnchor` — hive name + alveolus type + axial `coord` (typically `freight_bay`)
- `zone`: `FreightZoneDefinition` — either `kind: 'radius'` with `center` + `radius`, or
  `kind: 'named'` with a saved tile-zone `zoneId`

There is **no** stored `op`. Runtime behavior should be decided by exchange candidates: what the current halt can load, what it can unload/provide, what later halts can use, and what the vehicle already carries.

### Exchange routes and cyclic order

An exchange route should be evaluated as ordered halt-to-halt opportunities, with zone halts also able to perform local zone-to-zone exchange when configured for both load and unload.

- Non-cyclic line `A-B-C`: evaluate from the chosen start through the route tail, e.g. `A-B-C` if starting at `A`, `B-C` if starting at `B`.
- Cyclic line `A-B-C`: the vehicle may begin anywhere, so evaluate all rotations: `A-B-C`, `B-C-A`, and `C-A-B`.
- A cyclic two-halt `Bay-Zone` line is effectively checked as if the zone can appear on both sides of the bay rotation. This allows `Zone-Zone` work before `Zone-Bay` work when the zone halt is configured for both load and unload.
- A one-halt zone route is valid only if the zone halt has actionable local exchange work; it should not load goods merely because goods exist.

The practical rule: a halt is complete when there is no actionable load/provide candidate for the current vehicle and route context. Empty halts are skipped; if a cyclic scan finds no actionable halt, the service should end or idle instead of spinning.

### Legacy route segments (current implementation)

The engine derives **segments** from consecutive stops:

- **Gather segment:** a **radius zone** stop whose **center matches** the next stop’s **bay anchor**
  coordinates, or a **named zone** stop followed by a bay anchor → loose goods into that bay.
  Radius zone/anchor pairs at different tiles are not gather.
- **Distribute segment:** **load** at a **bay anchor** that is **not** the unload anchor of a gather
  segment, then **unload** at an anchor, radius zone, or named zone. Radius unload zones cap delivery
  path length; named unload zones restrict delivery to the painted zone tiles.

`findDistributeRouteSegments` skips the bay anchor that **ends** a gather pair so gather and distribute chains can sit on the same line without false positives.

See `findGatherRouteSegments` / `findDistributeRouteSegments` in `engines/ssh/src/lib/freight/freight-line.ts`. These helpers should be refactored toward exchange-segment discovery instead of remaining the primary freight-line model.

### Goods selection

Restrictive policies on halt **pickup** are read from `loadSelection`; restrictive policies on halt **provide/unload** are read from `unloadSelection`. For legacy segment helpers, pickup is still read from the segment load stop’s `loadSelection` (gather: zone stop; distribute: bay anchor stop).

For a zone halt with both policies, the same zone may legally produce and consume goods in one line service. Example: loose wood in the zone can be loaded and then provided to a construction site in that same zone, if both actions pass policy and utility checks.

### Persistence and normalization

`GamePatches.freightLines` and `Game.replaceFreightLine` accept **`FreightLineDefinition`** (canonical `stops[]`). `normalizeFreightLineDefinition` trims ids, snaps coordinates, and strips unrestricted policies — call it when replacing a line so `game.freightLines` stays normalized.

Custom named tile zones are saved under `GamePatches.zones.named`; legacy `zones.harvest` and
`zones.residential` remain supported as built-in tile markers and keep their gameplay meaning. They
are not selectable named-zone objects.

## Bootstrap and implicit lines

- Implicit gather routes are generated per `freight_bay` hive patch (`implicitGatherFreightLinesFromHivePatches`); ids contain `:implicit-gather:`.
- Explicit patches with the same `id` override implicit lines.
- `collectFreightLineBootstrapCoords` collects anchor tiles and zone centers for materialization.

## Runtime contracts

- **Segment-scoped checks:** use `gatherSegmentAllowsGoodTypeForSegment` / `distributeSegmentAllowsGoodTypeForSegment` with the **active** `FreightGatherRouteSegment` / `FreightDistributeRouteSegment` in loops (e.g. bay requisition, line-vehicle work).
- **Broad checks:** `gatherSegmentAllowsGoodType` / `distributeSegmentAllowsGoodType` OR across segments — for aggregate behavior (e.g. `distributeLinesAllowGoodType`, hive storage ads).
- **UI / summary:** `freightLineAllowsGoodType` ORs gather and distribute sides — **not** for tight runtime authority on a single segment.
- **Exchange-scoped checks:** new runtime code should prefer halt load/unload policies plus exchange candidates over gather/distribute labels.
- **Cyclic checks:** for a cyclic line, candidate search must consider every rotation of the stop list so a vehicle can begin at any halt.
- **Zone local exchange:** a zone halt configured for both load and unload must be treated as capable of `zone -> zone` transfer when a source and sink exist in that zone.
- **Radius:** `distributeSegmentWithinRadius(line, segment, pathLength)` uses the **unload** stop’s zone when present; missing zone means no path-length cap for that segment.
- **Named zones:** use `freightZoneTiles` / `freightZoneContainsPosition` for runtime authority. Named
  zone stops search/provide only on tiles currently painted with that zone id.
- **Deprecated:** `freightLineWithinRadius` / `freightDistributeDeliveryWithinRadius` — prefer per-segment APIs.

## Browser UI

**Implemented**

- Synthetic line objects: `freight-line:${encodeURIComponent(id)}`, `Game.getObject`.
- Custom zone objects: `zones` opens the collection inspector; `zone:<zoneId>` opens an individual custom zone inspector with name/color editing, icon-based painting/deletion, central-tile go-to support, goods totals, and member-tile links. Built-in residential/harvest markers are not listed as named-zone objects.
- Bay inspector: list lines, add gather/distribute **presets** (`createExplicitFreightLineDraftForFreightBay` + `Game.replaceFreightLine`). Per-line remove was removed from the bay list; **delete** is on the **line** inspector (`FreightLineProperties`).
- Line inspector: name, **mode** (when unambiguous) + **radius** for the first matching segment, **Delete line** (`Game.removeFreightLineById`; implicit `:implicit-gather:` ids refused in engine). Stations list shows `load`/`unload` policy hints from `loadSelection` / `unloadSelection`.
- Freight editor v2: compact stop table with add/remove, drag reorder, bay/radius/named-zone stop
  kinds, map picking, existing zone-object selection, zone-object links, and per-stop load/unload policy configuration. Zone creation/renaming/deletion lives in the zone inspectors, not the line inspector.
- Board preview: selected freight lines draw connectors and stop/zone highlights; hovering a stop row
  emphasizes that stop on the board. Named-zone masks use the zone color normally and the shared blue stop color when a named-zone stop is hovered.
- Tile/alveolus inspectors expose a top-right zone link when the tile belongs to a zone, alongside the existing hive link where applicable.

**Remaining / handoff**

- Better line diagnostics: blocked pickup, missing unload, no eligible goods, no vehicle.
- Refactor runtime line management from gather/distribute segments to exchange candidates.
- Add and expose a `cyclic` line option. UI copy should explain that cyclic lines can be begun from any halt and are checked in rotated order.
- Support zone-local exchange (`zone -> zone`) for zone halts configured with both load and unload policies.
- Optional: expose distribute default (bay→bay unload = unlimited delivery radius) in copy/tooltips.

## Related files

| Area | Path |
|------|------|
| Domain + normalize | `engines/ssh/src/lib/freight/freight-line.ts` |
| Standalone construction site scan (segment radius) | `engines/ssh/src/lib/freight/construction-demand.ts` |
| Bay gather helper | `engines/ssh/src/lib/hive/freight-bay.ts` |
| Docked vehicle transfers | `engines/ssh/src/lib/freight/vehicle-freight-dock.ts` |
| Line inspector UI | `apps/browser/src/components/FreightLineProperties.tsx` |
| Bay line list | `apps/browser/src/components/AlveolusProperties.tsx` |

## Cheat sheet

`engines/ssh/LLM.md` (Residential / freight bullets) mirrors engine-specific pitfalls and line-vehicle job wiring (`vehicleApproach` → `provideFromVehicle`, etc.).
