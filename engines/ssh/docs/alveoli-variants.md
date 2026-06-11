# Alveolus Variants

A variant-capable alveolus type defines a **variant tree**. The tree root is the
bare alveolus state, which holds common properties shared by all variants. Each
variant is another state in that tree and may fill in parts of the definition
that the root or an ancestor leaves open.

Some states in the tree are intentionally **incomplete**. For example, `pile`
is a valid constructed state, but has no meaningful storage capacity until the
player constructs a useful variant such as `pile.wood`, `pile.planks` or `pile.stone`.

Types without variants — the common case — are fully defined by their root and work
exactly as they do today.

| Concept | Role |
|---|---|
| **Variant tree** | All valid states for one alveolus type: the bare root state plus every variant path below it. |
| **Root state** | The bare alveolus state, e.g. `pile`. Holds common definition fields: behavior kind, base `construction` cost, structural invariants. May be incomplete on its own. |
| **Variant state** | A named target state in the tree, e.g. `pile.wood` or `pile.wood.extra`. Strongly-typed overlay that may complete or further specialize its ancestors. |
| **Incomplete state** | A valid constructed state that is not very useful yet, but always offers useful variant construction targets. |

---

## Initial scope

Only two alveolus types introduce variants in the first iteration: `pile` and
`engineer`. `pile` variants include `wood`, `planks`, and `stone` (each with
an optional `extra` tier). All other types (`storage`, `freight_bay`, `sawmill`, `flour_mill`,
`bakery`, `forester`, `restaurant`, `wheat_planter`, `wheat_harvester`,
`stonecutter`) remain untouched — their root definition is already complete and
they have no `variants` field.

> **`tree_chopper` and equipment.** Axe vs. chainsaw is **not** a variant. Tool
> choice is a separate equipment system — the chopper building itself has one
> stable identity and the tool it uses comes from an equipment slot, not from
> construction-time variant selection. This document does not cover equipment.

## Example definitions

### `pile` — incomplete root, storage-filled by variant

```ts
pile: {
    // Root: common to all pile variants — minimal, incomplete alone
    construction: { time: 2, wood: 4 },
    action: { type: 'storage', kind: 'specific' },           // goods field omitted here

    variants: {
        wood: {
            goods: { wood: 24 },
            construction: { time: 2, wood: 6 },              // cost to construct pile.wood from an eligible pile state
            variants: {
                extra: {
                    goods: { wood: 48 },
                    construction: { time: 3, wood: 8 },
                },
            },
        },
        planks: {
            goods: { planks: 24 },
            construction: { time: 2, planks: 4 },
            variants: {
                extra: {
                    goods: { planks: 48 },
                    construction: { time: 3, planks: 6 },
                },
            },
        },
        stone: {
            goods: { stone: 24 },
            construction: { time: 2, stone: 4, wood: 4 },
            variants: {
                extra: {
                    goods: { stone: 48 },
                    construction: { time: 3, stone: 6, wood: 6 },
                },
            },
        },
    },
}
```

- `pile` alone (no variant) is an incomplete state with no meaningful storage capacity. Construction cost: `wood: 4, time: 2`. It should present useful variants such as `pile.wood`, `pile.planks`, and `pile.stone`.
- `pile.wood` → `SpecificStorage({ wood: 24 })`. Construction cost from an existing pile state: `wood: 6, time: 2`.
- `pile.wood.extra` → `SpecificStorage({ wood: 48 })`. Construction cost from `pile.wood`: `wood: 8, time: 3`.
- `pile.planks` → `SpecificStorage({ planks: 24 })`. Construction cost from an existing pile state: `planks: 4, time: 2`.
- `pile.planks.extra` → `SpecificStorage({ planks: 48 })`. Construction cost from `pile.planks`: `planks: 6, time: 3`.
- `pile.stone` → `SpecificStorage({ stone: 24 })`. Construction cost from an existing pile state: `wood: 4, stone: 4, time: 2`.
- `pile.stone.extra` → `SpecificStorage({ stone: 48 })`. Construction cost from `pile.stone`: `wood: 6, stone: 6, time: 3`.

