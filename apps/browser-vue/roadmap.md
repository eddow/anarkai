# ssh-vue port evaluation + roadmap

## Scope / baseline

This evaluation compares `ssh-vue` (Vue 3 + Vite) to the current reference UI in `ssh/src/app` (Pounce UI + Dockview).

The intent of the port appears to be:

- Keep **core game logic** in `ssh/src/lib` (reused via aliases like `@ssh/lib/*` and `$assets/*`).
- Replace the **UI layer** (`ssh/src/app/*`) with Vue components.

## Current state (what is already ported)

### Application shell

- **Vite + Vue 3 bootstrap** exists (`src/main.ts`), and initializes `@ssh/lib/i18n` via `initTranslator()`.
- **Docking layout framework** exists (`src/components/Dockview.vue`) using `dockview-core` directly.
  - Vue apps are mounted per panel and properly unmounted when panels dispose.
- **Toolbar** is implemented in Vue (`src/App.vue`) with:
  - Time controls (`configuration.timeControl`) wired.
  - Interaction mode selection (`interactionMode.selectedAction`) wired.
  - Build actions derived from `$assets/game-content` (alveoli) wired.
  - Zoning actions wired.
  - Dark mode toggle wired (`configuration.darkMode`) and mirrored to `document.documentElement[data-theme]`.
- **Layout persistence** is wired via `@ssh/lib/globals`:
  - `getDockviewLayout()` used for initial layout.
  - `dockviewLayout.sshLayout` updated on layout changes.

### Widgets

- **Game widget** exists (`src/widgets/GameWidget.vue`):
  - Creates a `GameView` once `game.loaded` resolves.
  - Destroys `GameView` on unmount.
- **Configuration widget** exists (`src/widgets/ConfigurationWidget.vue`):
  - Can update `configuration.timeControl`.

### Tests

- **Playwright smoke tests** exist (`tests/smoke.spec.ts`) verifying:
  - App loads.
  - Dockview and toolbar render.
  - Dark mode toggle changes `data-theme`.

## Parity check vs `ssh/src/app`

Reference widget list in `ssh/src/app/widgets/index.ts`:

- `game`
- `configuration`
- `selection-info`

### What matches well

- **Overall shell structure** is very close to `ssh/src/app/App.tsx`:
  - Toolbar sections and actions are substantially equivalent.
  - Dockview-based workflow and saved layout concept are present.
  - `mutts` globals (`configuration`, `games`, `interactionMode`) are reused as intended.

### Major missing features / regressions

#### 1) Selection inspector panel (`selection-info`) is not ported

- In the reference app:
  - There is a `selection-info` widget.
  - The toolbar has an info button to open it.
  - The selection panel is also auto-opened when in “select mode”.
- In `ssh-vue`:
  - The toolbar includes the info icon button but it does **not** open a panel.
  - No Vue widget exists for `selection-info`.
  - No wiring exists to keep `selectionState.panelId` and `selectionState.selectedUid` in sync.

This is the biggest visible missing feature because it is the primary inspector/debug UI.

#### 2) Game interaction wiring is incomplete

In the reference `ssh/src/app/widgets/game.tsx`, the game widget registers game event handlers:

- **Click**:
  - If action is `build:*`, build on tiles.
  - If action is `zone:*`, zone/unzone.
  - Else, set selection (`selectionState.selectedUid`) and open/update the selection panel.
- **Drag**:
  - Zoning drag on tiles.

In `ssh-vue/src/widgets/GameWidget.vue`:

- A `GameView` is created, but there is no equivalent wiring to:
  - Subscribe/unsubscribe to `game.on(...)` / `game.off(...)` with the game events.
  - Apply build/zoning actions.
  - Update `selectionState` and manage the selection panel.

Net: you can render the game, but not drive the core “click-to-interact” loop the reference UI has.

#### 3) Configuration widget parity

The reference configuration widget includes:

- Dark mode toggle (delegated through scope/theme).
- Time control radios.

The Vue configuration widget currently:

- Only provides time control radios.

Dark mode exists in the toolbar already, so this is not blocking, but it is a parity gap.

#### 4) Resize / lifecycle parity for GameView

The reference game widget reacts to dockview size updates and resizes the Pixi renderer.

