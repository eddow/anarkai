# Anarkai Browser Adapter Transformation Plan

## Execution Dossier

The implementation-facing companion documents live in:

- `docs/browser-adapter/README.md`
- `docs/browser-adapter/architecture-spec.md`
- `docs/browser-adapter/work-packages.md`
- `docs/browser-adapter/acceptance-and-rollout.md`
- `docs/browser-adapter/agent-briefs.md`

## Goal

Replace the current `@sursaut/adapter-pico` usage in `apps/browser` with an Anarkai-specific browser adapter that keeps Sursaut's headless behavior and owns the full browser visual language:

- game toolbar
- palette and command box
- inspector chrome
- framed panels
- dense controls
- badges, pills, and utility surfaces
- icon and asset rendering conventions

The intent is to move away from a generic web look and toward a Simutrans / Settlers-like UI feeling.

## Why This Should Start In `apps/browser`

The first implementation should live in `apps/browser`, not in `engines/`.

Reasons:

- this is presentation and browser DOM/CSS work, not engine logic
- it depends on browser rendering details
- the current consumer is the browser app only
- Proton could likely reuse most of it later if it stays web-based
- native mobile would reuse the design system and semantics, not the DOM/CSS implementation

So the first target should be a browser-local adapter:

```text
apps/browser/src/ui/anarkai/
```

## Long-Term Architecture

Do not think in terms of one universal adapter shared identically across browser, Proton, and native mobile.

Instead, think in terms of:

1. one shared Anarkai UI language
2. one adapter per platform

What should be shared later:

- token names and meaning
- component semantics
- interaction grammar
- iconography rules
- spacing and density scales
- selected / disabled / warning / active state semantics

What should not be assumed shareable:

- CSS files
- DOM structure
- hover/focus browser details
- platform-specific input affordances
- mobile layout constraints

## CSS Paradigm

The adapter should start from:

- vanilla CSS
- CSS custom properties
- semantic class names

Not from:

- Tailwind
- utility-first styling
- ad hoc component-local style strings

### Why Vanilla CSS Is The Right Starting Point

This adapter is not a page-building toolkit. It is a strongly opinionated visual implementation layer.

The main goal is not flexibility at call sites. The main goal is coherence:

- compact controls
- bevels and frames
- stable chrome
- repeated panel patterns
- consistent selected states
- icon-first interactions

Those are better expressed with:

- semantic components
- shared tokens
- central control over state styling

Tailwind would tend to leak visual construction into call sites. That is useful for app layout work, but not ideal for a reusable adapter that should own the visual identity.

### Recommended CSS Structure

Use three conceptual layers:

1. tokens
2. primitives
3. surfaces

#### 1. Tokens

Own all reusable design values:

- colors
- spacing
- radii
- shadows
- borders
- control heights
- densities
- z-index and overlays

Examples:

- `--ak-surface-0`
- `--ak-surface-1`
- `--ak-surface-panel`
- `--ak-border`
- `--ak-border-strong`
- `--ak-accent`
- `--ak-accent-active`
- `--ak-text`
- `--ak-text-dim`
- `--ak-radius-sm`
- `--ak-shadow-inset`
- `--ak-control-height-compact`

#### 2. Primitives

Own the base visual building blocks:

- buttons
- grouped buttons
- segmented controls
- selects
- badges
- chips
- panels
- field shells

Examples:

- `.ak-button`
- `.ak-button-group`
- `.ak-radio-button`
- `.ak-check-button`
- `.ak-select`
- `.ak-toolbar`
- `.ak-badge`
- `.ak-panel`

#### 3. Surfaces

Own browser-specific assemblies:

- app shell
- top toolbar
- palette IDE shell
- palette command box
- dockview integration chrome
- inspector layout
- selection panes

Examples:

- `.ak-app-shell`
- `.ak-palette-shell`
- `.ak-command-box`
- `.ak-inspector`
- `.ak-dockview-frame`

### Optional Additions Later

If it becomes useful, the adapter can later add:

- `@layer`
- Sass for nesting and mixins

But those should remain authoring conveniences, not the styling paradigm itself.

The paradigm should still be:

- token-first
- semantic
- component-owned

## Icon Policy

The icon policy is already clear and should be formalized inside the adapter.

Primary icon sources:

1. `pure-glyf`
2. installed SVG/icon libraries imported through npm and often exposed through `pure-glyf`
3. game images and visual assets from Anarkai itself, especially `assets`, `engines/pixi`, and `engines/ssh`

The adapter should define one normalized icon rendering path so that controls do not each invent their own icon logic.

That renderer should handle:

- glyf icon names
- imported SVG strings
- JSX icon nodes
- game asset-backed visuals

This is especially important for toolbars and palette controls, where some entries are classic icons and some are in-world sprites or resource/building visuals.

## Proposed Folder Structure

### Root

