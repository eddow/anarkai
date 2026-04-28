# Vehicle job offers

When a vehicle is not operated, it might offer jobs that characters can take, as alveoli do

## Planner-visible jobs vs script phases

The freight work planner only ranks **`vehicleOffload`**, **`vehicleHop`**, and **`zoneBrowse`** (see `collectVehicleWorkPicks` / `Job` in `src/lib/types/base.ts`). Walking to the wheelbarrow (`approachPath` on `vehicleHop`), attaching line service (`needsBeginService`), intra-zone tile load/provide, and dock prep are **NPC script procedures** implemented in `assets/scripts/vehicle.npcs` and `npcs/context/vehicle.ts`—they are not separate planner `Job` kinds. Optional `type: 'work'` payloads named `loadOntoVehicle` / `provideFromVehicle` / `unloadFromVehicle` exist only as **script-internal transfer steps** for tests and VM calls, not as ranked work.

Note, "drive" means to go with the vehicle. As things have been implemented, "walk" is the service responsible of the movements, so for now, `walk.until` is what is used for "drive until"

Implementation note: vehicle burdening is implemented at the board level through `Tile.isBurdened`. Idle / non-docked wheelbarrows participate in that predicate, while docked line vehicles do not. The one deliberate exception is maintenance unload on the operator's currently operated wheelbarrow tile: `canDropLooseHere()` allows that case when the vehicle itself is the only burden.

> Notes: Many things, like `1. **[long]** Character moves toward the vehicle (walk.until tile, then walk.moveTo vehicle).` should be npcs procedures

## Vocabulary

We will say a stop is "fulfilled" when it cannot load/unload more of what is specified in its contract

Maintenance `vehicleOffload` variants use the discriminator names `loadFromBurden`,
`unloadToTile`, and `park`. Older prose names such as "offload from burdening place" or
"parkVehicle" are explanatory aliases only.

## Scripts

### Vehicle offload family

`vehicleOffload` should be understood as a family of three concrete job offers sharing the same acquisition / release pattern, not as one monolithic behavior.

At the data seam, the planner keeps `vehicleOffload` as the public job family and carries only a small `maintenanceKind` hint on the work payload. The runtime source of truth is the vehicle's attached `service`:

- line work uses a line service,
- maintenance work uses a maintenance service discriminated as `loadFromBurden`, `unloadToTile`, or `park`.

This means scripts should branch from `vehicle.service`, not by re-inferring behavior from incidental job-plan fields.

#### Shared begin plan

- **Link loop:** character `X` **operates** -> job-offering vehicle **serves** -> offloading-service has **operator** -> character `X`.
- **If the plan breaks:** the service has no operator and the character operates no vehicle. The service itself remains attached while the vehicle still has unfinished work, so another worker can continue it.

#### Work plan allocation seam

Vehicle usage is allocated by the **work plan**, not by an incidental script step. When `work.goWork`
enters `plan jobPlan`, `PlanFunctions.begin` runs before the vehicle script body. For vehicle jobs
(`vehicleOffload`, `vehicleHop`, `zoneBrowse`), that begin step calls
`allocateVehicleServiceForJob(...)` and establishes the authoritative runtime link:

1. resolve `jobPlan.vehicleUid` to a `VehicleEntity`;
2. attach or resume the appropriate `VehicleEntity.service`;
3. set `service.operator` to the character;
4. set `character.operates` to the same vehicle;
5. board immediately only when the job starts on the vehicle hex and does not still have an approach prelude.

This makes the work plan the ownership boundary for vehicle usage: once a vehicle work plan begins,
`character.operates`, `vehicle.service`, and `vehicle.service.operator` must agree. Conversely,
ordinary work and self-care do not own a vehicle; if they are selected while `character.operates`
still exists, the operator/control link is released first and any unfinished service remains attached
without an operator.

