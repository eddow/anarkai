// @ts-nocheck
import { commercialDefaultShopType } from 'ssh/commerce/commercial-demand'
import { BasicDwelling } from 'ssh/board/content/basic-dwelling'
import { BuildDwelling } from 'ssh/board/content/build-dwelling'
import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import { Shop } from 'ssh/commerce/shop'
import { isOneShotLine } from 'ssh/freight/one-shot-lines'
import type { GamePatches, SaveState } from 'ssh/game'
import { Game } from 'ssh/game/game'
import type { SimulationLoop } from 'ssh/utils/loop'
import { residentialBasicDwellingSite } from 'ssh/residential/constants'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Spontaneous residential + commercial construction (ticker-driven).
 *
 * Lets the real game simulate a minimal colony and asserts that a residential
 * zone's housing pressure spawns a dwelling project that an engineer builds to
 * completion, and a commercial zone's sustained shoppers spawn a shop. Asserts
 * **completion** (`100%`), never partial progress. See
 * `plans/spontaneous-construction-test.md`.
 */

function axialRect(
	q0: number,
	q1: number,
	r0: number,
	r1: number
): ReadonlyArray<readonly [number, number]> {
	const coords: Array<readonly [number, number]> = []
	for (let q = Math.min(q0, q1); q <= Math.max(q0, q1); q++) {
		for (let r = Math.min(r0, r1); r <= Math.max(r0, r1); r++) coords.push([q, r])
	}
	return coords
}

const RESIDENTIAL = axialRect(3, 5, -1, 1)
const COMMERCIAL = axialRect(-3, -1, -1, 1)

// Design target is "a few minutes" of game time (exact value TBD). The budget is
// a small multiple of that, purely a harness hard stop — NOT the acceptance criterion.
const TEST_BUDGET_S = 900 // 15 game-minutes
const TICK_MS = 250 // delta = gameRootSpeed(2) × 0.25s × speedFactor(1) = 0.5 virtual s
// Measured with the (sped-up) cadence below and the DEFAULT observation threshold:
// shop ≈ 1.5s, dwelling ≈ 31.6s. This bound is a regression guard over the
// "a few minutes" design target — it is not the acceptance criterion.
const LATENCY_GUARD_S = 60

function clearGeneratedBurden(game: Game, coords: ReadonlyArray<readonly [number, number]>) {
	for (const [q, r] of coords) {
		const tile = game.hex.getTile({ q, r })
		const content = tile?.content
		if (content instanceof UnBuiltLand) content.deposit = undefined
		for (const good of [...(tile?.looseGoods ?? [])]) good.remove()
	}
}

/**
 * Drive the real ticker until `isDone` or the budget elapses.
 *
 * Deliberately does **not** hand-drive `findBestJob()`/`begin()`: characters placed
 * via `patches.characters` exist before `gameStart` is emitted, so the script loop
 * self-drives them. Verified to produce identical latency with and without manual
 * driving — keeping it out means a broken script loop fails this test instead of
 * being masked by the harness.
 */
async function simulateUntil(
	game: Game,
	isDone: () => boolean,
	maxVirtualSeconds: number
): Promise<{ ticks: number }> {
	let ticks = 0
	while (game.clock.virtualTime < maxVirtualSeconds && !isDone()) {
		game.tickerCallback({ elapsedMS: TICK_MS } as SimulationLoop)
		ticks++
		if (ticks % 200 === 0) await new Promise((resolve) => setTimeout(resolve, 0))
	}
	return { ticks }
}