Material availability gates the `extra` variant implicitly. If `pile.wood.extra`,
`pile.planks.extra` or `pile.stone.extra` costs `steel` (a good that does not yet exist in the
economy), the player cannot gather the required material and the variant is
effectively unavailable until steel production or trade is established. No
separate gating field is needed — the construction cost itself encodes
availability.

### `engineer` — variant by role

```ts
engineer: {
    construction: { time: 4, wood: 1, stone: 1 },

    variants: {
        building: {
            actions: ['construct', 'foundation'],
            specifications: { radius: 6 },
            construction: { time: 1 },
        },
        research: {
            actions: ['validateHivePlan'],
            specifications: {},
            construction: { time: 2, charcoal: 2 },
        },
        road: {
            actions: ['road'],
            specifications: { radius: 8 },
            construction: { time: 3, concrete: 2 },
        },
    },
}
```

- `engineer` alone (no variant) is incomplete — it has no action set or specifications.
- `engineer.building` → standard `EngineerAlveolus` that constructs and lays foundations (radius 6).
- `engineer.research` → `EngineerAlveolus` that only validates hive plans. The research action has no radius specification.
- `engineer.road` → `EngineerAlveolus` that builds roads with extended reach (radius 8).

`engineer` is not itself an action. The actions are `foundation`, `construct`,
`road`, `validateHivePlan`, etc. — the root defines no action set on its own.
A variant declares the set of actions it enables and one shared `specifications`
object for that whole set. For `building`, the single `radius` specification
applies to both `construct` and `foundation`; there is no separate construction
radius and foundation radius. Research does not set `radius` because
`validateHivePlan` is not external spatial work.

At runtime, the resolved `actions` + `specifications` produce the
`EngineerAlveolus` behavior object. The `EngineerAlveolus` class receives the
merged action set and, for each enabled action, uses the shared specifications
to determine reach, work time, and other parameters. An action that is not in
the variant's `actions` list is simply not offered by that alveolus instance.

Specifications are not gameplay configuration. They describe the capability
provided by the constructed state. Configuration may later restrict or tune how
the capability is used, with an empty configuration meaning "no extra
restriction".

---

## Construction flow

### Construction queue

Each tile has a **construction queue**: an ordered list of variant-path segments
that will be executed sequentially. Today a tile holds a single project
(`UnBuiltLand.project` → `BuildAlveolus`); the queue generalizes this to
`['pile', 'wood', 'extra']` or, equivalently, the dotted name `pile.wood.extra`
from which the segments are expanded.

Construction is one state-transition primitive. A tile has a current state, a
construction job targets a new adjacent state in the variant tree, and when the
job completes the tile holds that new state. This is the same pipeline for every
construction job:

```
current tile state + adjacent construction target + target construction cost
    -> BuildAlveolus shell
    -> materials + engineer work
    -> target tile state
```

There is no code-level distinction between "building" and "upgrading":

| Current state | Construction target | Target construction cost |
|---|---|---|
| `UnBuiltLand` | `pile` | `pile.construction` |
| `pile` | `pile.wood` | `variants.wood.construction` |
| `pile.wood` | `pile.wood.extra` | `variants.wood.variants.extra.construction` |
| `pile` | `pile.planks` | `variants.planks.construction` |

The old "root phase then variant phase" language is only a player-facing
description. If the player chooses `pile.wood` from empty land, the experience may
read as "build a pile, then make it a wood pile", but the implementation still
processes ordinary construction jobs: `UnBuiltLand -> pile`, then `pile ->
pile.wood`. Each job has a construction recipe with required engineer work time;
goods are optional.

### Key behaviors

- **Variant choice window**: An eligible variant can be selected from the moment the project is set on `UnBuiltLand` and later from any built state. A requested target may be any node in the same variant tree; the construction queue expands it into adjacent jobs.
- **Queuable**: Each building has a construction queue. If the player requests a new target while a construction job is still in progress, the active job continues and pending queued variant jobs for that building are replaced by the newly expanded path. If the player cancels the active project through the existing project-cancel flow, the active job is removed too.
- **Change variant**: Changing an existing alveolus' variant starts one or more construction jobs on the same tile. Each job temporarily replaces the existing alveolus with a `BuildAlveolus` shell targeting the next adjacent state, reusing the existing foundation → materials → construction → finalize machinery.
- **Cost**: Each construction job pays only its adjacent target state's construction cost. Moving to `pile` pays `pile.construction`; moving to `pile.wood` pays `variants.wood.construction`; moving to `pile.wood.extra` pays `variants.wood.variants.extra.construction`. Cross-branch downgrades through ancestors are free and implicit, but construction down the target branch is explicit and paid node by node.
- **Recipe shape**: Every constructible state has a recipe with required `time` and optional good quantities. Time-only recipes are valid; goods-only or empty recipes are not. For example, `engineer.building` costs `{ time: 1 }` because the building specialization requires only engineer attention with no extra materials.

