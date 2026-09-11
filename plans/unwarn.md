# Unwarn

## Run a small simulation and collect warnings (IN PROGRESS)

Run a small simulation (soviet/chopsaw/…) and collect warnings; solve them one by one (pick, solve,
then collect again).

### Loose-good claim + two-phase zone query (DONE 2026-09-11)

Symptom was `planGrabLoose: no matching loose goods (idle)` firing when the zone-browse pick
named a tile/good at decision time but the good was gone at grab time. Fixed:

- Claim model (`board/looseGoods.ts`): `LooseGood.claimedBy: Commitment | undefined`, `available`
  derived. `allocate` fails when claimed/removed; `onFulfilled → remove`,
  `onCancelled → clear + bump`. `removeKnownGood` cancels the claim before unlinking. `applyDecay`
  no longer skips claimed goods — decay cancels (`loose-decayed`) then removes. Claim acquire and
  release both bump work planning (`loose-good.claim` / `loose-good.unclaim`). `findAndAllocate`
  requires an explicit owner commitment. Hot filters read `claimedBy === undefined && !isRemoved`
  directly (no derived-getter reactivity risk).
- Two-phase zone query (`freight/vehicle-zone-browse.ts`): `findVehicleZoneBrowseSelection`
  (exist?, no pathfinding, axial-distance scoring, no cache) vs `pickVehicleZoneBrowseSelection`
  (path?, walks ranked load matches best-first with one `pathToTile` each, provide merged by
  score). `zoneBrowseCache` deleted. `shouldAdvancePastZoneStop` and `freightStopMovementTarget`
  are reachability-aware (`zoneBrowseHasReachableMatch`, reachable-pick-first fallback).
- Provide side unchanged (no loose claim).

Verified: typecheck clean; 22 passed (loose_goods, tile-blocking, vehicle-work-pick,
soviet-example) + 138 passed (zone-hop, arbitration, hop-prepare, freight-dock, offload-job,
character-vehicle).

Remaining: re-run soviet collector, expect the `planGrabLoose` warn gone or reduced to rare races.

Note (reverted during verification): materializing `tilesAround` (auto-`ensureGeneratedTiles`
inside the disc scan) changed maintenance-offload behavior — newly visible generated burdens
surfaced a `loadFromBurden` candidate that the joint-line check (tile-identity compare) does not
suppress, breaking `vehicle-zone-hop` "instead of maintenance offload". Reverted to plain
`tilesAround`; unstreamed coords stay invisible to the maintenance scan until streamed. If
revisited, the joint-line check needs object-identity awareness first.