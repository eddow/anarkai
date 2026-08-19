# Sursaut Guideline Audit — apps/browser

> Generated 2026-06-12. Documents component patterns that deviate from Sursaut's reactive/declarative model.

---

## 1. Redundant `draft` + `effect` Sync (Anti-Pattern: "Avoid Redundant Synchronization")

Sursaut says: *"Do not create generic 'sync' effects that just copy values from A to B. `mutts` reactivity allows you to use the values directly. Anti-Pattern: `effect(() => state.localVal = globalVal)`"*

### 1.1 `SpecificStorageConfiguration.tsx` (L49–85) — ✅ RESOLVED

~~Creates `draft = reactive({ bufferStars })`, then an `effect` copies `buffers[goodType]` → `draft.bufferStars[goodType]`.~~ The `draft` buffer is gone: the component now derives `getBufferStars` / `getBufferValue` directly from `props.configuration.buffers` and writes back through `setBufferFromStars` — direct get/set, no redundant sync effect.

### 1.2 `SlottedStorageConfiguration.tsx` (L65–133) — ✅ RESOLVED (2026-08-19)

~~Creates `draft = reactive({ generalSlots, ranges })`, then an `effect` copies `view.displayedGeneralSlots` → `draft.generalSlots` and `view.rule(goodType)` → `draft.ranges[goodType]`.~~ `GoodStarsEditor` / `GeneralStarsEditor` now derive everything from the reactive `props.content.slottedStorageConfiguration` through a `view` getter object (same pattern as the parent) — no `state` buffer, no `effect` sync. The `mutts` import is gone from this file.

### 1.3 `StorageConfiguration.tsx` (L125, L270–280, L467–474) — LEGITIMATE (local UI state)

The `preset = reactive({ selectedPreset, presetName })` is **local UI state** (which preset is selected + the name-input text), not a buffer of config. Derived values (`mode`, `exceptions`, `buffers`, `isSlotted`, etc.) already use `memoize(...)`, and the `effect `storage-configuration:preset-sync`` is a reactive validation (reset to `SPECIFIC_PRESET` when the settings no longer match the selected preset). This is the correct pattern, not redundant synchronization.

### 1.4 `FreightLineProperties.tsx` (L327) — ✅ RESOLVED (2026-08-19)

~~`const local = reactive({ revision: 0 })` — used as a manual invalidation flag (bumped with `local.revision++` after mutations).~~ The `local.revision` poke token was removed; the reactive `Set<FreightLineDefinition>` + reactive line object drive re-render directly (see `sandbox/version-token-hack-analysis.md` §3.1).

---

## 2. `onChange`/`onInput`/`onBlur` Instead of Two-Way Binding

Sursaut says: *"Most of the time, onChange, onInput etc are useless and should be avoided. Two-way binding always the pattern we should use."* and *"Avoid `onChange` handlers for inputs. Use two-way binding with mutable state. Pass a mutable state slice to the component, and let the component mutate it directly."*

### 2.1 Input bindings that should be `value={…}` two-way

| File | Line(s) | Element | Current pattern |
|------|---------|---------|-----------------|
| `FreightLineProperties.tsx` | 489 | `<input>` name | `onInput` → `handleNameInput` |
| `HiveProperties.tsx` | 186 | `<input>` name | `onInput` → `handleNameInput` |
| `AlveolusProperties.tsx` | 423 | `<input type="range">` | `onInput` → `setTransformRatio` |
| `plan-manager.tsx` | 405, 442 | `<input>` name/role | `onInput` → `applyDraftPatch` / `setEntry` |
| `lines-management.tsx` | 312 | `<input type="search">` | `onInput` → `state.text = …` |
| `HardListSearchPicker.tsx` | 159 | `<input>` filter | `onInput` → `state.query = …` |
| `StorageConfiguration.tsx` | 387 | `<input>` preset | `update:value=` + `onChange` + `onBlur` — should use only `update:value=` |

### 2.2 `<select>` bindings that should be two-way

| File | Line(s) | Current pattern |
|------|---------|-----------------|
| `AlveolusProperties.tsx` | 388, 403 | `onChange` → `setTransformRatio` |
| `plan-manager.tsx` | 454, 474, 505 | `onChange` → `setEntry` / `setEntryNamedConfiguration` |
| `key-bindings.tsx` | 178 | `onChange` → `setRowCommand` |

### 2.3 Custom component `onChange` props (should be two-way bindings)

Sursaut says: *"DO NOT override internal component logic with event handlers to manually force state changes."*

