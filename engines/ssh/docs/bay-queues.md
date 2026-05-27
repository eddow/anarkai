# Bay queues

This note specifies a generic waiting and admission model for vehicles that target bays.

The design target is not a train-specific queue, a truck-specific queue, or a single FIFO list in
front of a dock. A bay queue is a local traffic controller for a bay group. It manages ordered
service requests plus physical holding positions, and it emits short movement jobs whenever a
vehicle may advance one position closer to service.

## Problem

Several vehicles may target the same bay, or a set of interchangeable bays, and arrive at roughly
the same time. If a vehicle reserves a physical dock while it is still far away, it can lock that
dock uselessly during a long trip. If the dock is only chosen at the final tile, vehicles can crowd
the approach and lose any fair order.

The system also needs to handle more than one kind of waiting space:

- road vehicles can wait on a road lane, in a parking area, or beside the road if they are allowed
  off-road;
- trains can wait on the main line, a siding, or a dead-end parallel parking line;
- any vehicle can either keep blocking its current network path or move into an off-path holding
  position that frees the approach;
- a bay may be reachable from multiple roads or rails, producing several ingress branches that must
  merge before service.

The queue model must therefore be based on spatial movement constraints, not on vehicle type.

## Vocabulary

### Bay group

A bay group is the logical destination of a vehicle line stop. It contains one or more service
points that can be used interchangeably when their constraints match the vehicle and the requested
transfer.

Examples:

- two loading bays in the same hive that can both load wood;
- one bay with multiple dock slots;
- a rail bay and a road bay that share the same hive-side freight interface but accept different
  movement networks.

A vehicle may target a bay group from far away. It should not reserve a concrete dock from far away.

### Service node

A service node is a queue node where docking or service can happen. A physical bay with several
docks may expose several service nodes, or one service node with capacity greater than one.

### Queue graph

A queue graph is the local movement and holding graph attached to a bay group.

It is made of:

- queue nodes, where vehicles may wait, pass through, or receive service;
- queue edges, which describe permitted movement from one node to another;
- merge policies, which decide how competing branches feed a shared downstream node.

This graph is the generic replacement for a single "queue list".

### Queue node

A queue node is any local position relevant to admission.

Examples:

- a road lane segment;
- a rail block;
- a roadside waiting patch;
- a parking slot;
- a rail siding;
- a bay approach;
- a dock slot.

Conceptually:

```ts
type QueueNode = {
	id: QueueNodeId
	capacity: number
	accepts: VehicleCapabilityFilter
	canWait: boolean
	canService: boolean
	blocksThroughTraffic: boolean
}
```

`blocksThroughTraffic` describes the effect of waiting there. It does not decide whether the node is
valid. A valid queue may deliberately place vehicles inline when no off-path holding position exists.

### Queue edge

A queue edge is a possible advancement from one queue node to another.

Conceptually:

```ts
type QueueEdge = {
	from: QueueNodeId
	to: QueueNodeId
	requires: VehicleCapabilityFilter
}
```

An edge may require road movement, rail movement, off-road movement, a compatible vehicle length, a
turning capability, or any later routing property. The queue controller does not need special cases
for "car parks beside the road" or "train enters siding"; those are just edges to compatible nodes.

### Dock request

A dock request is the vehicle's local intent to receive service from a bay group.

Conceptually:

```ts
type DockRequest = {
	vehicleUid: string
	bayGroupUid: string
	arrivedAt: number
	priority: number
	requirements: DockRequirement[]
	state: 'waiting' | 'granted' | 'servicing' | 'cancelled'
}
```

`arrivedAt` is the time the vehicle entered the local queue system, not the time the line planned the
trip. This gives a stable local order without remotely locking docks.

### Movement grant

A movement grant is a short-lived permission to move from one queue node to another.

Conceptually:

```ts
type MovementGrant = {
	vehicleUid: string
	from: QueueNodeId
	to: QueueNodeId
	expiresAt?: number
}
```

