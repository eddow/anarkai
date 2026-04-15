# Freight lines and routes (`engines/ssh`)

## Scope

Freight is the first **by-hand** transport layer in `engines/ssh` (no vehicle simulation yet). A **freight line** is an ordered route: a list of **stops**, each stop being one step at a **bay tile** or in a **zone** (not both).

## Data model

### Canonical shape (`FreightLineDefinition`)

- `id`, `name`
- `stops`: `ReadonlyArray<FreightStop>`

### Stop shape (`FreightStop`)

Each stop has:

- `id`: string
- optional `loadSelection` / `unloadSelection`: layered `GoodSelectionPolicy` (good rules, tag rules, default allow/deny). Omitted or unrestricted policies are stripped on normalize.

…and **exactly one** of:

- `anchor`: `FreightBayAnchor` — hive name + alveolus type + axial `coord` (typically `freight_bay`)
- `zone`: `FreightZoneDefinition` — currently `kind: 'radius'` with `center` + `radius`

There is **no** stored `op`. Gather vs distribute is inferred **only from geometry** (see segments below).

### Route segments (derived, not stored)

The engine derives **segments** from consecutive stops:

- **Gather segment:** a **radius zone** stop whose **center matches** the next stop’s **bay anchor** coordinates → loose goods into that bay. (Zone and anchor at different tiles are *not* gather — e.g. distribute unload radius → next bay.)
- **Distribute segment:** **load** at a **bay anchor** that is **not** the unload anchor of a gather segment, then **unload** at an anchor and/or radius zone (optional cap on delivery path length via unload `zone`).

`findDistributeRouteSegments` skips the bay anchor that **ends** a gather pair so gather and distribute chains can sit on the same line without false positives.

See `findGatherRouteSegments` / `findDistributeRouteSegments` in `engines/ssh/src/lib/freight/freight-line.ts`.

### Goods selection

Restrictive policies on segment **pickup** are read from the segment **load** stop’s `loadSelection` (gather: zone stop; distribute: bay anchor stop). `unloadSelection` is available when a stop needs an explicit unload-side filter.

### Persistence and normalization

`GamePatches.freightLines` and `Game.replaceFreightLine` accept **`FreightLineDefinition`** (canonical `stops[]`). `normalizeFreightLineDefinition` trims ids, snaps coordinates, and strips unrestricted policies — call it when replacing a line so `game.freightLines` stays normalized.

## Bootstrap and implicit lines

- Implicit gather routes are generated per `gather` / `freight_bay` hive patch (`implicitGatherFreightLinesFromHivePatches`); ids contain `:implicit-gather:`.
- Explicit patches with the same `id` override implicit lines.
- `collectFreightLineBootstrapCoords` collects anchor tiles and zone centers for materialization.

## Runtime contracts

- **Segment-scoped checks:** use `gatherSegmentAllowsGoodTypeForSegment` / `distributeSegmentAllowsGoodTypeForSegment` with the **active** `FreightGatherRouteSegment` / `FreightDistributeRouteSegment` in loops (e.g. residential `freightDeliver`, bay requisition).
- **Broad checks:** `gatherSegmentAllowsGoodType` / `distributeSegmentAllowsGoodType` OR across segments — for aggregate behavior (e.g. `distributeLinesAllowGoodType`, hive storage ads).
- **UI / summary:** `freightLineAllowsGoodType` ORs gather and distribute sides — **not** for tight runtime authority on a single segment.
- **Radius:** `distributeSegmentWithinRadius(line, segment, pathLength)` uses the **unload** stop’s zone when present; missing zone means no path-length cap for that segment.
- **Deprecated:** `freightLineWithinRadius` / `freightDistributeDeliveryWithinRadius` — prefer per-segment APIs.

## Browser UI

**Implemented**

- Synthetic line objects: `freight-line:${encodeURIComponent(id)}`, `Game.getObject`.
- Bay inspector: list lines, add gather/distribute **presets** (`createExplicitFreightLineDraftForFreightBay` + `Game.replaceFreightLine`). Per-line remove was removed from the bay list; **delete** is on the **line** inspector (`FreightLineProperties`).
- Line inspector: name, **mode** (when unambiguous) + **radius** for the first matching segment, **Delete line** (`Game.removeFreightLineById`; implicit `:implicit-gather:` ids refused in engine). Stations list shows `load`/`unload` policy hints from `loadSelection` / `unloadSelection`.

**Remaining / handoff**

- Full **stop list** editing (reorder, add/remove steps, pick bay vs zone per step).
- Multi-segment lines: edit **per-segment** goods and radius, not only the first gather/distribute segment (helpers such as `applyFreightLineGoodsSelectionFromEditor` still target the first segment when used programmatically).
- Optional: expose distribute default (bay→bay unload = unlimited delivery radius) in copy/tooltips.
- Future **non-radius** zones: extend `FreightZoneDefinition` and segment finders when implemented.

See also `sandbox/freight-handoff.md` for a concise task list.

## Related files

| Area | Path |
|------|------|
| Domain + normalize | `engines/ssh/src/lib/freight/freight-line.ts` |
| Residential delivery | `engines/ssh/src/lib/freight/residential-freight-deliver.ts` |
| Bay demand augmentation | `engines/ssh/src/lib/freight/residential-freight-requisition.ts` |
| Bay gather / road-fret | `engines/ssh/src/lib/hive/storage.ts` |
| Line inspector UI | `apps/browser/src/components/FreightLineProperties.tsx` |
| Bay line list | `apps/browser/src/components/AlveolusProperties.tsx` |

## Cheat sheet

`engines/ssh/LLM.md` (Residential / freight bullets) mirrors engine-specific pitfalls and the generic `freightDeliver` discovery roadmap.
