# Plan: Remove Runtime IDs from SSH Entities

> Updated 2026-08-18 — **Phase F complete.** All 14 F-items are done. Inspector dispatch now uses object identity (`selectionState.selectedObject`), `debugObjectId` is display-only, and test `.uid` fixtures were removed. Selection/layout state is no longer persisted (`stored` → `shallowReactive`). See the per-item snapshot at the bottom.
>
> **Final audit 2026-08-18** — runtime object ids are fully removed and **no id is saved** to `SaveState` (array-index + content-key only). `roleId`/`planRoleId`, `settlementId` and `zoneId` (name) are all gone — replaced by coordinate / center / array-index. 2 items remain: the in-memory `debugObjectId` Map keys and the stale `vehicleUid` literal. See "What remains to remove all runtime ids".

> Updated 2026-08-06 — Phase F audit identified ~190 id/index patterns across 14 items (F1–F14). See "Phase F — 2026-08-06 audit" below.

## Purpose: removal of all runtime IDs

- **ssh runtime**: delete `.uid` and `.id` properties from runtime objects. Store references directly.
  `vehicle.operator = character`, not `vehicle.operatorId = character.id`.
- **ssh serialization**: delete string IDs from save format. Use array positions or direct object references as identity.
- **pixi**: already clean — zero runtime `.uid` reads.
- **browser inspector**: delete uid-based dispatch. Use `instanceof`/`kind` and object identity instead.

## Status

| Layer | Status |
|---|---|
| `engines/pixi` src | ✅ 0 type errors, zero runtime `.uid` reads |
| `engines/ssh` build | ✅ `pnpm run build` succeeds |
| `apps/browser` typecheck | ✅ `pnpm run check` succeeds |
| `engines/ssh` regression tests | ✅ bay-queue 21/21 pass |
| **Phase A+B** (`.uid` runtime removal) | ✅ Completed |
| **Phase C** (`FreightLineDefinition.id` removal) | ⚠️ Partial — `.id` deleted, but no stable replacement identity installed (see note) |
| **Phase D** (browser `.uid`/`.id` cleanup) | ✅ Completed — `selectedUid` removed; inspector dispatch by object identity; `debugObjectId` display-only |
| **Phase E** (trace `.uid` cleanup) | ✅ Completed — trace payloads use `debugObjectId()` as display |
| **Serialization bridge** | ✅ Completed — index-based vehicle/character/line/plan refs in save/load |
| **Final audit 2026-08-02** | ✅ Superseded by Phase F (all 14 items done) |
| **Phase F (F1–F14)** | ✅ Completed — 14/14 done (see snapshot) |
| **Contraventions audit 2026-08-18** | ⚠️ 2 internal `debugObjectId`/`vehicleUid` fixes remain (3 legacy shapes cleaned) |

## Principles (for removal)

1. **Delete, don't convert**: When a `Map<string, T>` is keyed by object identity, delete the Map and the string keying. Don't rename the key — remove the indirection.
2. **Object identity is the identity**: Two references to the same object are equal (`===`). No string needed.
3. **Index, not ID, in serialization**: Arrays have inherent order. Array position is the identity.
4. **Debug labels are transient**: `WeakMap<object, string>` for trace/log only. Never part of the object's type.
5. **Dead code dies immediately**: A removed `.uid` property must delete every line that read it.

---

## Remaining contraventions (2026-08-18 audit)

Runtime object ids and serialized save-state ids are gone, but these violations of the principles
remain. **None are persisted as object ids in `SaveState`** — the "no id saved" invariant holds — but
several are dead/legacy shapes or internal `debugObjectId` uses that still need cleanup.

### 1. `debugObjectId` used as an in-memory identity key (violates principle #4) ❌

`engines/ssh/src/lib/game/game.ts` builds **Map keys** from `debugObjectId()` for dedupe/accumulation.
This is *identity*, not display:

- `pendingPresentationEvents` (private, ~line 540) — dedupe keys:
  - `${event.type}:${debugObjectId(owner)}` in `enqueueStoragePresentationChange` (~937)
  - `${event.type}:${debugObjectId(owner)}:${debugObjectId(vehicle)}` in `enqueueVehicleDockPresentationChange` (~949)
  - `npc-trade.transferred:${event.line}:${event.stopIndex}:${debugObjectId(event.vehicle)}` in `enqueueNpcTradePresentationChange` (~960)
