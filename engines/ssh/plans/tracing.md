# Tracing — debug level semantics, watch toggle UI, and subject-aware API

Status: **design / plan only** — nothing implemented yet. The tracing runtime lives in
`engines/ssh/src/lib/dev/{trace,debug,watch,debug-object-id}.ts`; the consumer-facing pieces are in
`engines/ssh/src/lib/game/object.ts` (`InteractiveLogObject`) and
`apps/browser/src/widgets/selection-info.tsx` (`Logs` section).

This documents three related changes to the tracing system:

1. Define the `debug` trace level as "`assert` for everyone, `log` for watched subjects".
2. A per-entity **debug toggle** in the property widget (puts the entity on watch + surfaces its log).
3. Refactor the channel API from `traces.vehicle.log?.(...)` to `traces.vehicle(subject).log?.(...)`.

---

## Current state (what already exists)

### The trace level ladder

`TraceVerb` (ordered) is `log < debug/warn < assert < error` (see `TRACE_VERB_RANK` in `debug.ts`).
A channel's level gates which console-like methods are `undefined` (so `?.` short-circuits before
evaluating arguments):

- `log` → everything (`log`, `debug`, `info`, `trace`, `warn`, `assert`, `error`) enabled.
- `warn` / `debug` → `warn`, `assert`, `error` enabled; `log`/`info`/`trace` undefined.
- `assert` → `assert`, `error` enabled; `log`/`warn`/`debug` undefined.
- `error` → `error` only.

All default channels are `assert` (`traceLevels` in `debug.ts`).

### Subject-aware tracing (`traceFor` / `forSubject`)

`traceFor(channel, subject)` already exists and returns a **subject-bound view** of a channel:

- At any level other than `debug`, it returns the live channel sink unchanged.
- At the `debug` level, `NamedTraceList.forSubject(subject)` returns a view whose `log`/`info`/`trace`
  are enabled **only when `isWatched(subject)` holds**; `warn`/`error`/`assert` stay uniform for
  everyone. Unwatched subjects keep `log === undefined`, so their arguments never evaluate.

This is exactly the "assert for everyone + log for watched" behaviour the user describes — it is
**already implemented** for the `warn`-adjacent `debug` level in `forSubject`.

### The watch filter

`watch.ts` keeps a `WeakSet` of watched objects keyed by the raw (unproxied) target so Mutts proxies
and their targets resolve to one entry. `watch` / `unwatch` / `isWatched` are the API.

### Per-entity logs

`withInteractive()` (`game/object.ts`) mixes in `logs: string[]` (reactive) + `logAbout(topic, ...args)`.
The trace sink's `pushRow` collects any `InteractiveLogObject` found in the args and calls
`object.logAbout(row, text)`, so traced entities already accumulate a per-entity log.
`Vehicle`, `Character`, `Tile` (and settlements) all use `withInteractive`.

`selection-info.tsx` already renders `current.logs` in a collapsible **`Logs` `InspectorSection`** at
the bottom of the property widget.

### Two coexisting call styles

Call sites are split today:

- **Channel style** — `traces.vehicle.log?.('event', payload)` (~most call sites) and
  `traces.vehicle.assert?.(cond, msg)` (invariants, non-subject).
- **Subject style** — `traceFor('vehicle', vehicle).log?.('event', payload)` (~30+ sites across
  `vehicle-run.ts`, `vehicle-work.ts`, `vehicle-freight-dock-sync.ts`, `npcs/context/vehicle.ts`,
  `population/vehicle/entity.ts`).

The two styles coexist because `traceFor` was introduced later; channel-style sites do **not** scope
their `log` by subject, so at `debug` they fire for *everyone* (subject-scoping is lost).

---

## Channel classification (decided)

Every channel falls into one of three buckets. This is the call-site audit result (surveyed
2026-09-08 over `engines/ssh/src/**`), and it drives the API shape in "Subject-aware channel API"
below.

### A. Entity-attached — compulsory subject argument

The trace always describes one watchable entity; the subject is a **required** argument (not
optional, not channel-style):

| Channel | Subject | Notes |
| --- | --- | --- |
| `vehicle` | `Vehicle` | ~30 `traceFor` sites + ~60 channel-style sites, all with a local `vehicle`/`character` in scope. One site passes a `character` (`vehicle-work.ts:2412` `traceFor('vehicle', character)`) — still entity-attached, subject is the operator. |
| `position` | `Character` | `character.ts` only; payload already embeds `uid: debugObjectId(this)`. |
| `npc` | `Character` | `npcs/object.ts` `nextStep` loop/throttle, `this`-scoped. |
| `script` | `Character` | **script-bound** traces only (see split below). |

### B. Entity-less — unchanged

No single entity to watch; these stay exactly as they are (`traces.queue.log`, no subject argument):

