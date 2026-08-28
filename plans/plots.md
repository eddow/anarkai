# Plots — plan & open questions

> Open questions and proposal. Decided parts migrate to `docs/` (see [`../docs/plots.md`](../docs/plots.md)).
> This is the **plot** half — authored, assignable areas of tiles — as opposed to
> [`districts.md`](./districts.md) (per-tile land-use designations).

## Open / remaining work

### Terraformers (planned)

Terraformers will read per-tile terraforming info carried by their assigned plot ("nothing" / "toward some
terrain type", never water). Not implemented.

### Hive plot variables (planned)

A hive can define a plot-typed "variable" (e.g. `forest`); its alveoli keep their target plot fixed to
`hive.<var>`. UI: set the value in the hive (select existing / create), while alveoli stay unchanged.

### Division & merging (open)

What happens when a plot is divided (road through it, tiles removed)? Hive-style merge/split vs per-tile
membership. Open.

### NPC settlement plots (deferred)

Generate 1–2 plots per NPC settlement, sized inversely to the settlement's district footprint (a small
settlement fills its space with a big plot; a large city gets few or none). **Deferred** — record only; do
not implement until settlements/roads mature. See
[`../docs/terrain-generation-roadmap.md`](../docs/terrain-generation-roadmap.md).

### Storage migration (in-extenso + double-link)

Plots should be stored in-extenso (coordinate list) with a runtime double link (tile → plots, plot →
coords), and center+radius reduced to an authoring convenience. The current `ZoneManager` stores a single
per-tile `AxialKeyMap<ZoneDefinition>` and scans for `coordsForZone` — to be migrated.

## Naming migration (obsolete terms)

| Old | New |
| --- | --- |
| `ZoneDefinition` | `PlotDefinition` |
| `ZoneManager` | plot registry on the board |
| `ZoneType` `'residential'/'commercial'/'harvest'` | `DistrictKind` `'residential'/'commercial'/'clean'` |
| `ZoneType` `'passive'` | (plot — no type needed) |
| `residentialCoords` / `commercialCoords` | district indexes |
| `zone-tendencies.ts` / `measureZoneTendencies` / `ZoneProperties` | district/plot tendencies |
| `FreightZoneDefinition` `'radius'`/`'named'` | plot + authoring radius |
| `coordsForZone` / `centralCoordForZone` | `coordsForPlot` / `centralCoordForPlot` |
