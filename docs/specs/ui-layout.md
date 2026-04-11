# Browser UI Layout

This document describes the current browser-side inspection model and the near-term panel shape worth preserving.

It is intentionally narrower than a full UI spec. Older notes tied to `browser-vue` and Vue-specific file names are obsolete and should not be treated as current architecture.

## Current Application Shape

`apps/browser` is the active client.

The main UI building blocks are:

- a playable game view backed by Pixi
- Dockview-based panels
- selection-driven inspection widgets
- palette and editor-style tooling around the simulation

Layout state is expected to remain persistent and user-rearrangeable.

## Inspection Model

The inspection system follows a dynamic-versus-pinned pattern.

### Dynamic inspector

- there is one main "last selected" inspector
- it updates whenever selection changes
- it should display the selected object without needing local mirror state

### Pinned inspector

- a pinned panel is just an inspector with stable widget params
- it does not follow subsequent global selection changes
- it should be creatable from the dynamic inspector

This matches the current browser widget guidance: use widget params as the differentiator rather than inventing extra UI registries or duplicate state.

## Expected Inspector Content

The first-level content types remain:

- tile inspection
- character inspection
- alveolus inspection
- fallback debug information when a richer view does not exist yet

Near-term addition:

- hive overview as an alternate lens from an alveolus-centric selection

That hive view should initially be read-only and focused on understanding the network:

- alveoli in the hive
- aggregate demand/provide balance
- visible bottlenecks or stalled pressure

It should not become a large configuration surface in the first version.

## Panel Behavior Principles

The current browser docs imply a few rules worth keeping explicit:

- derive panel content from selection and widget params whenever possible
- avoid manual sync effects that copy global state into local state
- keep Dockview lifecycle simple and reactive
- let titles flow from widget content back into Dockview when needed

## Toolbar Direction

The exact toolbar composition will continue to evolve, but these capabilities remain central:

- simulation controls
- selection mode
- build placement
- zone painting
- panel visibility

Future toolbar work should follow the actual browser implementation rather than old framework-specific notes.
