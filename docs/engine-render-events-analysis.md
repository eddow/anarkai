# Engine to Renderer Events Analysis

This document records the intended boundary for engine-to-renderer events, especially for convey/storage
visuals. The core rule is that `engines/ssh` owns simulation truth and emits explicit presentation
invalidations; Pixi and browser UI consume those invalidations and pull fresh snapshots instead of relying
on incidental Mutts observation of engine internals.

## Context

Anarkai currently has a TypeScript simulation engine in `engines/ssh` and a Pixi renderer in `engines/pixi`.

The intended long-term direction is that `engines/ssh` may become Rust/WASM. That matters because the renderer cannot depend forever on Mutts being able to observe arbitrary engine object fields. Mutts is useful in the TypeScript client, but it should not be the semantic transport between simulation and rendering.

The recent convey bugs exposed this boundary problem clearly:

- the convey engine reached the correct storage state after final delivery;
- logs showed the destination storage changing from allocated to present correctly;
- the Pixi visual still showed stale allocated/grey goods until another unrelated action forced a refresh.

That means the simulation truth was correct, but the renderer did not reliably learn that the visual snapshot had changed.

## Sawmill Arrival Diagnostic

The reference failure was the `saw` example, where wood was conveyed from storage to a sawmill through a
border handoff. Traces showed the terminal movement finishing correctly: after `movement.finish()`, the
sawmill storage had `stock=1`, `available=1`, and one remaining inbound allocation for the next wood.

The board still rendered both wood icons as allocated/grey. That narrowed the bug away from gameplay
bookkeeping and toward presentation invalidation:

- engine state after finish: one present wood, one allocated wood;
- visual state after finish: two allocated-looking wood icons;
- likely cause: Pixi either did not repaint after target allocation fulfillment, or it repainted from a
  stale stored-goods snapshot.

The durable lesson is that storage completion must emit an explicit presentation dirty event for the
affected owner. Renderer visuals and inspectors should treat that event as a wake-up and then read a fresh
snapshot.

## Current Coupling

Today, stored goods are rendered by Pixi through a Mutts effect.

The visual calls `storage.renderedGoods()` inside a renderer-side effect, and the effect is expected to rerun when storage internals change.

This makes the renderer depend on several implicit conditions:

- the storage fields read by `renderedGoods()` must be Mutts-observable;
- mutations must touch those observed fields in a way Mutts notices;
- the mutation must happen outside any context that hides or coalesces the relevant dependency;
- the visual must already have subscribed to the exact shape of data that later changes;
- the renderer must not need information that is transient and no longer visible in storage by the time the effect runs.

That is a fragile contract. It is not written in the type system, it is not portable to Rust/WASM, and it makes visual correctness depend on incidental implementation details of the simulation objects.

## Why `renderRevision` Was a Hack

Adding a `renderRevision` counter to storage made the visual effect rerun by giving Pixi a simple observable value to read.

That fixed the symptom, but it did not fix the boundary.

The counter was not simulation state. It existed only to wake the renderer. It also made engine storage know about render invalidation indirectly, while still keeping the actual communication implicit through Mutts.

The problem is not that storage lacked a revision number. The problem is that Pixi had no explicit engine-owned notification saying:

> this storage's presentation snapshot changed.

This does not mean the browser or renderer can never use revision-like counters internally.

A revision counter is a hack when it is added to engine storage as simulation-adjacent state whose only purpose is to wake a renderer. A small UI-side revision token is different: it is an adapter detail maintained by the presentation layer after consuming explicit SSH events.

For example, the browser inspector may keep a local `presentationRevisionByOwnerUid` map. When SSH emits `storage.changed` for a tile or vehicle, the browser increments that local token, and property widgets read the token before pulling a fresh storage snapshot. That token is not gameplay state, is not saved, and does not live in `Storage`. It is only the browser's way to bridge explicit events into its own reactive rendering system.

## What `inert`, `untracked`, and `atomic` Mean Here

This problem should not be solved by swapping `inert` for `untracked`, or by sprinkling reactive wrappers around convey.

Those tools answer different questions.

`inert` is useful for code paths that should not become reactive dependencies. In the current SSH code, it is mostly used around job proposal, advertising, pathfinding-like selection, and other engine-side planning reads.

`untracked` is useful when a block should execute without subscribing the caller to its reads. Script execution uses this shape, which is reasonable: running an NPC script should not accidentally make some unrelated Mutts effect depend on every engine field the script inspected.

`atomic` is useful for grouping mutations so observers see a coherent result instead of every internal twitch. Convey needs this concept: pickup, hop fulfillment, source/target commitment transitions, claim release, and storage updates should be committed as a coherent lifecycle step.

But none of these are a proper renderer transport.

They control reactivity behavior inside the TypeScript runtime. They do not define a stable cross-engine boundary, and they do not describe the presentation events Pixi needs.

