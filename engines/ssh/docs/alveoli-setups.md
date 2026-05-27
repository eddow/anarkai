# Alveolus Setups

Every alveolus type defines one **root** (common properties shared by all its variants)
together with one or more **setups**. A setup fills in the remaining parts of the
definition that the root leaves open, producing the fully functional building.

| Concept | Role |
|---|---|
| **Root** | Common configuration: `action.type`, base `construction` cost, structural invariants. May be non-functional on its own when critical fields (e.g. `output`, `workTime`) are only provided by a setup. |
| **Setup** | Strongly-typed override that completes the root. Supplies action fields the root omitted, optionally adds construction materials/time, and can change the alveolus' visual identity. |
| **`defaultSetup`** | The setup used when no explicit choice is made. Makes the system backward-compatible: existing save data without a `setupId` resolves to this default. |

---

## Example definitions

### `pile` — empty root, storage-filled by setup

```ts
pile: {
    // Root: common to all pile variants — minimal, non-functional alone
    construction: { goods: { wood: 4 }, time: 2 },
    action: { type: 'storage', kind: 'specific' },           // goods field omitted here

    setups: {
        'wood-pile': {
            goods: { wood: 24 },
            construction: { goods: { wood: 6 }, time: 2 },   // additive on root
        },
        'plank-pile': {
            goods: { planks: 24 },
            construction: { goods: { planks: 4 }, time: 2 },
        },
    },
    defaultSetup: 'wood-pile',
}
```

- `pile` alone has no meaningful storage capacity.
- `pile` + `wood-pile` → `SpecificStorage({ wood: 24 })`, total construction cost `wood: 10 + time: 4`.
- `pile` + `plank-pile` → `SpecificStorage({ planks: 24 })`, total construction cost `wood: 4 + planks: 4 + time: 4`.

### `tree_chopper` — tool determines output

```ts
tree_chopper: {
    // Root: always harvests trees; tool choice sets output and work time
    construction: { goods: { wood: 2, stone: 1 }, time: 4 },
    action: { type: 'harvest', deposit: 'tree' },             // output + workTime from setup

    setups: {
        axe: {
            output: { wood: 1 },
            workTime: 3,
            construction: {},                                  // no extra cost — baseline
        },
        chainsaw: {
            output: { wood: 2 },
            workTime: 1.5,
            construction: { goods: { chainsaw: 1 }, time: 2 }, // chainsaw in cost gates availability
        },
    },
    defaultSetup: 'axe',
}
```

- `tree_chopper` + `axe` → `HarvestAlveolus` producing 1 wood every 3s, cost: `wood: 2, stone: 1, time: 4`.
- `tree_chopper` + `chainsaw` → `HarvestAlveolus` producing 2 wood every 1.5s, cost: `wood: 2, stone: 1, chainsaw: 1, time: 6`.
- The `chainsaw` setup is gated **implicitly**: the chainsaw good must exist in the player's economy for the construction material to be obtainable. If `chainsaw` is not yet available (e.g. not researched, not traded, not produced), the player cannot gather the required material and the setup is effectively unavailable.

### `engineer` — specialization by role

```ts
engineer: {
    construction: { goods: { wood: 1, stone: 1 }, time: 4 },
    action: { type: 'engineer' },                              // radius + specializations from setup

    setups: {
        building: {
            radius: 6,
            specializations: ['construct', 'foundation'],
            construction: {},
        },
        research: {
            radius: 0,
            specializations: ['validateHivePlan'],
            construction: { goods: { charcoal: 2 }, time: 2 },
        },
        road: {
            radius: 8,
            specializations: ['road'],
            construction: { goods: { concrete: 2 }, time: 3 },
        },
    },
    defaultSetup: 'building',
}
```

- `engineer` + `building` → standard `EngineerAlveolus` that constructs and lays foundations (radius 6).
- `engineer` + `research` → `EngineerAlveolus` that only validates hive plans (radius 0, stays on its own tile).
- `engineer` + `road` → `EngineerAlveolus` that builds roads with extended reach (radius 8).

---

## Construction flow

### Normal path: root phase then setup phase

```
UnBuiltLand
  │
  ├─ Player sets project "build:pile"
  │   └─ (setup choice can be made now, or deferred)
  │
  ├─ Phase 1: Root construction
  │   ├─ Materials: root.construction.goods
  │   ├─ Work:     root.construction.time
  │   └─ Engineer work → foundation → building
  │       Result: a "pile" alveolus (non-functional — no setup)
  │
  ├─ Phase 2: Setup upgrade
  │   ├─ Player selects "wood-pile" (available from project time onward)
  │   ├─ Materials: setup.construction.goods (additive)
  │   ├─ Work:     setup.construction.time (additive)
  │   └─ Engineer work → foundation → building
  │       Result: specialized "pile:wood-pile"
  │
  └─ Later: change setup to "plank-pile"
      ├─ Alveolus re-enters construction pipeline
      ├─ Materials: setup.construction.goods for "plank-pile"
      └─ Result: specialized "pile:plank-pile"
```