The job script then performs movement and transfer. It may complete the service explicitly (for
example `completeVehicleMaintenanceService` after `loadFromBurden`, `unloadToTile`, or `park`), or it
may leave the service attached and only release the operator (line `zoneBrowse`, docked line service,
or interrupted unfinished maintenance). `plan.finally` is a safety net for the operator/control link;
it must not be the hidden place where transfer policy is decided.

#### Scoped vehicle usage invariant

Every planner-visible vehicle job owns vehicle usage as part of its work plan. `plan.begin` links the operator to the vehicle/service; the job script explicitly ends the service only when that maintenance or line objective is complete; and `plan.finally` is the safety net that releases only the operator/control link. A character must not fall through into self-care, resting, wandering, or unrelated work while still operating a vehicle from a finished/interrupted vehicle job.

The correspondence is strict: while `character.operates` is set, the current activity must be a vehicle job for that same vehicle and for the live service kind. If the next selected activity is self-care or ordinary work, the operator/control link is released first and the vehicle service remains attached without an operator when it is still unfinished.

Common first steps:

1. **[long]** Character moves toward the vehicle (`walk.until` tile, then `walk.moveTo` vehicle).
2. Character loses their own position (-> driving).

#### Priority between maintenance offers

For a loaded vehicle, selection is:

1. If it is already serving a line, continue that line.
2. Otherwise, if its cargo is compatible with a served gather line and the vehicle is currently in
   that line's first zone stop, begin that line at the gather segment's unload stop **only when the
   hive at that line's unload bay currently advertises demand for that good** (`Hive.needs`, i.e.
   `1-buffer` or `2-use`, not `0-store`). A gather line's load policy may allow a good type even when no
   alveolus in that hive actually demands it; that cargo must fall through to maintenance (`unloadToTile` / `loadFromBurden`) instead of a line hop.
3. Otherwise, if the vehicle still has room and a burdening good is reachable, `loadFromBurden`.
4. Otherwise, `unloadToTile`.

When both `loadFromBurden` and `unloadToTile` are available for a loaded idle vehicle, shortest
vehicle-to-target distance wins.

For an empty vehicle, `unloadToTile` is impossible. It can enter a line only when the line has an
actual current `zoneBrowse` load candidate, load a burdening good, or park if empty and burdening
an important tile. A good merely matching a gather line's filter is not enough to suppress
`loadFromBurden`; the line must be ready to load that tile now.

Rules:

- `loadFromBurden` vs `unloadToTile` is nearest-first when both are available on a loaded idle vehicle.
- `park` is fallback-by-control-flow, not score-compared against load/unload.
- `park` also follows a completed docked `(un)loading` process when the line service ends and leaves an empty vehicle burdening the current tile.
- Entering a compatible gather line from loaded cargo (first zone) **preempts** maintenance only when
  begin-service is actually actionable for that worker (reachable unload / valid hop), not from
  structural compatibility alone.
- UI/debug vehicle proposals are not bound to the current operator. An idle vehicle has no operator
  after a completed maintenance run, but it can still expose valued candidate work by asking
  available workers which vehicle jobs they can perform for that vehicle.
- When a character operates a vehicle, the settled invariant is
  `character.operates -> vehicle.service -> operator === character`. Reassigning the same operated
  vehicle revalidates that back-link, and a service-less vehicle cannot be an operated vehicle.

### `loadFromBurden`

This is the former "offloading loose-good" case, generalized to any burdening source such as an alveolus tile.

It is structurally the same as a `zoneBrowse` **load**:

- choose a target loose good,
- drive to it,
- perform a load transfer through the vehicle storage,
- then end the temporary offload service instead of keeping a line service attached.

That is the whole work. `loadFromBurden` does not also decide where to drop the loaded good. Once
the burdening good is inside the wheelbarrow, normal work selection runs again at distance 0 from
that same vehicle. A loaded mushroom with no compatible line should usually become `unloadToTile`;
a loaded wood may enter a served gather line only when the vehicle is in that line's first zone stop.

