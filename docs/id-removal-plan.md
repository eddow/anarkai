# Plan: Remove Runtime IDs from SSH Entities

> Updated 2026-08-17 — **Status corrected.** Phase F is still in progress; the earlier "ALL runtime IDs removed" banner overstated completion. Core runtime `.uid` removal (Phase A+B), the serialization bridge, and trace payloads are done; inspector dispatch (`selectedUid`), synthetic uid keys, and the `vehicleUid`/`lineId` string fields are still TODO. See the per-item snapshot at the bottom.

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
| **Phase D** (browser `.uid`/`.id` cleanup) | ⚠️ Partial — `selectedUid` + `debugObjectId` lookups remain (F1, F8) |
| **Phase E** (trace `.uid` cleanup) | ✅ Completed — trace payloads use `debugObjectId()` as display |
| **Serialization bridge** | ✅ Completed — index-based vehicle/character/line/plan refs in save/load |
| **Final audit 2026-08-02** | ⚠️ Incomplete — swept object `.uid` only; missed `selectedUid`, `vehicleUid`, `lineId`, `zoneObjectUid`, synthetic uid keys |
| **Phase F (F1–F14)** | ⏳ In progress — 6 done, 1 partial, 7 TODO (see snapshot) |

## Principles (for removal)

1. **Delete, don't convert**: When a `Map<string, T>` is keyed by object identity, delete the Map and the string keying. Don't rename the key — remove the indirection.
2. **Object identity is the identity**: Two references to the same object are equal (`===`). No string needed.
3. **Index, not ID, in serialization**: Arrays have inherent order. Array position is the identity.
4. **Debug labels are transient**: `WeakMap<object, string>` for trace/log only. Never part of the object's type.
5. **Dead code dies immediately**: A removed `.uid` property must delete every line that read it.

---

## Phase A+B: DONE — `.uid` removal from runtime ✅

*Committed as `eec4b8c "killing ids"`. 46 files, ~370 changes.*

Removed `.uid` from every runtime object: `Map<string,T>` → `Map<Vehicle,T>` (bay queue, freight docks), `DockRequest.vehicleUid`/`MovementGrant.vehicleUid` → object refs, all `.uid` comparisons → `===`, `Game.getObject()` deleted, `uid` removed from `GameObject` mixin / `InteractiveLogObject` / `InspectorSelectableObject`, cache keys → `debugObjectId()`, error/log payloads → `debugObjectId()`. Result: 270+ `.uid` refs deleted, 0 tsc errors, bay-queue 21/21.

## Phase C: PARTIAL — `FreightLineDefinition.id` removal ⚠️

*Committed as `62fcebb "b4c"`.*

Deleted `id` from `FreightLineDefinition`; removed implicit-gather line synthesis; `VehicleHopJob.lineId`/`ZoneBrowseJob.lineId` → required `line` object ref; all `line.id` trace payloads → `debugObjectId(line)`; serialization now index-based (`lineIndex`, `servedLineIndices`, `VehiclePatch.servedLineIndices`).

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

