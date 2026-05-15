# @sursaut/ui LLM Cheat Sheet

Read [sursaut core's LLM](../core/LLM.md) and [kit's LLM](../kit/LLM.md).

## Overview

**Headless** UI primitives for Sursaut applications. Zero styling, zero class names, zero opinions on CSS frameworks. Provides:
- Behavioral logic (state, a11y, event handling) via composable `*Model` functions
- Shared prop interfaces that adapters extend
- Icon registration via `options.iconFactory`
- `uiComponent` factory for variant typing + dot-syntax
- `options` object for global configuration
- RTL/LTR awareness via logical CSS properties (`order`, `marginInline*`) — no physical side resolution needed

## Architecture: Adapter as Front

**Old model (adapted-ui)**: App → `@sursaut/ui` Button → checks adapter registry → falls back to vanilla classes.

**New model**: App → `@sursaut/pico` Button → uses `buttonModel()` from `@sursaut/ui` → zero styling.

```
@sursaut/ui (headless)
  └── buttonModel(props) → { button: { onClick, disabled, aria-label, ... }, icon: { position, span, element }, ... }

@sursaut/pico (styled)
  └── Button = picoComponent(function Button(props) {
        const model = buttonModel(props)
        return (
          <button class="btn" {...model.button} {...props.el}>
            {model.icon && <span {...model.icon.span}>{model.icon.element}</span>}
            {model.hasLabel && gather(props.children)}
          </button>
        )
      })
```

## `env.dc` — DisplayContext

`@sursaut/kit` injects a `DisplayContext` into the Sursaut `Env` under the key `dc`.
Components and hooks access it as `env.dc`. It carries:
- `direction: 'ltr' | 'rtl'`
- `theme: string`
- `locale: string`
- `timeZone: string`

The `Icon` component receives `env` and passes `env.dc` to `iconFactory`.

`uiComponent` forwards `env` to the wrapped component automatically.

Models do **not** take `env` — direction-awareness is handled via logical CSS, not `env.dc`.

## `options` Object

Single mutable config object.

```ts
import { options } from '@sursaut/ui'
options.iconFactory = (name, size, el, dc) => <i class={`icon-${name}`} />
```

**Fields:**
- `options.iconFactory: IconFactory | undefined` — `(name, size, context: DisplayContext) => JSX.Element`. Falls back to `<span data-icon>` if unset.

## `uiComponent` — Variant Factory

Curried factory. Call once per adapter with the variant list; wrap each component with the result.

```ts
const picoComponent = uiComponent(['primary', 'secondary', 'danger', 'ghost'] as const)

export const Button = picoComponent(function Button(props) {
  const model = buttonModel(props)
  return <button class={`btn btn-${props.variant ?? 'secondary'}`} {...model.button} {...props.el}>{gather(props.children)}</button>
})

// Usage — both equivalent:
<Button variant="primary">Save</Button>
<Button.primary>Save</Button.primary>
```

**What it does:** narrows `props.variant`, adds dot-syntax accessors, forwards `env`, dev-mode unknown-variant error.

**What it does NOT do:** variant-to-attrs mapping, class generation, theme handling — all adapter concerns.

## Model Pattern

Each component domain exports a `*Model` function returning a plain object of lazy getters.
The model groups spreadable attrs by **target element** — adapters spread them directly:

```ts
export function buttonModel(props: ButtonProps): ButtonModel {
  const model: ButtonModel = {
    get hasLabel() { ... },
    get isIconOnly() { return !!props.icon && !model.hasLabel },
    get icon() {
      // undefined when no icon; otherwise: { position, span, element }
    },
    get button(): JSX.IntrinsicElements['button'] {
      return {
        get onClick() { return props.disabled ? undefined : props.onClick },
        get disabled() { return props.disabled || undefined },
        get 'aria-label'() { ... },
        get 'aria-disabled'() { ... },
      }
    },
  }
  return model
}

// Adapter:
const model = buttonModel(props)
<button {...model.button} {...props.el} class={...}>
```

All properties are **getters** — no reactive reads at model call time. Safe to call in component body.

Spread group types use `JSX.IntrinsicElements['tagname']` (not `BaseHTMLAttributes`) — this includes element-specific attrs like `disabled` on `<button>`.