Moving into a service node is the same mechanism as moving into a waiting node. A concrete dock
reservation is just a movement grant whose target is a service node.

## Intent vs reservation

The core rule is:

> Vehicles may declare remote intent for a bay group, but concrete dock reservation is local and
> short-lived.

Remote intent is useful for ETA prediction, line planning, UI, and soft demand. It must not occupy a
dock.

Concrete reservation starts only when the vehicle is already in the queue graph and can act on the
grant soon. This keeps docks productive while preserving local ordering near the bay.

## Lifecycle

A vehicle targeting a bay group moves through these states:

1. `Inbound`: the vehicle is traveling toward a bay group.
2. `Queued`: the vehicle has reached an admission point in the queue graph and has a dock request.
3. `Holding`: the vehicle is dormant on a queue node.
4. `Advancing`: the vehicle has a movement job for a granted edge.
5. `Servicing`: the vehicle is at a service node and may load, unload, or exchange goods.
6. `Leaving`: the vehicle has completed service and is exiting the bay group area.

The important boundary is between `Inbound` and `Queued`. Before that boundary, the vehicle has only
intent. After that boundary, the local bay group queue owns admission and advancement.

## Movement jobs

The queue does not only decide who docks next. It decides who may advance one step.

Possible grants include:

- advance from an inline road node to the next inline road node;
- advance from the road into off-road waiting;
- advance from a rail main line into a siding;
- advance from a siding back to the approach;
- advance from any holding node into a dock;
- advance out of a service node after service completes.

When a vehicle cannot move because no compatible node is free, it remains dormant on its current
node. The queue controller creates the next vehicle hop job when capacity appears.

## Generic spatial model

The queue graph is a constrained movement graph:

```text
Vehicle waits on a node.
Vehicle advances along an edge.
Docking is reaching a service node.
```

That makes these cases data, not special systems:

- one road feeding one dock;
- two roads feeding one bay group;
- several road and rail entrances;
- off-road parking beside a road;
- train sidings and dead-end parallel waiting lines;
- inline queues that block through traffic;
- off-path queues that free the approach;
- multi-dock bays;
- interchangeable bays in the same hive.

Example shape:

```text
road_north_1 ----\
                  -> merge_gate -> dock_a
road_south_1 ----/             \-> dock_b
roadside_wait ---/
rail_siding -----/
```

The merge is not implicit in the list order. It is configured as part of the queue graph.

## Multiple branches and merge policy

When several ingress branches can feed the same downstream node, the bay group needs a merge policy.

Useful policies:

- `global_fifo`: choose the earliest waiting compatible vehicle across all branches;
- `priority_then_fifo`: choose highest priority, then earliest arrival;
- `round_robin_by_branch`: alternate between ingress branches;
- `weighted_round_robin_by_branch`: give some branches more turns than others;
- `physical_first_available`: choose the first compatible vehicle that can physically move now.

The default should be `priority_then_fifo` with priority normally equal for all vehicles. That gives
simple FIFO behavior while leaving room for urgent cargo, line priority, or starvation prevention.

Logical order and physical feasibility are separate:

```text
logical order = who should go first
physical feasibility = who can actually move now
decision = first logical candidate that has a legal movement, unless policy allows skipping
```

If the first logical candidate cannot move because its exit path is blocked, policy decides whether
the queue waits or skips to the next candidate. That choice should be explicit because it affects
fairness and throughput.

## Vehicle capability

Vehicle type is not the main branching concept. Capabilities are.

Examples:

- `road`;
- `rail`;
- `offroad`;
- `canWaitOffNetwork`;
- `canReverse`;
- `maxLength`;
- `cargoCompatibility`.

A road vehicle that may park beside the road has a capability that allows edges into roadside
holding nodes. A road vehicle that cannot leave the road simply lacks that capability. A train that
can enter a siding follows rail edges into a siding node. If a later vehicle can move both on-road
and off-road, it can use both classes of nodes as long as capacity and routing allow it.

