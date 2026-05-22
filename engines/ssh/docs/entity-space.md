# Entity Space

This document records the intended movement semantics around blocking tiles. It is
written for the pathfinding layer and the `.npcs` scripts that decide how characters
and vehicles approach work targets.

## Blocking Tiles

A tile is considered **blocking space** once it has at least a foundation.
This includes:

- a construction site after foundation work has begun
- an alveolus, whether still building or already complete
- a residential tile, whether still building or already complete
- any other built or building tile content

The rule is structural: if the tile has crossed from plain/project land into a
foundation, shell, or finished built object, it is blocking space. It should be
treated as unpassable even when it is still under construction.

Pre-foundation project land is not blocking space by this definition. It may
still be blocked for other reasons, such as loose goods or vehicles burdening the
tile, but it has not yet become built space.

## Landlocked Blocking Tiles

A **landlocked tile** is a blocking tile whose neighboring tiles are all also
blocking tiles.

Landlocked tiles are a problem, not a desirable feature. Since pedestrians may end
on a blocking tile but cannot pass through blocking tiles, a landlocked blocking tile
cannot be reached from ordinary passable space. Once created, no character can walk
to its center unless they already start inside the sealed blocking cluster.

The engine should treat landlocked blocking tiles as layout issues:

- procedural or generative placement should avoid creating them
- validation and debug tools should detect them
- the player should be informed when a build plan would create one

## Pedestrian Movement

Pedestrians cannot use blocking tiles as through-space.

A walking path may:

- start inside a blocking tile
- end inside a blocking tile
- include ordinary passable land between the start and end

A walking path must not include any blocking tile as an intermediate step. In other
words, a worker can stand in the center of a construction site, alveolus, or dwelling
when that is the actual work target, and can leave from one, but cannot shortcut
through one while walking somewhere else.

This preserves the common work scripts:

- foundation and construction work may end at the target tile
- transform, convey, residential, and other building-local work may start or end at
  the building tile
- unrelated travel must route around built space

The pathfinder should therefore distinguish endpoint allowance from transit
allowance. "Can stand here because this is my source or destination" is not the
same as "can pass through here on the way to another target."

## Occupancy

Blocking space and **occupancy** are separate concepts.

Blocking answers: "Can this path go through the tile?" Occupancy answers: "How many
entities may be present on this tile at the same time?"

Occupancy is also split by entity kind. Pedestrian occupancy and vehicle occupancy
must be tracked separately because they have different capacities, movement rules,
and future congestion behavior.

## Pedestrian Occupancy

The current conservative rule is effectively one character per tile. That is a valid
default for early implementation, but it should not become the long-term model for
every tile type. Some spaces should allow characters to pass beside each other or
gather inside the same place.

Pedestrian occupancy should be modeled as a per-tile capacity:

- unbuilt land: global default
- roads: likely higher than plain land, so characters can pass each other
- construction sites: low, probably one or a very small number
- alveoli: low by default, probably one unless the alveolus defines otherwise
- residential tiles: derived from housing capacity
- commercial or leisure tiles: derived from their function, level, or current
  layout

The default can be global per content family, but specific content should be allowed
to override it. For example, a basic dwelling may use its resident capacity, while a
future canteen could calculate occupancy from its level or furniture slots. Some
future alveoli may also need custom occupancy if their work model naturally supports
multiple characters.

Pedestrian occupancy should affect where characters can stand or wait. It should not, by
itself, make a tile passable for through-movement. For example, a dwelling may have
space for several residents, but it is still blocking space for unrelated pedestrian
travel and impossible vehicle travel.

## Vehicle Occupancy

Vehicle occupancy is separate from pedestrian occupancy.

The initial rule should be one vehicle per vehicle-allowed position. If a vehicle can
stand on or service a position, no other vehicle should occupy that same position at
the same time.

Later, the engine may allow vehicles to pass each other in specific places, such as
roads. That should be modeled as a deliberate congestion or passing behavior, not as
unlimited vehicle overlap. For example, two vehicles might be allowed to cross paths
only by slowing down, yielding, or using a road-specific rule.

Blocking tiles still remain impossible vehicle positions. Vehicle occupancy applies
only where vehicles are otherwise allowed to be.

## Mixed Traffic

Occupancy and traffic are related but separate.

Occupancy answers: "Who may stand or wait here?" Traffic answers: "Who may enter
or cross here now?"

