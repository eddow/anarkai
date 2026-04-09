# engine-pixi

`engine-pixi` is the rendering backend for Anarkai.

It is responsible for:

- continuous terrain sector rendering
- entity visuals for board content, characters, and goods
- asset loading
- reacting to `ssh` state without owning gameplay rules

## Role In The Stack

- `engine-terrain` generates terrain data
- `ssh` decides gameplay state
- `engine-pixi` turns both into the visible world

## Current Direction

The renderer should keep visual-sector ownership and visibility reporting, while gameplay frontier policy continues moving into `ssh`.

## Docs

- `docs/render-layers.md`: world RenderLayer architecture, attachment rules, and migration notes