### Shortcut: immediate specialization

When the player chooses a setup at project time and that setup is the `defaultSetup` (or has zero extra construction cost), the two phases are effectively collapsed into one — the alveolus is created directly in its final specialized form. This is the common case for `tree_chopper` + `axe` or `engineer` + `building`.

### Key behaviors

- **Setup choice window**: The setup can be selected from the moment the project is set on `UnBuiltLand` all the way through the root construction phase, and even after the root building is finished. The setup choice is always an available interaction on the tile.
- **Queuable**: If the player picks a setup while root construction is still in progress, the setup phase is automatically queued and will begin as soon as the root phase completes.
- **Re-specialization**: Changing an existing alveolus' setup re-enters the construction pipeline on the same tile. The existing alveolus is temporarily replaced by a `BuildAlveolus` shell targeting the same root type with the new `setupId`, reusing the existing foundation → materials → construction → finalize machinery.
- **Cost**: Each setup change costs the setup's `construction.goods` and `construction.time`. There is no discount for "downgrading" — the full setup cost is always paid.
- **Construction cost is additive**: `totalGoods = merge(root.construction.goods, setup.construction.goods)` and `totalTime = root.construction.time + setup.construction.time`.

---

## Runtime resolution

When an alveolus is created, the root definition and setup are merged:

```
resolvedDefinition = {
    ...root,
    ...setup,
    construction: {
        goods: { ...root.construction?.goods, ...setup.construction?.goods },
        time: (root.construction?.time ?? 0) + (setup.construction?.time ?? 0),
    },
    action:    { ...root.action, ...setup.action },
    workTime:  setup.workTime ?? root.workTime,
}
```