Self-references inside getters use the named `model` variable, not `this` (object literal arrow functions lose `this`).

**Element group naming convention:**
| Model | Spread group | Target element |
|---|---|---|
| `buttonModel`, `checkButtonModel`, `radioButtonModel` | `model.button` | `<button>` |
| `checkboxModel`, `radioModel`, `switchModel` | `model.input` + `model.label` | `<input>` + `<label>` |
| `accordionModel` | `model.details` | `<details>` |
| `progressModel` | `model.progress` | `<progress>` |

## RTL/LTR — Logical CSS Only

`buttonModel` exposes `model.icon.position: 'start' | 'end'` — logical, never physical.
The model sets `order: -1` (start) or `order: 1` (end) on the icon `<span>` via `model.icon.span`.
Legacy `'left'`/`'right'` inputs are normalized to `'start'`/`'end'` inside the model.
Logical margins (`marginInlineEnd`/`marginInlineStart`) are set by the model when a label is present.

`shared/utils.tsx` still exports `relativeSide(dc, side)` for legacy adapters only — do not use in new code.

See `src/models.md` for the full recipe before creating/modifying models.

## Entry Points

| Import | Who uses it | What it exports |
|---|---|---|
| `@sursaut/ui` | App consumers | Complete components (`InfiniteScroll`) + everything in `./internal` |
| `@sursaut/ui/internal` | Adapter authors | Models, props types, `uiComponent`, `gather`, `options`, directives, overlays, shared types/utils |

Adapters should import from `@sursaut/ui/internal` rather than `@sursaut/ui` to make the dependency boundary explicit.

## Source Map

```
src/
├── index.ts          # Barrel export — single entry point, tree-shakeable
├── options.ts        # options.iconFactory, IconFactory type
├── component.ts      # uiComponent factory, UiComponent/WithVariant types
├── icon.tsx          # <Icon> component (uses env.dc + options.iconFactory)
├── button.tsx        # ButtonProps, ButtonModel, buttonModel(props) — JSX for icon rendering
├── checkbox.ts       # CheckboxProps, RadioProps, SwitchProps, checkboxModel, radioModel, switchModel
├── checkbutton.ts    # CheckButtonProps, CheckButtonModel, checkButtonModel
├── radiobutton.ts    # RadioButtonProps, RadioButtonModel, radioButtonModel
├── accordion.ts      # AccordionProps, AccordionModel, AccordionGroupProps, accordionModel
├── progress.ts       # ProgressProps, ProgressModel, progressModel
├── options.tsx       # SelectProps, ComboboxProps, SelectModel, ComboboxModel, selectModel, comboboxModel
├── layout.ts         # SpacingToken, stackModel, inlineModel, gridModel, containerModel, appShellModel
│                     # + spacingValue, alignItemsValue, justifyContentValue helpers
├── nav.ts            # setupButtonGroupNav, setupToolbarNav (DOM keyboard nav utilities)
├── status.ts         # BadgeProps, PillProps, ChipProps, badgeModel, pillModel, chipModel
├── typography.ts     # HeadingProps, TextProps, LinkProps, headingModel, textModel, linkModel
├── multiselect.ts    # MultiselectProps<T>, MultiselectModel<T>, multiselectModel
├── stars.ts          # StarsProps, StarsModel, starsModel
├── directives.ts     # resize, scroll, intersect, loading, pointer, floatingBadge, tail
├── overlays.ts       # OverlaySpec, OverlayEntry, createOverlayStack, applyTransition, trapFocus,
│                     # applyAutoFocus, dialogSpec, toastSpec, drawerSpec, bindDialog, bindToast, bindDrawer
├── menu.ts           # MenuProps, MenuModel, menuModel, menuItemModel, menuBarModel
├── shared/
│   ├── types.ts      # DisableableProps, VariantProps, IconProps, CheckedProps, ...
│   └── utils.tsx     # generateId, isDev, gather, relativeSide, LogicalSide, PhysicalSide
└── components/
    └── infinite-scroll.tsx # InfiniteScroll<T> component — self-contained virtualized list
                            # Fixed-height fast path + variable-height ResizeObserver + prefix-sum offset table
                            # Props: items, itemHeight, estimatedItemHeight, stickyLast, children(item,index)
```