1. ⏳ **F1**: `selectedUid: string` → `selectedObject: object` — `selectedObject` added + preferred, but `selectedUid` remains as localStorage/pinned-panel fallback.
2. ✅ **F2**: `freight-line:${index}` → direct line object — synthetic keys gone.
3. ❌ **F3**: `hive-plan:${index}` → direct plan object — still at `plan-manager.tsx:344`.
4. ❌ **F4**: `hive:${anchorUid}` → direct hive object — `hiveUidForAnchorTile` / `createSyntheticHiveObjectForUid` still present.
5. ✅ **F5**: `zone:` uid → direct ZoneObject — `ZoneObject` now holds the `ZoneDefinition` by reference; `zoneObjectUid`/`ZONE_UID_PREFIX` removed; paint token is name-keyed (`zone:${name}`).
6. ❌ **F6**: `vehicleUid` → Vehicle reference — still at `build-site.ts:31`, `bay-queue-types.ts:115`, `jobs/offers.ts:14`, `types/base.ts:97,138,155,166`, `trace.ts:507,516,549`.
7. ❌ **F7**: `lineId` → line reference — still at `types/base.ts:92`, `npc-diagnostics.ts:30`.
8. ❌ **F8**: `debugObjectId` lookups → object identity — still at `FreightLineProperties.tsx:420`, `VehicleProperties.tsx`, `follow-selection.ts:106`, `selection-info.tsx:245`.
9. ✅ **F9**: `interactiveLogObject(uid)` registry → delete — replaced with `WeakSet` (`isInteractiveLogObject`).
10. ✅ **F10**: `.uid` display → `debugObjectId` — `InspectorSelectableObject` has no `.uid`.
11. ❌ **F11**: `hivePlanIndex` → plan object ref — still at `plan-manager.tsx`, `hive-plan.ts:364`, `action-job-registry.ts:441`, `work.ts:1385`.
12. ❌ **F12**: Test uid data → object refs — still at `convey-rebind.test.ts:25`, `presentation_events.test.ts:20-52`, `trace.test.ts:16-26`, plus browser `selectedUid` specs.
13. ✅ **F13**: `FreightStopList.spec.tsx` `lineId` mock — gone.
14. ✅ **F14**: zone `parseInt` key parsing — gone (remaining `zoneObjectUid` is F5).

## Phase F status snapshot (2026-08-17)

| Item | Status | Verified against |
|---|---|---|
| F1 `selectedUid` | ⏳ Partial | `globals.ts:23,31`, `App.tsx:75,87`, `follow-selection.ts:102,194`, `selection-info.tsx:232,268,349`, `game.tsx:114-116` |
| F2 `freight-line:${index}` | ✅ Done | no source matches |
| F3 `hive-plan:${index}` | ❌ TODO | `plan-manager.tsx:344` |
| F4 `hive:${anchorUid}` | ❌ TODO | `hive-inspector.ts:16`, `selection-info.hive.spec.tsx:129` |
| F5 `zoneObjectUid` | ✅ Done | `ZoneObject.definition` (object ref); `zoneObjectUid`/`ZONE_UID_PREFIX` deleted; `findZoneByName`/`removeZoneDefinition` added |
| F6 `vehicleUid` | ❌ TODO | `build-site.ts:31`, `bay-queue-types.ts:115`, `jobs/offers.ts:14`, `types/base.ts`, `trace.ts` |
| F7 `lineId` | ❌ TODO | `types/base.ts:92`, `npc-diagnostics.ts:30` |
| F8 `debugObjectId` lookups | ❌ TODO | `FreightLineProperties.tsx:420`, `VehicleProperties.tsx`, `follow-selection.ts:106`, `selection-info.tsx:245` |
| F9 `interactiveLogObject(uid)` | ✅ Done | `game/object.ts` → `WeakSet` + `isInteractiveLogObject` |
| F10 `.uid` display | ✅ Done | `InspectorSelectableObject` (no `.uid`) |
| F11 `hivePlanIndex` | ❌ TODO | `plan-manager.tsx`, `hive-plan.ts:364`, `action-job-registry.ts:441`, `work.ts:1385` |
| F12 test uid data | ❌ TODO | `convey-rebind.test.ts:25`, `presentation_events.test.ts:20-52`, `trace.test.ts:16-26` |
| F13 `lineId` mock | ✅ Done | no matches in `FreightStopList.spec.tsx` |
| F14 zone `parseInt` | ✅ Done | no `isZoneObjectUid`/`parseInt` in `apps/browser/src` |

**RESOLVED (2026-08-17).** Freight-line runtime identity is now object reference, backed by a reactive
`Set<FreightLineDefinition>` and mutable+reactive line objects (edits mutate in place). Option (b) was chosen.
`refreshFreightLineReference()` was deleted; `replaceFreightLine` mutates in place and `addFreightLine` is the
add path. The `local.revision`/`state.revision` UI poke tokens were removed.