### Variant path construction

Variant IDs are dot-delimited paths through nested `variants` objects. The first
segment is a **root variant** (`wood`, `planks`); later segments are child
variants (`wood.extra`, `planks.extra`). The full alveolus identity is written
as `alveolusType.variant`, e.g. `pile.wood.extra`.

Reachability is intentionally broad once the root alveolus exists: from any node
in an alveolus' variant tree, the player may request any other node in that same
tree. The request is resolved through the tree:

1. Find the common ancestor of the current state and requested target.
2. Treat movement upward to that ancestor as free and implicit.
3. Queue one construction job for each node on the downward path from that
   ancestor to the requested target.

The tree therefore defines valid identities, parent-child relationships, queue
expansion, and construction recipes. A child variant cannot exist without its
parent in the data structure; `extra` under `planks` is represented as
`variants.planks.variants.extra`, not as an orphan flat key.

In general, a current state `A.B.C` may request any variant under `A.B.C`,
`A.B`, or `A`. Movement upward to the chosen ancestor is implicit and free;
movement downward from that ancestor is expanded into adjacent construction
jobs. For example, requesting `A.B.D.E` from `A.B.C` moves implicitly to `A.B`,
then queues `A.B -> A.B.D` and `A.B.D -> A.B.D.E`.

Every node in the tree is a valid tile state, but not every node must be useful
as a working building. Incomplete states like `pile` or `engineer` are acceptable
waypoints as long as they expose useful variant targets to the player. They
should not look like dead ends in the UI: the primary action from an incomplete
state is choosing a useful variant in the same tree.

Examples:

- `UnBuiltLand -> pile` pays `pile.construction`.
- Choosing `pile.wood.extra` from `UnBuiltLand` queues `UnBuiltLand -> pile`,
  then `pile -> pile.wood`, then `pile.wood -> pile.wood.extra`.
- `pile -> pile.wood.extra` queues `pile -> pile.wood`, then
  `pile.wood -> pile.wood.extra`.
- `pile.wood.extra -> pile.planks` queues one construction job,
  `pile -> pile.planks`; the upward movement to the common ancestor `pile` is
  implicit and free.
- `pile.planks -> pile.wood.extra` queues `pile -> pile.wood`, then
  `pile.wood -> pile.wood.extra`; the upward movement from `pile.planks` to
  `pile` is implicit and free.

The intermediate ancestor state does not happen visibly during cross-branch
changes, but each missing node on the target branch does become a construction
job. The request may look like a jump, but the construction primitive is
unchanged: current state plus next adjacent target plus target recipe produces
the next state, until the queue reaches the requested state.

---

## Runtime resolution

When a construction job completes and `createAlveolus` finalizes the target
state, the root definition and the selected variant path are merged to produce
the behavioral definition. A first-segment variant merges one overlay on top of
the root. A nested variant merges each prefix in order:

```
variant = 'planks.extra'
variantPath = [variants.planks, variants.planks.variants.extra]

resolvedDefinition =
    merge(root, variants.planks, variants.planks.variants.extra)
```

Construction cost is **not** merged here. The construction job has already
selected the target state's recipe (`root.construction` for the root state,
the resolved variant node's `construction` for a variant state). Only the fields
that determine runtime behavior (`actions`, `specifications`, `workTime`,
`output`, etc.) are resolved at finalization time.

The resolved definition is what `createAlveolus` in [`hive/index.ts`](../src/lib/hive/index.ts) dispatches on. Each merge step is **shallow** — later variant fields replace earlier fields of the same name, with `action` shallow-merged so the root's `type` is preserved.

