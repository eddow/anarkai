# Work configuration — hive / alveolus configuration

> Inventory of what is **already done** for hive/alveolus configuration, as the starting point for a
> full review. The review itself (shared vs forked config, project-level reuse, reusable clones) is a
> later slice.

## Resolution model

Each `Alveolus` resolves its effective configuration through `get configuration` with a priority chain
(`Alveolus.configurationRef`):

1. **individual** — `Alveolus.individualConfiguration` (this alveolus only).
2. **named** — a shared config looked up in `AlveolusConfigurationManager` by alveolus type + name.
3. **hive** — `Hive.configurations` (a per-hive map, keyed by alveolus type).
4. **default** — the `configurations.default` rule (fallback).

The `working` on/off toggle is implemented as an individual-config override (`set working`), so pausing
a single alveolus never mutates a shared named config.

## Registries

- **`AlveolusConfigurationManager`** (`ssh/hive/alveolus-configuration.ts`) — global, shared named
  configurations: `get/set/deleteNamedConfiguration(alveolusType, name)`, `serialize`/`deserialize`.
  Reactive `Map`, so renames/adds/removes and edits to a returned config propagate.
- **`Hive.configurations`** — per-hive config by alveolus type (persisted as `hiveConfigurations` in
  save, keyed by hive name).
- **Rule defaults** — `configurations` in `engine-rules` (`slotted-storage`, `specific-storage`,
  `transform`, `default`).

## Config shape (by alveolus kind)

Type guards in `alveolus-configuration.ts` discriminate the config union:

- **specific-storage** — `buffers` (per-good keep-targets).
- **slotted-storage** — `generalSlots` + `goods` (per-good min/max slots).
- **transform** — `productRatio` (max product ratio, etc.).

`StorageAlveolus` exposes `setBuffers` and individual-config editing (per-good `goods`/`buffers`,
`generalSlots`) on top of this.

## Plan / project configuration

A `HivePlanEntry` / `ProjectEntry` carries an optional `configuration`:
`{ ref: { scope: 'named', name } | { scope: 'individual', individual? } }`. Structural validation
rejects a `named` ref whose name isn't registered (`missing-configuration`). When a project entry is
materialized, the build shell carries `planConfiguration`, and `finalizeConstructionShell` applies it to
the finished alveolus (`configurationRef` + `individualConfiguration`).

## Variants

`pile` (material variants: `wood`/`planks`/`stone` + `*.extra`) and `engineer` (role variants:
`building`/`research`/`road`) are resolved through `resolveAlveolusVariant` into a merged definition +
an `ancestorChain` of construction recipes. Variant changes find the nearest common ancestor and only
rebuild the remaining steps.

## Save / load

- `namedConfigurations` (global named configs) and `hiveConfigurations` (per-hive) are serialized and
  restored; individual configs round-trip through the alveolus `configuration` patch.

## TBD (the review)

- Shared vs forked config across stamped clones (reusable / scattered plans).
- Project-level configuration reuse (name a config once, reuse across projects).

Note: operating demand (configured buffers / transform ratios) is **out of scope for the construction
project's bill** — functioning goods belong to the live hive, never the plan.
