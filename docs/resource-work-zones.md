# Resource Work Zones

This note describes the intended gameplay model for resource-producing work that is scoped by named zones:
forestry, farming, quarrying, and similar managed resource areas.

## Core Model

Named zones are spatial coordination objects. A named zone says "this set of tiles belongs together" and gives
that area a name, color, and selectable identity. The zone itself does not define whether it is a wheat field,
a managed grove, or a quarry.

Resource meaning comes from alveoli assigned to the zone.

Examples:

- A wheat planter assigned to `South Field` makes `South Field` a wheat planting area.
- A fertilizer alveolus assigned to `South Field` improves planted wheat inside that same area.
- A harvester assigned to `South Field` harvests mature wheat inside that same area.
- A forester and woodchopper assigned to `North Grove` make `North Grove` a managed forestry area.

The same named zone may be shared by multiple alveoli. This is the normal way to coordinate multi-step
resource chains without requiring every alveolus to rediscover or duplicate the same spatial intent.

## Assignment

Resource-producing alveoli that create, maintain, or harvest map resources require at least one assigned named
zone before they can propose ordinary work.

This rule applies to alveoli such as:

- foresters
- woodchoppers
- crop planters
- fertilizers or field maintainers
- crop harvesters
- quarry or gatherer buildings that operate on authored resource areas

An alveolus may support one assigned zone or several assigned zones, depending on its building type and UI.
When several zones are assigned, the alveolus treats the union of those zones as its work authority, while still
preserving each named zone as a selectable authored area.

Project-driven work may override this rule when the project itself explicitly names the target tile. For
example, construction clearing can request removal of a blocking resource even when the tile is not inside an
assigned resource zone.

## Work Authority

Assigned named zones bound where an alveolus can search for work.

A planter searches for valid planting tiles only inside its assigned zones. A harvester searches for mature
crop instances only inside its assigned zones. A forester searches for available tree capacity only inside its
assigned zones. A woodchopper searches for harvestable trees only inside its assigned zones.

The zone does not need a crop type, tree type, or resource type setting. The assigned alveolus supplies that
meaning through its own action definition.

## Clearing And Obstacles

Preparing a managed resource area may require removing existing resources. If a wheat planter is assigned to a
zone that contains trees, rocks, or bushes on otherwise valid planting tiles, the planter may request clearing
work as a prerequisite to planting.

Clearing is not the same as harvesting for production:

| Action | Meaning |
| --- | --- |
| Harvest | collect a mature or available resource as the intended output of a resource chain |
| Clear | remove an obstacle so another intended use can occupy the tile |

Named zones may expose a player-facing clearing policy when that choice matters. The default policy is that
resource-production alveoli may clear blocking resources inside their assigned zones. A preservation-oriented
policy can prevent clearing existing resources, useful for parks, untouched groves, or resource areas that
should only use already-empty capacity.

## Forestry

Managed forestry is the reference model for zone-scoped resource production.

A forester assigned to a named zone plants and maintains trees in that zone. A woodchopper assigned to the same
zone harvests trees in that zone once they are mature enough. The player coordinates the system by assigning
both alveoli to the same named zone, not by configuring the zone as a forestry zone.

Trees are represented as individual resource instances or small groups on a tile, not only as a terrain deposit.
At the working map scale, a tile is small enough that tree count should be limited. Forestry tiles support a
small maximum number of tree instances, typically one or two per tile.

Each planted tree records enough state to support growth and harvesting:

- species or resource type
- planted age or growth ticks
- growth stage
- harvest eligibility

Growth stage drives both behavior and rendering. Small trees use distinct sprites from mature harvestable
trees, so a managed grove reads visually as a living area rather than a static deposit.

## Farming

Farming follows the same pattern as forestry.

A crop planter assigned to a named zone creates crop instances on valid tiles in that zone. Crop maintenance
alveoli, such as fertilizer or irrigation, operate only on matching crop instances inside their assigned zones.
A crop harvester collects mature crop instances inside its assigned zones.

The named zone does not store "wheat" or "barley". A wheat planter creates wheat because the planter is a wheat
planter. A different planter assigned to the same zone would create a different farming intent, subject to
normal validation and conflict rules.

Crop chains may use local processors nearby, such as a mill that turns wheat into flour. Processors consume and
produce goods through storage and freight systems; they do not need to own the field unless their work directly
targets map resources in that field.

## Tile Capacity

Resource instances on a tile are bounded by tile capacity.

Capacity depends on terrain, resource type, and tile occupation. For example, a small forest tile may support
one or two trees, while a tile containing an alveolus, dwelling, road reservation, or construction project may
support no tree planting at all.

Capacity prevents planters and foresters from filling every visual gap indefinitely and gives harvesters a
clear notion of when a tile is exhausted or ready for replanting.

## Logistics

Harvested goods enter the existing goods and freight systems.

An alveolus may store its output locally, pass it through hive storage, or rely on freight lines to move loose
goods from a zone to a bay. Named zones can already be used as freight stop authority, so the same authored area
can coordinate both field work and logistics.

The field zone remains a spatial object. Goods selection, storage rules, vehicle routes, and processor demand
continue to live in the freight, storage, and alveolus systems.

## UI

Named zone inspectors show the zone as an authored area: name, color, member tiles, links, and any general
area-level policies such as clearing preservation.

Resource alveolus inspectors show zone assignment. The important player action is:

```text
Assign this alveolus to one or more named zones.
```

Once assigned, the inspector can summarize what the alveolus sees in those zones: available planting capacity,
immature resources, harvestable resources, blocked tiles, and missing logistics.

## Persistence

Save data preserves:

- named zone definitions and member tiles
- alveolus-to-zone assignments
- resource instances on tiles
- resource age or growth state
- harvest eligibility when it cannot be derived from age and type

The zone remains stable even if the assigned alveoli are removed. Removing a forester does not delete `North
Grove`; it only removes one building's interpretation of that area.
