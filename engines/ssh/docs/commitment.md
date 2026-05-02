# Commitment System

The `Commitment` class (`src/lib/commitment/commitment.ts`) is the root lifecycle type for all deferred-resolution objects in the engine. It replaces the old `Finalized` and `AllocationBase` concepts with a single unified type.

## What is a Commitment?

A commitment is something that has been promised and must eventually be resolved. It is the root type for:

- **Steps** — timed activities that tick each frame (`ASingleStep extends Commitment`)
- **Storage allocations** — goods reserved or room promised (`allocate`/`reserve` register callbacks on a commitment)
- **Plans** — NPC work intent backed by allocations (`PlanCommitment extends Commitment`)
- **Convey hops** — goods in flight between borders (the step itself is the commitment)

## Lifecycle

```
not begun (undefined) → begun (false) → fulfilled (true)
                                      → cancelled (string)
```

| `ended` value | Meaning |
|---|---|
| `undefined` | Not yet begun. The commitment exists but hasn't started. |
| `false` | Begun but not resolved. The commitment is in progress. |
| `true` | Fulfilled successfully. |
| `string` | Cancelled with a reason string (for debug/tracing). |

### Transitions

- **`begin()`** — transitions `ended` from `undefined` to `false`. No-op if already begun or resolved.
- **`fulfill()`** — transitions to `true`. Auto-begins if not yet begun. Fires `onFulfilled` then `onFinal` callbacks.
- **`cancel(reason: string)`** — transitions to the reason string. Auto-begins if not yet begun. Fires `onCancelled` then `onFinal` callbacks.

### Why `false` for "begun"?

The `false` value was chosen because:

1. It's falsy, so `if (commitment.ended)` correctly detects "not resolved yet" — same as the old `undefined` check.
2. It's distinct from `undefined` (not begun), `true` (fulfilled), and `string` (cancelled).
3. It allows `fulfill()`/`cancel()` to auto-begin: they check `ended === true || typeof ended === 'string'` to detect "already resolved", and auto-call `begin()` if `ended === undefined`.

## Callbacks

| Method | Fires when | Use case |
|---|---|---|
| `onStarted(cb)` | `begin()` is called | Logging, tracing, trigger side effects when execution starts |
| `onFulfilled(cb)` | Commitment is fulfilled | Commit storage changes, finalize bookkeeping |
| `onCancelled(cb)` | Commitment is cancelled | Roll back storage changes, release resources |
| `onFinal(cb)` | Either way | Clean up references, delete temporary fields |

Callbacks are fired in registration order. `onStarted` callbacks fire once on the first `begin()` call and are cleared immediately. `onFinal` callbacks fire after the phase-specific callbacks. All callbacks are cleared after firing.

## GC Guard

If a `Commitment` is garbage-collected while still `not begun` or `begun`, the finalization registry logs an error with the creation stack and label. This catches leaked commitments that were never resolved.

The guard uses `FinalizationRegistry` (available in Node.js and modern browsers). In environments where it's not available, it degrades to a no-op.

## FailureReason

```ts
type FailureReason = string | undefined
```

Used as the return type for `allocate`/`reserve` after the Phase 3 migration. `undefined` means success, `string` means failure with a reason.

**IMPORTANT:** `''` (empty string) is NOT a valid success signal. The check is `reason !== undefined`, so any string — including `''` — is treated as a failure. Callers must return `undefined` for success.

### assertSuccess

```ts
function assertSuccess(reason: FailureReason, label: string): void
```

Throws if `reason` is a string. Used by every `allocate`/`reserve` call site — high enough severity because these are called from constructors and "must succeed" paths.

## Subclasses

### ASingleStep (steps.ts)

All step types extend `ASingleStep`, which extends `Commitment`. This means every step has a lifecycle:

- `begin()` is called when the step starts ticking
- `fulfill()` is called when the step completes successfully
- `cancel(reason)` is called when the step is interrupted

Steps use their own lifecycle to govern resource allocations. For example, `MultiMoveStep` in the convey system uses itself as the allocation commitment for hop storage — when the step fulfills, the hop allocation is committed; when the step is cancelled, the hop allocation is rolled back.

### PlanCommitment (plan-commitment.ts)

`PlanCommitment` extends `Commitment` and is attached to transfer/pickup plans via a structural `commitment?` field. Plans do **not** extend `Commitment` directly because ArkType string-based schemas define `TransferPlan`/`PickupPlan` as validated shapes, and making plans extend `Commitment` would conflict with ArkType validation.

## Debug display

The `ended` value is mapped to human-readable strings in debug output:

| `ended` value | Display |
|---|---|
| `undefined` | `not-begun` |
| `false` | `begun` |
| `true` | `fulfilled` |
| `string` | `cancelled` |

This mapping is used in:
- `src/lib/npcs/object.ts` — `debugStepSnapshot()`
- `src/lib/dev/debug-game-state.ts` — `stepExecutorSnapshot()`

## Assertion pattern

When checking that a step has completed (e.g., in the `update()` loop), use:

```ts
assert(
  step.ended === true || typeof step.ended === 'string',
  'Step executor is not pending'
)
```

This correctly excludes both `undefined` (not begun) and `false` (begun but not resolved).
