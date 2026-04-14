# Freight Lines (v1)

## Scope

Freight lines are the first transport layer in `engines/ssh`, introduced before explicit vehicle simulation.

The current v1 shape focuses on:

- one-stop lines attached to hive alveoli
- line modes `gather` and `distribute`
- line-owned goods selection rules and gather radius
- worker execution through the existing `by-hands` carrier

## Data Model

`Game` owns `freightLines` as an array of `FreightLineDefinition`:

- `id`
- `name`
- `mode` (`gather` or `distribute`)
- `stops` (currently normalized to one stop)
- optional `radius` (gather only)
- optional `goodsSelection` (explicit good rules, ordered tag rules, then a default allow/deny for all goods)
- legacy `filters` (`GoodType[]`) is still accepted on load but is migrated into `goodsSelection` and stripped on normalize

Stops are station-facing and hive-anchored:

- `hiveName` + `coord` identify the station
- labels are rendered as `<HiveName> (q, r)`
- legacy stop type `gather` is canonicalized to `freight_bay`

## Bootstrap And Compatibility

At game bootstrap:

- implicit one-stop gather lines are derived from hive patches (`gather`/`freight_bay` alveoli)
- explicit `patches.freightLines` override implicit entries with the same id
- all lines are normalized before storage

Compatibility bridge kept in v1:

- legacy patched alveolus type `gather` is migrated to `freight_bay` at load
- runtime still supports matching legacy gather stop references through canonicalization

## Runtime Behavior

### Gather mode

- gather radius is line-owned (`line.radius`) and defaults to `DEFAULT_GATHER_FREIGHT_RADIUS` when absent
- gather selection uses `goodsSelection` when it is restrictive; otherwise it falls back to hive needs
- for `road-fret` stops with an active gather line, `StorageAlveolus.canTake` blocks generic incoming transfers so the stop behaves as a collector

### Distribute mode

- distribute lines are persisted and editable
- distribute `goodsSelection` currently constrains storage advertisement exposure
- dedicated worker-side distribute job flow is still pending

## Inspector And UI

Browser inspector exposes synthetic freight line objects:

- UID format: `freight-line:${encodeURIComponent(line.id)}`
- resolved through `Game.getObject`
- properties panel supports name, mode, gather radius (numeric input), and layered goods selection rules

## Current Limits

- modes are limited to `gather` and `distribute`
- `transfer` mode is not implemented yet
- goods selection is rule-based; richer vehicle-specific treatments are future work
- only gather currently uses radius semantics

## Example Save Shape

`exampleGames.chopSaw` includes an explicit gather line in `freightLines` with stop type `freight_bay`.