Pedestrian occupancy and vehicle occupancy should be tracked separately, but traffic
rules decide whether those occupants can safely mix or pass through the same space
at the same time. A tile or border-side vehicle position can have enough pedestrian
capacity and enough vehicle capacity independently, while still requiring a yield,
wait, reservation, or slowdown before another entity enters.

The conservative default should be:

- non-road positions do not allow ordinary mixed pedestrian/vehicle traffic
- the vehicle operator may share the vehicle's position while boarding, driving, or
  servicing that vehicle
- explicit service states may allow controlled overlap, such as the operator
  standing at the vehicle border position or stepping into a blocking tile while the
  vehicle remains at the border
- roads may allow mixed pedestrian/vehicle traffic with slowdown, crowding, or wait
  rules
- crowded roads may temporarily block vehicle entry even when the road is generally
  vehicle-passable

Vehicle-to-vehicle interaction should also be traffic negotiation, not unlimited
vehicle occupancy. One vehicle per vehicle position remains the default standing
rule. Road passing, opposite-direction movement, and crossing flows should use an
explicit reservation, yielding, or slowdown rule so two vehicles do not claim the
same position at the same time by accident.

## Vehicle Movement

Vehicles cannot enter blocking tiles at all. This is stricter than pedestrian
movement: a blocking tile is neither a vehicle transit tile nor a vehicle endpoint.

When a vehicle job needs to load from, unload to, or otherwise service a blocking
tile, the vehicle should drive only to the border of that tile. The vehicle remains
outside the blocking tile while still being operated by the character assigned to
the vehicle service.

The service pattern is:

1. The character operates the vehicle and drives it to a reachable border adjacent
   to the blocking target tile.
2. The vehicle stays at that border-side position and remains under the same
   operator/service link.
3. The character steps into the center of the blocking tile.
4. Loading or unloading is performed as a short hop between the blocking tile center
   and the vehicle at the border.
5. If the vehicle service continues, the character returns to the border and resumes
   operating the same vehicle.

This means vehicle scripts should not model a blocking-tile load/unload as "drive
onto the tile, transfer, then drive away." They should model it as "drive until the
border, worker steps in, transfer hop, worker steps back."

### Border Service State

During a blocking-tile vehicle service, the character may temporarily leave the
vehicle and walk into the blocking tile center while still operating that vehicle.
This is a valid service state, not a release of vehicle ownership.

While the character performs the center-tile hop:

- the vehicle remains at the border-side service position
- `character.operates` remains set to that vehicle
- `vehicle.service` remains attached
- `vehicle.service.operator` remains the same character
- no other character may take over that vehicle service

Transfer work should treat the vehicle as being at the border and the character as
being inside the blocking tile. Loading and unloading are therefore short
center-to-border transfers, not same-tile transfers and not vehicle entry into the
blocking tile.

If the script is interrupted while the character is inside the blocking tile, the
service must remain recoverable. Interruption handling may move the character back
to the border, leave the service attached without completing it, or explicitly
release the operator link as part of a known recovery path. It must not silently mark
the vehicle service complete just because the character left the vehicle during the
hop.

### Bays

Bays are the special case where a vehicle must become docked to perform its service.
For now, docking should still respect the blocking-space rule: the vehicle first
drives to the target tile border, then enters the docked state from that border-side
position. The vehicle should not path through the blocking tile center to become
docked.

## Pathfinding Contract

Pathfinding and script callers should expose the intended movement mode and endpoint
policy explicitly:

- `walk`: blocking tiles are allowed only as the start or final destination.
- `drive`: blocking tiles are never allowed in the path.
- `drive-to-service-border`: the target is a blocking tile, but the route endpoint
  is a neighboring reachable border or tile-side position, not the blocking tile
  center.

The important invariant is that built space is never accidental transit space.
Pedestrians may interact with it from its center when the work requires that exact
tile; vehicles interact with it from the edge.

## Script Implications

`.npcs` procedures that currently say "walk until target" or "drive until target"
need to choose the correct spatial target:

- pedestrian building work can still walk to the blocking tile center
- pedestrian travel past a building must path around it
- vehicle load/unload against a construction shell, alveolus, dwelling, or other
  built tile must drive to a border-side approach point
- during that vehicle load/unload, the operator relationship must remain intact even
  while the character briefly leaves the vehicle to step into the tile center

This keeps the visual behavior coherent: characters can enter workspaces, vehicles
respect their footprint, and transfer work at built tiles becomes an explicit
border-to-center hop rather than an implicit overlap.
