# Hive Refresh And Good Movements

This document describes the current topology refresh model for hives and the lifecycle rules for Good Movements (GMs).

It exists because hive / convey bugs tend to come from one bad assumption: treating a `Hive` object as durable gameplay identity. It is not. Hive objects are rebuildable topology containers. Good Movements are the durable intent.

## Core Model

### Hive identity

- A hive is the connected component of touching alveoli.
- Hive connectivity is derived from board topology.
- A `Hive` instance is ephemeral and may be destroyed/recreated during topology refresh.
- Hive names and configurations are migrated when possible, but the object instance itself is not authoritative identity.

### Good Movement identity

- A GM is identified by a stable `movementId`.
- A GM survives hive restructuration as long as its target still exists and a valid path still exists from the good's current position.
- GM target identity is the destination coord, not the old alveolus object instance.
- Rebinding a GM after refresh must preserve `movementId`.

### Terminal outcomes

A GM may end only in one of these ways:

- it is effectuated successfully,
- it becomes impossible because the target alveolus no longer exists,
- it becomes impossible because the rebuilt topology no longer provides a path,
- it is explicitly downgraded into a free good after such impossibility.

Hive destruction/recreation alone is never a terminal reason.

## Refresh Transaction

Topology edits are coalesced at the board level.

### Trigger

When tile content changes:

- the old alveolus is detached from its current hive for refresh,
- affected hives are marked dirty,
- the board schedules one deferred topology refresh pass.

This avoids immediate per-edit teardown/rebuild churn during multi-step construction or replacement.

### Transaction phases

The deferred refresh pass does this:

1. Mark touched hives as reconstructing.
2. Snapshot live GMs from those hives.
3. Collect all still-present alveoli from the touched region.
4. Rebuild connected hives by touching flood fill.
5. Rebind or recreate GMs against the rebuilt topology.
6. Run a post-refresh invariant pass.
7. Destroy the old hive objects.

While a hive is reconstructing:

- watchdog scans must not treat movements as broken,
- advertisement scheduling is suppressed,
- wake-ups that would create new movements are suppressed.

## GM Snapshot Semantics

The durable snapshot contains enough information to survive hive reconstruction without depending on the old hive object:

- `movementId`
- `goodType`
- `currentCoord`
- `targetCoord`
- `providerCoord` as best-effort provenance
- `claimed`
- `claimedBy`
- `claimedAtMs`
- whether the movement was tile/border tracked
- best-effort pointer to the previous live movement object

Important: the snapshot source is the current physical location of the good, not the original provider tile.

## Rebind Rules

### Preferred path: rehome existing movement

If the rebuilt topology still supports the movement without changing its logical meaning:

- reuse the existing movement object,
- move it from the old hive tracking tables to the rebuilt hive,
- recompute its path from `currentCoord` to `targetCoord`,
- preserve `movementId`,
- preserve claim metadata if continuity is still valid.

This path is especially important for hive merges, where many movements can remain valid with no need to recreate allocations.

### Fallback path: recreate movement bookkeeping

If direct rehome is not safe:

- cancel the old snapshot movement bookkeeping,
- recreate source/target allocations against the rebuilt topology,
- recreate the GM with the same `movementId`,
- preserve claimed state when the movement is still in-flight and the rebuilt state supports it.

### Cancellation path

If the rebuilt topology makes the GM impossible:

- cancel bookkeeping,
- remove one unit from the source/current storage when needed,
- spawn a free good on the most local valid tile.

Current policy prefers explicit free-good downgrade over silently relocating the good elsewhere.

## Claimed / In-Flight Movements

Claimed movements survive refresh too.

Rules:

- claimed GMs are snapshotted,
- claim metadata is preserved when the GM can be rebound safely,
- claimed GMs are not required to be tile-tracked during the refresh window,
- invariant checks must tolerate claimed source gaps and claimed terminal-path windows.

If exact claim continuity cannot be proven in a future scenario, the intended fallback is to keep the GM and clear only the claim, not cancel the GM.

## Invariants

After refresh, live movements should satisfy all of these:

- each live `movementId` is unique,
- each GM belongs to exactly one live hive,
- `currentCoord` matches movement tracking when the movement should be tracked,
- target coord resolves to a live alveolus,
- source/target allocations belong to the same logical movement,
- a path exists from `currentCoord` to `targetCoord`,
- refresh-suspended movements are never discarded as corruption during the transaction.

In steady state, violations are real bugs and should be treated as such.

## Interaction With Watchdog And Job Selection

### Watchdog

The watchdog must distinguish:

- steady-state broken movement,
- transactionally suspended movement during topology refresh,
- valid claimed transient windows.

Refresh-suspended movements should not emit broken/detached warnings purely because the topology is being rebuilt.

### `aGoodMovement`

`aGoodMovement` should only consider steady, actionable movements.

- Claimed movements are skipped for pickup selection.
- Refresh-suspended movements must not be interpreted as corruption.
- After refresh completes, the rebuilt hive may wake wandering workers if a valid GM remains actionable.

## Current Regression Coverage

The regression suite currently covers these topology-sensitive cases:

- movement rebind after target replacement on the same coord,
- claimed movement identity preserved through target replacement,
- impossible movement downgraded to a free good after hive split,
- existing movement id survives a hive merge through a new bridge.

The full watchdog suite still has broader lifecycle instability outside this topology-refresh design, so targeted regressions are the most trustworthy coverage for this subsystem.

## Practical Guidance

When changing hive or convey code:

- never key GM lifetime off `Hive` object identity,
- preserve `movementId` whenever intent survives,
- rebind from the good's current position, not from original creation assumptions,
- treat replacement on the same coord as continuity by default,
- only cancel on true impossibility after rebuilt topology is known,
- add a targeted regression for any new topology/convey edge case before refactoring further.
