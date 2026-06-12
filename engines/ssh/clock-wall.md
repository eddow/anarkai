# Clock wall — Refactoring plan & ClockHeap spec

> **Goal**: a single `ClockHeap` drives all simulation work. The interface is pure `dt`: `advance`, `setTimeout`, `setInterval`. No absolute time leaks out. Time wraps — no unbounded growth. All `dt` branching logic lives inside the ClockHeap, localized and heavily tested.

---

## 1. Current state

### 1.1 The tick loop (`game.ts:1066`)

```
requestAnimationFrame
  → SimulationLoop.tick()
    → tickerCallback (mutts `atomic`)
      → compute deltaSeconds = gameRootSpeed × elapsedMS × speedFactor / 1000
      → clock.virtualTime += deltaSeconds
      → for each tickedObject → update(deltaSeconds)
```

Every object gets the **same** `deltaSeconds`, every frame (~60×/s).

### 1.2 Who's in `tickedObjects` today

| # | Object | What happens | Invariant under dt-subdivision? |
|---|--------|-------------|-------------------------------|
| 1 | **Character** (×N) | Step execution loop: burns through all completable steps in `while(remaining)` | **No** — causal order of step completions depends on dt magnitude |
| 2 | **UnBuiltLand** (×N tiles) | `treeAge += dt`; Poisson spawning | Yes — linear & memoryless exponential |
| 3 | **LooseGoods** (singleton) | Decay: `p = 1 − 2^(−dt/halfLife)`, binomial kill per good-type | Yes — exponential decay is memoryless |
| 4 | **ResidentialDemandTicker** (singleton) | `cooldown += dt`; if ≥2s, spawn dwelling | Yes — linear accumulator |
| 5 | **Inline lambda** | `bayQueueRegistry.updateAllQueues()` + every 2s: stale reservation cleanup | Yes — idempotent polling; cleanup is periodic sweep |

---

## 2. ClockHeap — the replacement

### 2.1 Pure-dt interface

No absolute time anywhere in the API. Only delays from now.

```ts
class ClockHeap {
    /** Advance the simulation clock by dt seconds. Process all due events. */
    advance(dt: number): void

    /** Schedule a one-shot callback after dt seconds from now. */
    setTimeout(dt: number, callback: () => void): void

    /** Schedule a recurring callback every dt seconds. Returns a cancel function. */
    setInterval(dt: number, callback: () => void): () => void

    /** Current virtual time (exposed for computed-read getters; wraps at UINT32_MAX µs). */
    readonly now: number  // u32 µs, wrapping

    /** Number of pending events. */
    readonly size: number
}
```

All `dt` values are in **virtual seconds** (pause when paused, accelerate with speed factor). Internally converted to µs integers.

### 2.2 Internal design — anchor ring buffer + dt

Time is a wrapping u32 of microseconds (`TIME_MAX = 0xFFFFFFFF ≈ 71.5 min`). The heap never stores absolute times — each entry stores `dtUs` (remaining delay) relative to a **time anchor**.

```
anchors: RingBuffer<{ id: u16, timeUs: u32 }>  // fixed size, e.g. 256

Entry: { dtUs: u32, anchorId: u16, callback: () => void }
```

**Rebasing** (runs once per `advance()` call):

1. Create a new anchor at `this.virtualTimeUs`.
2. For every heap entry, compute its remaining delay from the new anchor:
   ```
   scheduledUs = (anchors[entry.anchorId].timeUs + entry.dtUs) & TIME_MAX
   remainingUs = (scheduledUs - newAnchor.timeUs) & TIME_MAX
   entry.dtUs = remainingUs < TIME_MAX/2 ? remainingUs : 0  // overdue → fire now
   entry.anchorId = newAnchor.id
   ```
3. Rebuild the heap (all entries now share the same anchor → ordered by `dtUs`).

**Processing** (after rebase + virtualTime advance):

```
while heap not empty && heap[0].dtUs ≤ this.dtAdvancedUs:
    entry = heap.pop()
    entry.callback()
    // callback may call setTimeout/setInterval → new entries appended
    // new entries use the current anchor → dtUs is relative to newAnchor.timeUs
    // but virtualTime has already advanced, so we check dtUs ≤ dtAdvancedUs
```