```text
apps/browser/src/ui/anarkai/
  index.ts
  css/
    tokens.css
    base.css
    primitives.css
    palette.css
    dockview.css
    app-shell.css
  icons/
    index.ts
    render-icon.tsx
  theme/
    tokens.ts
    theme.ts
  components/
    Button.tsx
    ButtonGroup.tsx
    RadioButton.tsx
    CheckButton.tsx
    Select.tsx
    SplitButton.tsx
    SplitRadioButton.tsx
    Toolbar.tsx
    Badge.tsx
    Pill.tsx
    Panel.tsx
    InspectorSection.tsx
  palette/
    preset.tsx
    command-box.tsx
    editors.tsx
    types.ts
```

## Folder Roles And Content

### `apps/browser/src/ui/anarkai/index.ts`

Role:

- public entrypoint for the browser-local adapter

Content:

- component exports
- palette preset exports
- theme exports if needed
- CSS entrypoint imports if desired

This file should be the import surface used by browser app code instead of importing from `@sursaut/adapter-pico`.

### `apps/browser/src/ui/anarkai/css/`

Role:

- all adapter-owned styling

Content:

- `tokens.css`: design tokens
- `base.css`: generic base rules relevant to the adapter
- `primitives.css`: buttons, groups, panels, badges, basic controls
- `palette.css`: palette-specific visuals
- `dockview.css`: dockview visual integration
- `app-shell.css`: top-level browser-shell adapter visuals

What should move here over time:

- most of the current style rules in `apps/browser/src/app.css` that are actually skinning adapter controls

What should stay outside:

- app-specific layout rules that are not part of the shared browser visual language

### `apps/browser/src/ui/anarkai/icons/`

Role:

- normalize all icon and asset rendering

Content:

- `render-icon.tsx`: central icon renderer/helper
- `index.ts`: exports and icon-related helper types

Responsibilities:

- accept `pure-glyf` icon names or imported icon strings
- accept JSX icon content
- accept game-backed visuals when needed
- normalize size, baseline alignment, and fallback behavior

This avoids repeated icon branching logic across `Button`, `RadioButton`, palette editors, badges, and resource-like controls.

### `apps/browser/src/ui/anarkai/theme/`

Role:

- bind app theme state to adapter tokens and modes

Content:

- `tokens.ts`: typed token names or token maps if useful
- `theme.ts`: light/dark/system resolution and any browser theme helpers

This is where the conceptual Anarkai design system begins to separate from plain CSS implementation.

### `apps/browser/src/ui/anarkai/components/`

Role:

- adapter component implementations for the browser

Content:

- visual implementations of the headless UI components currently provided by Pico

First-wave components:

- `Button.tsx`
- `ButtonGroup.tsx`
- `RadioButton.tsx`
- `CheckButton.tsx`
- `Toolbar.tsx`
- `Select.tsx`
- `SplitButton.tsx`
- `SplitRadioButton.tsx`

Second-wave components:

- `Badge.tsx`
- `Pill.tsx`
- `Panel.tsx`
- `InspectorSection.tsx`

These components should own:

- DOM structure
- adapter class names
- accessibility semantics
- icon slot conventions
- selected / active / disabled visuals

These components should not own:

- app behavior
- game tool definitions
- browser panel orchestration

### `apps/browser/src/ui/anarkai/palette/`

Role:

- Anarkai browser adapter layer for `@sursaut/ui/palette`

Content:

- `preset.tsx`: `anarkaiPalettePreset`
- `editors.tsx`: editor registry and editor implementations
- `command-box.tsx`: Anarkai command-box UI
- `types.ts`: palette item config types specific to the adapter

This layer replaces the current Pico palette dependency.

It should contain:

- palette editor visuals
- command-box rendering
- adapter-level item configs
- footprint decisions for each editor variant

It should not contain:

- browser app tools
- tool business logic
- app-specific panel bridge callbacks

## What Stays Outside The Adapter

### `apps/browser/src/palette/`

Role:

- browser app palette composition

Content that should stay here:

- palette tool definitions
- browser-specific commands
- `palettePanelBridge`
- toolbar arrangement
- app-specific editor-only items such as clock

What should change:

- this area should stop importing from `@sursaut/adapter-pico`
- it should start importing from `@app/ui/anarkai/palette`

### `apps/browser/src/lib/`

Role:

- browser app behavior and state

Content that should stay here:

- `app-shell-controls`
- globals
- configuration
- selection logic
- app interaction logic

This should not become a styling or adapter home.

### `engines/ssh` and `engines/pixi`

Role:

- domain logic and visual asset definitions

Content that should stay there:

- simulation data
- asset references
- content catalogs
- sprite metadata

The adapter may consume those assets, but the adapter itself should not live in the engines.

## Migration Strategy

### Phase 1. Freeze The Design Contract

Before coding too much, define the visual contract.

Document:

- component inventory
- state vocabulary
- token families
- icon conventions
- density rules
- selected / disabled / warning patterns

The purpose is to avoid rebuilding Pico piece by piece without a coherent Anarkai system.

### Phase 2. Introduce The Adapter Root

Add:

- `apps/browser/src/ui/anarkai/`
- CSS token files
- adapter index
- icon renderer skeleton

At this point the browser app can import the new CSS alongside the old one if needed during transition.

### Phase 3. Build Icon Normalization First

