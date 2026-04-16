# Vehicle job offers

When a vehicle is not operated, it might offer jobs that characters can take, as alveoli do

## Planner-visible jobs vs script phases

The freight work planner only ranks **`vehicleOffload`**, **`vehicleHop`**, and **`zoneBrowse`** (see `collectVehicleWorkPicks` / `Job` in `src/lib/types/base.ts`). Walking to the wheelbarrow (`approachPath` on `vehicleHop`), attaching line service (`needsBeginService`), intra-zone tile load/provide, and dock prep are **NPC script procedures** implemented in `assets/scripts/vehicle.npcs` and `npcs/context/vehicle.ts`—they are not separate planner `Job` kinds. Optional `type: 'work'` payloads named `loadOntoVehicle` / `provideFromVehicle` / `unloadFromVehicle` exist only as **script-internal transfer steps** for tests and VM calls, not as ranked work.

Note, "drive" means to go with the vehicle. As things have been implemented, "walk" is the service responsible of the movements, so for now, `walk.until` is what is used for "drive until"

TODO: if a vehicle is non-operated and not docked on an alveoli/..., the tile is burdened too

> Notes: Many things, like `1. **[long]** Character moves toward the vehicle (walk.until tile, then walk.moveTo vehicle).` should be npcs procedures

## Vocabulary

We will say a stop is "fulfilled" when it cannot load/unload more of what is specified in its contract

## Scripts

### Offloading loose-good

#### Precondition

Vehicle has no bound service

#### Begin plan

- **Link loop:** character `X` **operates** → job-offering vehicle **serves** → offloading-service has **operator** → character `X`.
- **If the plan breaks:** the service has no operator and the character operates no vehicle; the service remains while there are goods in the vehicle.

Steps:

1. **[long]** Character moves toward the vehicle (`walk.until` tile, then `walk.moveTo` vehicle).
2. Character loses their own position (→ driving).
3. **[long]** Character moves toward the loose good to offload.
4. **[long]** Grab (loose good → vehicle).
5. **[long]** Move toward the dropping site (unbuilt land, etc.).
6. **[long]** Drop (vehicle → loose good).

#### End plan

- The vehicle has no more service (object can be GC’d).
- Character offboards and operates no more vehicle.

### Line-hop

#### Precondition

- Either:
  * Vehicle is serving a line and its stop is fulfilled
  * Vehicle has no service but spotted a line who would be nice serving

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
      3. launch the loading/unloading process
   - **zone** (should be a procedure as it is reused in [#Zone-browse])
      1. pick a good to grab or need to fulfil
      2. **[long]** drive to that good/need
      3. offboard: character regain its position
      4. **[long]** grab/drop the good/need

#### End plan

- The service remains attached
- The service **operator** is undefined as well as what the character **operates**

### Offloading vehicle

#### Precondition

- The vehicle is in service, on its last stop and its stop is fulfilled

#### Begin plan

- **Link loop:** character `X` **operates** → job-offering vehicle and the vehicle's service' has **operator** → character `X`.
- **If the plan breaks:** the service has no operator and the character operates no vehicle; the service remains

Steps:

1. **[long]** Character moves toward the vehicle (`walk.until` tile, then `walk.moveTo` vehicle).
2. Character loses their own position (→ driving).
3. **[long]** Move to a parking place (for now, an unbuilt land, like for offloading good)

#### End plan

- The vehicle has no more service (object can be GC’d).
- Character offboards and operates no more vehicle.

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

## (Un)Loading process

When docked at a bay, both process can happen at the same time. The vehicle will advertise provide/needs (with 2-Use priority)
Note: all the calculations presented here will be used to calculate the utility of a line - so these computations will need to be done in the same libraries (it has been begun like in engines/ssh/src/lib/freight/freight-stop-utility.ts)

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

**For now** once ads have given raise to good movements and all good-movements are over, the stop is considered as fulfilled.

> "For now" because, later, we will configure stops and fulfillment condition
