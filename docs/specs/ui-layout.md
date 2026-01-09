# UI Layout Specification

## 1. Overview
The **browser-vue** application uses a **Dockview-based** layout system to provide a flexible, persistent workspace.
The state of the layout is persisted in `localStorage`.

## 2. Toolbar
**Location**: Top of screen (or left side).
**Behavior**: Persistent, always visible.

### Controls
| Section | Widgets | Requirements |
| :--- | :--- | :--- |
| **View Control** | `Game`, `Config`, `Info` | Toggle visibility of main panels. |
| **Speed** | `Play`, `Pause`, `FastForward` | Control simulation loop. |
| **Selection** | `Select` | Default interactions mode |
| **Build** | `ResourceImage` buttons | Place building orders (Alveoli) |
| **Zones** | `Harvest`, `Residency`, `Shop` | Paint functional zones on map. |
| **System** | `ThemeToggle` | Switch light/dark mode. |

## 3. Inspection System (Property Panels)

The inspection system follows a "Last Selected" vs "Dedicated" paradigm to manage multiple object contexts.

### A. Hover Context
- **Trigger**: Mouse over object.
- **Visual**: Highlights object in game view.
- **Data**: Updates `mrg.hoveredObject`.

### B. Last Selected Widget (`id: 'info'`)
- **Behavior**: A single, dynamic panel that updates content whenever a new object is clicked.
- **Title**: "Information" or Object Name.
- **Toolbar Actions**:
    - 👁️ **Pin**: Converts this transient panel into a dedicated one.
    - 📍 **GoTo**: Centers camera on object.
- **Content**:
    - `TileProperties` (if Tile)
    - `CharacterProperties` (if Character)
    - `JSON Debug View` (Fallback)

### C. Dedicated Widgets (`id: 'pinned:{uid}'`)
- **Behavior**: A specific panel locked to one object UID. Does NOT update on new clicks.
- **Title**: Object Name.
- **Creation**: Spawned when "Pin" is clicked in the Last Selected widget.
- **Closing**: Standard Dockview tab close.

## 4. Widget Architecture
All widgets are managed by `App.vue` using `Dockview`.

- **Registry**: `apps/browser-vue/src/widgets/index.ts` map component names to Vue components.
- **State Sync**: `useMuttsEffect` in `App.vue` watches `selectionState` to auto-open/focus widgets.
- **Parameters**: `Dockview.vue` supports passing `params` (e.g., `{ uid: "123" }`) to widget instances during creation or update.