| Component | Line | Prop |
|-----------|------|------|
| `Stars` (in SpecificStorageConfiguration) | 138 | `onChange` → writes draft + source |
| `Stars` (in SlottedStorageConfiguration ×2) | 156, 199 | `onChange` → writes draft + source |
| `Stars` (in StorageConfiguration) | 467 | `onChange` → writes draft + source |
| `WorkingIndicator` | 107 | `onChange?: (checked: boolean) => void` — should mutate `props.checked` directly |
| `VariantPicker` | 118 | `onChange: (value: string) => void` — should mutate `props.value` directly |
| `FreightStopList` | 302–304 | `onChange: (next: FreightLineDefinition) => void` — event-based parent communication |

### 2.4 Legitimate exceptions (keep)

- `command-box.tsx` — framework-level input component, needs `onInput`/`onFocus`/`onBlur` for interop
- `key-bindings.tsx` L159 `onBlur` — dismisses recording mode, an exceptional UI gesture
- `lines-management.tsx` L368 `onBlur` — clears hover state, legitimate as it's a focus-exit gesture
- `editors.tsx` — uses `update:value=` (correct Sursaut pattern), the `onChange` at L767 appears to be on a custom `Select` wrapper

---

## 3. Early `return null` in Component Body (No Reactive Guard)

Sursaut components run once; their body is fenced. Returning `null` from the body skips all reactive wiring. Conditions should use `if={}` on the root JSX element instead.

| File | Line | Code |
|------|------|------|
| `SpecificStorageConfiguration.tsx` | 47 | `if (!props.action) return null` |
| `render-icon.tsx` | 87 | `if (!icon) return null` |

Both should use `<div if={props.action}>` / `<span if={!!icon}>` patterns instead.

---

## 4. Props Read in Component Body (Rebuild Fence Risk)

Sursaut says: *"Reading `props.foo` directly in the component function body creates a dependency on that prop for the entire component render effect. If `props.foo` changes, the rebuild fence triggers and the component body does not re-run."*

### 4.1 `SpecificStorageConfiguration.tsx` L48–50

```tsx
const goods = Object.keys(props.action.goods) as GoodType[]  // reads props.action
const buffers = props.configuration?.buffers || {}             // reads props.configuration
```

### 4.2 `HiveProperties.tsx` L107

```tsx
const state = reactive({ hiveName: '', working: true, entries: [], dockedVehicles: [] })
// L109: props.hiveObject.game read outside effect
const currentHive = () => resolveHiveFromAnchorTile(props.hiveObject.game, props.hiveObject.anchorTileUid)
```
The `currentHive` getter is fine (it's a closure), but `state.hiveName` is written in the effect (L125) which *partially* follows the pattern but adds redundant local state.

### 4.3 `FreightLineProperties.tsx` L328–339 — ✅ RESOLVED (2026-08-19)

```tsx
const currentGame = () => props.lineObject?.game    // ok, getter
const currentLine = () => props.lineObject?.line    // ok, getter (no manual invalidation)
```

~~The `local.revision` manual invalidation was removed; `currentLine()` reads the reactive line object directly.~~

---

## 5. `.map()` for JSX Rendering (Should Use `<for>`)

Sursaut says: *"DO NOT use `.map()` to render lists of components in JSX."*

No direct JSX `.map()` violations found in the non-spec source. The `.map()` calls in components are all data-transformation (returning plain arrays) that are then fed into `<for each={…}>`, which is correct. ✅

---

## 6. Summary: Files Requiring the Most Attention

| Priority | File | Violations |
|----------|------|-----------|
| 🔴 High | `storage/SpecificStorageConfiguration.tsx` | draft+sync, onChange, early return null, props body read |
| 🔴 High | `storage/SlottedStorageConfiguration.tsx` | draft+sync, onChange |
| 🔴 High | `storage/StorageConfiguration.tsx` | draft+sync×2, onChange, onBlur |
| 🟡 Medium | `HiveProperties.tsx` | onInput, onChange, local synced state |
| 🟡 Medium | `FreightLineProperties.tsx` | onInput, manual revision invalidation |
| 🟡 Medium | `AlveolusProperties.tsx` | onChange (selects), onInput (range) |
| 🟡 Medium | `plan-manager.tsx` | onInput, onChange (selects) |
| 🟡 Medium | `HardListSearchPicker.tsx` | onInput |
| 🟡 Medium | `parts/WorkingIndicator.tsx` | onChange prop |
| 🟡 Medium | `properties/VariantPicker.tsx` | onChange prop |
| 🟡 Medium | `FreightStopList.tsx` | onChange prop |
| 🟢 Low | `lines-management.tsx` | onInput (search), onBlur (legitimate) |
| 🟢 Low | `key-bindings.tsx` | onChange (select), onBlur (legitimate exception) |
| 🟢 Low | `icons/render-icon.tsx` | early return null |
