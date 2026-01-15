# engine-pixi

**engine-pixi** is the PixiJS-based rendering backend for the **ssh** game engine within the Anarkai workspace. It bridges the logical game state provided by `ssh` with a high-performance 2D WebGL renderer.

## Overview

This package provides a concrete implementation of the `GameRenderer` interface defined in `ssh`. It manages the PixiJS `Application`, handles asset loading, and synchronizes game state changes to visual representations using reactive bindings.

### Key Components

- **`PixiGameRenderer`**: The main class that initializes the Pixi application, manages scene layers, and acts as the central hub for rendering logic.
- **`VisualFactory`**: responsible for observing the game state (e.g., population changes, board setup) and spawning the appropriate `VisualObject` wrappers.
- **`VisualObject`**: Base class for entity renderers (e.g., `CharacterVisual`, `TileVisual`) that bind to specific `GameObject`s.
- **`AssetManager`**: handlers loading and caching of sprite sheets and textures.

## Architecture

The renderer organizes the scene into Z-sorted layers:

1.  **Ground** (Z=0): Terrain tiles.
2.  **Alveoli** (Z=10): Structures and buildings.
3.  **Resources** (Z=20): Raw resources on the map.
4.  **Stored Goods** (Z=30): Goods stored in buildings or borders.
5.  **Loose Goods** (Z=40): Items moving or on the ground.
6.  **Characters** (Z=50): Agents and NPCs.
7.  **UI**: Overlay interface (screen space).

## Usage

To use the renderer in an application (e.g., a browser game client), you need to instantiate it with a running `Game` instance and a DOM element container.

```typescript
import { PixiGameRenderer } from 'engine-pixi';
import { Game } from 'ssh';

// ... setup your game instance ...

const container = document.getElementById('game-view');
const renderer = new PixiGameRenderer(game, container);

// The renderer will automatically initialize, load assets, and start rendering.
```

### Vite Integration

This package exports a Vite plugin to correctly serve and build the static assets located in the `assets/` directory.

**vite.config.ts** (in your consumer app):

```typescript
import { servePixiAssets } from 'engine-pixi/vite-plugins';

export default defineConfig({
  plugins: [
    // ... other plugins
    servePixiAssets()
  ]
});
```

This ensures that assets requested via `/pixi-assets/` are served correctly during development and copied to the output directory during build.

## Development

-   **`pnpm dev`**: Start the dev server (Vite).
-   **`pnpm build`**: Type-check and build (TSC).
-   **`pnpm test`**: Run unit tests (Vitest).

## Dependencies

-   **`pixi.js`**: Core rendering library.
-   **`mutts`**: Reactive state management used to bind game logic to visuals.
-   **`ssh`**: The core game engine (workspace dependency).

# TODO

- goods "in vehicle" are not visible