- `tradeTransferLog` (private) — accumulator key `${event.line}:${event.stopIndex}:${debugObjectId(event.vehicle)}`
  in `accumulateTradeTransferLog` (~970), read back in `getFreightLineTradeHistory` via `key.startsWith(`${line}:`)`.

**Fix:** dedupe by object identity (`Map`/`Set`/`WeakMap` keyed on the `GameObject`/`Vehicle`), keeping the
`line`/`stopIndex` string prefix only where the trade-log really needs a stable per-(line, stop, vehicle)
grouping (which can be derived from indexes, not `debugObjectId`).

### 2. `vehicleUid:` leftover on a convey job literal (violates F6) ❌

`engines/ssh/src/lib/freight/vehicle-work.ts:2200` — `asVehicleProposedJob({ job: 'convey', …, vehicleUid: debugObjectId(vehicle) ?? '' }, …)`.
The target type (`VehicleDockConveyJob`) now has `vehicle`, not `vehicleUid`; this is a stale write that no
longer type-checks (`TS2561`). Replace with `vehicle`.

### 3. Legacy serialization types with `operatorUid?` (declared, never emitted) ✅ cleaned 2026-08-18

Removed `operatorUid?` from `VehicleMaintenanceServiceSerialized` / `VehicleServiceSerialized` /
`LegacyLineVehicleServiceSerialized` / `LegacyOffloadVehicleServiceSerialized` in `vehicle.ts`, and deleted the
entirely-dead duplicate module `vehicle-types.d.ts`. `serializeVehicles` emits the index-based
`SerializedVehicle` / `SerializedVehicleService` (`operatorIndex`) — no string uids remain in the vehicle save types.

### 4. `SerializedDockRequest.vehicleUid: string` (declared, never used) ✅ cleaned 2026-08-18

Deleted the dead `SerializedDockRequest` interface from `bay-queue-types.ts` (runtime `DockRequest` uses a `Vehicle` ref; nothing serialized it).

### 5. Legacy `lineId?`/`vehicleUid?`/`stopId?` arktype fields on work-plan contracts ✅ cleaned 2026-08-18

Removed the optional legacy string-uid fields from `types/base.ts` arktype schemas (`GenericWorkPlan`,
`VehicleOffloadWorkPlan`, `LoadOntoVehicleWorkPlanArk`, `UnloadFromVehicleWorkPlanArk`, `ProvideFromVehicleWorkPlanArk`),
and dropped the `lineId`/`stopId` string fallback in `npc-diagnostics.ts`. Object-ref `line`/`vehicle` are the only identity.

### 6. Persisted content/domain string identities (by design — not object ids) ✅

Persisted but legitimate *content* keys, not runtime object ids (see "Legitimate remaining keys" above):
`HivePlan.knownnessFingerprint`, `NpcSettlementTradeProfile.id` / `GeneratedSettlement.id` /
`SettlementRegion.id` (`settlement-7,19` generator keys, generator-internal), `BayQueueConfigInput.bayGroups[].id`
(authored YAML config key), `MovementRef.id` (opaque nonce — explicitly "not a serialization id").

### 8. `roleId`/`planRoleId` → removed 2026-08-18 (position is identity) ✅

Deleted `roleId` from `HivePlanEntry` (coord is the unique identity via `hivePlanEntryAt`). Removed
`nextRoleId`, the `duplicate-role` validation, `planRoleId` on `AlveolusPatch`/`ProjectSitePatch`/`BuildAlveolus`,
and the `plan.entries.find(e => e.roleId === planRoleId)` configuration lookup — `ProjectSitePatch.configuration`
is now serialized directly. Browser `HivePlanCanvas`/`plan-manager` selection switched `selectedRoleId` → `selectedCoord`.

### 9. `settlementId` → `center` coord 2026-08-18 ✅

`FreightNpcTradeStop.settlementId: string` (a stringified `settlement-q,r`) → `center: AxialCoord`. Resolved via
`Game.getSettlementTradeProfileAtCenter(center)` (scans `profile.center`); `getSettlementTradeProfile(id)` deleted.

### 10. `zoneId` (name) → `zoneIndex` 2026-08-18 ✅

