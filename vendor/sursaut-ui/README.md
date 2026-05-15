# @sursaut/ui

Headless UI primitives for Sursaut applications.

`@sursaut/ui` owns behavior, accessibility, reactive bindings, and low-level interaction logic. It does **not** own styling. Adapters consume these models and render the actual markup and classes.

## What this package exports

`@sursaut/ui` currently exposes four kinds of API:

- **Headless models**
  - `buttonModel`, `checkboxModel`, `radioModel`, `switchModel`
  - `checkButtonModel`, `radioButtonModel`
  - `accordionModel`
  - `selectModel`, `comboboxModel`
  - `multiselectModel`
  - `menuModel`, `menuItemModel`, `menuBarModel`
  - `progressModel`
  - `starsModel`
  - `badgeModel`, `pillModel`, `chipModel`
  - `headingModel`, `textModel`, `linkModel`
  - `themeToggleModel`
  - `dialogModel`, `drawerModel`, `toastModel`
  - `stackModel`, `inlineModel`, `gridModel`, `containerModel`, `appShellModel`
  - `withOverlaysModel`

- **Components**
  - `Dockview`
  - `InfiniteScroll`

- **Directives**
  - `badge`, `intersect`, `loading`, `pointer`, `resize`, `scroll`, `sizeable`, `tail`

- **Utilities**
  - `uiComponent`
  - `options`
  - `Icon`
  - overlay helpers from `./overlays`

## Architecture

`@sursaut/ui` is the headless layer. Adapters sit on top and decide the visual language.

```tsx
import { buttonModel } from '@sursaut/ui'

export const Button = (props) => {
	const model = buttonModel(props)
	return (
		<button class={`btn btn-${props.variant ?? 'secondary'}`} {...model.button} {...props.el}>
			{model.icon && <span {...model.icon.span}>{model.icon.element}</span>}
			{props.children}
		</button>
	)
}
```

### Model pattern

Models return plain objects of **lazy getters**.

- **No styling**
- **No adapter-specific markup opinions**
- **Reactive reads happen inside getters, not at model construction time**
- **Element props are grouped by target** (`model.button`, `model.input`, `model.details`, ...)

This makes models safe to construct in component bodies while preserving reactivity when adapters spread the returned groups.

## Quick start

```tsx
import { buttonModel, checkboxModel } from '@sursaut/ui'

function Demo(props) {
	const button = buttonModel(props.button)
	const checkbox = checkboxModel(props.checkbox)

	return (
		<div>
			<button {...button.button}>
				{button.icon && <span {...button.icon.span}>{button.icon.element}</span>}
				{props.button.children}
			</button>
			<label style="display: inline-flex; align-items: center; gap: 8px;">
				<input {...checkbox.input} />
				{props.checkbox.children}
			</label>
		</div>
	)
}
```

## Public surface by category

### Models

See [docs/models.md](./docs/models.md).

### Components

See [docs/components.md](./docs/components.md).

### Directives

See [docs/directives.md](./docs/directives.md).

### Topic guides

- [Button](./docs/button.md)
- [Checkbox / Radio / Switch](./docs/checkbox.md)
- [Select / Combobox](./docs/select.md)
- [Overlays](./docs/overlay.md)

## Utilities

### `uiComponent`

Curried helper for adapter authors. It narrows `variant`, adds dot-syntax variant accessors, and validates variants in development.

```tsx
import { uiComponent } from '@sursaut/ui'

const picoComponent = uiComponent(['primary', 'secondary', 'danger'] as const)
```

### `options`

Global mutable configuration for the package.

Today the main hook is `options.iconFactory`, used by `<Icon>` and by models that resolve string icon names.

### `Icon`

Thin wrapper around `options.iconFactory`. Falls back to a plain `<span data-icon>` if no icon factory is installed.

## Development

### Run the demo

```bash
pnpm demo
```

The UI demo server runs on port `5270`.

### Run tests

```bash
pnpm test
pnpm test:e2e
```

### Build

```bash
pnpm build
```

## Documentation map

- [Button](./docs/button.md)
- [Checkbox / Radio / Switch](./docs/checkbox.md)
- [Select / Combobox](./docs/select.md)
- [Overlays](./docs/overlay.md)
- [Directives](./docs/directives.md)
- [Models catalogue](./docs/models.md)
- [Components catalogue](./docs/components.md)
- [Model recipe](./src/models/models.md)

## License

MIT