If no variant is resolved because the saved `variant` path no longer exists in
the nested variant tree, the bare root definition is used. For variant-capable
types like `pile`, this may produce an incomplete state that awaits variant
construction and should offer useful variants. Missing children in authored
rules are content validation errors, not silently degraded partial merges. For
types without a `variants` field, the root is already complete and works as it
always has.

---

## Data model additions

### `AlveolusDefinition` (rules layer — [`alveoli.ts`](../../rules/src/content/alveoli.ts))

Variant-capable entries gain an optional `variants` map. Nested variants are
stored as nested objects:

```ts
interface AlveolusDefinition {
    // … existing fields …
    variants?: Record<string, AlveolusVariantDefinition>
}
```

Types without variants simply omit the field. There is no `defaultVariant` — a
variant-less alveolus is the root and must be explicitly changed through
construction to become functional.

```ts
variants: {
    wood: {
        ...,
        variants: {
            extra: { ... },
        },
    },
    planks: {
        ...,
        variants: {
            extra: { ... },
        },
    },
}
```

```ts
type ConstructionRecipe =
    { time: number } & Partial<Record<GoodType, number>>

interface AlveolusVariantDefinition {
    // Construction is required; runtime fields override only what differs from the root
    action?: Partial<AlveolusAction>
    actions?: ActionType[]
    specifications?: Partial<Record<SpecificationType, unknown>>
    workTime?: number
    preparationTime?: number
    construction: ConstructionRecipe
    variants?: Record<string, AlveolusVariantDefinition>
    output?: Partial<Record<GoodType, number>>
    goods?: Partial<Record<GoodType, number>>
}
```

`construction.time` is required for every constructible root or variant state.
Good quantities are optional flattened fields in the same object. A time-only
recipe such as `{ time: 1 }` is valid; a goods-only or empty construction recipe
is not. `time` is reserved and cannot be used as a good type key.

Strong typing is enforced per alveolus type — e.g. `pile.variants.wood.goods` must be `Partial<Record<GoodType, number>>`, not an arbitrary string. `engineer.variants.building.actions` must be a subset of the known engineer action types, and `engineer.variants.building.specifications.radius` must be a number.

For variants that enable multiple actions, `specifications` is the union of
specifications needed by that action set. Shared specifications appear once. For
example, `engineer.building` has `actions: ['construct', 'foundation']` and one
`specifications.radius`, because both actions use the same external-work reach.

Variant IDs used in save data and APIs remain dot-delimited paths, but authored
rule definitions are nested. A content validator should reject malformed trees,
duplicate or empty path segments, and invalid variant node definitions. A saved
or API path that cannot be resolved by walking the nested `variants` objects is
treated as a missing variant at runtime and falls back as described above.

### `ConstructionTarget` (ssh — [`construction-state.ts`](../src/lib/construction-state.ts))

```ts
export type ConstructionTarget =
    | { readonly kind: 'alveolus'; readonly alveolusType: AlveolusType; readonly variant?: string }
    | { readonly kind: 'dwelling'; readonly tier: DwellingTier }
```

`constructionTargetFromProject` and `createConstructionRecipe` are extended to incorporate `variant` when selecting the target state's recipe.

### `Alveolus` base class (ssh — [`alveolus.ts`](../src/lib/board/content/alveolus.ts))

```ts
export abstract class Alveolus {
    /** Which variant this alveolus was built with. `undefined` means root-only or not applicable. */
    public readonly variant?: string

    /** The fully resolved definition, with variant merged in. */
    get resolvedDefinition(): Ssh.AlveolusDefinition { … }
}
```