describe('spontaneous construction (residential + commercial)', () => {
	let game: Game | undefined

	afterEach(() => {
		game?.destroy()
		game = undefined
	})

	it(
		'builds a dwelling and spawns a shop from boosted zones',
		{ timeout: 120000 },
		async () => {
			const area = axialRect(-6, 8, -6, 8)
			const patches: GamePatches = {
				terrains: { concrete: [...area] },
				// Roads live on BORDER midpoints (half-integers), not tiles — a
				// commercial tile with no road on any of its six borders is never
				// a candidate.
				roads: {
					path: [
						[-1, 0.5],
						[0, 0.5],
						[1, 0.5],
					],
				},
				hives: [
					{
						name: 'Spontaneous',
						working: true,
						alveoli: [
							{
								coord: [0, 0],
								alveolus: 'storage',
								goods: { concrete: 6, wood: 12, planks: 6 },
							},
							{ coord: [0, 1], alveolus: 'freight_bay' },
							// The engineer MUST carry the `building` variant — the root
							// engineer has no `variantSpec`, so `allowedJobs` is empty
							// and it exposes zero foundation/construct jobs.
							{ coord: [1, 0], alveolus: 'engineer', variant: 'building' },
						],
					},
				],
				zones: [
					{ type: 'residential', coords: [...RESIDENTIAL] },
					{ type: 'commercial', coords: [...COMMERCIAL] },
				],
				characters: [
					{ name: 'Resident A', position: { q: 4, r: 0 } },
					{ name: 'Resident B', position: { q: 4, r: 1 } },
					{ name: 'Shopper C', position: { q: -2, r: 0 } },
					{ name: 'Shopper D', position: { q: -2, r: 1 } },
				],
				// A free vehicle (no line, no operator) so the one-shot self-haul
				// branch could claim it. Kept un-operatored so the "no self-haul
				// line spawned" assertion stays meaningful.
				vehicles: [{ name: 'hauler', vehicleType: 'wheelbarrow', position: { q: 0, r: 1 } }],
				playerAccount: { balanceVp: 200 },
			} as GamePatches

			game = new Game(
				{ terrainSeed: 20260912, characterCount: 0, settlementGeneration: false },
				patches as Partial<SaveState>
			)
			await game.loaded
			game.ticker.stop()

			// The three tickers must be registered — a silently-missing ticker
			// would otherwise fail as a timeout instead of loudly.
			const ticked = (game as unknown as { tickedObjects: Set<{ constructor: { name: string } }> })
				.tickedObjects
			const tickerNames = [...ticked].map((o) => o.constructor.name)
			expect(tickerNames).toContain('ResidentialDemandTicker')
			expect(tickerNames).toContain('CommercialDemandTicker')
			expect(tickerNames).toContain('OneShotLineTicker')

			// Concrete terrain keeps every candidate tile clear and walkable, but
			// clear any stray burden the seed may have placed anyway.
			clearGeneratedBurden(game, [...RESIDENTIAL, ...COMMERCIAL])

			// Materials via the delivery branch (deterministic instant credit).
			// Self-haul is covered end-to-end by one-shot-lines tests; here it
			// would only add the vehicle-operator race.
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
			game.transportAutomation.internality = 0 // delivery first — deterministic
			game.transportAutomation.spawnCooldownSeconds = 0
			game.transportAutomation.maxSelfHaulDistance = 0 // disabled here

			// Spawner cadence is live tuning from `rules` — speed it up
			// deterministically for the test rather than shrinking the tick.
			game.districtSpawning.residentialSpawnCooldownSeconds = 0.5
			game.districtSpawning.commercialSpawnCooldownSeconds = 0.5
			// The observation threshold is deliberately left at its `rules` default (3)
			// so the cumulative-observation gate is exercised, not bypassed.

			const balanceBefore = game.playerAccount.balanceVp

			const errors: string[] = []
			const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
				errors.push(
					args
						.map((a) => {
							if (typeof a === 'string') return a
							if (a instanceof Error) return `${a.message}\n${a.stack ?? ''}`
							try {
								return JSON.stringify(a)
							} catch {
								return String(a)
							}
						})
						.join(' ')
				)
			})

			try {
				const workers = [...game.population]
				for (const worker of workers) {
					worker.role = 'worker'
					void worker.scriptsContext
				}

				let builtAt: number | undefined
				let shopAt: number | undefined
				// Prove the construction pipeline actually ran (site → shell → dwelling)
				// rather than a structure appearing by some shortcut.
				let sawSite = false
				let sawShell = false

				await simulateUntil(
					game,
					() => {
						if (builtAt === undefined) {
							for (const [q, r] of RESIDENTIAL) {
								const content = game!.hex.getTile({ q, r })?.content
								if (content instanceof UnBuiltLand && content.site === residentialBasicDwellingSite) {
									sawSite = true
								}
								if (content instanceof BuildDwelling) sawShell = true
								if (content instanceof BasicDwelling) {
									builtAt = game!.clock.virtualTime
									break
								}
							}
						}
						if (shopAt === undefined) {
							for (const [q, r] of COMMERCIAL) {
								if (game!.hex.getTile({ q, r })?.content instanceof Shop) {
									shopAt = game!.clock.virtualTime
									break
								}
							}
						}
						return builtAt !== undefined && shopAt !== undefined
					},
					TEST_BUDGET_S
				)

				// 1. Residential construction completed — via the real pipeline.
				let dwellingTile: { q: number; r: number } | undefined
				for (const [q, r] of RESIDENTIAL) {
					if (game.hex.getTile({ q, r })?.content instanceof BasicDwelling) {
						dwellingTile = { q, r }
						break
					}
				}
				expect(
					dwellingTile,
					`no BasicDwelling in residential zone after ${game.clock.virtualTime.toFixed(1)}s (builtAt=${builtAt}, shopAt=${shopAt})`
				).toBeDefined()
				// The dwelling must have passed through the spawner's foundation site and
				// the material-bearing shell — otherwise this test would not be exercising
				// spontaneous construction at all.
				expect(sawSite, 'dwelling never passed through a foundation site').toBe(true)
				expect(sawShell, 'dwelling never passed through a BuildDwelling shell').toBe(true)
				expect(game.hex.getTile(dwellingTile!)?.baseTerrain).toBe('concrete')

				// 2. Commercial spawned with the default shop type.
				let shopTile: { q: number; r: number } | undefined
				for (const [q, r] of COMMERCIAL) {
					if (game.hex.getTile({ q, r })?.content instanceof Shop) {
						shopTile = { q, r }
						break
					}
				}
				expect(
					shopTile,
					`no Shop in commercial zone after ${game.clock.virtualTime.toFixed(1)}s (builtAt=${builtAt}, shopAt=${shopAt})`
				).toBeDefined()
				expect(
					(game.hex.getTile(shopTile!)?.content as Shop).shopType
				).toBe(commercialDefaultShopType)

				// 3. Both happened within the budget.
				expect(
					builtAt,
					`dwelling never completed within ${TEST_BUDGET_S}s (shopAt=${shopAt})`
				).toBeDefined()
				expect(
					shopAt,
					`shop never spawned within ${TEST_BUDGET_S}s (builtAt=${builtAt})`
				).toBeDefined()
				expect(builtAt!).toBeLessThanOrEqual(TEST_BUDGET_S)
				expect(shopAt!).toBeLessThanOrEqual(TEST_BUDGET_S)

				// 4. Latency regression guard — tight bound over the "few minutes"
				// design target. Report both measured numbers on failure.
				expect(
					builtAt,
					`dwelling latency regression: builtAt=${builtAt}s shopAt=${shopAt}s (bound ${LATENCY_GUARD_S}s)`
				).toBeLessThan(LATENCY_GUARD_S)
				expect(
					shopAt,
					`shop latency regression: builtAt=${builtAt}s shopAt=${shopAt}s (bound ${LATENCY_GUARD_S}s)`
				).toBeLessThan(LATENCY_GUARD_S)

				// Delivery branch ran (not a free credit): the wallet paid.
				expect(game.playerAccount.balanceVp).toBeLessThan(balanceBefore)
			} finally {
				errorSpy.mockRestore()
			}

			// 5. No engine errors.
			const forbidden = [
				'script.executionError',
				'Action infinite fail',
				'Unsupported construction target',
			]
			for (const sub of forbidden) {
				const hit = errors.find((line) => line.includes(sub))
				expect(
					hit,
					`captured forbidden console.error (${JSON.stringify(sub)}): ${(hit ?? '').slice(0, 500)}`
				).toBeUndefined()
			}
			const skipStorm = errors.filter((line) =>
				line.includes('work.constructionStep.skip')
			)
			expect(
				skipStorm.length,
				`storm of work.constructionStep.skip (${skipStorm.length}): ${skipStorm.slice(0, 3).join(' | ').slice(0, 500)}`
			).toBeLessThan(50)

			// 6. No temporary corridor outlives the construction it served. With
			// delivery-only automation no one-shot line should exist at all; if one
			// ever spawned it must have been swept once the site was satisfied.
			const lingering = [...game.freightLines].filter(isOneShotLine)
			expect(
				lingering.map((line) => line.name),
				'one-shot line(s) outlived the construction they served'
			).toEqual([])
		}
	)
})