`FreightZoneDefinitionNamed.zoneId` (a slugified zone name) → `zoneIndex` into the serialized `zones[]` array.
`saveGameData` builds `zoneIndexByDefinition` and `serializeFreightLineForSave` rewrites named-zone stops to
`{ kind, zoneIndex }` (dropping the live `definition` object); hydration resolves `zoneIndex` → `zoneByIndex`.

### 7. Trace/display `*Uid`/`*Id` payload fields (display-only — acceptable) ✅

`characterUid`, `vehicleUid`, `operatorUid`, `lineId`, `claimedByUid`, `operatedVehicleUid`, `servedLineIds`,
etc. throughout `dev/trace.ts`, `dev/debug-game-state.ts`, `freight/*`, `npcs/*`, `population/*` are
`debugObjectId(...)` values keyed by `WeakMap` — display strings only, never part of an object type and
never serialized. Also `storage/guard.ts` `Held.id` (leak-tracking counter, only in `console.error`/trace).
Acceptable under principle #4.

---

## What remains to remove all runtime ids (2026-08-18)

### Must fix — `debugObjectId`/`vehicleUid` still used internally (2)

| # | Site | Action |
|---|---|---|
| 1 | `game.ts:936,948,959,969` — `pendingPresentationEvents` + `tradeTransferLog` Map keys built from `debugObjectId(...)` | Re-key by object identity (`WeakMap`/`Set` keyed on `GameObject`/`Vehicle`); keep the `line`/`stopIndex` prefix in the trade log via indexes, not `debugObjectId` |
| 2 | `vehicle-work.ts:2200` — `asVehicleProposedJob({ job: 'convey', …, vehicleUid: debugObjectId(vehicle) ?? '' })` | Change to `vehicle` (the `VehicleDockConveyJob` type already dropped `vehicleUid`) |

### Should delete — dead/legacy shapes (3) — ✅ DONE 2026-08-18

| # | Site | Action |
|---|---|---|
| 3 | `vehicle.ts:84-118` + `vehicle-types.d.ts:8-48` — `operatorUid?` in legacy `Vehicle*Serialized` unions | ✅ Removed `operatorUid?`; `vehicle-types.d.ts` (dead duplicate module) deleted; `serializeVehicles` emits index-based `SerializedVehicle` (`operatorIndex`) |
| 4 | `bay-queue-types.ts:114` — `SerializedDockRequest { vehicleUid: string }` | ✅ Deleted (dead shape, referenced nowhere in save/load) |
| 5 | `types/base.ts:94,100,101,142,160,172,185` — `lineId?`/`vehicleUid?`/`stopId?` arktype fields | ✅ Removed the legacy string-uid arktype fields; `npc-diagnostics.ts` legacy `lineId`/`stopId` string fallback dropped (object-ref `line`/`vehicle` are authoritative) |

### Keep — by design, not runtime ids

- **Content/domain keys**: `knownnessFingerprint`, `NpcSettlementTradeProfile.id`, `GeneratedSettlement.id`, `SettlementRegion.id` (generator-internal), `BayQueueConfigInput.bayGroups[].id`
- **Opaque nonce**: `MovementRef.id` (number; survives object replacement; "not a serialization id")
- **Debug/display**: `debugObjectId(...)` trace payloads, `Held.id` leak counter

**Net:** 2 code fixes remaining (the 🔴 items above); the 3 dead/legacy shapes are cleaned up. Everything else is content identity or display-only.

---

## Phase A+B: DONE — `.uid` removal from runtime ✅

*Committed as `eec4b8c "killing ids"`. 46 files, ~370 changes.*

Removed `.uid` from every runtime object: `Map<string,T>` → `Map<Vehicle,T>` (bay queue, freight docks), `DockRequest.vehicleUid`/`MovementGrant.vehicleUid` → object refs, all `.uid` comparisons → `===`, `Game.getObject()` deleted, `uid` removed from `GameObject` mixin / `InteractiveLogObject` / `InspectorSelectableObject`, cache keys → `debugObjectId()`, error/log payloads → `debugObjectId()`. Result: 270+ `.uid` refs deleted, 0 tsc errors, bay-queue 21/21.

## Phase C: PARTIAL — `FreightLineDefinition.id` removal ⚠️

*Committed as `62fcebb "b4c"`.*

Deleted `id` from `FreightLineDefinition`; removed implicit-gather line synthesis; `VehicleHopJob.lineId`/`ZoneBrowseJob.lineId` → required `line` object ref; all `line.id` trace payloads → `debugObjectId(line)`; serialization now index-based (`lineIndex`, `servedLineIndices`, `VehiclePatch.servedLineIndices`).

