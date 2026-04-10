# engine-pixi

`engine-pixi` is the rendering backend for Anarkai.

It is responsible for:

- continuous terrain sector rendering
- entity visuals for board content, characters, and goods
- asset loading
- reacting to `ssh` state without owning gameplay rules
- requesting SSH frontier materialization for visible missing tiles

## Role In The Stack

- `engine-terrain` is a pure generator library used by `ssh`
- `ssh` owns authoritative terrain and gameplay state
- `engine-pixi` renders SSH-owned terrain and other world objects

## Current Direction

`engine-pixi` may track visible sectors and ask `ssh` to materialize missing frontier tiles, but it does not generate terrain or keep a private terrain snapshot. The renderer waits for SSH-owned board state, then draws exactly what SSH materialized.

## Docs

- `docs/render-layers.md`: world RenderLayer architecture, attachment rules, and migration notes
