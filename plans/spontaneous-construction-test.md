# Plan — end-to-end test: spontaneous residential + commercial construction

> Status: implemented (2026-09-12). Test: `engines/ssh/tests/integration/spontaneous-construction.test.ts` — passes (~0.7s).
> Prerequisite landed: `engines/rules/src/tuning/districts.ts` + reactive `Game.districtSpawning`.
> Measured (sped-up cadence, **default** observation gate): **shop ≈ 1.5s, dwelling ≈ 31.6s** game time.
> Related: [`spontaneous-lines.md`](./spontaneous-lines.md), [`districts.md`](./districts.md),
> [`../docs/districts.md`](../docs/districts.md).

## Goal

One integration test that lets the real game simulate a minimal colony and asserts that:

1. a **residential** zone's housing pressure triggers `trySpawnResidentialProject`, the site is
   foundationed and constructed, and the tile ends as a finished `BasicDwelling`; and
2. a **commercial** zone's sustained shoppers triggers `trySpawnCommercialShop`, and the tile ends
   as a `Shop`.

The test passes when both structures exist — i.e. it asserts **completion** (`100%` built), not
intermediate progress. Additionally it **records the virtual time** at which each appeared, so we can
catch latency regressions.

**Latency expectation (decided).** "Within one hour" was loose phrasing. The design target is a **few
minutes of game time** (exact number still to be determined). The test's own hard ceiling is therefore
a small multiple of that (see [Simulation harness](#simulation-harness)), not an hour.

## Honest scope — what "commercial construction" is today

Residential rides the full construction pipeline (foundation → shell → materials → construct).
Commercial does **not**: `placeCommercialShop`
(`engines/ssh/src/lib/commerce/commercial-demand.ts`) replaces the tile content with a finished
`Shop` immediately. There is no `BuildShop`, no recipe, and no material demand.

Consequences for this plan:

- The commercial half asserts **spawn**, not construction. Its latency is a function of the
  ticker cooldown × 3 observation passes, not of an engineer or of freight.
- The residential half is the part that exercises one-shot freight + engineer + the construction
  pipeline.
- A **follow-up** (out of scope here) would add a `BuildShop` shell fed by a `construction.shops`
  recipe so commercial also consumes materials — see "Optional follow-ups".

### Prerequisite — spawner tuning moves to `rules` (✅ landed)

Both spawners previously hard-coded their cadence and thresholds as module constants in `ssh`:

| Constant | Was (`ssh`) | Now (`rules`) |
|---|---|---|
| `residentialProjectSpawnCooldownSeconds = 2` | `residential/constants.ts` | `tuning/districts.ts` |
| `residentialHousingDemandRadius = 12` | `residential/constants.ts` | `tuning/districts.ts` |
| `commercialShopSpawnCooldownSeconds = 2` | `commerce/commercial-demand.ts` | `tuning/districts.ts` |
| `commercialObservationThreshold = 3` | `commerce/commercial-demand.ts` | `tuning/districts.ts` |
| `commercialShopSensingRadius = 12` | `commerce/commercial-demand.ts` | `tuning/districts.ts` |

**Decision:** all *game constants* live in the `rules` project (`engines/rules/src`), consistent with
`gameTimeSpeedFactors`, `jobBalance`, `characterEvolutionRates`, etc. — never hard-coded in `ssh` and
never only a test constant.

**Implemented** following the `commerce.transportAutomation` precedent (content value in `rules`,
seeded into a reactive `Game` mirror): `engines/rules/src/tuning/districts.ts` exports
`districtSpawning`, re-exported from `rules/src/index.ts`, and `Game.districtSpawning` mirrors it.
Both spawners, and `zone-tendencies.ts`, now read the live `game.districtSpawning.*` values each pass.
The old `ssh/residential/constants.ts` exports are retained as `@deprecated` aliases for compatibility.

This resolves the previously documented "Tunability (TODO)" in
[`../docs/districts.md`](../docs/districts.md) §"Emission cadence & tunability" (the doc was updated
to reference `Game.districtSpawning`).

```ts
// engines/rules/src/tuning/districts.ts
export const districtSpawning = {
  residentialSpawnCooldownSeconds: 2,
  commercialSpawnCooldownSeconds: 2,
  commercialObservationThreshold: 3,
  residentialHousingDemandRadius: 12,
  commercialShopSensingRadius: 12,
} as const
```

## Board fixture

Small, fully walkable, obstacle-free board so the engineer's reachability (`action.radius = 6`)
never fails and the two spawners' sensing radii (`12` each) comfortably cover their zones.

```ts
const gen = { terrainSeed: <fixed>, characterCount: 0, settlementGeneration: false }

// Concrete patch over the whole working rectangle: walkable, no seed deposits, no loose goods.
const area: ReadonlyArray<readonly [number, number]> = axialRect(-6, 8, -6, 8)

const patches: GamePatches = {
  terrains: { concrete: [...area] },

  // A road so commercial tiles can be road-adjacent. Roads are BORDER midpoints (half-integers),
  // not tiles — a commercial tile with no road on any of its six borders is never a candidate.
  roads: { path: [[-1, 0.5], [0, 0.5], [1, 0.5]] },

  hives: [
    {
      name: 'Spontaneous',
      working: true,
      alveoli: [
        // The material store: foundation + dwelling goods, well above any reserve.
        { coord: [0, 0], alveolus: 'storage', goods: { concrete: 6, wood: 12, planks: 6 } },
        // The estate delivery tile (freight bay).
        { coord: [0, 1], alveolus: 'freight_bay' },
        // The engineer MUST carry the `building` variant — the root engineer has no
        // `variantSpec`, so `allowedJobs` is empty and it exposes zero foundation/construct jobs.
        { coord: [1, 0], alveolus: 'engineer', variant: 'building' },
      ],
    },
  ],

  // Two 3×3 zones, both within sensing radius 12, and with at least one tile inside the
  // engineer's radius-6 reach of [1,0].
  zones: [
    { type: 'residential', coords: axialRect(3, 5, -1, 1) },   // east of the hive
    { type: 'commercial', coords: axialRect(-3, -1, -1, 1) },  // west, borders touch the road
  ],

  // "Boosted" signals: enough bodies to fire both spawners.
  characters: [
    { name: 'Resident A', position: { q: 4, r: 0 } },
    { name: 'Resident B', position: { q: 4, r: 1 } },
    { name: 'Shopper C', position: { q: -2, r: 0 } },
    { name: 'Shopper D', position: { q: -2, r: 1 } },
  ],

  // A free vehicle (no line, no operator) so the one-shot self-haul branch could claim it.
  // Kept un-operatored so the "no self-haul line spawned" assertion stays meaningful.
  vehicles: [{ name: 'hauler', vehicleType: 'wheelbarrow', position: { q: 0, r: 1 } }],

  playerAccount: { balanceVp: 200 },
}
```

**Design notes**

- `settlementGeneration: false` removes generated NPC cities/roads that could otherwise hijack paths
  or inject unintended trade offers.
- The four characters double as **both** housing pressure (radius 12) and shoppers (radius 12).
  Residential `pressure = people − freeSlots` needs only `> 0` (there are no dwellings yet), and
  commercial only needs `≥ 1` shopper per observation pass.
- `terrains.concrete` keeps every candidate tile clear and walkable, and puts the residential zone
  squarely inside the engineer's radius.

## Materials: two mutually exclusive branches, one of which starves

`OneShotLineTicker` prefers self-haul at `internality ≥ 0.5`, delivery at `< 0.5`. Both write into
the construction storage — but `hasTransportCoveringNeed` treats a spawned targeted line as
coverage and therefore **suppresses the delivery branch**. So:

- If self-haul spawns a line and its wheelbarrow is **never operated**, the site starves forever and
  the test hangs. This is the single biggest flakiness risk in the scenario.
- If delivery runs, materials are credited **instantly**, which is deterministic.

**Decision for this test:** drive materials via the **delivery** branch.

```ts
// Registered before the sim loop; this is the external half of the internality slider.
game.registerSettlementTradeProfile({
  regionSetKey: '0,0',
  id: 'settlement-0,0',
  name: 'Test market',
  kind: 'village',
  center: { q: 12, r: 0 },
  radius: 2,
  cityHall: { kind: 'city_hall', name: 'Test City Hall', position: { q: 12, r: 0 } },
  offers: [
    { good: 'concrete', direction: 'sell', priceVp: 3 },
    { good: 'wood', direction: 'sell', priceVp: 4 },
    { good: 'planks', direction: 'sell', priceVp: 6 },
  ],
})

game.transportAutomation.autoBuy = true
game.transportAutomation.internality = 0        // delivery first — deterministic
game.transportAutomation.spawnCooldownSeconds = 0
game.transportAutomation.maxSelfHaulDistance = 0 // disabled here; covered by one-shot-lines tests
```

Self-haul is already covered end-to-end by `tests/unit/one-shot-lines.test.ts`; re-testing it here
would only add the vehicle-operator race to this scenario. See "Optional follow-ups" §1 for the
self-haul variant as a separate test.

## Spawn strategy: ticker-driven (default) vs seeded (fast path)

**A. Ticker-driven (preferred — this is the behaviour we want to prove).**
Leave both spawners to their tickers. Nothing reaches into them; residential fires within ~2s,
commercial after 3 passes × 2s.

**B. Seeded fast path (fallback if A proves slow or flaky).**
Call the pure helpers directly, then simulate construction:

```ts
trySpawnResidentialProject(game)                                  // once
const observations = new Map<string, number>()
for (let i = 0; i < 3; i++) trySpawnCommercialShop(game, observations)  // cross the threshold
```

Keep A as the headline test and note B as the escape hatch. If A is used, add a cheap guard that the
three tickers are actually registered (`ResidentialDemandTicker`, `CommercialDemandTicker`,
`OneShotLineTicker`) so a silently-missing ticker fails loudly instead of timing out.

Because the spawner cadence is **live tuning** (see "Prerequisite" above), strategy A can be sped up
deterministically for the test by lowering the cooldown — rather than shrinking the tick:

```ts
game.districtSpawning.residentialSpawnCooldownSeconds = 0.5
game.districtSpawning.commercialSpawnCooldownSeconds = 0.5
// The observation threshold is deliberately left at its `rules` default (3).
```

**Do not lower `commercialObservationThreshold` below its default.** It was tried (set to `1`) and
turned out to be unnecessary: the full cumulative-observation gate passes comfortably inside the
budget. Bypassing it would silently stop the test from covering the evidence-accumulation logic, which
is the most interesting part of the commercial spawner. If a future change makes the default
threshold too slow, fix the cadence, not the gate.

## Simulation harness

Use the same shape as `tests/integration/project-lifecycle-simulation.test.ts` and
`test-engine/viability.ts` — drive the real `tickerCallback`, early-exit on success, and yield to the
event loop periodically.

```ts
// Design target is "a few minutes" of game time (exact value TBD). The budget is a small multiple
// of that, purely a harness hard stop — NOT the acceptance criterion.
const TEST_BUDGET_S = 900   // 15 game-minutes
const TICK_MS = 250         // delta = gameRootSpeed(2) × 0.25s × speedFactor(1) = 0.5 virtual s

const residentialCoords = axialRect(3, 5, -1, 1)
const commercialCoords = axialRect(-3, -1, -1, 1)

let builtAt: number | undefined
let shopAt: number | undefined
let ticks = 0

while (
  game.clock.virtualTime < TEST_BUDGET_S &&
  !(builtAt !== undefined && shopAt !== undefined)
) {
  game.tickerCallback({ elapsedMS: TICK_MS } as SimulationLoop)
  ticks++

  if (builtAt === undefined) {
    for (const [q, r] of residentialCoords) {
      if (game.hex.getTile({ q, r })?.content instanceof BasicDwelling) {
        builtAt = game.clock.virtualTime
        break
      }
    }
  }
  if (shopAt === undefined) {
    for (const [q, r] of commercialCoords) {
      if (game.hex.getTile({ q, r })?.content instanceof Shop) {
        shopAt = game.clock.virtualTime
        break
      }
    }
  }

  if (ticks % 200 === 0) await new Promise((resolve) => setTimeout(resolve, 0))
}
```

Polling every tile in both zones is the simplest approach and avoids tracking the spawners'
(pressure-sorted) tile choice; the spawners correctly leave the un-chosen tiles as `UnBuiltLand`.

Characters placed via `patches.characters` are created **before** `gameStart` is emitted (the patch
is applied inside `generateAsync`, before the emit), so `withScripted`'s `gameStart` listener gives
them a first action automatically and they keep re-planning through `nextStep` → `findAction`.

**Confirmed:** no manual `findBestJob()` / `begin()` driving is needed. A hand-driven loop was
actually written and then removed — measured latency was identical (shop ≈ 1.5s, dwelling ≈ 31.6s)
with and without it. Keeping it out is deliberate: it would mask a broken script loop instead of
letting this test fail.

## Assertions

The test asserts **completion**, not progress — a dwelling/shop either exists on the tile (`100%`)
or it does not. No partial-progress assertions, and `hasResidentialConstructionInProgress` is not
part of the acceptance criterion (see "Decided").

1. **Residential construction completed via the real pipeline.** At least one residential tile is a
   `BasicDwelling`; the run must also have passed through the spawner's foundation site
   (`UnBuiltLand` with `site === residentialBasicDwellingSite`) and a `BuildDwelling` shell. Latching
   those two flags in the poll is what actually proves spontaneous construction happened — a plain
   "a dwelling exists" check could be satisfied by a shortcut.
2. **Commercial spawned.** At least one commercial tile is a `Shop` with
   `shopType === commercialDefaultShopType` (`'grocery'`).
3. **Both happened within the budget.** `builtAt` and `shopAt` are both defined and both
   `≤ TEST_BUDGET_S` (fail with a message that reports the observed times).
4. **Latency regression guard.** `expect(builtAt).toBeLessThan(<tight bound>)` and the same for
   `shopAt`, where the tight bound is a small multiple of the **design target** (a few minutes of
   game time). Measured values with the sped-up cadence and the default gate are shop ≈ 1.5s and
   dwelling ≈ 31.6s, so a 60s bound is both comfortable and meaningful. Report both measured numbers
   in the failure message so a regression is diagnosable from output alone.
5. **No engine errors.** Spy on `console.error` (copy the `vi.spyOn` pattern from
   `test-engine/viability.ts`) and assert no `script.executionError`, no `Action infinite fail`, no
   storm of `work.constructionStep.skip` with `reason: 'site-finalized-during-approach'`, and no
   `Unsupported construction target`.
6. **No one-shot line outlives its construction.** Assert `game.freightLines` contains no
   `isOneShotLine` entries at the end. With delivery-only automation none should exist; if one does
   spawn it must have been swept once its site was satisfied, so the same assertion covers both the
   "never spawned" and the "spawned and self-deleted" cases.

## Time budget & performance

- `TEST_BUDGET_S = 900` (15 game-minutes) at `TICK_MS = 250` is ~1800 iterations worst case; the
  early exit means the normal path is ~64 ticks (the dwelling completes at ≈31.6s). Wall-clock for
  the whole file is ~0.8s of test time. The 15-minute ceiling is a safety net, not a target — the
  acceptance target is "a few minutes of game time" (TBD).
- `TICK_MS` must stay `≤ 500`. `gameMaxTickDeltaSeconds = 1` (see
  `engines/rules/src/tuning/simulation.ts`) and the ticker **skips** any tick whose scaled delta
  exceeds it — which would silently freeze `virtualTime` and make the loop never terminate.
  `gameTimeSpeedFactors[1] = 1` is the default `timeControl`.
- Spawner cadence must come from `rules` (the "Prerequisite" step) so the test tunes it explicitly.
  Do **not** shrink `TICK_MS` to speed the test up — that trades determinism for wall-clock.
- This test lives in `tests/integration/**`, which `engines/ssh/vitest.light.config.ts` already
  excludes as a class — so it runs only in the thorough suite
  (`pnpm --filter ssh test:thorough`). No per-file exclude entry is needed (verified:
  `vitest list --config vitest.light.config.ts` reports zero matches).
- Opt into a large per-test timeout at the test site, since the file default is 10s:
  `it('…', { timeout: 120000 }, async () => { … })`.

## Determinism & gotchas checklist

- [x] **Engineer variant.** Use `{ alveolus: 'engineer', variant: 'building' }`. The root engineer has
      no `variantSpec` ⇒ `allowedJobs` is empty ⇒ zero foundation/construct jobs. Existing tests that
      place a bare `engineer` patch `variantSpec` by hand; specifying the variant is cleaner.
- [x] **Commercial road adjacency.** `isRoadAdjacent` scans the six borders via
      `game.hex.getRoadType`; roads live on **border midpoints**, not tiles. A commercial tile with
      no road border is silently never a candidate (there is a dedicated unit test for exactly this).
- [x] **Ticker lifetime.** `ResidentialDemandTicker` / `CommercialDemandTicker` / `OneShotLineTicker`
      are created in `Game.load()` and in `loadGameData()`. Prefer constructing
      `new Game(gen, patches)` directly; a bare `Game.generate()` call would not create them.
- [x] **One dwelling at a time, but not the test's business.** `hasResidentialConstructionInProgress`
      is a global gate that serializes dwelling builds. It is **not** part of the acceptance
      criterion: the test only cares that a dwelling/shop is eventually built (`100%`), so a serial
      gate is fine. Do not assert on intermediate progress, and do not special-case the gate to make
      the test pass.
- [x] **Clear tile burden.** The residential spawner requires `tile.isClear`. Concrete terrain plus
      `settlementGeneration: false` avoids seed deposits, but clear any stray
      `looseGoods` / `deposit` on candidate tiles after load — the `clearGeneratedBurden` helper in
      `tests/unit/engineer-residential-priority.test.ts` is the pattern.
- [x] **Free vehicle.** `findFreeVehicle` requires `servedLines.length === 0 && !vehicle.operator`.
      Even with self-haul disabled, keep the vehicle un-operatored so the "no one-shot line" check
      is meaningful.
- [x] **Wallet.** `autoBuy` needs `canAffordVp`; `startingAccountBalanceVp = 200` covers
      concrete + wood + planks at the prices above. Assert `balanceVp` decreased — that proves the
      delivery branch ran rather than a free credit.
- [x] **`internality` is a strict threshold.** `internality >= 0.5` means self-haul first. Use `0`,
      not `0.499`, so the intent is unambiguous.
- [x] **`gameStart` ordering.** Verify with a first-tick assertion that the authored characters have
      started (`runningScripts.length > 0` / a non-idle `stepExecutor`). If it fails, switch to the
      manual driver described above.
- [x] **Yield to the event loop** every ~200 ticks with `await new Promise(r => setTimeout(r, 0))`,
      mirroring the existing long-running sims, so the vitest worker is not starved.

## Test layout

One `it`, per the request — both structures in a single scenario:

```ts
describe('spontaneous construction (residential + commercial)', () => {
  it(
    'builds a dwelling and spawns a shop from boosted zones',
    { timeout: 120000 },
    async () => {
      // …fixture, settlement profile, automation config, sim loop, assertions…
    }
  )
})
```

Sub-cases that would be nicer as separate tests (spawner-only, construction-only, self-haul) already
exist as unit tests for the spawners and for one-shot lines, so this file stays a single scenario.

## Optional follow-ups (not part of this test)

1. **Self-haul variant** — same fixture with `internality = 0.5`, `maxSelfHaulDistance = 12`, and a
   character parked at the bay so the wheelbarrow gets an operator deterministically. Assert that the
   one-shot line spawns, the vehicle moves goods, and the line self-deletes. Separate `it` with a
   generous timeout; expect operator-pickup flakiness.
2. **`BuildShop`** — make commercial construction real (shell + a `construction.shops` recipe), then
   tighten assertion 2 to "a `Shop` built by an engineer", and extend `zone-tendencies` /
   `deficit-ledger` to surface the shop's material demand.
3. **Latency budget** — once the measured latency of both spawners is known, replace the 900s hard
   stop with the measured worst case × 2, and write the agreed "few minutes" design target into
   [`../docs/districts.md`](../docs/districts.md) §"Emission cadence & tunability".
4. **Long-range delivery** — prove the self-haul branch alone can satisfy foundation + shell demand
   for an estate beyond `maxSelfHaulDistance`, i.e. that the *delivery* fallback is genuinely what
   covers long-range spontaneous construction.
5. **Passenger/payload seam** — unaffected by this test; the line/order representation stays
   goods-typed for now (see [`spontaneous-lines.md`](./spontaneous-lines.md) §"People (passengers) —
   defer").

## Decided (was "Open questions")

**1. Game constants belong in `rules`.** All spawner tuning — cooldowns, observation threshold,
sensing/demand radii — moves from `ssh` module constants into the `rules` project, following the
`commerce.transportAutomation` precedent (content value in `rules`, seeded into a reactive `Game`
mirror for live tuning by both the player and tests). This is a **prerequisite** for the test; see
"Honest scope → Prerequisite" above.

**2. Latency target: a few minutes of game time.** "Within one hour" was a figure of speech, not a
requirement. The intended target is a few game-minutes, exact value still **to be determined** once
both spawners are measured. The test's 900s budget is a harness hard stop only; the tuning constant
should eventually be derived from the agreed target rather than left at the hard-coded `2`.

**3. `hasResidentialConstructionInProgress` is a spawner guard, not a global rule.** It has no reason
to exist as a general-purpose function — it is internal exclusion logic for the residential spawner,
not a property of the world that anything else should read or assert on. It should be kept private to
the spawner (or removed in favour of letting each candidate tile be evaluated independently).

Independently: the **test asserts completion, not progress**. A dwelling/shop is either fully built
on its tile or it is not — so the one-at-a-time serialization is irrelevant to the acceptance
criterion (`100%`, never partial). Serialization may limit how fast a *district* grows, but that is a
separate tuning question, not this test's concern.