> **DONE (2026-08-18) — no implicit lines at all.** `implicitGatherFreightLinesFromHivePatches` and
> `isImplicitGatherFreightLineName` were deleted. `bootstrapFreightLines` restores `GamePatches.freightLines`
> 1:1 (normalized, order preserved) — nothing is synthesized from `freight_bay` hive patches. The "create
> gather line" UI action is a preset that materializes an **explicit** line (`createExplicitFreightLineDraftForFreightBay`
> + `addFreightLine`). Every line in play is explicit; `servedLineIndices`/`lineIndex` resolve against the
> restored array directly (no name-keyed merge).

> **DECIDED (2026-08-17) — container shape resolved.** `Game.freightLines` is now a **reactive `Set<FreightLineDefinition>`**
> keyed by object identity. The array form exists only in the serialized savefile and a transient
> `unpackedFreightLines` buffer (populated during `bootstrapFreightLines`, consumed only by
> `applyVehiclePatches`/`deserializeVehicles` for index resolution).
>
> **DONE (2026-08-17) — lines are mutable + reactive, edits mutate in place.**
> `FreightLineDefinition`/`FreightStop` dropped their `readonly` modifiers; `normalizeFreightLineDefinition`
> now returns `reactive(...)` (identity-stable), so `===`/`sameRef` between a line and `vehicle.service.line` /
> `servedLines` still holds. `replaceFreightLine(original, updated)` now mutates `original` in place (identity
> preserved), and `Game.addFreightLine(line)` is the separate add path. `Vehicle.refreshFreightLineReference`
> was deleted; active line services re-resolve their stop by index via `Vehicle.lineStopIndexFor` /
> `rebindFreightLineStop`. The `local.revision`/`state.revision` UI poke tokens in `FreightLineProperties` /
> `VehicleProperties` were removed — the reactive `Set` + reactive line object drive re-render directly.

## Phase D: PARTIAL — Browser `.uid`/`.id` cleanup ⚠️

*Committed as `62fcebb "b4c"`.*

`DockedVehicleList`/`FreightStopList`/`AlveolusProperties`/`FreightLineProperties`/`VehicleProperties`/`lines-management`/`follow-selection`/`selection-info` use object identity (`line === draft`, `service.line === line`); `game.getObject()` gone.

> **TODO — not complete.** `selectionState.selectedUid` remains (`globals.ts`, `App.tsx`, `follow-selection.ts`,
> `selection-info.tsx`, `game.tsx`) as a localStorage/pinned-panel fallback, and `debugObjectId()`-based equality
> lookups remain in `FreightLineProperties.handleAssign/UnassignVehicle`, `VehicleProperties.assignLine/unassignLine`,
> `follow-selection.resolveSelectionPanelTitle`, and `selection-info` (F1 + F8).

## Phase E: DONE — Trace `.uid` cleanup ✅

All runtime `.uid` accesses in trace/profile/debug payloads → `debugObjectId()` or `===`; browser UI `@ts-nocheck` removed; 18 test files switched `char.operates?.uid === vehicle.uid` → `char.operates === vehicle`.

## Final audit — 2026-08-02: partial sweep (object `.uid` only) ⚠️

Swept `src/` + `tests/` for object `.uid` and name-based lookups. **Result: 0 object `.uid` reads; string uid fields (`selectedUid`, `vehicleUid`, `lineId`, `zoneObjectUid`) and synthetic uid keys were out of scope and remain (see Phase F).**

| Found | Disposition |
|---|---|
| `freight-transfer.ts` (whole module) — `characterUid`, `vehicleUid`, `bayUid`, `routePromiseId`, `transfer.id`, `FreightDemandRef.id`, `FreightOfferRef.id` | **Deleted** — orphaned legacy parallel transfer runtime, imported nowhere |
| `bay-queue.spec.ts` `makeVehicle(uid)` fixture + 4 assertions | **Renamed** `uid` → `label` (test-local label, not a runtime property) |
| `HivePlan.id` + `hivePlanId` string fields + `find(name/id)` | **Refactored** to register index (`byIndex`/`indexOf`, `hivePlanIndex`) — same session |
| `FreightNpcTradeStop.settlementName` persistence key | **Renamed** `settlementId`; resolution by generator id only (`getSettlementTradeProfile(id)`), name fallback removed |

