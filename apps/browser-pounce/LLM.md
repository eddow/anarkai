Refer to `pounce-ts/LLM.md` and `pounce-ui/LLM.md` for introduction to the Pounce framework.

# Widget Logic & State Simplification

## Core Principle: Simplify State Management
When designing widgets that interact with global state (like selection), follow these principles:

1.  **Single Source of Truth**: Avoid duplicating global state into local state. If a widget needs to know about a global selection, read it directly or derive it reactively from parameters.
    - *Example (Selection Info)*: Instead of a local `isPinned` boolean, simply check if `props.params.uid` is populated.
2.  **Avoid Redundant Synchronization**: Do not create generic "sync" effects that just copy values from A to B. `mutts` / `pounce` reactivity allows you to use the values directly.
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