## Why Events Should Come Back

Events give Anarkai an explicit simulation-to-presentation boundary.

The key idea is:

- `engines/ssh` remains the source of truth;
- Pixi does not own duplicated gameplay state;
- events say what changed;
- Pixi pulls or receives a fresh render snapshot for the affected thing.

For example, after convey finishes a terminal hop, SSH does not need Pixi to infer what happened by observing private storage counters. SSH can explicitly publish that the destination storage presentation changed.

The event is not the data. The event is the wake-up bell.

The data can still come from a snapshot method such as `renderedGoods()` while SSH remains TypeScript. Later, if SSH becomes Rust/WASM, the same conceptual event can point to a serialized snapshot or stable handle instead of a live object.

## Why Events Should Be Batched

Convey is not a single mutation. A visible hop can involve:

- a transient good visual being created;
- the movement source commitment moving from storage reservation to hop step;
- border storage receiving committed stock;
- an intermediate source reservation being rebound;
- terminal target allocation being fulfilled;
- a worker claim being released;
- jobs or advertisements becoming available.

If Pixi receives every tiny internal change as a separate render instruction, it can draw impossible intermediate states. That is the same class of bug as the old "border stock without reservation" window, but in presentation form.

The renderer should usually see the end of an engine transaction, not the inside of it.

That suggests SSH should collect presentation events while simulation code runs, then flush them at a stable boundary:

- end of an `atomic` convey step;
- end of an NPC script slice;
- end of a simulation tick;
- end of a save/load restore phase.

The batch lets Pixi process coherent changes:

- remove or finish transient moving goods;
- redraw affected storage goods;
- refresh changed object visuals;
- update inspector-facing data if needed.

## Why Not a Full Event Engine Yet

A full event engine or message bus would be premature.

The needed abstraction is small:

- SSH can queue typed presentation events.
- The game integration can expose one listener or callback for flushed batches.
- Pixi can consume those batches and refresh affected visuals.

This is enough to make the boundary explicit without introducing another large framework.

Mutts may still be used inside Pixi for Pixi-local convenience: hover state, UI bindings, local diagnostics, or renderer-owned caches. The important separation is that Mutts should not be the semantic bridge from simulation truth to render truth.

## Why Not a Full Duplicated Presentation Model Yet

A separate "placenta" model that copies all SSH data into Pixi would make the boundary explicit, but it would also introduce a second large state tree.

That is risky right now because the current bug is already a truth-versus-appearance drift. Duplicating all data would create more places where drift can hide.

A smaller bridge is safer:

1. SSH emits dirty events.
2. Pixi redraws affected visuals from fresh SSH snapshots.
3. Only when necessary, Pixi adds small render-owned caches for performance or animation.

This keeps one gameplay truth while gradually removing the hidden Mutts dependency.

A fuller presentation model may become useful later, especially for Rust/WASM, remote simulation, replay, or deterministic inspection. But it should grow from explicit event/snapshot needs, not as a first response to one stale visual.

## Event Categories That Matter

The likely event categories are presentation-level, not storage-internal:

- storage presentation changed;
- tile or object presentation changed;
- transient good movement started;
- transient good movement progressed or finished;
- entity position changed;
- object registered or unregistered;
- terrain presentation invalidated.

These events should be phrased in renderer-relevant terms, while still coming from the engine transaction that knows what changed.

For storage, the event does not need to say how `_goods`, `_reserved`, or `_allocated` changed. It only needs to say that the storage presentation snapshot for this object is dirty.

For convey, transient moving goods are especially important because they are not simply storage contents. A moving good is presentation state derived from a movement step. Pixi should not need to reverse-engineer it from storage allocation bookkeeping.

## Relationship to Existing `objectsChanged`

Anarkai already has interactive object change notifications. Those are useful but too coarse for this problem.

The current Pixi visual factory uses changed objects mostly to create or dispose visuals when object presence changes. Existing visuals are not necessarily rebound or redrawn just because an object was reported changed.

Storage goods need a more direct presentation invalidation path:

- either the existing visual receives a storage-dirty event and redraws its goods layer;
- or a renderer-level presentation event router maps storage/tile IDs to the visuals that must refresh.

This is different from object lifecycle. A sawmill can remain the same object while its rendered goods change.

## Browser Inspector Consumption

The same boundary applies to `apps/browser`, not only to Pixi.

Property widgets currently read live SSH objects too. For example, a stored-goods inspector can derive display rows from `content.storage.stock`, while a vehicle inspector can derive goods from `vehicle.storage.stock`. If those reads depend only on incidental Mutts tracking, browser DOM can drift from SSH truth in the same way Pixi goods did.

The browser should therefore consume SSH presentation events directly.

The browser does not need a duplicated presentation model for this first step. It can keep a small local invalidation table keyed by presentation owner UID:

- tile-content storage: tile UID;
- border-gate storage: border UID;
- vehicle storage: vehicle UID.

When a `storage.changed` event arrives, the browser increments the matching local token. Components that display storage data read that token before pulling the fresh SSH snapshot. This gives property widgets an explicit wake-up path without putting render-only revisions back into SSH storage.

This browser-side token is intentionally disposable UI state. It can be recreated on page load, does not participate in save/load, and should not be interpreted as part of simulation correctness.

## Advertisement Invalidation Inside SSH

The same lesson applies inside `engines/ssh` itself.

Advertisements are not renderer state, but they currently have a similar hidden dependency problem. The hive advertisement system still partly relies on Mutts effects observing `alveolus.goodsRelations`.

The current shape is roughly:

- an alveolus exposes `goodsRelations`;
- `goodsRelations` derives provide/demand from storage stock, allocations, working state, action configuration, buffers, and hive needs;
- `Hive.attach()` installs a Mutts effect that reads `alveolus.goodsRelations`;
- when the effect reruns, the hive schedules an advertisement refresh;
- `AdvertisementManager.advertise()` mutates advertisement buckets and may create movements.

That works while every relevant engine mutation is visible to the right Mutts effect. It becomes fragile as soon as engine code uses `inert`, `untracked`, explicit batching, commitment callbacks, or future Rust/WASM state that Mutts cannot observe directly.

The sawmill consumption failure is an example of that fragility. Consuming wood changed SSH storage truth, and presentation events could refresh Pixi/browser, but the ad system did not reliably receive the gameplay wake-up saying: this alveolus' provide/demand snapshot may have changed.

The target is therefore explicit advertisement invalidation events inside SSH.

This does not mean exposing advertisement events to Pixi. It means SSH should treat advertisement invalidation as an engine event, owned by the hive:

- storage stock changed;
- movement created, finished, aborted, or downgraded;
- a commitment fulfillment changed stock or room;
- an alveolus working flag, action, buffer, or configuration changed;
- a hive need changed;
- a docked vehicle endpoint appeared, disappeared, or changed storage state.

Those causes should call a clear engine method such as `hive.invalidateAdvertisement(party, reason)`. The hive can then batch invalidated parties and recompute their `goodsRelations` at a stable boundary, just as presentation events are batched before Pixi/browser consumption.

The event should be an invalidation, not duplicated advertisement state.

The source of truth can remain the current `goodsRelations` computation for now. The important change is who decides that it must be recomputed. That decision should come from explicit engine lifecycle events, not from Mutts discovering that some getter read changed.

This also suggests a cleaner split for storage notifications:

- presentation notification: a storage visual snapshot changed;
- advertisement/gameplay notification: stock, available room, or buffer-relevant state changed;
- commitment bookkeeping notification: allocation/reservation visuals changed, but this may not always imply a new ad match should be attempted.

Conflating those notifications is tempting because they often happen together, but they answer different questions. Pixi cares that `_allocated` changed because grey goods may need redrawing. The hive usually should not create a new exchange just because a target allocation was registered during movement creation. It should wake ads when stock or effective capacity changes in a way that can alter provide/demand.

In the long term, `AdvertisementManager` should not need a reactive advertisement bucket object. Its buckets are engine matching state, not UI state. A plain map keyed by good type, advertisement side, and priority is a better fit for a future Rust/WASM engine and easier to reason about during batched updates.

Mutts can still be useful while SSH is TypeScript, but it should not be the correctness mechanism for ads. Advertisement correctness should be explained by explicit engine invalidation causes and a deterministic hive flush.

## Consequences for Convey

The convey engine should keep enforcing the movement commitment invariant internally:

- a live movement has a live source commitment;
- at rest, that source is a storage reservation;
- in flight, that source is the hop step;
- after intermediate landing, that source is rebound to the landed storage;
- at terminal finish, the target allocation becomes present stock.

Pixi should not need to understand those commitment transitions to draw correctly.

Pixi needs presentation facts:

- a good started moving from A to B;
- a good finished moving;
- storage X changed its visible goods snapshot.

This lets convey remain a simulation concept and the moving sprite remain a presentation concept.

## Desired Direction

The direction is to make SSH explicitly publish batched presentation events and make Pixi consume those events instead of relying on Mutts to observe SSH internals.

This does not mean removing Mutts from Pixi entirely. It means removing Mutts as the hidden transport between the simulation engine and the renderer.

The near-term shape is:

- keep SSH as the only gameplay truth;
- avoid render-only revision counters in engine storage;
- emit batched presentation dirty events from SSH;
- let Pixi redraw affected visuals from fresh snapshots;
- reserve duplicated Pixi-side state for animation and renderer-owned concerns.

That gives Anarkai a boundary that works now in TypeScript and still makes sense later if SSH becomes Rust/WASM.