**Legitimate remaining keys (not identity hacks):**
- `NpcSettlementTradeProfile.id` — stable generator key (`settlement-7,19`) for generated content, referenced from persisted freight-line trade stops.
- `MovementRef.id` — opaque nonce for copied movements (explicitly "not a serialization id").
- `ZoneMapPatches.named[].id` — legacy patch-input alias, normalized to `name ?? id`.
- Named-configuration registry (`Map<string, AlveolusConfiguration>`) — user-named content, keyed by name by design.
- Catalog keys (`deposit.name === 'tree'`, `zone.name === 'Industrial'`) — static engine-rules content.
- `settlementName` on `npc-trade.transferred` event / trade log / commercial-overview — display label, not identity.

---

## Phase F — 2026-08-06 audit: remaining id/index patterns

~190 patterns found across 14 items (F1–F14). All must go:

### F1. `selectedUid: string` — Browser inspector dispatch protocol

**14 sites.** `SelectionState.selectedUid` in `globals.ts`; read and written by `follow-selection.ts`, `selection-info.tsx`, `game.tsx`, `App.tsx`, `LinkedEntityControl.spec.tsx`, `selection-info.spec.tsx`, `follow-selection.spec.ts`, `selection-info.hive.spec.tsx`.

**Fix:** Replace `SelectionState.selectedUid: string` with `SelectionState.selectedObject: object`. All dispatch goes through object identity, not strings.

### F2. `freight-line:${index}` — Synthetic freight-line uid keys

**8 sites.** `DockedVehicleList.tsx:67-69` builds the key; `selection-info.tsx:249-251` and `follow-selection.ts:116-118` parse it back.

**Fix:** `lineSyntheticObject` returns `{ kind: 'freight-line', line }` and passes the line object directly to `showProps`. `selection-info` checks `object.kind === 'freight-line'`.

### F3. `hive-plan:${index}` — Synthetic hive-plan uid keys

**7 sites.** `plan-manager.tsx:344` sets `interactionMode.selectedAction` to `hive-plan:${index}`; `game.tsx:89,195` parses it back via `planIndex`.

**Fix:** Pass plan object through a shared reactive reference instead of encoding index in string action.

### F4. `hive:${anchorUid}` — Synthetic hive uid keys

**5 sites.** `selection-info.tsx:246-248` and `follow-selection.ts:109-111` parse `hive:tile:0,0` format.

**Fix:** `createSyntheticHiveObjectForUid` returns `{ kind: 'hive', ... }`; dispatch by `kind`.

### F5. `zone:` / `zone:` — Zone uid keys + `zoneObjectUid()` helpers

**10 sites.** `zone.ts:28-33` defines `zoneObjectUid(index)`, `isZoneObjectUid()`, `zoneIndexFromObjectUid()`. `selection-info.tsx:256-257` and `follow-selection.ts:121-122` parse.

**Fix:** `ZoneObject` passed directly. UID helpers deleted.

### F6. `vehicleUid: string` — Vehicle string uid on runtime types

**22 sites.** `build-site.ts:31,50-119` — `InTransitReservation.vehicleUid`, `reservationKey(vehicleUid, goodType)`, `cancelVehicleReservationsOnSites`. `freight-stop-utility.ts:940,1032` — `FreightLineVehicleStatus.vehicleUid`. `jobs/offers.ts:14` — `VehicleDockConveyJob.vehicleUid`. `types/base.ts:97,138,155,166,178` — `GenericWorkPlan.vehicleUid` etc. `trace.ts:507,516,549-565` — trace record type guards.

**Fix:** All → Vehicle object reference. Trace payloads keep `debugObjectId(vehicle)` as a display field.

### F7. `lineId: string` — Line string id on runtime types

**4 sites.** `types/base.ts:92` — `GenericWorkPlan.lineId`. `npc-diagnostics.ts:30` — reads `j.lineId`. `follow-selection.ts:117` — `game.freightLines.find(l => l.id === id)`.

**Fix:** → `line: FreightLineDefinition` object reference.

### F8. `uid` → Object lookups via `debugObjectId`