Implement the icon abstraction before rebuilding controls.

Why first:

- every major control depends on icons
- the source mix is known
- icon consistency will influence all spacing and alignment rules

Deliverable:

- one icon rendering path used everywhere in the adapter

### Phase 4. Rebuild Core Controls

Implement:

- `Button`
- `ButtonGroup`
- `RadioButton`
- `CheckButton`
- `Toolbar`

First migration target:

- the top toolbar in `apps/browser/src/App.tsx`

This gives a visible win early and removes the most obvious Pico dependency.

### Phase 5. Rebuild Palette Adapter

Implement:

- `anarkaiPalettePreset`
- `createAnarkaiPaletteEditors`
- `AnarkaiPaletteCommandBox`

Then migrate:

- `apps/browser/src/palette/browser-palette.tsx`

This is the real cutover from Pico to the Anarkai visual language for tool-driven controls.

### Phase 6. Move Styling Out Of `app.css`

Audit the current `apps/browser/src/app.css`.

Split it into:

- app-specific layout rules that should remain app-local
- adapter-owned skinning rules that belong in `apps/browser/src/ui/anarkai/css/`

Target outcome:

- `app.css` no longer contains most of the control skinning logic

### Phase 7. Add Higher-Level Browser Surfaces

Once the basics are stable, add richer surfaces:

- panels
- inspector sections
- framed property groups
- reusable badges / status shells
- resource-like display chips where appropriate

This is where the browser app fully moves from "Pico with overrides" to a coherent game-like interface system.

### Phase 8. Extract Only If A Second Web Consumer Appears

If another web-based consumer appears, for example Proton:

- extract token semantics first
- extract web adapter second

Do not extract prematurely.

The first version should optimize for clarity and speed inside `apps/browser`.

## Minimal First Milestone

The smallest useful migration should be:

1. add `apps/browser/src/ui/anarkai/`
2. add `tokens.css`
3. add icon normalization
4. implement `Button`, `ButtonGroup`, `RadioButton`, `Toolbar`
5. migrate the top app toolbar in `App.tsx`
6. keep Pico for palette temporarily

This gives:

- an immediate Anarkai visual identity for the most visible controls
- a smaller risk than switching the full palette first

## Second Milestone

After the first toolbar migration:

1. add `anarkaiPalettePreset`
2. migrate `browser-palette.tsx`
3. replace Pico palette editor visuals
4. remove `@sursaut/adapter-pico/css` from browser bootstrap

At that point the browser app is functionally off Pico.

## Proposed Import Direction After Migration

### `apps/browser/src/App.tsx`

Should move away from:

- `@sursaut/adapter-pico`

Toward:

- `@app/ui/anarkai`

The app should still keep using headless/shared pieces from Sursaut where appropriate, but the visual control layer should come from the local adapter.

### `apps/browser/src/palette/browser-palette.tsx`

Should move away from:

- `createPicoPaletteEditors`
- `picoPalettePreset`

Toward:

- `createAnarkaiPaletteEditors`
- `anarkaiPalettePreset`

## Design Rules For The Adapter

### Rule 1. Keep Token Names Platform-Agnostic

Good:

- `--ak-surface-panel`
- `--ak-accent-selected`
- `--ak-control-height-compact`

Avoid:

- `--browser-toolbar-bg`
- `--html-select-border`

The point is to keep the design language portable, even though the implementation is browser-only for now.

### Rule 2. Keep Components Semantic

Prefer:

- `Button`
- `Toolbar`
- `Panel`
- `InspectorSection`

Avoid introducing a styling system where the look is assembled manually at every call site.

### Rule 3. Centralize Icon Rendering

Icon and asset rendering should not be duplicated in every component.

One renderer should decide:

- glyph vs svg vs jsx vs game asset
- class names
- size policy
- fallback behavior

### Rule 4. Keep Browser App Logic Separate

The adapter should never absorb:

- selection logic
- game state orchestration
- panel opening behavior
- configuration state definitions

Those belong to app code, not to the adapter.

## Future Extraction Path

If reuse becomes real, split along these lines:

### Shared Design Spec

Possible future package:

```text
packages/anarkai-ui-spec/
```

Role:

- token names and semantics
- component vocabulary
- state and variant vocabulary
- icon conventions

### Web Adapter

Possible future package:

```text
packages/anarkai-adapter-web/
```

Role:

- DOM/CSS implementation of the Anarkai design system

### Platform-Specific Consumers

Examples:

- browser app uses the web adapter directly
- Proton reuses the web adapter if still DOM-based
- native mobile implements its own rendering while following the shared design spec

## Final Recommendation

Start with a browser-local adapter in:

```text
apps/browser/src/ui/anarkai/
```

Use:

- vanilla CSS
- CSS custom properties
- semantic component classes
- centralized icon normalization

Keep:

- palette tool definitions in `apps/browser/src/palette/`
- app behavior in `apps/browser/src/lib/`
- simulation and asset logic in `engines/`

Then migrate in two steps:

1. top toolbar and core controls
2. palette preset and command box

This gives a clean browser-first implementation now while preserving a sane path toward Proton and native later.
