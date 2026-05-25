# Runtime invariants

This document is the living contract for SSH runtime state. It is intentionally incomplete: when a
bug reveals a new implicit rule, add the smallest precise invariant here, then connect it to traces
and tests.

The goal is not to describe every subsystem. The goal is to make invalid state recognizable quickly
enough that a future change, test failure, or agent session can repair the right seam instead of
patching a downstream symptom.

## Policy

An invariant is a statement that must be true outside a named transition window.

Each invariant should include:

- **Name:** stable identifier suitable for trace payloads and tests.
- **Rule:** what must be true.
- **Allowed transition windows:** where the rule may be temporarily false.
- **Primary owners:** files or methods expected to preserve it.
- **Diagnostics:** trace messages, assertions, or tests that expose violations.
- **Repair guidance:** where to start before changing behavior.

Prefer narrow invariants over broad prose. If an invariant needs an exception, name the exception and
document the transition that owns it.

## Trace and invariant identifiers

Use stable dot-separated identifiers in diagnostics:

```ts
traces.vehicle.warn?.('[vehicle.advertisedJobs] loaded docked vehicle has no advertised job', {
	invariant: 'freight.vehicle.docked.loaded-has-advertisement',
	vehicleUid: vehicle.uid,
})
```

Stable identifiers let tests, DevTools, and agents connect a runtime symptom to the contract that
was violated.

Trace channels should remain domain-oriented (`vehicle`, `position`, `convey`, `work`, etc.).
Invariants are connected to a trace channel when that channel's `assert` method is connected:

```ts
traces.vehicle.invariant?.['docked.loaded-has-advertisement'](vehicle)
```

Avoid `trace.something.invariants` as a separate channel per subsystem unless there is a strong
filtering need. It fragments discovery and makes it harder to ask "what invariant failed?"

## Static invariant registry proposal

Longer term, add a small registry module, for example `src/lib/dev/invariants.ts`:

```ts
export const runtimeInvariants = {
	'character.vehicle.walking-has-foot-position': {
		severity: 'error',
		docs: 'docs/invariants#character-vehicle-state',
		owner: 'population',
	},
	'freight.vehicle.docked.loaded-has-advertisement': {
		severity: 'warn',
		docs: 'docs/invariants#docked-vehicle-advertisement',
		owner: 'freight',
	},
} as const
```

Then expose helpers that register channel-local invariant functions:

```ts
registerTraceInvariants('vehicle', {
	'operator-links-are-symmetric': (vehicle, character) => ({
		ok: character.operates?.uid !== vehicle.uid || vehicle.operator?.uid === character.uid,
		payload: { vehicleUid: vehicle.uid, characterUid: character.uid },
	}),
})
```

The trace system should:

- validate the invariant id at compile time;
- attach `invariant`, `docs`, `owner`, and `severity` to the trace payload;
- expose the check at `traces.<channel>.invariant?.[id](...)` only when assertions are enabled;
- feed the existing test diagnostic reporter so invariant failures are test failures by default.

This keeps the invariant list statically discoverable while preserving the existing trace engine.

## Character vehicle state

### `character.vehicle.walking-has-foot-position`

**Rule:** a character that is not driving must have a valid foot position. Reading or setting
`character.position` must not need to recover from an absent `_footPosition` when the character is
not driving.

**Allowed transition windows:** during `onboard()` and controlled vehicle movement, `_footPosition`
may be absent because the vehicle position is authoritative.

**Primary owners:**

- `src/lib/population/character.ts`
- `src/lib/population/vehicle/entity.ts`
- `src/lib/population/vehicle/vehicle.ts`
- `assets/scripts/vehicle.npcs`

**Diagnostics:**

- `[position] character.position.set.recoverFootPositionWithoutVehicle`
- `tests/unit/character-vehicle.test.ts`

**Repair guidance:** inspect operator release/offboard paths before changing position recovery.
Releasing an onboard operator must either call an offboard path or restore foot position from the
vehicle effective position.

### `character.vehicle.operator-links-are-symmetric`

**Rule:** vehicle operation is a two-sided link. When `character.operates` is set, the referenced
vehicle must point back to that character through its service/operator relation. When a vehicle
service has an operator, that character must operate the same vehicle.

**Allowed transition windows:** only inside the methods that establish or clear the link. Do not
leave a script step, work-plan begin/finally, or tick with one side updated and the other side stale.

**Primary owners:**

- `Character.operates`
- `Character.setOperatedVehicleFromService`
- `VehicleEntity.setServiceOperator`
- `VehicleEntity.releaseOperator`
- work-plan begin/finally for vehicle jobs

**Diagnostics:**

- `src/lib/freight/vehicle-invariants.ts`
- `tests/unit/character-vehicle.test.ts`