**17 sites.** `FreightLineProperties.tsx:402-419` — `handleAssignVehicle(vehicleUid)` / `handleUnassignVehicle(vehicleUid)` → `find(v => debugObjectId(v) === vehicleUid)`. `VehicleProperties.tsx:412-428` — `assignLine(lineId)` / `unassignLine(lineId)` → `find(entry => debugObjectId(entry) === lineId)`. `selection-info.tsx:248,258` — `find(o => debugObjectId(o) === uid)`. `follow-selection.ts:105,110`.

**Fix:** All → pass object references directly. Delete `debugObjectId`-based equality checks.

### F9. `interactiveLogObject(uid)` — Legacy uid-based log object registry

**3 sites.** `game/object.ts:35-38` — `interactiveLogObjectsByUid: Map<string, ...>`, `interactiveLogObject(uid)`.

**Fix:** Delete the Map and `interactiveLogObject()`. Log objects stored by identity.

### F10. `game/object.ts:205` — Display `props.object?.uid ?? debugObjectId(props.object)`

**Fix:** `props.object?.uid` → just `debugObjectId(props.object)`.

### F11. `hivePlanIndex` → index-based identity for hive plans

**6 sites.** `action-job-registry.ts:441` — `planIndex: alveolus.tile.game.hivePlans.indexOf(plan)`. `plan-manager.tsx` — many `game.hivePlans.indexOf()` calls for index-based identity.

**Fix:** All → pass plan object reference. `hivePlans.byIndex()` → `byPlan()` or identity-based lookup.

### F12. `vehicle.uid` in test data

**~20 sites.** Test files assign `uid: 'veh-1'`, `uid: 'character-1'` to test objects and then look them up.

**Fix:** All → object references. Test mocks use direct object identity.

### F13. `FreightStopList.spec.tsx` — `lineId` in mock

**2 sites.** `lineId: args.lineId` in `freight-map-pick` mock; `lineId: 'line-1'` in test data.

**Fix:** → object references.

### F14. `zone:` keys in serialization

Zone index → object references in `ZoneObject` via identity, not parseInt.

---
## Removal order (updated 2026-08-17)

Legend: ✅ done · ⏳ partial · ❌ TODO.