**setTimeout(dt, callback)**:
```
dtUs = Math.round(dt * 1e6)
this.heap.push({ dtUs, anchorId: this.currentAnchor.id, callback, cancel: undefined })
```

**setInterval(dt, callback)**:
```
const self = this
const schedule = () => { callback(); self.setTimeout(dt, schedule) }
this.setTimeout(dt, schedule)
return () => { /* mark as cancelled */ }
```

### 2.3 Why this design

| Property | How |
|----------|-----|
| **No unbounded time** | u32 wraps every 71 minutes; anchors wrap after `256 × 71min ≈ 12 days` |
| **No absolute time in API** | Only `dt` from now. `now` is exposed for render-layer getters but never for scheduling |
| **dt consistency localized** | All `delay → wakeTime → comparison` logic lives in ClockHeap. No other module computes wake times |
| **Deterministic** | Integer arithmetic, modular comparison, heap ordering by `dtUs` then by insertion order |
| **Pause-safe** | `advance(0)` → anchor created, rebase, nothing fires. Time frozen |
| **Speed-safe** | `advance(bigDt)` → more events fire in one batch. Same ordering as `advance(smallDt)` called repeatedly |
| **Heavily testable** | Pure function of `(push sequence, advance sequence) → fire sequence`. No game state needed |

### 2.4 Modular time comparison

```
isFuture(a: u32, b: u32): boolean =
    ((b - a) & TIME_MAX) < TIME_MAX/2
    // a is before b if the clockwise distance from a to b is < half the circle
```

Unit-tested at: 0, 1, TIME_MAX-1, TIME_MAX, TIME_MAX/2, TIME_MAX/2+1, wrap point.

---

## 3. How entities use ClockHeap

### 3.1 Character steps

The `withScripted` mixin no longer receives `update(dt)`. Instead, each character is a heap entry.

```
Character has: lastWakeUs: u32, stepExecutor: ASingleStep | undefined

// Called by ClockHeap when the character's delay expires
character.advanceTo(targetUs: u32): number | undefined
    if (!stepExecutor) return undefined  // idle, don't reschedule
    dtUs = (targetUs - lastWakeUs) & TIME_MAX
    dtSeconds = dtUs / 1e6
    remaining = stepExecutor.tick(dtSeconds)
    lastWakeUs = targetUs
    if remaining !== undefined:
        stepExecutor = undefined
        this.nextStep()  // chain, may set new stepExecutor
    if stepExecutor:
        return stepExecutor.remainingUs  // reschedule with remaining delay
    return undefined  // idle

// External wake-up (job assigned, freight arrives)
character.wake():
    clockHeap.setTimeout(0, () => character.advanceTo(clockHeap.now))
```

### 3.2 Periodic accumulators

```
// Resource growth, good decay, tree aging — all become setInterval
clockHeap.setInterval(1.0, () => {
    looseGoods.update(1.0)
    unbuiltLandBatch.update(1.0)
    residentialDemandTicker.update(1.0)
})

// Stale reservation cleanup every 2s
clockHeap.setInterval(2.0, () => {
    cleanupStaleReservationsOnAllSites(tiles, clockHeap.now)
})
```

### 3.3 BayQueueRegistry — removed from ClockHeap

Already fully event-driven via lifecycle hooks. The per-tick polling is deleted.

---

## 4. Computed-read layer (mutation vs interpolation)

The heap only fires **mutations** at precise moments. Smooth visual state (progress bars, positions, needs) becomes **computed getters** queried each render frame from step metadata + `clockHeap.now`.

| State | Current (push) | New (computed read) | Definitive at |
|-------|---------------|---------------------|---------------|
| `character.position` | `ALerpStep.lerp()` in `evolve()` | `lerp(from, to, elapsed/duration)` | step completion |
| `transform.processBuffer` | `TransformStep.evolve()` → `setProcessBuffer()` | `start + rate * duration * clamp(t,0,1)` | step completion |
| `hunger/fatigue/tiredness` | `applyNeedRate()` in `update(dt)` | `clamp(baseValue + rate * elapsed, 0, 1)` | periodic tick sets new baseValue |
| `treeAge` | `+= dt` | `baseAge + elapsed` | periodic tick sets new baseAge |

