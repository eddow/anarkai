# Entity tracing (watched entities)

Trace channels (`traces.vehicle`, `traces.npc`, …) are level-gated **globally**: raising
`traces.vehicle` to `log` dumps every vehicle in the world. When you are chasing one misbehaving
wheelbarrow, that is flooding.

Entity tracing narrows the firehose with a **`debug` verb** on a channel: `debug` acts as `warn`
in general, but as `log` for the entities marked **watched**. Everything else stays at `warn` —
so the `log` entry is `undefined` for non-watched entities and its argument expressions are never
evaluated (no test, no cost).

## Two halves

1. **Persistence** — a `watched: boolean` on the *serialized* entity (`VehicleState` /
   `CharacterState`). On load, `watch(entity)` is called for any row carrying it.
2. **Runtime** — a `WeakSet` of watched objects (identity-keyed by the raw target, so Mutts
   reactive proxies resolve to one entry) plus the `debug` channel verb.

The runtime set is the source of truth. The save boolean is just how you seed it from a savegame.

## Making a vehicle traced from a savegame

Edit the save JSON and add `"watched": true` to the vehicle's entry inside `serializedVehicles`.

A vehicle entry (array index = identity) looks like:

```json
{
  "vehicleType": "wheelbarrow",
  "position": { "q": 0, "r": 0 },
  "goods": {},
  "servedLines": [0],
  "service": { "kind": "line", "line": 0, "stopIndex": 0, "docked": false, "operator": 0 },
  "watched": true
}
```

The field is optional and is only emitted by the saver when `true`, so adding it by hand is all
that is needed. `deserializeVehicles` (in `population/vehicle/vehicles.ts`) calls `watch(vehicle)`
when it sees `row.watched`.

Characters work the same way — add `"watched": true` to the entry in the top-level `characters`
array (`deserializeCharacters` in `population/character.ts`).

## Turning it on

Channels default to the `warn` verb, so `log` is gated off for everyone. Watching an object arms the
trace channels: while any subject is watched, every configured channel is raised to `debug`, and the
watched entity logs at full `log` detail (everyone else keeps `warn`).

Typical session:

1. For a live object, call `watch(obj)` directly (or press the 🔍 "Debug object" toggle in the
   property widget). For a save-loaded entity, add `"watched": true` to its savegame entry and reload.
2. The watched entity now logs at full `log` detail; every other entity keeps `warn`.
3. `unwatch(obj)` (or releasing the toggle) disarms the channels back to `warn`.

You can also force a single channel to `debug` explicitly, independent of watch state, in code or the
DevTools console (`traces` is exposed on `window`):

```js
traces.vehicle.setLevel('debug')
```

## Runtime API (browser console)

| Call | Effect |
|---|---|
| `watch(obj)` | Add `obj` to the watched set; arms channels to `debug`. |
| `unwatch(obj)` | Remove `obj` from the watched set; disarms when none remain. |
| `traceFor('vehicle', obj)` | Subject-bound view of a channel (see below). |
| `traces.vehicle.setLevel('debug')` | Put the channel at the `debug` verb. |

## How the `debug` verb works

The verb ranks are `log < debug = warn < assert < error`, so at `debug` a channel's base sink is
warn-like: `warn`/`assert`/`error` are enabled, `log` is `undefined`.

The subject-dependent part happens through the callable subject view:

```ts
traces.vehicle(vehicle).log?.('vehicleJob.dock.check', { vehicleUid })
```

- **`debug` + watched** → the view's `log` (and friends) are enabled, so the watched vehicle logs at
  full detail.
- **`debug` + not watched** → the warn-level sink is returned unchanged: `log` is `undefined`, so
  `?.` short-circuits without evaluating the payload builder.
- **any other verb** (`log`, `warn`, `assert`, `error`) → the live sink is returned unchanged; the
  level applies globally as before.

`traceFor(channel, subject)` is the underlying primitive the callable accessors delegate to; it is the
only place that reads the watched set, so the filtering is a single `WeakSet.has` at the call site.

### Migrating a call site

Mechanical: `traces.vehicle.log?.(...)` → `traces.vehicle(vehicle).log?.(...)`, choosing `subject` as
the entity the row is about. The subject argument is compulsory for entity-attached channels
(`vehicle`, `position`, `npc`, `script`), a named bag for hybrid channels (`convey`, `work`), and
absent for entity-less channels (`queue`, `terrain`, `scriptEngine`, …). `traceFor` works for every
verb, so migrating a site is safe even when the channel is still at `log`/`warn`: it just returns the
live sink.

## Test setup

`test-setup.ts` calls `resetWatched()` before and after every test, so the watched set never leaks
between cases. The channel levels themselves are reset by `disconnectAllTraces()`.

## Files

- `engines/ssh/src/lib/dev/watch.ts` — watched `WeakSet`, `watch`/`unwatch`/`isWatched`/
  `resetWatched`.
- `engines/ssh/src/lib/dev/debug.ts` — `debug` verb + rank, `traceFor`, sink level application,
  browser-global exposure.
- `engines/ssh/src/lib/population/vehicle/vehicle.ts` — `VehicleState.watched`.
- `engines/ssh/src/lib/population/vehicle/vehicles.ts` — save/load round-trip.
- `engines/ssh/src/lib/population/character.ts` — `CharacterState.watched` + round-trip.