## Configuration sketch

The exact data shape can evolve, but the configuration should express the graph instead of encoding
one queue per vehicle type.

```yaml
bay_groups:
  mine_loader:
    service_nodes:
      - dock_a
      - dock_b

    queue_graph:
      nodes:
        - id: road_north_1
          capacity: 1
          accepts: [road]
          can_wait: true
          can_service: false
          blocks_through_traffic: true

        - id: road_south_1
          capacity: 1
          accepts: [road]
          can_wait: true
          can_service: false
          blocks_through_traffic: true

        - id: roadside_wait
          capacity: 4
          accepts: [road, offroad]
          can_wait: true
          can_service: false
          blocks_through_traffic: false

        - id: rail_siding_a
          capacity: 1
          accepts: [rail]
          can_wait: true
          can_service: false
          blocks_through_traffic: false

        - id: dock_a
          capacity: 1
          accepts: [road, rail]
          can_wait: false
          can_service: true
          blocks_through_traffic: false

        - id: dock_b
          capacity: 1
          accepts: [road]
          can_wait: false
          can_service: true
          blocks_through_traffic: false

      edges:
        - from: road_north_1
          to: roadside_wait
          requires: [offroad]

        - from: road_north_1
          to: dock_a
          requires: [road]

        - from: road_south_1
          to: dock_a
          requires: [road]

        - from: roadside_wait
          to: dock_a
          requires: [road]

        - from: roadside_wait
          to: dock_b
          requires: [road]

        - from: rail_siding_a
          to: dock_a
          requires: [rail]

      merge_policy:
        kind: priority_then_fifo
```

## Admission loop

Conceptually, the queue controller runs when:

- a vehicle enters the queue graph;
- a vehicle completes a movement grant;
- a vehicle completes service;
- a queue node gains capacity;
- a request priority or compatibility changes.

Pseudo-code:

```ts
function advanceBayQueue(queue: BayQueue) {
	for (const request of orderedRequests(queue)) {
		const current = currentQueueNode(request.vehicleUid)
		const next = findAvailableNextNode(queue, current, request)

		if (!next) continue

		reserveNode(next, request.vehicleUid)
		emitAdvanceJob(request.vehicleUid, current, next)
		return
	}
}
```

`findAvailableNextNode` must consider:

- node capacity;
- edge requirements;
- vehicle capabilities;
- service compatibility;
- branch merge policy;
- whether moving this vehicle would violate an active grant;
- whether the target node is reachable by the vehicle's movement rules.

The loop may run repeatedly while progress is available, but each grant should remain a concrete
short movement. This prevents a vehicle from claiming a long chain of future positions.

## Invariants

- A vehicle far from the bay group may hold intent, but not a concrete dock reservation.
- A concrete service node reservation must belong to a vehicle already in the queue graph or leaving
  a directly adjacent granted movement.
- A vehicle occupies at most one queue node unless it is in a movement transition that explicitly
  reserves the target.
- A queue node's occupied plus reserved count must not exceed capacity.
- A movement grant must reserve its target before the vehicle starts moving.
- The queue controller, not the vehicle script, owns selection of the next queue movement.
- Vehicle scripts execute granted movements and report completion, cancellation, or blockage.
- Logical order and physical occupancy are separate state.
- Off-path waiting is just a node that does not block through traffic.
- Inline waiting is just a node that does block through traffic.

## Open questions

- Should a blocked first candidate stall the merge by default, or should the default skip to the
  next physically movable candidate?
- Should service-node reservations expire if no worker takes the emitted vehicle hop job?
- How much of the queue graph should be authored by players versus derived automatically from roads,
  rails, bays, and parking/siding construction?
- Do queue nodes need length-aware capacity from the start, or can capacity be scalar until long
  vehicles require more precision?
- Should leaving a dock use the same queue graph, a separate exit graph, or ordinary pathfinding once
  the service node is released?