The resolved definition is what `createAlveolus` in [`hive/index.ts`](../src/lib/hive/index.ts) dispatches on. The merge is **shallow** — setup fields replace root fields of the same name, except for `construction` (additive) and `action` (shallow-merged so the root's `type` is preserved).

If no setup is resolved (missing `setupId`, `setupId` not found in `setups`, no `defaultSetup`), the bare root definition is used. For types like `pile`, this produces a non-functional or limited alveolus. For types like `storage` or `freight_bay` that do not need setups, the root is already complete.

---

## Data model additions

### `AlveolusDefinition` (rules layer — [`alveoli.ts`](../../rules/src/content/alveoli.ts))

Each entry gains optional `setups` and `defaultSetup`:

```ts
interface AlveolusDefinition {
    // … existing fields …
    setups?: Record<string, AlveolusSetupDefinition>
    defaultSetup?: string
}

interface AlveolusSetupDefinition {
    // All fields are optional — each setup overrides only what differs from the root
    action?: Partial<AlveolusAction>
    workTime?: number
    preparationTime?: number
    construction?: { goods?: Partial<Record<GoodType, number>>; time?: number }
    output?: Partial<Record<GoodType, number>>
    goods?: Partial<Record<GoodType, number>>
    radius?: number
    specializations?: string[]
}
```

Strong typing is enforced per alveolus type — e.g. `tree_chopper.setups.chainsaw.output` must be `Partial<Record<GoodType, number>>`, not an arbitrary string.

### `ConstructionTarget` (ssh — [`construction-state.ts`](../src/lib/construction-state.ts))

```ts
export type ConstructionTarget =
    | { readonly kind: 'alveolus'; readonly alveolusType: AlveolusType; readonly setupId?: string }
    | { readonly kind: 'dwelling'; readonly tier: DwellingTier }
```

`constructionTargetFromProject` and `createConstructionRecipe` are extended to incorporate `setupId`.

### `Alveolus` base class (ssh — [`alveolus.ts`](../src/lib/board/content/alveolus.ts))

```ts
export abstract class Alveolus {
    /** Which setup this alveolus was built with. `undefined` means root-only or not applicable. */
    public readonly setupId?: string

    /** The fully resolved definition, with setup merged in. */
    get resolvedDefinition(): Ssh.AlveolusDefinition { … }
}
```

### `HivePlanEntry` (ssh — [`hive-plan.ts`](../src/lib/hive-plan.ts))

```ts
export interface HivePlanEntry {
    roleId: string
    coord: readonly [number, number]
    alveolusType: AlveolusType
    setupId?: string                                         // new
    configuration?: {
        ref: Ssh.ConfigurationReference
        individual?: Ssh.AlveolusConfiguration
    }
}
```

### `BuildAlveolus` (ssh — [`build.ts`](../src/lib/hive/build.ts))

The construction shell already carries `planConfiguration`. A `setupId` follows the same propagation pattern — stored on the shell during construction, transferred to the final alveolus in `finalizeConstructionShell`.

### Save data (ssh — [`game.ts`](../src/lib/game/game.ts))

`setupId` is serialized alongside the alveolus type. On deserialization, the runtime re-resolves the root + setup merge from the rule definitions, so the saved data remains robust against rule changes (a removed setup falls back to the root or `defaultSetup`).

---

## `setupId` vs configuration

Setup and configuration are orthogonal:

| Axis | Setup | Configuration |
|---|---|---|
| **When chosen** | Construction time (or upgrade) | Anytime through inspector |
| **What it changes** | Action definition, output goods, work time, radius, visual | Working flag, buffers, product ratio, slot allocation |
| **Cost to change** | Construction materials + engineer work | Free |
| **Where stored** | `alveolus.setupId` | `alveolus.configurationRef` + `alveolus.individualConfiguration` |
| **Scope** | Per building instance | Per building instance (individual), per hive (hive scope), or global (named) |

A `tree_chopper` with setup `chainsaw` can still have its `working` flag toggled, its product ratio adjusted, or buffer sizes configured through the existing configuration system. Setup chooses *what* the building is; configuration tunes *how* it operates.

---

## Types that do not need setups

Some alveolus types are already fully defined by their root and do not benefit from setup variants:

- `storage` — generic slotted storage; configuration handles slot allocation.
- `freight_bay` — its action is `road-fret` with no meaningful variant.
- `sawmill`, `flour_mill`, `bakery` — transform buildings with fixed recipes; the existing `productRatio` configuration already provides runtime tuning.

For these types, `setups` is omitted and `defaultSetup` is `undefined`. They work exactly as they do today.

---

## UI implications

### Construction palette / plan editor

When the player selects a setup-capable alveolus type (`pile`, `tree_chopper`, `engineer`), a setup picker appears showing all defined setups. Each setup entry shows:

- The setup name (e.g. "wood-pile", "chainsaw")
- The additive construction cost
- The key behavioral differences (e.g. output rate, work time)

### Inspector

A built alveolus with setups shows its current `setupId` in the inspector. If the alveolus type has multiple setups, a "Change Setup" action is available, which opens the setup picker and, on confirmation, initiates the construction upgrade.

### Hive plan editor

Each `HivePlanEntry` exposes a setup picker. When validating or placing a plan, entries with a `setupId` resolve to the merged definition for construction cost calculation and placement validation.

---

## Summary of file changes

| File | Change |
|---|---|
| [`engines/rules/src/content/alveoli.ts`](../../rules/src/content/alveoli.ts) | Add `setups` + `defaultSetup` to `pile`, `tree_chopper`, `engineer` |
| [`engines/ssh/src/lib/construction-state.ts`](../src/lib/construction-state.ts) | `ConstructionTarget.alveolus` gains optional `setupId`; `createConstructionRecipe` merges root + setup goods |
| [`engines/ssh/src/lib/construction-shell.ts`](../src/lib/construction-shell.ts) | `finalizeConstructionShell` resolves setup, passes to `createAlveolus` |
| [`engines/ssh/src/lib/hive/index.ts`](../src/lib/hive/index.ts) | `createAlveolus` accepts `setupId`, resolves merged definition |
| [`engines/ssh/src/lib/board/content/alveolus.ts`](../src/lib/board/content/alveolus.ts) | Store `setupId`, expose `resolvedDefinition` getter |
| [`engines/ssh/src/lib/hive/build.ts`](../src/lib/hive/build.ts) | `BuildAlveolus` carries `setupId` |
| [`engines/ssh/src/lib/board/content/unbuilt-land.ts`](../src/lib/board/content/unbuilt-land.ts) | `setProject` accepts `setupId` |
| [`engines/ssh/src/lib/board/tile.ts`](../src/lib/board/tile.ts) | `build(alveolusType, setupId?)` signature |
| [`engines/ssh/src/lib/hive-plan.ts`](../src/lib/hive-plan.ts) | `HivePlanEntry` gains `setupId` |
| [`engines/ssh/src/lib/game/game.ts`](../src/lib/game/game.ts) | Serialize/deserialize `setupId` in saved game data |
| `apps/browser` widgets | Setup picker in construction palette, plan editor, inspector |
| [`engines/pixi`](../../pixi) | Optionally different sprites per setup in `alveolus-visual.ts` |
