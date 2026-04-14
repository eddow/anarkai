Refer to `sursaut-ts/LLM.md` and `sursaut-ui/LLM.md` for introduction to the Sursaut framework.

# Palette (browser)

- **Edit mode** is toggled from the command box pencil; `palettes.editing` tracks which `Palette` instance is being edited.
- **Inspect** (which item is being configured) uses global `palettes.inspecting` (`item`, `palette`, optional `region`). Sursaut sets it when clicking a toolbar **guard** strip or starting a guard drag; clearing happens when edit mode ends or after a successful drag move.
- **Toolbar item inspector** (`PaletteToolbarInspectorPanel` in `src/palette/palette-inspector.tsx`) renders inside Dockview widget **`paletteInspector`** (`src/widgets/palette-inspector-widget.tsx`). **`App.tsx`** opens a **floating** panel (`PALETTE_INSPECTOR_DOCK_PANEL_ID`, `palette.toolbar-inspector`) when `palette.editing` is on and **removes** it when edit mode ends. Inside the panel: hint until `palettes.inspecting` is set, then identity + configurator (same as before).
- **Reactivity**: Do not read `palettes.inspecting` **once** in the component body; use getters or `if={}` so Sursaut re-runs when selection changes (see Sursaut LLM “component body rules”). The Dock open/close effect must read `palette.editing` inside `effect` so it tracks `palettes.editing`. The **configurator** must be produced from getters that read `view.inspectingItem` in **`PaletteToolbarInspectorPanel`** (not only from a child that receives `item` as props), so changing the selected toolbar item updates the “editor’s editor” under Dockview.
- **Escape** clears `palettes.inspecting` only (stays in edit mode). The floating panel’s chrome **Close** is Dockview’s; no duplicate close control in the inspector body.

# Widget Logic & State Simplification

## Core Principle: Simplify State Management
When designing widgets that interact with global state (like selection), follow these principles:

1.  **Single Source of Truth**: Avoid duplicating global state into local state. If a widget needs to know about a global selection, read it directly or derive it reactively from parameters.
    - *Example (Selection Info)*: Instead of a local `isPinned` boolean, simply check if `props.params.uid` is populated.
2.  **Avoid Redundant Synchronization**: Do not create generic "sync" effects that just copy values from A to B. `mutts` / `sursaut` reactivity allows you to use the values directly.
    - *Anti-Pattern*: `effect(() => state.localVal = globalVal)`
    - *Pattern*: `const derivedVal = () => globalVal` (or used directly in effects/JSX)
3.  **Minimal Global Registry**: Avoid complex global registries for UI state (like tracking every single open panel ID) if a simple flagged state (e.g., "is dynamic panel open") suffices.

## Design Smell: Over-Abstraction
If you find yourself writing complex helper functions to manage lifecycle (register/unregister) for simple UI toggles, pause and reconsider. The design might be misunderstood. Often, the framework's reactivity + simple boolean flags are sufficient.

## Direct Parameter Usage
For widgets that can be "pinned" or "dynamic":
- Use widget parameters (e.g., `props.params.uid`) as the primary differentiator.
- A widget with a specific UID parameter is "pinned".
- A widget without it is "dynamic".
- The logic then becomes a simple ternary or fallback: `const target = props.params.uid ?? globalSelection.uid`.

## Reactivity
Trust the reactive system. Components updates should be driven by reactive data sources changing, not by manual imperative `update()` calls unless absolutely necessary for interop.
Most of the time, onChange, onInput etc are useless and should be avoided. Two-way binding always the pattern we should use.

## JSX Patterns: Conditionals and Loops

**IMPORTANT:** Do NOT use JavaScript ternary operators or `&&` for conditional rendering, and do NOT use `.map()` for list rendering. Sursaut provides dedicated mechanisms:

### Conditionals: Use `if`, `else`, `else-if` Attributes
```tsx
// ✗ WRONG: Ternary operator
{condition ? <ComponentA /> : <ComponentB />}

// ✓ CORRECT: if/else attributes
<ComponentA if={condition} />
<ComponentB else />

// For else-if chains:
<ComponentA if={conditionA} />
<ComponentB else-if={conditionB} />
<ComponentC else />
```

### Loops: Use `<for>` Element
```tsx
// ✗ WRONG: .map()
{items.map((item) => <Item key={item.id} data={item} />)}

// ✓ CORRECT: <for> element (no key needed, handled by framework)
<for each={items}>
  {(item: ItemType) => <Item data={item} />}
</for>
```

**Note:** Always add explicit type annotations to the callback parameter (e.g., `(item: ItemType)`) for proper TypeScript inference.

# Inspector goods / tags UI

- **`ComboDropdownPicker`** (`src/components/ComboDropdownPicker.tsx`): combo-style dropdown — trigger stays in flow; menu is **`position: absolute`** (`top: 100%`, `left: 0`, `min-width: 100%`) under the trigger; full-screen **`position: fixed`** backdrop behind it for outside dismiss; wrapper gets **`z-index`** + **`isolation: isolate`** when open. Modes: **`icon`** (uses shared **`Button`**) or **`value`** (native-looking text + caret). **`goodsAddComboIcon`** / **`tagsAddComboIcon`**: **`tablerOutlinePackage`** / **`tablerOutlineTags`** from `pure-glyf/icons` via **`renderAnarkaiIcon`**, plus a small green **`+`** overlay. Optional **`renderValueTrigger`** on **`value`** mode replaces the label span before the caret (used for tag icon + label on the trigger).
- **`GoodPickerButton`** (`src/components/GoodPickerButton.tsx`): thin wrapper over **`ComboDropdownPicker`** + **`EntityBadge`** rows; **`GoodMultiSelect`** (storage) and freight **`GoodSelectionRulesEditor`** use it for goods.
- **Good tags (freight goods selection):** canonical SVG icons live under **`engines/rules/assets/goods-tags/`**. They are inspector/UI assets, not board-rendered Pixi assets. Browser URL resolution is handled in **`src/lib/good-tag-icons.ts`**, then rendered by **`GoodTagBadge`** + **`TagPickerButton`** (`src/components/GoodTagBadge.tsx`, `TagPickerButton.tsx`) for icon-only tag rows and add-picker entries (tooltip carries the label). Tag rule rows reorder via **`startLocalDragSession`** / **`resolveLocalDragInsertion`** from **`@sursaut/ui`** (grip handle only; no per-row tag reselection and no Up/Down buttons). Remove rows use **`tablerFilledSquareRoundedMinus`** on **`Button`**.
- **GoodSelectionRulesEditor flat state:** The editor's local reactive state uses flat top-level properties (`state.goodRules`, `state.tagRules`, `state.defaultEffect`) instead of a nested `state.policy` object. This is required because replacing a nested object (`state.policy = newObj`) inside a reactive proxy does not reliably propagate to `<for>` loops that read through the nested object (e.g. `state.policy.tagRules`) when the parent feeds back the emitted policy via `props.policy` in the same reactive batch. Flat state ensures each `<for>` loop tracks a direct top-level reactive property.