The Vue version does not obviously handle dockview panel resizing. Depending on how `GameView` is implemented, this may cause:

- Incorrect canvas sizing after panel splits/resizes.
- Rendering artifacts.

#### 5) Selection state validation

The reference code calls `validateStoredSelectionState(api)` after mounting the game view to avoid stale `selectionState.panelId`.

The Vue port currently doesn’t validate selection state against Dockview.

## Architectural notes / risks

### 1) Vue reactivity vs `mutts` reactivity

`ssh-vue` bridges `mutts` state into Vue using `mutts` `effect(...)` inside `App.vue`.

- This is a workable approach.
- But it creates a **two-reactivity-systems** environment.

Risks to watch for:

- Vue components that read `mutts` state directly (without a `mutts` `effect`) may not update.
- Watchers/effects must be properly disposed to avoid leaks.

Recommendation:

- Standardize on one pattern:
  - Either wrap reads in `mutts` `effect` and copy into Vue refs, or
  - Provide a small adapter utility to convert `mutts` reactive values into Vue refs/computed.

### 2) Dockview integration differences

The Vue Dockview wrapper mounts each widget as an independent Vue app.

Pros:

- Good isolation.
- Clean teardown via `app.unmount()`.

Risks:

- Passing `params`, `api`, `container` must be consistent across widgets.
- If you want feature parity with the reference `Dockview` wrapper (from `pounce-ui/src`), you may want a shared “widget contract” (props schema).

### 3) Workspace linking / build portability

`ssh-vue` depends on sibling repos via `file:../ssh`, `file:../mutts`, etc., plus `preserveSymlinks: true` and `server.fs.allow: ['..']`.

This works for local dev but may complicate:

- CI builds.
- Deploying as a standalone package.

That’s fine short-term, but should be called out as an explicit constraint.

## Recommended roadmap (prioritized)

### Milestone 0: Define port target (decision)

- **Goal**: confirm whether `ssh-vue` is intended to become the default UI.
- **Output**:
  - “Port target” statement (feature parity target vs experimental playground).
  - Clarify whether to keep using `dockview-core` or adopt a Vue dockview wrapper.

### Milestone 1: Restore core interaction loop (blocking parity)

- **Add `selection-info` widget** in Vue.
  - Port logic from `ssh/src/app/widgets/selection-info.tsx`.
  - Port `CharacterProperties` / `TileProperties` views (or embed minimal equivalents first).
- **Wire the toolbar info button** to open/focus selection panel.
- **Auto-open selection panel** when `interactionMode.selectedAction === ''` (matches reference behavior).
- **Update `GameWidget` to register game events**:
  - `objectClick` (selection/build/zone).
  - `objectDrag` (zoning drag).
  - Maintain `selectionState.selectedUid`.
  - Create or update selection panel via dockview `api`.
- **Validate stored selection state** when dockview API is ready / game mounts.

Acceptance criteria:

- Clicking tiles/objects updates the inspector.
- Building and zoning actions work like the reference.
- Drag-zoning works.

### Milestone 2: Lifecycle correctness / UX parity

- **GameView resize support** on dockview panel resize.
  - Either observe dockview size events, or use `ResizeObserver` on the container.
- **Configuration widget parity**:
  - Dark mode toggle in config panel (optional, but easy parity win).
- **Layout defaults**:
  - If no saved layout, open game panel + selection panel (or match reference default behavior precisely).

### Milestone 3: Quality + dev experience

- Extend Playwright tests:
  - Ensure game panel opens.
  - Ensure selection panel opens.
  - Click an object and assert the selection panel updates.
  - Toggle build mode and click tile to assert a build state change (if testable).
- Add basic error boundaries / better console logging around widget mount failures.

### Milestone 4: Packaging / build stability

- Document assumptions about sibling repo layout.
- Decide whether `ssh-vue` is meant to:
  - Stay as a workspace app, or
  - Become a distributable package.

## Quick “port status” summary

- **Shell / layout / toolbar**: mostly ported.
- **Game rendering**: ported (basic mount/unmount).
- **Core interactions (select/build/zone/drag)**: not yet ported.
- **Selection inspector**: not yet ported.
- **Tests**: basic smoke coverage exists.