`queue`, `advertising`, `allocations`, `commitments`, `bay`, `commercial`, `residential`,
`terrain`, `ui`, `i18n`, `characterNeeds`, `idleDiagnosis`, `forwardProbe`, `identityProbe` —
plus the **new generic-script channel** (below).

### C. Hybrid — named-argument subject

The trace is about one of *several* possible entities, selected by a **named argument object** rather
than a positional subject:

| Channel | Subject shape | Notes |
| --- | --- | --- |
| `convey` | `{ vehicle?, character?, alveolus?, tile? }` | subject alternates — `alveolus` (`this.name`) in `alveolus.ts`/`work.ts`, `character` in `inventory.ts`, and some sites describe a `Tile`. |
| `work` | `{ vehicle?, character?, alveolus?, tile? }` | construction + harvest/convey work steps; subject implicit in scope today. |

### The `script` split (decided)

`script` is genuinely mixed today: **character-bound** traces (`makeRun scriptsContext undefined`,
`No LooseGoods to grab`, plan begin/conclude — all carry a character) sit alongside **generic
engine** traces (`Error during gameStart emission`, `EatStep deserialize skipped`, `LooseGood not
found`, `Missing context prototype`).

Split it:

- **`script` (entity-full)** — keep the channel name, but it becomes entity-attached: compulsory
  `character` argument, `traces.script(character).log?.(...)`.
- **New entity-less channel** — move the generic engine traces to a new channel. Proposed name:
  **`scriptEngine`** (alternatives: `scriptRuntime`, `engineScript`). It is entity-less like `queue`/
  `terrain` and stays `traces.scriptEngine.warn?.(...)`.

---

## Goal

### 1. `debug` level ≡ `warn` (everyone) + `log` (watched)

Lock in the semantics, already materialized by `forSubject`, as the definition of `debug`. Note the
ordering correction: `debug` sits **just below `log`** in the ladder, so it is `warn`-adjacent, not
`assert`-adjacent — the settled definition is:

- Unwatched subject → `warn`/`error`/`assert` fire for everyone; `log`/`info`/`trace` are `undefined`
  (their arguments never evaluate). `warn` is **uniform** (it is the "something is off but not fatal"
  channel and should not require watch).
- Watched subject → full `log`-level methods (`log`, `info`, `trace`) are live, on top of
  `warn`/`error`/`assert`.

This matches the existing `forSubject` exactly — it is implemented, not new work — except that the
**default channel level changes from `assert` to `warn`**. Today `traceLevels` defaults every channel
to `assert`; the new default is `warn`. Note that `warn` itself does **not** gate `log` on watch:
at `warn`, `log` is off for *everyone* (watched or not). The "`log` gated on watch" behaviour only
materializes at the explicit `debug` verb, so watching an object is only useful once its channels are
at `debug`. `assert` remains available when explicitly requested.

(Implementation note, added 2026-09-09: this gating gap is what made the initial debug toggle a no-op.
The resolution is that `watch()` now *arms* all configured channels to `debug` while any subject is
watched — `onWatchChange`/`watchCount` in `watch.ts` drive `armTraceDebug`/`disarmTraceDebug` in
`debug.ts` — so pressing the toggle raises channels to `debug`, watched entities log at full detail,
everyone else stays `warn`-like, and releasing the last subject restores `warn`.)

### 2. Per-entity debug toggle in the property widget

For entities whose trace channels are on `debug`/`log`, expose a **push/release** "debug" button in the
inspector tool row (`selection-info.tsx` tools, alongside "Go to Object" / "Pin Panel"):

- **A. Put the object on watch** — pressed → `watch(object)`; released → `unwatch(object)`.
  `object` is the raw `SelectionInfoObject`/`InteractiveGameObject` (a `Vehicle`, `Character`,
  announcement, `Tile`, settlement, …).
- **B. Show the log** — the button toggles the existing `Logs` `InspectorSection` (or pins its open
  state); the log content is `object.logs` (already reactive via `withInteractive`).

Open items to settle while planning the slice:

- **Which entities show the button.** Only entities that *can* be watched and have a trace channel at
  `debug`/`log`. Proxy: `isInteractiveLogObject(object)` (has `logs`) + the owning game exposes which
  channels are debug/log. A pragmatic first cut: show the button for any `InteractiveLogObject`, since
  `watch` is a no-op for entities no debug channel is filtered on.
- **Button state source.** Whether "pushed" reflects `isWatched(object)` (reactively) so the button and
  the underlying watch filter cannot drift. (`isWatched` is not reactive today — needs a reactive
  wrapper or a version counter in `watch.ts`.)
- **Log bottom-placement.** The `Logs` section already renders at the bottom of the property widget;
  the toggle should control its visibility/open state rather than move it.

### 3. Subject-aware channel API

Make the subject the **primary** argument, so a single call style replaces both `traceFor` and the
unscoped channel form. The shape depends on the channel's classification (above):

