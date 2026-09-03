# Projects — remaining work

> Decisions and the full spec live in [`../docs/projects.md`](../docs/projects.md).
> This file is the **TODO list** — only what remains. Science/study (validation) is a
> separate surface; see [`science.md`](./science.md).

## Status (2026-09-03)

Landed: `Project`/`HivePlan` separation, `ProjectCollection` (`draft`/`working`/`archived`), commit
with **instant** validation, board placement (stamp/build/bulldoze/road), demolition
(bulldoze → clean → foundation → construction), road construction sites (roads build like buildings),
per-good sourcing (`auto`/`take`/`buy`), the variant picker (`build:<root>#<variant>`), and the
committed-project live progress UI (`Game.projectProgress`).

## Remaining work

### Sourcing / commerce
- [ ] **Forward-declare the bill into the net-deficit ledger on push.** Today only *materialized*
      shells advertise demand; deferred-demolition entries do not until their tile is cleared.
- [ ] **Operating demand in the bill** (storage buffers / transform inputs), not just construction recipes.
- [ ] The surplus (producer-export) half of the ledger — sourcing resolution covers demand only.

### Project structure / UX
- [ ] **"Project hive" grouping** — group placed alveoli into named hives for deletion/configuration
      and progress-bar grouping (hives must stay internally connected). Ships the lighter tree today
      (flat alveoli + roads grouped by same-type-connected).
- [ ] Authoring a project on top of an ongoing project.
- [ ] Merge semantics (how two projects' bills combine/conflict).
- [ ] Reusable / scattered clones (stamp the same hive N times; shared vs forked config).

### Science / validation (separate)
- See [`science.md`](./science.md). Currently **instant**; a `validating` stage + research sink is deferred.

## Done (historical, for reference)

- Tile-level `project` → `site` rename; `Project`/`HivePlan` split.
- `ProjectCollection` CRUD + save/load + `knownnessFingerprint` dedup.
- Commit (instant validation) + board materialization + `project` shell link.
- Board placement preview + click/drag authoring (build/road/bulldoze/hive-stamp).
- Demolition: `Project.demolitions` + `roadDemolitions`, `demolish`/`demolishRoad` jobs, refund loose goods.
- Roads build as `RoadConstructionSite`s (advertise demand like buildings).
- Per-good sourcing policy + transport-automation wiring.
- Committed-project read-only progress UI.