Alveoli **no longer override `nextAlveolusJob()`**. Job proposal is driven by the
[action→job provider registry](#action--job-provider-registry) keyed on
`action.type`. The base class gates convey/burden/working checks, then delegates
to the registry's `proposedJobs` and `jobForCharacter`. Per-alveolus-class
switches (harvest, transform, forester, storage defrag, engineer) are removed.

### Action → job provider registry (ssh — [`action-job-registry.ts`](../src/lib/jobs/action-job-registry.ts))

Every [`Action`](../src/resources.d.ts) type registers a **job provider** that
returns `ActionJobResult`:

```ts
interface ActionProposedJob {
    job: Job
    /** Target tile for multi-target jobs (engineer construct/foundation, forester planting). */
    targetTile?: Tile
}

interface ActionJobResult {
    proposedJobs: readonly ActionProposedJob[]
    jobForCharacter(character?: Character): Job | undefined
}

type ActionJobProvider = (alveolus: Alveolus) => ActionJobResult
```

Registered providers:

| Action type | Job(s) offered | Key inputs |
|---|---|---|
| `harvest` | `HarvestJob` | `action.deposit`, `action.output`, zone/clearing/project status |
| `transform` | `TransformJob` | `canWork` (has output room, below product ratio, process buffers) |
| `plant` | `ForesterJob` | `assignedZoneIds`, `canPlantDepositOnLand` |
| `slotted-storage` | `DefragmentJob` (only when fragmented) | `storage.fragmented` |
| `specific-storage` | *(none)* | — |
| `storage` (unified) | `DefragmentJob` (if `kind: 'slotted'` and fragmented) | `action.kind` |
| `engineer` | `ConstructJob`, `FoundationJob`, `ValidateHivePlanJob` | `action.radius`, construction sites, hive plans |
| `road-fret` | *(none)* | — |
| *(no action / undefined)* | *(none)* | Falls back to empty; pure root states like `pile` propose nothing |

The registry lives in [`engines/ssh/src/lib/jobs/action-job-registry.ts`](../src/lib/jobs/action-job-registry.ts).
New action types register a provider via `registerActionJobProvider(type, provider)`.
Alveoli never need to override `nextAlveolusJob()` or `proposedJobs` again.

### `HivePlanEntry` (ssh — [`hive-plan.ts`](../src/lib/hive-plan.ts))

```ts
export interface HivePlanEntry {
    roleId: string
    coord: readonly [number, number]
    alveolusType: AlveolusType
    variant?: string                                       // new
    configuration?: {
        ref: Ssh.ConfigurationReference
        individual?: Ssh.AlveolusConfiguration
    }
}
```

### `BuildAlveolus` (ssh — [`build.ts`](../src/lib/hive/build.ts))

The construction shell already carries `planConfiguration`. A `variant` follows the same propagation pattern — stored on the shell during construction, transferred to the final alveolus in `finalizeConstructionShell`.

### Save data (ssh — [`game.ts`](../src/lib/game/game.ts))

`variant` is serialized alongside the alveolus type. On deserialization, the runtime re-resolves the root + variant merge from the rule definitions. If a saved `variant` no longer exists in the rules (e.g. the variant was removed in a game update), the alveolus falls back to its root definition — possibly incomplete but still present, allowing the player to apply a different variant.

---

## `variant` vs configuration

Variant and configuration are orthogonal:

| Axis | Variant | Configuration |
|---|---|---|
| **When chosen** | Construction time | Anytime through inspector |
| **What it changes** | Action set, specifications, output goods, work time, visual | Working flag, buffers, product ratio, slot allocation |
| **Cost to change** | Construction materials + engineer work | Free |
| **Where stored** | `alveolus.variant` | `alveolus.configurationRef` + `alveolus.individualConfiguration` |
| **Scope** | Per building instance | Per building instance (individual), per hive (hive scope), or global (named) |

A `pile.wood` alveolus can still have its `working` flag toggled or its buffer sizes configured through the existing configuration system. An `engineer.building` can have individual buffers adjusted. Variant chooses *what* the building is; configuration tunes *how* it operates.

---

## Types without variants (all others)

All alveolus types not listed in [Initial scope](#initial-scope) have no `variants`
field. They are fully defined by their root and work exactly as they do today.
The existing configuration system (buffers, product ratios, slot allocation,
working flag) provides sufficient tuning for these types.

---

## UI implications

### Construction palette / plan editor

When the player selects a variant-capable alveolus type (`pile`, `engineer`), a variant picker appears showing all defined variants. Each variant entry shows:

- The variant name (e.g. "wood", "wood.extra", "building", "road")
- The target state's own construction cost
- If the request expands into multiple queued jobs, the total queued cost and the intermediate jobs
- The key behavioral differences (e.g. output rate, work time)

For example, selecting `pile.wood.extra` from `UnBuiltLand` should make clear
that the queue is `UnBuiltLand -> pile -> pile.wood -> pile.wood.extra` and show
the combined cost of those jobs. Selecting `pile.wood.extra` from an existing
`pile.wood` only shows the final `pile.wood -> pile.wood.extra` job cost.

### Inspector

A built alveolus with variants shows its current `variant` in the inspector. If the alveolus type has multiple variants, a "Change Variant" action is available, which opens the variant picker and, on confirmation, starts a construction job targeting the selected variant state.

If the current state is incomplete, the inspector should make variant selection
the obvious next action rather than presenting the state as broken. For example,
a bare `pile` should offer `wood`, `planks`, and any other useful variants in
the `pile` tree.

On-board visual: the main icon remains the root (e.g., the pile icon). Variant
state is shown as a badge overlay (e.g., wood/planks/extra, building/research/road)
so the base footprint is stable while specialization is visible.

### Hive plan editor

Each `HivePlanEntry` exposes a variant picker. When validating or placing a plan, entries with a `variant` resolve to the merged definition for construction cost calculation and placement validation.
Plan cost previews should use the expanded construction queue from the planned
starting state, not only the leaf variant recipe.

---

## Summary of file changes

| File | Change |
|---|---|
| [`engines/rules/src/content/alveoli.ts`](../../rules/src/content/alveoli.ts) | Add `variants` to `pile` and `engineer` only |
| [`engines/ssh/src/lib/construction-state.ts`](../src/lib/construction-state.ts) | `ConstructionTarget.alveolus` gains optional `variant`; `createConstructionRecipe` selects the recipe for the target state |
| [`engines/ssh/src/lib/construction-shell.ts`](../src/lib/construction-shell.ts) | `finalizeConstructionShell` resolves variant, passes to `createAlveolus` |
| [`engines/ssh/src/lib/hive/index.ts`](../src/lib/hive/index.ts) | `createAlveolus` accepts `variant`, resolves merged definition |
| [`engines/ssh/src/lib/board/content/alveolus.ts`](../src/lib/board/content/alveolus.ts) | Store `variant`, expose `resolvedDefinition` getter; `computeProposedJobs`/`computeJobForCharacter` delegate to action→job registry |
| [`engines/ssh/src/lib/jobs/action-job-registry.ts`](../src/lib/jobs/action-job-registry.ts) | **New**: action→job provider registry with providers for all action types |
| [`engines/ssh/src/lib/hive/engineer.ts`](../src/lib/hive/engineer.ts) | Removed `nextAlveolusJob`, `proposedJobs` override, `engineeringTargets`; now purely data |
| [`engines/ssh/src/lib/hive/harvest.ts`](../src/lib/hive/harvest.ts) | Removed `nextAlveolusJob` override |
| [`engines/ssh/src/lib/hive/transform.ts`](../src/lib/hive/transform.ts) | Removed `nextAlveolusJob` override |
| [`engines/ssh/src/lib/hive/forester.ts`](../src/lib/hive/forester.ts) | Removed `nextAlveolusJob` override |
| [`engines/ssh/src/lib/hive/storage.ts`](../src/lib/hive/storage.ts) | Removed `nextAlveolusJob` override |
| [`engines/ssh/src/lib/hive/build.ts`](../src/lib/hive/build.ts) | `BuildAlveolus` carries `variant` |
| [`engines/ssh/src/lib/board/content/unbuilt-land.ts`](../src/lib/board/content/unbuilt-land.ts) | `setProject` accepts `variant` |
| [`engines/ssh/src/lib/board/tile.ts`](../src/lib/board/tile.ts) | `build(alveolusType, variant?)` signature |
| [`engines/ssh/src/lib/hive-plan.ts`](../src/lib/hive-plan.ts) | `HivePlanEntry` gains `variant` |
| [`engines/ssh/src/lib/game/game.ts`](../src/lib/game/game.ts) | Serialize/deserialize `variant` in saved game data |
| `apps/browser` widgets | Variant picker in construction palette, plan editor, inspector |
| [`engines/pixi`](../../pixi) | Optionally different sprites per variant in `alveolus-visual.ts` |