```ts
// A. Entity-attached — compulsory positional subject
traces.vehicle(vehicle).log?.('event', payload)
traces.position(character).log?.('event', payload)
traces.script(character).log?.('event', payload)

// B. Entity-less — unchanged, no argument
traces.queue.log?.('event', payload)
traces.scriptEngine.warn?.('event', payload)

// C. Hybrid — named-argument subject
traces.convey({ alveolus }).log?.('event', payload)
traces.work({ character }).log?.('event', payload)
```

Mechanics to decide:

- `traces.<entity-attached>` becomes a **callable** `(subject: Subject) => TraceSink` — the argument is
  **compulsory** (no `traces.vehicle()` fallback). `traces.vehicle.log` is **removed**; all
  entity-attached sites must pass the subject. This is the whole point of the refactor: it makes the
  missing subject a compile error instead of a silent de-scoping.
- `traces.<entity-less>` stays a plain `TraceSink` (the `traces` proxy already returns one). No change
  at call sites.
- `traces.<hybrid>` becomes a **callable** `(subject: { vehicle?; character?; alveolus?; tile? }) => TraceSink`
  — the argument is a named bag; exactly the fields relevant to the site are provided.
- The `traces` proxy's `get` must therefore return **either** a `TraceSink` (entity-less) **or** a
  callable (entity-attached / hybrid), distinguished by a per-channel kind table — a channel's kind is
  static, known at module load, so the proxy can be typed accordingly. Simplest: keep `traceFor` as the
  single underlying primitive and have the callable wrappers delegate to `traceFor(channel, subject)`.
- **Call-site migration** (~129 matches across 14 files):
  - Entity-attached: `traces.vehicle.log?.()` → `traces.vehicle(vehicle).log?.()`;
    `traceFor('vehicle', v)` → `traces.vehicle(v)`. `traces.vehicle.assert?.()` → either
    `traces.vehicle(vehicle).assert?.(...)` (assert is subject-independent at `debug` but a subject is
    still required for the API to be uniform) or, where no subject is in scope, a bare `assert(...)`.
  - Hybrid: `traces.convey.log?.()` → `traces.convey({ alveolus }).log?.()` etc.; the subject is
    whatever the enclosing function has in scope.
  - `script`: character-bound → `traces.script(character)`; generic engine → `traces.scriptEngine`.
  - Entity-less: untouched.
- **`traceFor` fate** — keep as the exported backing primitive (tests use it); the callable wrappers
  are sugar over it. Optionally delete once migration lands if nothing external calls it.

---

## Suggested implementation order

1. **Settle `debug` semantics + default level** — codify "`debug` = `warn` + (watched ? `log`)", and
   change `traceLevels` default from `assert` to `warn`. Confirm `forSubject` already matches; add a
   `trace.test.ts` case codifying "debug = warn for everyone, +log for watched".
2. **Reactive watch state** — make `isWatched` cheaply reactive (e.g. a module counter bumped on
   `watch`/`unwatch`, or expose a `watchVersion()` the UI can bind to), so the toggle button reflects
   reality instead of initial state.
3. **Callable channel API** — change the `traces` proxy to return a callable subject getter for
   entity-attached/hybrid channels (compulsory subject / named bag) while entity-less channels stay a
   plain `TraceSink`; migrate all `traces.vehicle.log` / `traceFor('vehicle', v)` sites; split `script`
   → `script` (character) + `scriptEngine` (generic); keep `traceFor` as the backing primitive. Run
   `ssh` typecheck + `trace.test.ts`.
4. **Debug toggle button** — in `selection-info.tsx`, add a "🔍 debug" push/release tool for
   `InteractiveLogObject`s; pressed → `watch(object)`, released → `unwatch(object)`; drive the `Logs`
   section visibility from it. Add a `selection-info.spec.tsx` case for button presence/state.
5. **Verification** — `pnpm --filter ssh check`, `pnpm --filter ssh-browser check`,
   `pnpm --filter ssh test -- tests/unit/trace.test.ts`, `pnpm --filter ssh-browser exec vitest run
   src/widgets/selection-info.spec.tsx`.

---

## Open questions (answer before/while implementing)

- **Button visibility rule** — any `InteractiveLogObject`, or only entities whose channel is actually
  at `debug`/`log` (needs channel-level introspection from the game)?
- **New generic-script channel name** — `scriptEngine` (proposed) vs `scriptRuntime` / `engineScript`.
- **Default-level migration blast radius** — flipping `traceLevels` from `assert` to `warn` makes
  `warn` fire for everyone by default; confirm nothing relies on `warn` being silent under `assert`
  (e.g. perf-sensitive `warn` sites that should stay gated).
- **Watch reactivity** — counter approach vs a `reactive(Set)` refactor of `watch.ts` (a `WeakSet` can't
  be reactive directly; a counter is the minimal change, a tracked registry the clean one).