The render layer queries getters each frame; Mutts `$()` tracking picks up `clockHeap.now` as a dependency.

---

## 5. New architecture

```
   requestAnimationFrame
         │
         ▼
   ┌─────────────────────────────────────────────────────┐
   │  tickerCallback                                     │
   │                                                     │
   │  deltaSeconds = wallDelta × speedFactor × rootSpeed │
   │  clockHeap.advance(deltaSeconds)                    │
   │    ├─ rebase all entries to new anchor              │
   │    ├─ advance virtualTime                           │
   │    └─ while heap[0].dtUs ≤ delta: fire             │
   │         ├─ Character.advanceTo() → step tick/chain │
   │         ├─ setInterval callbacks → reschedule       │
   │         └─ setTimeout callbacks → one-shot          │
   └─────────────────────────────────────────────────────┘
         │
         ▼ (render frame boundary)
   ┌─────────────────────────────────────────────────────┐
   │  Render layer                                       │
   │  queries computed getters (position, buffer, etc.)  │
   │  all read clockHeap.now for interpolation           │
   └─────────────────────────────────────────────────────┘
```

---

## 6. Phase order

### Phase A — Build ClockHeap (zero game dependency)

1. Create `engines/ssh/src/lib/utils/clock-heap.ts`
2. Create `engines/ssh/src/lib/utils/clock-heap.spec.ts`
3. Tests cover:
   - `setTimeout` fires after exact dt
   - `setInterval` fires every dt, returns cancel fn
   - Multiple intervals interleave correctly
   - `advance(0)` fires nothing
   - `advance(large)` fires all pending
   - Rebase correctness: schedule at different moments, events fire in correct order
   - Wrapping: schedule near TIME_MAX, advance across wrap, events fire correctly
   - Cancel: `setInterval` cancel stops further fires
   - Recursive scheduling: callback calls `setTimeout` → fires in same or next batch

### Phase B — Wire characters into ClockHeap

1. Add `clockHeap: ClockHeap` to `Game`
2. Remove `tickedObjects` Set and `registerTickedObject`/`unregisterTickedObject`
3. Remove `withTicked` mixin from `Character`
4. Replace `withScripted.update(dt)` with character as heap entry
5. Replace `tickerCallback` body with `clockHeap.advance(deltaSeconds)`
6. Wake-up triggers push characters onto the heap

### Phase C — Move accumulators to setInterval

1. Create `clockHeap.setInterval(1.0, batchUpdate)` for LooseGoods, UnBuiltLand, ResidentialDemandTicker, stale cleanup
2. Remove `withTicked` from `UnBuiltLand`, `LooseGoods`
3. Remove the `ResidentialDemandTicker` manual register/unregister

### Phase D — Remove BayQueueRegistry polling

1. Delete inline lambda from `game.ts`
2. Deprecate `updateAllQueues()`

### Phase E — Polish

1. Serialize heap state for save/load (ordered array of `[{ dtUs, anchorId }, ...]` + anchor buffer + virtualTimeUs)
2. Remove dead `tickedObjects` infra
3. Invariant assertions

---

## 7. Determinism contract

| Scenario | Deterministic? |
|----------|---------------|
| Same seed, same frame rate | ✅ |
| Same seed, different frame rate | ✅ (heap ordered by dt, not Set iteration) |
| Same seed, headless vs browser | ✅ |
| Save → reload → continue | ✅ (heap + anchors + virtualTime serialized exactly) |
| Same seed, different speed factor | ✅ (only changes how much dt passes per wall-second) |
| Paused then unpaused | ✅ (virtual time frozen; heap frozen) |
| Server running for months | ✅ (u32 wraps, anchor buffer wraps, rebase resets) |

---

## 8. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Rebase O(N) per frame | N ≈ 200 entries; one pass of arithmetic per frame — microseconds |
| Integer µs rounding vs float seconds | Round once: `Math.round(seconds * 1e6)`. All heap ops integral |
| Modular comparison off-by-one at wrap | Exhaustive unit tests at boundary values |
| Overdue event gets large dtUs after rebase | Clamped to 0 (fire ASAP); verified in tests |
| Anchor buffer wrapping | 256 × 71min ≈ 12 days before wrap; rebase handles it |
| setInterval callback throws | Caught, logged, interval continues (or stops — configurable) |
