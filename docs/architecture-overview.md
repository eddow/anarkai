# Architecture Overview

## System Context

Anarkai is a modular system composed of a shared game engine, reusable libraries, and multiple frontend consumers (clients). The architecture emphasizes separation of concerns between core logic, state management, and rendering/UI.

## Dependency Graph

```mermaid
graph TD
    subgraph Apps
        BP[browser-pounce]
        BV[browser-vue]
    end

    subgraph Engines
        SSH[ssh (Game Engine)]
    end

    subgraph Packages
        M[mutts]
        NPC[npcs]
        I18N[omni18n]
        PTS[pounce-ts]
        PUI[pounce-ui]
    end

    %% Dependencies
    BP --> PUI
    BP --> PTS
    BP --> SSH
    
    BV --> SSH
    BV --> M
    
    SSH --> M
    SSH --> NPC
    SSH --> I18N
    
    PUI --> PTS
    PUI --> M
    
    PTS --> M
    
    NPC --> M
    
    I18N --> M
```

## Core Components

### 1. Reactivity Layer (`mutts`)
At the heart of the system lies `mutts`, the reactivity engine. It powers state management in the game engine, the Pounce framework, and even the Vue integration shim.

### 2. Game Engine (`ssh`)
The `ssh` engine encapsulates the domain logic. It depends on `mutts` for state, `npcs` for AI/behavior, and `omni18n` for text. It abstracts the game rules and state from the specific rendering technology, though it currently leverages PixiJS.

### 3. Framework Layer (`pounce-ts`)
`pounce-ts` is a custom UI framework built on top of `mutts`. It offers a JSX-based component model similar to React or Solid but with direct DOM manipulation and fine-grained reactivity.

### 4. UI Layer (`pounce-ui`)
Built on `pounce-ts`, this library provides the concrete UI widgets (buttons, panels, etc.) used by the `browser-pounce` application.
