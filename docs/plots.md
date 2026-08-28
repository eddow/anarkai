# Plots

A **plot** is an authored set of tiles that belong together, carrying an optional name and a selectable
identity (name + color). It answers *"where does **this** forester / planter / harvester / terraformer
work?"* — a bounded, assignable area — as opposed to a [district](./districts.md), which answers *"what
may spawn **here**?"*.

This document supersedes `resource-work-zones.md` (and the "named zone" terminology): the same concept,
generalized beyond resource work to terraforming and hive "plot variables".

## Core model

A plot is a **spatial coordination object**: it says "this set of tiles belongs together" and gives that
area a name, color, and selectable identity. The plot itself does not define whether it is a wheat field,
a managed grove, a quarry, or a terraforming target.

Meaning comes from the alveoli assigned to the plot:

- A wheat planter assigned to `South Field` makes `South Field` a wheat planting area.
- A fertilizer alveolus assigned to `South Field` improves planted wheat inside that same area.
- A harvester assigned to `South Field` harvests mature wheat inside that same area.
- A forester and woodchopper assigned to `North Grove` make `North Grove` a managed forestry area.
- A terraformer assigned to `The Flats` pushes its tiles toward a chosen terrain.

The same plot may be shared by multiple alveoli — the normal way to coordinate a multi-step chain without
each alveolus rediscovering the same spatial intent.

## Storage & authoring

- **In-extenso storage.** A plot is stored as a **list of coordinates** (never a center + radius). In the
  savegame it is a coordinate list; at runtime it is a **double link**: each tile knows the plots it
  belongs to (a tile can belong to **several** plots), and the board keeps the reverse index
  `plot → coords` so membership queries don't scan the board.
- **Center+radius is authoring-only.** A radius is only a UI convenience for *drawing* a plot; once
  authored the plot is always materialized in-extenso.
- **Naming is optional.** A plot may be **unnamed** and used directly as a freight-line halt without ever
  becoming a named, selectable object.

## Assignment

Resource-producing alveoli that create, maintain, or harvest map resources require at least one assigned
plot before they can propose ordinary work:

- foresters
- woodchoppers
- crop planters
- fertilizers or field maintainers
- crop harvesters
- quarry or gatherer buildings that operate on authored resource areas

An alveolus may support one or several assigned plots; several are treated as the **union** for work
authority, while each plot stays a selectable authored area.

Project-driven work may override this rule when the project itself explicitly names the target tile (e.g.
construction clearing can request removal of a blocking resource even when the tile is not inside an
assigned plot).

## Work authority

Assigned plots bound where an alveolus can search for work: a planter searches only inside its assigned
plots, a harvester only inside its assigned plots, a forester only inside its assigned plots, a
woodchopper only inside its assigned plots.

The plot does not need a crop type, tree type, or resource type setting — the assigned alveolus supplies
that meaning through its own action definition.

Harvesters (cutters/choppers) **without** an assigned plot harvest at the **nearest** matching place;
foresters should always have a plot assigned. See [districts](./districts.md) for the `clean` designation
that prioritizes cutter/chopper work on specific tiles.

## Clearing and obstacles

Preparing a managed area may require removing existing resources before planting. Clearing is **not** the
same as harvesting:

| Action | Meaning |
| --- | --- |
| Harvest | collect a mature/available resource as the intended output of a chain |
| Clear | remove an obstacle so another intended use can occupy the tile |

Plots may expose a clearing policy (default: resource alveoli may clear blocking resources inside their
assigned plots; a preservation policy prevents clearing existing resources).

## Terraforming (plot-wide effects)

Terraformers are planned alveoli that reshape terrain. Each plot tile carries **terraforming
information** — "nothing" or "toward some terrain type" (never water). A terraformer assigned to a plot
reads that per-tile info and works toward it. This is the general **plot-wide effect** model: the plot is
a container for per-tile *instructions*, and the assigned alveolus is the *actor* that applies them.

## Hive "plot variables"

A hive's intent (e.g. "care about a forest") can be expressed as a hive-owned **plot variable**: a
forest-care hive defines a plot named `forest`, and its forester/planter/gatherer alveoli have their
target plot fixed to `hive.forest`. The alveolus setting does not change; the hive lets the player set the
variable's value (select an existing plot, or create one). Plot *meaning* lives at the hive level while
each alveolus keeps a fixed reference.

## Division & merging (open)

What happens when a plot is divided (removing tiles, placing a road through it)? Hive-style merge/split,
or per-tile membership? **Open** — see [`../plans/plots.md`](../plans/plots.md).

## NPC settlements

NPC settlements can own plots too (a forest, an agricultural field, …), but few of them — generated
inversely to the settlement's district footprint (a small settlement fills its space with a big plot; a
large city gets few or none). **Deferred** — see [`../plans/plots.md`](../plans/plots.md) and
[`./terrain-generation-roadmap.md`](./terrain-generation-roadmap.md).

## Forestry

Managed forestry is the reference model for plot-scoped resource production.

A forester assigned to a plot plants and maintains trees in it. A woodchopper assigned to the same plot
harvests trees once mature. The player coordinates by assigning both alveoli to the same plot, not by
configuring the plot as a forestry plot.

Trees are represented as individual resource instances or small groups on a tile, not only as a terrain
deposit. At the working map scale a tile supports a small maximum of tree instances (typically one or two
per tile). Each planted tree records species/resource type, planted age, growth stage, and harvest
eligibility — driving both behavior and rendering (small vs mature sprites).

## Farming

Farming follows the same pattern: a crop planter creates crop instances on valid tiles in its plot; crop
maintenance alveoli (fertilizer, irrigation) operate only on matching crops inside their assigned plots; a
crop harvester collects mature crops inside its assigned plots.

The plot does not store "wheat" or "barley" — a wheat planter creates wheat because it is a wheat planter.
Crop chains may use local processors nearby (a mill turning wheat into flour); processors consume/produce
through storage and freight systems and do not need to own the field unless they directly target map
resources in that field.

## Tile capacity

Resource instances on a tile are bounded by tile capacity. Capacity depends on terrain, resource type, and
tile occupation — a small forest tile may support one or two trees, while a tile containing an alveolus,
dwelling, road reservation, or construction project may support no planting at all. Capacity prevents
planters/foresters from filling every gap indefinitely and gives harvesters a clear exhausted/ready signal.

## Logistics

Harvested goods enter the existing goods and freight systems. An alveolus may store output locally, pass it
through hive storage, or rely on freight lines to move loose goods from a plot to a bay. Plots can be used
as freight-stop authority, so the same authored area coordinates both field work and logistics. Goods
selection, storage rules, vehicle routes, and processor demand continue to live in the freight, storage,
and alveolus systems.

## UI

Plot inspectors show the authored area: name, color, member tiles, links, and general policies (clearing,
terraforming). A plot widget also exposes a button to set the **district** kind of all tiles in the plot
(see [districts](./districts.md)).

Resource alveolus inspectors show plot assignment. The important player action is:

```text
Assign this alveolus to one or more plots.
```

Once assigned, the inspector summarizes what the alveolus sees in those plots: available planting
capacity, immature resources, harvestable resources, blocked tiles, missing logistics.

## Persistence

Save data preserves:

- plot definitions and member tiles
- alveolus→plot assignments
- resource instances on tiles
- resource age/growth state
- harvest eligibility when it cannot be derived from age and type

The plot remains stable even if the assigned alveoli are removed. Removing a forester does not delete
`North Grove`; it only removes one building's interpretation of that area.