1. ✅ **F1**: `selectedUid: string` → `selectedObject: object` — `selectionState.selectedObject` is the sole dispatch path (object identity); `selectedUid` deleted everywhere.
2. ✅ **F2**: `freight-line:${index}` → direct line object — synthetic keys gone.
3. ✅ **F3**: `hive-plan:${index}` → direct plan object — `hivePlanPlacementState.plan` holds the `HivePlan` object; `selectedAction` is the bare marker `'hive-plan'`.
4. ✅ **F4**: `hive:${anchorUid}` → direct hive object — `createSyntheticHiveObject(game, tile)` returns `{ kind: 'hive', tile }`; dispatch by `kind === 'hive'`; `hiveUidForAnchorTile`/`isHiveUid`/`HIVE_UID_PREFIX` deleted.
5. ✅ **F5**: `zone:` uid → direct ZoneObject — `ZoneObject` now holds the `ZoneDefinition` by reference; `zoneObjectUid`/`ZONE_UID_PREFIX` removed; paint token is name-keyed (`zone:${name}`).
6. ✅ **F6**: `vehicleUid` → Vehicle reference — `InTransitReservation.vehicle`, `FreightLineVehicleStatus.vehicle`, `VehicleDockConveyJob.vehicle`, `WorkPlan.vehicle?` all object refs; `reserveInTransit`/`cancelVehicleReservationsOnSites` keyed by `WeakMap<Vehicle, …>`. `SerializedDockRequest.vehicleUid` remains (serialization only).
7. ✅ **F7**: `lineId` → line reference — `WorkPlan.line?: FreightLineDefinition`; `summarizeJobPlanForDiagnostics` reads `.line` and emits `debugObjectId(line)` as display. `lineId` remains only as legacy trace/display strings.
8. ✅ **F8**: `debugObjectId` lookups → object identity — `HardListSearchPicker.onSelect` passes the item; assign/unassign handlers take the object directly; `debugObjectId` remains only for `data-test-*` attributes and debug dumps.
9. ✅ **F9**: `interactiveLogObject(uid)` registry → delete — replaced with `WeakSet` (`isInteractiveLogObject`).
10. ✅ **F10**: `.uid` display → `debugObjectId` — `InspectorSelectableObject` has no `.uid`.
11. ✅ **F11**: `hivePlanIndex` → plan object ref — `BuildAlveolus.hivePlan: HivePlan`; `HivePlanCollection.updateDraft/sendToValidation/archive/unarchive` take the plan object; `ValidateHivePlanJob.plan` is an object. `hivePlanIndex` remains **only** in the serialized patches (index = array position per principle #3).
12. ✅ **F12**: Test uid data → object refs — `convey-rebind`/`presentation_events` fixtures stripped of `.uid`; browser specs use `selectedObject` + `unwrap`. `trace.test.ts:16-26` `.uid` fields are serialization canaries (`must-not-expand`, `custom-1`), not identity lookups — kept.
13. ✅ **F13**: `FreightStopList.spec.tsx` `lineId` mock — gone.
14. ✅ **F14**: zone `parseInt` key parsing — gone (remaining `zoneObjectUid` is F5).

## Phase F status snapshot (2026-08-17)

| Item | Status | Verified against |
|---|---|---|
| F1 `selectedUid` | ✅ Done | `selectionState.selectedObject` (object ref); `selectedUid` gone from `apps/browser/src` |
| F2 `freight-line:${index}` | ✅ Done | no source matches |
| F3 `hive-plan:${index}` | ✅ Done | `hivePlanPlacementState.plan` (object ref); bare `'hive-plan'` action |
| F4 `hive:${anchorUid}` | ✅ Done | `createSyntheticHiveObject` (object ref); `kind === 'hive'` dispatch; uid helpers deleted |
| F5 `zoneObjectUid` | ✅ Done | `ZoneObject.definition` (object ref); `zoneObjectUid`/`ZONE_UID_PREFIX` deleted; `findZoneByName`/`removeZoneDefinition` added |
| F6 `vehicleUid` | ✅ Done | `InTransitReservation.vehicle`, `FreightLineVehicleStatus.vehicle`, `WorkPlan.vehicle?` (object refs); `SerializedDockRequest.vehicleUid` is serialization-only |
| F7 `lineId` | ✅ Done | `WorkPlan.line?: FreightLineDefinition`; diagnostics reads `.line` → `debugObjectId` display |
| F8 `debugObjectId` lookups | ✅ Done | `HardListSearchPicker.onSelect(item)`; Freight/Vehicle assign/unassign by object ref; `debugObjectId` display-only |
| F9 `interactiveLogObject(uid)` | ✅ Done | `game/object.ts` → `WeakSet` + `isInteractiveLogObject` |
| F10 `.uid` display | ✅ Done | `InspectorSelectableObject` (no `.uid`) |
| F11 `hivePlanIndex` | ✅ Done | `BuildAlveolus.hivePlan` (object ref); `ValidateHivePlanJob.plan`; `hivePlanIndex` only in serialized patches |
| F12 test uid data | ✅ Done | `convey-rebind`/`presentation_events` `.uid` removed; browser specs object-ref based; `trace.test.ts` canaries kept |
| F13 `lineId` mock | ✅ Done | no matches in `FreightStopList.spec.tsx` |
| F14 zone `parseInt` | ✅ Done | no `isZoneObjectUid`/`parseInt` in `apps/browser/src` |

**RESOLVED (2026-08-17).** Freight-line runtime identity is now object reference, backed by a reactive
`Set<FreightLineDefinition>` and mutable+reactive line objects (edits mutate in place). Option (b) was chosen.
`refreshFreightLineReference()` was deleted; `replaceFreightLine` mutates in place and `addFreightLine` is the
add path. The `local.revision`/`state.revision` UI poke tokens were removed.

**RESOLVED (2026-08-17).** Forester zone assignment `Alveolus.assignedZoneIndices: number[]` (index into
`zoneManager.definitions`) → `Alveolus.assignedZones: ZoneDefinition[]` (object refs). Persisted as
`assignedZoneNames: string[]`, resolved via `findZoneByName` at load. Requires zone patches applied **before**
hive patches (reordered in `generate`/`generateAsync`). `action-job-registry.ts` now reads
`assignedZones.flatMap(coordsForZone)`; the browser picker carries `ZoneDefinition` objects, restricted to
named zones. Fixture `exampleGames.ts` foresters now use `assignedZoneNames: ['north-grove' | 'green-ring']`
(the old `[2]` in HearthLoop pointed at the unnamed `commercial` zone — a latent index bug fixed by name).