**Repair guidance:** use the existing seam methods instead of manually mutating both sides. If a new
vehicle job type is added, make its plan begin/finally own the link explicitly.

### `character.vehicle.service-required-for-operation`

**Rule:** a character cannot operate a service-less vehicle. Operation means a work plan or line
service owns the vehicle, not merely that the character is close to it.

**Allowed transition windows:** none after public setters return.

**Primary owners:**

- vehicle work planning
- vehicle service allocation
- character vehicle setters

**Diagnostics:**

- `tests/unit/character-vehicle.test.ts`

**Repair guidance:** if a job needs a vehicle, allocate the service in plan begin before assigning
`character.operates`.

## Docked vehicle advertisement

### `freight.vehicle.docked.loaded-has-advertisement`

**Rule:** a docked vehicle with available physical stock must have one of:

- an advertised job;
- an active dock movement;
- valid dock advertisement candidates;
- a documented reason why no transfer can happen.

Virtual goods and reserved goods do not satisfy "available physical stock" for this invariant.

**Allowed transition windows:** while refreshing docked advertisement candidates or while an active
dock movement is already representing the transfer.

**Primary owners:**

- `src/lib/freight/vehicle-work.ts`
- `src/lib/freight/vehicle-freight-dock.ts`
- `src/lib/freight/vehicle-run.ts`
- hive movement planning

**Diagnostics:**

- `[vehicle.advertisedJobs] loaded docked vehicle has no advertised job`
- `[vehicle.advertisedJobs] dock work exists but bay has no convey job`
- `tests/unit/chopsaw-viability.test.ts`

**Repair guidance:** first separate `stock`, `availables`, `allocated`, and `virtualGoodsCount`.
Then check whether the dock hive already has an active movement for the vehicle dock. Do not create a
new planner job merely to silence the warning if an active movement or candidate already owns the
work.

### `freight.vehicle.dock-work-has-convey-or-active-movement`

**Rule:** if docked vehicle freight work exists, the bay must expose a convey job or already have an
active movement for that vehicle dock.

**Allowed transition windows:** during advertisement refresh before proposed jobs are rebuilt.

**Primary owners:**

- `collectVehicleAdvertisedJobs`
- `refreshDockedVehicleAdvertisement`
- `Hive.collectActiveMovements`

**Diagnostics:**

- `[vehicle.advertisedJobs] dock work exists but bay has no convey job`

**Repair guidance:** inspect candidate target diagnostics before changing scoring. The issue is often
that a target cannot accept the good at the needed priority or an existing allocation/movement is
already consuming the candidate.

## Convey and script execution

### `script.work.yields-or-waits`

**Rule:** a script step must not synchronously spin when work is unavailable. It must yield a real
movement, yield a wait step, invalidate stale planning, or finish because the objective is complete.

**Allowed transition windows:** none. Returning `undefined` is terminal completion, not "try again
immediately".

**Primary owners:**

- `assets/scripts/work.npcs`
- `src/lib/npcs/context/work.ts`
- script execution stepping

**Diagnostics:**

- `High loop count in nextStep`
- `tests/unit/script_execution_regressions.test.ts`

**Repair guidance:** if no actionable movement/work exists, invalidate the relevant plan and wait.
Do not repeatedly return into the same script branch with unchanged state.

### `convey.plan.stale-execution-invalidates`

**Rule:** a stale convey execution must invalidate convey planning and yield, not complete
immediately and let the scheduler select the same stale plan again.

**Allowed transition windows:** while detecting that assigned work no longer matches available
movement.

**Primary owners:**

- `conveyStep`
- hive convey planning invalidation

**Diagnostics:**

- `tests/unit/script_execution_regressions.test.ts`

**Repair guidance:** preserve the stale-plan regression tests when changing convey planning. A
failure here often presents later as a high loop count rather than as a clear convey error.

## Test policy

Warnings that represent invariant drift should fail tests by default through `test-setup.ts`.
Temporary noisy diagnostics should be explicitly downgraded, narrowed, or allow-listed by test scope;
do not leave broad warning patterns active in the general suite.

Recommended smoke command for runtime contract work:

```bash
pnpm --filter ssh exec vitest run \
	tests/unit/character-vehicle.test.ts \
	tests/unit/vehicle-usage.test.ts \
	tests/unit/chopsaw-viability.test.ts \
	tests/unit/script_execution_regressions.test.ts
```

Always pair a new invariant with at least one of:

- a focused unit test;
- a viability/integration scenario;
- a trace diagnostic pattern that fails tests when emitted.

## Updating this directory

When a new issue appears:

1. Name the violated invariant, even if the first name is rough.
2. Add the observed diagnostic or symptom.
3. Document the smallest rule that would have prevented it.
4. Add or update the test that should fail next time.
5. Only then implement the behavior change.

This order keeps the contract ahead of the fix and gives the next maintainer a map.
