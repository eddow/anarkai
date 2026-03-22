# Project Inventory

## 📱 Applications

### [browser](../apps/browser)
**Type**: Web Application
**Tech Stack**: Vite, Sursaut-TS
**Description**: browser is a web client implementation using the custom Sursaut-TS framework.

### [browser-vue](../apps/browser-vue)
**Type**: Web Application
**Tech Stack**: Vue 3, Vite, Mutts
**Description**: browser-vue is an alternative web client implementation using Vue 3, integrating with the shared game logic.

## 🎮 Engines

### [ssh](../engines/ssh)
**Type**: Game Engine
**Tech Stack**: TypeScript, PixiJS, Mutts
**Description**: The core game engine ("ssh") responsible for game logic, rendering (via PixiJS), and state management. It serves as the backbone for the client applications.

## 📦 Shared Packages

### [mutts](../packages/mutts)
**Type**: Library (Core)
**Description**: A comprehensive reactive programming library providing the foundation for state management across the project. Features include reactive objects, intropection, and signal-like behavior.

### [npcs](../packages/npcs)
**Type**: Library (Game System)
**Description**: Handles NPC (Non-Player Character) logic, including script execution, behavior trees, or task execution. It likely includes the `npc-script` system mentioned in dependencies.

### [omni18n](../packages/omni18n)
**Type**: Library (i18n)
**Description**: A full-stack internationalization library supporting locales, zones, and dynamic loading. Used for translating the application interface and game content.

### [sursaut-ts](../packages/sursaut-ts)
**Type**: Library (Framework)
**Description**: A custom, lightweight reactive web framework built with TypeScript and JSX. It leverages `mutts` for reactivity and avoids a virtual DOM for performance.

### [sursaut-ui](../packages/sursaut-ui)
**Type**: Library (UI Components)
**Description**: A collection of reusable UI components built using `sursaut-ts` and `pico.css`. Provides the visual building blocks for the Sursaut-based client.