Each component file is self-contained: types + hook + helpers in one file. No per-component subdirectories.

## Directives

Directives are plain DOM functions — not hooks. They follow the Sursaut `use:name={value}` directive signature:
`(target: Node | Node[], value: T, scope?: Record<PropertyKey, unknown>) => (() => void) | undefined`

`sizeable()` intentionally waits for parent insertion instead of gating setup on `element.isConnected`: browser `use={...}` can run before the element has a parent, and the resize handle must be inserted once the sibling layout exists.

| Directive | Value type | Description |
|-----------|-----------|-------------|
| `resize` | `(w,h)=>void` or `{width?,height?}` | ResizeObserver wrapper |
| `scroll` | `{x?: ScrollAxis, y?: ScrollAxis}` | Scroll position tracking + max |
| `intersect` | `IntersectOptions` | IntersectionObserver wrapper |
| `loading` | `boolean` | Sets aria-busy, disables form elements |
| `pointer` | `{value: PointerState\|undefined}` | Pointer events (down/move/up/leave) |
| `floatingBadge` | `string\|number\|JSX.Element\|FloatingBadgeOptions` | Floating badge overlay |
| `tail` | `boolean?` | Scroll-to-bottom trailing |

## Nav Utilities

`setupButtonGroupNav(container, options?)` and `setupToolbarNav(container, options?)` are pure DOM utilities
called from a `use=` mount callback. They return a cleanup function.

- **ButtonGroupNav**: Arrow-key cycling within group, Tab exits to next focusable outside
- **ToolbarNav**: Arrow-key cycling within segment, Tab moves between segments (or exits)

## ⚠️ Gotchas

1. **Models can produce JSX**: Model files that render JSX (e.g. icon elements) use `.tsx` extension. The model owns icon rendering; adapters just spread `model.icon.span` and render `model.icon.element`.
2. **Reactive getters**: All model properties are getters — never read them at model call time.
3. **Variant is a string**: `props.variant` is always the string name. The adapter maps it to classes/attrs.
4. **`uiComponent` is curried**: First call takes the variant list, second call takes the component function.
5. **`env` in models**: Models do not take `env`. Direction-awareness uses logical CSS (`order`, `marginInline*`). Only `Icon` component still uses `env.dc`.
6. **`model.icon` is a group**: `model.icon` is `undefined` when no icon, otherwise `{ position, span, element }`. Use `model.hasLabel` to guard `gather(props.children)`.
7. **Spread groups**: Each model exposes element-keyed spread groups (`model.button`, `model.input`, `model.label`, etc.). Adapters spread them directly: `<button {...model.button} {...props.el}>`.
8. **`gather` for children**: Always wrap `props.children` with `gather()` in adapters that also render an icon — CSS `order` requires a single flex item.
9. **`JSX.IntrinsicElements['tag']` for spread types**: Use this, not `BaseHTMLAttributes<T>` — the latter omits element-specific attrs like `disabled`.
10. **Button/RadioButton icon prop**: Use the `icon` prop directly on Button/RadioButton components for icon-only buttons. The model handles icon rendering internally. **Do NOT wrap icons manually** - this causes "false" text display issues.
11. **Tooltip pattern**: Use `el:title` for tooltips on Button/RadioButton components. The `el:` prefix passes attributes to the underlying element.

### Button/RadioButton Icon Usage

```tsx
// ✅ CORRECT - Use icon prop directly
<Button icon="star" el:title="Star" aria-label="Star" />
<RadioButton value="star" group={selected} icon="star" el:title="Select star" />

// ❌ WRONG - Manual icon wrapping causes issues
<Button el:title="Star">
  <Icon name="star" />  {/* This creates "false" text display */}
</Button>
```

### Tooltip Pattern

```tsx
// ✅ CORRECT - Use el:title for tooltips
<Button icon="settings" el:title="Open Settings" onClick={openSettings} />

// ✅ ALSO CORRECT - For complex tooltips
<Button 
  icon="settings" 
  el:title={{ text: "Open Settings", placement: "bottom" }}
  onClick={openSettings} 
/>
```