#### Precondition

- The vehicle has room for at least one burdening good.
- There exists a burdening loose good that should be removed from its current place.

#### Steps

1. Run the shared begin plan.
2. **[long]** Drive to the burdening loose good.
3. **[long]** Load it (`loose good -> vehicle`).
4. The maintenance script completes the load objective and offboards.
5. The vehicle's service is freed only on that explicit maintenance completion.

#### End plan

- On normal completion, the loaded vehicle is left with no bound service and the character operates no vehicle.
- The next job is deliberately chosen by the planner: empty incompatible cargo via `unloadToTile`, or continue compatible line service when the loaded good can serve a line.
- If the plan is interrupted before completion, the service may remain attached without an operator.

### Line-hop

#### Precondition

- Either:
  * Vehicle is serving a line and its stop is fulfilled
  * Vehicle has no service, is empty, and spotted a line who would be nice serving

Important distinction:

- "begin a line" is empty-only for an idle wheelbarrow unless the wheelbarrow already carries cargo
  that matches a served gather segment,
- but ordinary line continuation is still allowed on a non-empty wheelbarrow that is already serving that line.

#### Begin plan

- **Link loop:** character `X` **operates** → job-offering vehicle and the vehicle's service' has **operator** → character `X`.
- **If the plan breaks:** the service has no operator and the character operates no vehicle; the service remains

Steps:

1. **[long]** Character moves toward the vehicle (`walk.until` tile, then `walk.moveTo` vehicle).
2. Character loses their own position (→ driving).
3. Depending on next stop
   - **bay**
      1. **[long]** drives *until* bay
      2. **[long]** dock the vehicle
      3. release the operator and let the docked vehicle advertise its loading/unloading demand to the bay hive
   - **zone** (should be a procedure as it is reused in [#Zone-browse])
      1. pick a good to grab or need to fulfil
      2. **[long]** drive to that good/need
      3. offboard: character regain its position
      4. **[long]** grab/drop the good/need

#### End plan

- The service remains attached
- The service **operator** is undefined as well as what the character **operates**

### `unloadToTile`

This is structurally the same as a `zoneBrowse` **provide/unload**:

- choose a burdenable target tile,
- drive there,
- unload through the vehicle storage,
- then end the temporary offload service instead of keeping a line service attached.

#### Precondition

- The vehicle is not empty.
- There exists an `unbuilt-land` tile that can be burdened.

#### Steps

1. Run the shared begin plan.
2. Pick the nearest acceptable `unbuilt-land` tile to the vehicle.
3. Among valid drop positions on that tile, choose the exact place randomly so repeated drops do not perfectly overlap.
4. When several tiles are similarly good, prefer choices that do not overwhelm the current pool of free tiles.
5. **[long]** Drive to the chosen tile.
6. **[long]** Unload one good (`vehicle -> loose good`).
7. The maintenance script completes the unload objective and offboards.

If the unload emptied the vehicle, the next candidate action can become `park`.

#### End plan

- On normal completion, the vehicle is left with no bound service after the unload.
- If the plan is interrupted before completion, the service may remain attached without an operator.
- Character offboards and operates no vehicle in both cases.

### `park`

This is only considered when there is no higher-priority offload action to perform.

This includes the case where a docked line vehicle has just finished its `(un)loading` process, the line service is over, and the now-empty vehicle should be re-picked as parking maintenance on the next tick.

#### Precondition

- The vehicle is empty.
- The vehicle is currently burdening its tile.

#### Steps

1. Run the shared begin plan.
2. Pick an `unbuilt-land` tile that is otherwise neutral for the board (that is: acceptable absent the vehicle itself).
3. **[long]** Drive there.
4. Leave the vehicle parked there.
5. The maintenance script completes the parking objective and offboards.

#### End plan

- On normal completion, the vehicle is empty, moved out of the important tile, and has no more bound service.
- If the plan is interrupted before arrival, the park service may remain attached without an operator.
- Character offboards and operates no vehicle in both cases.

Note:

- idle / non-docked vehicles still count as burdening in the board predicate,
- so "park" means "move it onto a harmless resting tile", not "make `tile.isBurdened` false while it remains there".

### Zone-browse

#### Precondition

- The vehicle services a line and is at a zone-stop who can be deepened: it has more loose-goods to grab if it has to load or more lose-need to fulfill if it has to unload

#### Begin plan

- **Link loop:** character `X` **operates** → job-offering vehicle and the vehicle's service' has **operator** → character `X`.
- **If the plan breaks:** the service has no operator and the character operates no vehicle; the service remains

Steps:

1. **[long]** Character moves toward the vehicle (`walk.until` tile, then `walk.moveTo` vehicle).
2. Character loses their own position (→ driving).
3. pick a good to grab or need to fulfil
4. **[long]** drive to that good/need
5. offboard: character regain its position
6. **[long]** grab/drop the good/need

#### End plan

- The service remains attached
- The service **operator** is undefined as well as what the character **operates**

#### Common structure with offload jobs

`zoneBrowse` and the two transfer maintenance variants should share as much runtime machinery as possible:

- `loadFromBurden` is "zone-browse load, but on a maintenance service";
- `unloadToTile` is "zone-browse provide/unload, but on a maintenance service";
- the real difference is therefore not the transfer gesture itself, but target selection, priority, and what happens to the service after the transfer.

## Reflection: advertisement channels (station vehicle vs hive)

**To think out** — design intent captured here for later implementation; details are not fixed.

When a vehicle is at a **station** (in particular while docked in an `(un)loading` process), its attached **service** is the natural place to derive **local** demand and provision: what this stop and the rest of the run need or can release. Those signals should drive **station-side** ads (provide/need as used in the sections below).

A **hive** (or any colony-scale actor) may also have a global picture of what should be stocked, transformed, or moved. That picture must **not** be folded into the same advertisement stream as the vehicle’s station contract: the hive should not “re-advertise” the vehicle’s dock semantics as if they were hive-level facts. Instead, hive intent can be propagated as **hive ads** (or another explicitly named channel), so planners, zone browse, and utility code can tell:

- what belongs to **this vehicle / this line / this stop**, and  
- what belongs to **workforce or economy policy** elsewhere.

Keeping channels separate reduces double-counting and clarifies authority when a pickup could satisfy both a line stop and a hive sink.

**Temporary and project-local needs** (construction, goods staged on a project tile, short-lived sinks) need the same discipline: they are not necessarily permanent hive policy nor line contract, but they still compete for the same wheelbarrows. **To think out:** how construction, chop/craft inputs, gathering segments, and maintenance offload share scoring without collapsing into one undifferentiated “demand” list.

## Reflection: priorities when choosing what to load (and related work)

**To think out** — ordering and tie-breakers should be **configurable** (per line, per policy, or per scenario), not a single global sort hard-coded in one place.

Several mechanisms already point at the same decision surface:

- **Zone-browse** and line-hop zone steps: “pick a good to grab or need to fulfil”, then drive and transfer.
- **(Un)loading** (below): `further-needed-goods` / `further-provided-goods` and utility points.
- **Maintenance offload** family: burden relief vs park vs line-hop (see “Priority between offload offers” above).

When multiple targets are valid—for example **wood on a project**, a **ChopSaw** (or similar hive) that **needs wood** inside the **zone of a gather line**, and the line’s own stop contract—a strawman **tier** ordering that matches the intended gameplay story is:

1. **Line + offload (joint):** Prefer pickups that **simultaneously** satisfy an obligation to the **line** (e.g. gather segment / stop) **and** a compatible **offload, hive-adjacent, or project** need (wood counts for the line *and* feeds production or clearing that the line is meant to support).
2. **Pure offload / burden / hive-target:** Then work that clears burden, explicit unload paths, or hive ads **without** requiring a line obligation on that good.
3. **Pure line:** Then remaining line-only gathers or zone obligations.

Between tiers, **distance**, **utility** (`freight-stop-utility` and cousins), and **which ad channel** matched (vehicle station vs hive vs project-local) should be tunable so one configuration can bias “always feed the saw first” and another “always clear the tile first”. The important implementation direction is one **policy surface** for ranking targets, fed by the same libraries that compute dock and line utility, not divergent one-off heuristics in each script. Current implementation routes zone browse, maintenance, begin-service, and dock provide/demand candidates through `scoreVehicleCandidate(...)`.

## (Un)Loading process

When docked at a bay, both process can happen at the same time. The vehicle will advertise provide/needs (with 2-Use priority)
Note: all the calculations presented here will be used to calculate the utility of a line - so these computations will need to be done in the same libraries (it has been begun like in engines/ssh/src/lib/freight/freight-stop-utility.ts)

Dock completion is owned by vehicle storage state, not by convey. `Storage.virtualGoodsCount`
is the sum of in-flight storage bookkeeping (`reserved + allocated`), and a docked vehicle only
waits while that value is non-zero. Convey workers remain responsible for moving goods and
settling source reservations / target allocations; they do not schedule dock completion.

 First, the *service* object will estimate the amount of goods needed further in the line: it will cumulate all the following stops with "unload"
 > TODO: Some lines will be marked as "exclusive", meaning that a vehicle can only serve one line. This line will therefore be a cycle and "all the next stops" = all the next stops in the lines concatenated by all the first stops until the one being served. Non-exclusive lines *ust* end on an unload-all, load-nothing stop

In all the following stops, count the amount of needed goods, intersect it with the goods that can be unloaded there. This will be the `further-needed-goods` collection (`{good: amount}`)

We should calculate the same for `further-provided-goods`

These collections should evolve together: if, after 3 stops, we need 5 sugars and we already have 2 sugars in the `further-provided-goods`, then the sugar of `further-provided-goods` should become 0 and the sugar in `further-needed-goods` should be augmented by 3. For utility calculation, it will be added as a "utility point" (further-transferred-good)

### Loading

Advertise the need for all the `further-needed-goods` - making sure you don't demand 2 stones if you need one (keep a counter of "what is still needed" to know what to advertise - in the service object)

### Unloading

Advertise providing the stored goods - with 2-Use if there is more than `further-needed-goods` loaded (or find a store) - or with 1-Buffer or 0-Store (let's decide) `further-needed-goods` contains what we have loaded on the vehicle
> TODO: this "advertise providing with 2-Use or find a store" should be a function as it is used already for example by transformer alveoli

### End

After dock advertisements have had a chance to create storage reservations/allocations, the dock
halt is considered complete when the vehicle has no virtual goods left:
`vehicle.storage.virtualGoodsCount === 0`. `VehicleEntity` installs the watcher for that condition
as part of the vehicle lifecycle and schedules `maybeAdvanceVehicleFromCompletedAnchorStop` after
dock registration/advertising settles.

`maybeAdvanceVehicleFromCompletedAnchorStop` intentionally does **not** inspect terminal convey
events, dock advertisement predicates, `Hive.pendingVehicleDockMovements`, or dock-involved hive
movement tokens. If virtual goods are still present it logs `vehicleJob.dock.check` with
`reason: 'vehicle-storage-not-drained'`; otherwise it advances to the next line stop or ends the
line service. Actual stock still matters for the follow-up decision: a final empty dock can expose
`park`, while a non-final loaded dock can continue to the next stop.

> "For now" because, later, we will configure stops and fulfillment condition

If this completion leaves the vehicle empty while it still burdens the current tile, a `park` job should be offered before any new line service is considered.
