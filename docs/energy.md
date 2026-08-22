# Energy

Energy powers buildings and vehicles. This document records the decided model for how it is produced,
carried, and distributed.

## Sources

Energy sources are ordinary alveoli:

- a **water wheel** (built beside water) produces rotational energy;
- a **stationary engine** transforms fuel → kinetic;
- a **generator** transforms kinetic → electricity.

Two kinds of energy:

- **Hauled** — fuel is an ordinary good, consumed as a transform input with a per-input usage rate
  ("1 can → X planks").
- **Continuous providers** — electricity, compressed air, kinetic rotation — carried over a **cable/grid**,
  where **instantaneous production must match instantaneous consumption**.

## Topology

- Cables are **road-like tile-border entities** — carried on the same borders roads use, not tile
  content.
- **A border holds at most one edge-layer** (a road *or* a cable, never two).
- **A tile centre is a stack of up to 3 levels** — ground / air / underground — one network per level.
  Each level is a proper **junction**: a road or cable can meet the centre from several borders (e.g. a
  3-way). Different networks (road + electric cable, kinetic axle + air pipe) co-locate at one centre on
  different levels rather than sharing a border.
- **One level per cable (for now)**: **high** carries electricity, **ground** carries roads + kinetic
  axles, **subterranean** carries pressured air. Other energies are open to proposal, each on its own
  level; cross-level links happen only in specific buildings (a tower).
- A cable can be **bridged**, **elevated (mats)**, or **buried** depending on tech/science; some kinds
  block, others let roads/rails pass through.
- **Cross-level links are natural, not a mesh**: they occur only in specific buildings (e.g. a tower
  linking a cable up and down). Such a building is a node joining two paths — just another node in the
  near-tree, never a general multi-level mesh.

## Distribution

Each energy network lives on one level and is a subgraph of the hex lattice, so it is **near-tree**: the
generator→consumer path is unique unless the player deliberately loops the grid. No flow solver is
needed.

- **Loss** = product of the per-edge efficiency η along the path: `Πη`.
- **Capacity bottleneck** = the minimum edge capacity along the path (the thin-cable choke).
- **Energy level** at a consumer = `delivered / demand × 100 %`.
- **Shortage** (demand exceeds generation, or a bottleneck chokes a branch): allocate by **priority**,
  tie-break by **distance-decay** — the farthest from a generator browns first.
- **Redundancy**: a loop yields at most a few parallel paths; effective capacity is the sum of their
  caps. A special case, not a general solve.

## Storage

Vehicles hold an energy reserve (battery, fly-wheel); buildings do not — they draw live from the grid.
