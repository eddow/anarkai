# Projects — remaining work

> Decisions and the full spec live in [`../docs/projects.md`](../docs/projects.md).
> This file is the **TODO list** — only what remains. Science/study (validation) is a
> separate surface; see [`science.md`](./science.md).

## Status (2026-09-05)

Landed: `Project`/`HivePlan` separation, `ProjectCollection` (`draft`/`working`/`archived`), commit
with **instant** validation, board placement (stamp/build/bulldoze/road), demolition
(bulldoze → clean → foundation → construction), road construction sites (roads build like buildings),
**binary take/buy sourcing** (`Project.sourcing` = per-good overrides, resolved via an
availability-sorted list with a take/buy divider — not a rule engine), **forward-declared bills**
(deferred entries + unbuilt roads feed the deficit ledger as `ProjectForwardNeed`), the variant picker
(`build:<root>#<variant>`), the committed-project live progress UI (`Game.projectProgress`),
**post-commit hive grouping** (`groupProjectEntriesIntoHives` — connected components over adjacency),
and **collision/conflict** (roads terminate-at-bay only; board + own-footprint collision only — **no
cross-plan checks**, a project is re-checked against the board when re-opened).

Fix pass (2026-09-05): bill shows expected totals (live state lives in Progress); done-detection
requires planned type/variant and owning road site; disconnected multi-hive projects commit;
cross-plan conflict check removed (no plan checks another); completion auto-archives as `obsolete`;
dedup surfaces `{ project, duplicate }` and skips archived; occupied road anchors stay pending
(no free roads); `project.roads` is stable (built segments read live from the board); ledger +
self-haul + delivery cover road sites; delivery dedupe counts same-tick credits; engineers
advertise `working` demand only; widget adds delete, read-only config labels, toggleable preview.

## Remaining work

### Sourcing / commerce
- [x] **Forward-declare the bill into the net-deficit ledger on push.** Working projects' deferred
      (not-yet-materialized) entry bills contribute to the ledger's demand side; delivery skips them
      (no storage) and they advertise through the normal path once materialized.
- [x] **Buy vs take decision.** `Project.sourcing` is `Partial<Record<GoodType, 'take' | 'buy'>>` —
      explicit per-good overrides (no rule engine). The UI is a bill-only, availability-sorted list
      (`measureGoodAvailability`: produced/held/unproduced) with a "take / buy" divider + "Take all" /
      "Buy all". Wired into the transport spawners (self-haul skips `buy`, delivery skips `take`).
- [x] **Operating demand is out of scope** — a construction project never manages *functioning* goods
      (storage buffers / transform inputs); those are handled by the live hive/commerce, not the plan.
- [x] **Surplus half of the ledger.** A construction plan produces nothing (cleared resources and
      demolition leftovers are not accounted against the project) — `surplus` stays `0`; documented,
      nothing to build for now.

### Project structure / UX
- [x] **"Project hive" grouping** — `groupProjectEntriesIntoHives` clusters the placed alveoli into
      connected components (flood-fill over adjacency, the `Hive` clustering algorithm) **after commit**;
      the committed-project tree shows each hive with its alveoli.
- [x] **Road terminus semantics** — a road may end at a freight bay (real or planned) but never cross it;
      `isRoadTerminusTile` + endpoint-aware `canBuildRoadThroughTile`.
- [x] **Project claims / bounding-box event (no conflict detection).** A project records its entry
      tiles, demolitions, road borders and anchor tiles (`projectClaimKeys` / `ClaimIndex`), which drive
      the `projectClaims` bounding-box event for NPC-growth / netcode invalidation. Claims do **not**
      reject another project — plans never check each other; a project is validated against the live
      board + its own footprint only, and re-checked against the board when re-opened. Completed
      projects auto-archive as `obsolete`, releasing claims.
- [ ] Authoring a project on top of an ongoing project. (TODO — later.)
- [ ] Merge semantics (how two projects' bills combine/conflict). (TODO — later.)
- [ ] Reusable / scattered clones (stamp the same hive N times; shared vs forked config).

### Configuration
- [ ] Review hive/alveoli configuration entirely — see [`work-configuration.md`](./work-configuration.md).

### Science / validation (separate)
- See [`science.md`](./science.md). Currently **instant**; a `validating` stage + research sink is deferred.

## Done (historical, for reference)

- Tile-level `project` → `site` rename; `Project`/`HivePlan` split.
- `ProjectCollection` CRUD + save/load + `knownnessFingerprint` dedup.
- Commit (instant validation) + board materialization + `project` shell link.
- Board placement preview + click/drag authoring (build/road/bulldoze/hive-stamp).
- Demolition: `Project.demolitions` + `roadDemolitions`, `demolish`/`demolishRoad` jobs, refund loose goods.
- Roads build as `RoadConstructionSite`s (advertise demand like buildings).
- Sourcing policy (3-tier) + transport-automation wiring + forward-declared bills.
- Committed-project read-only progress UI + post-commit hive grouping.
