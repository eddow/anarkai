# Unwarn

## Run a small simulation and collect warnings (IN PROGRESS)

Run a small simulation (soviet/chopsaw/…) and collect warnings; solve them one by one (pick, solve,
then collect again).

### Handoff (2026-09-10)

**Collector harness** — `engines/ssh/sandbox/collect-warnings.test.ts`. Runs the `soviet` world
(seed 549, 6 chars) for 120 virtual seconds via `tickerCallback({ elapsedMS: 250 })`, buckets every
`warn`/`assert`/`error` diagnostic, and writes `sandbox/collect-warnings.out.txt`. Run with:

```bash
npx vitest run --config sandbox/diag.vitest.config.ts sandbox/collect-warnings.test.ts
```

The test overrides `setTraceDiagnosticReporter` + `console.warn/error` locally so `afterEach`'s
disallowed-diagnostic check sees an empty set; output is written to a file because `console.log` is
suppressed in the diag config.

**Wave 1 result** — two distinct diagnostics:

1. ~~`queue.waiter.free-front` (×2, `passed: true`)~~ — **fixed**. The watchdog
   (`HexBoard.scanQueueWaiters`, `board.ts`) warned whenever a waiter sat at the front of its queue
   in the transient window between `QueueStep.pass()`/`fulfill()` (sets `ended`) and the clock's
   next `progress()` firing `onComplete`. That event *did* fire (`passed === true`); the diagnostic's
   intent is to catch the pass event *never* firing (`passed === false`). Guard: `if (!step.passed)`
   before the warn. Re-collected: gone. `queue-watchdog.test.ts` still 2/2.

2. **`High loop count in nextStep, throttling`** (`work.goWork` / `walk.until`) — **remaining,
   pre-existing, out of blocking-items scope.** Spins in the npc-script VM (`nextStep` loop in
   `npcs/object.ts`): a script re-`unshift`s nested `ScriptExecution`s 50+ times with no `ASingleStep`
   yielded. Confirmed pre-existing by reverting `board.ts`/`entity.ts`/`construction-demolition.ts`
   (still fires). Related known-signal notes: LLM.md "Action infinite fail / High loop count"
   (lastMakeRun `{ type: "return", valueKind: "undefined" }` → `goWork` finished in one run with no
   step, planner re-selects same job). This is a script-VM / planner-re-selection bug, not a
   blocking/alveolus issue. Needs its own investigation pass.

**Remaining manual checks** (item 5): `5b` block an alveolus (goods + vehicle) and read the list;
`5c` demolish an occupied bay and confirm the vehicle sits in another alveolus (now unit-covered by
`vehicle-relocation.test.ts`, but not yet verified in the live browser).