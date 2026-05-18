import {
	createNpcSettlementTradeProfile,
	settlementTradeObjectUid,
} from 'ssh/commerce/settlement-trade'
import { Game } from 'ssh/game/game'
import type { GeneratedSettlement, GeneratedTileData, SettlementZonePlan } from 'ssh/generation'
import { afterEach, describe, expect, it } from 'vitest'

function settlement(kind: GeneratedSettlement['kind']): GeneratedSettlement {
	const radius = kind === 'city' ? 4 : kind === 'town' ? 3 : 2
	return {
		id: `settlement-${kind}`,
		name: `${kind} market`,
		kind,
		center: { q: 0, r: 0 },
		score: 1,
		radius,
	}
}

function tile(q: number, r: number, patch: Partial<GeneratedTileData> = {}): GeneratedTileData {
	return {
		coord: { q, r },
		terrain: 'grass',
		height: 0,
		goods: {},
		walkTime: 1,
		...patch,
	}
}

const tiles: GeneratedTileData[] = [
	tile(0, 0),
	tile(1, 0, { terrain: 'forest' }),
	tile(2, -1, { terrain: 'forest' }),
	tile(4, -1, { terrain: 'rocky', deposit: { type: 'rock', amount: 10 } }),
]

const zones: SettlementZonePlan['zones'] = {
	harvest: [[1, 0]],
	residential: [],
	named: [{ id: 'industrial', name: 'Industrial', coords: [[4, -1]] }],
}

describe('settlement trade profiles', () => {
	const games = new Set<Game>()

	afterEach(() => {
		for (const game of games) game.destroy()
		games.clear()
	})

	it('generates deterministic offers for the same settlement and seed', () => {
		const first = createNpcSettlementTradeProfile({
			seed: 42,
			regionSetKey: '0,0',
			settlement: settlement('town'),
			tileData: tiles,
			zones,
		})
		const second = createNpcSettlementTradeProfile({
			seed: 42,
			regionSetKey: '0,0',
			settlement: settlement('town'),
			tileData: tiles,
			zones,
		})

		expect(first).toEqual(second)
	})

	it.each([
		['village', 2],
		['town', 3],
		['city', 4],
	] as const)('creates %s buy and sell offer counts', (kind, count) => {
		const profile = createNpcSettlementTradeProfile({
			seed: 42,
			regionSetKey: '0,0',
			settlement: settlement(kind),
			tileData: tiles,
			zones,
		})

		expect(profile.offers.filter((offer) => offer.direction === 'sell')).toHaveLength(count)
		expect(profile.offers.filter((offer) => offer.direction === 'buy')).toHaveLength(count)
	})

	it('derives positive integer prices from goods base values', () => {
		const profile = createNpcSettlementTradeProfile({
			seed: 42,
			regionSetKey: '0,0',
			settlement: settlement('city'),
			tileData: tiles,
			zones,
		})

		expect(profile.offers.length).toBeGreaterThan(0)
		for (const offer of profile.offers) {
			expect(Number.isInteger(offer.priceVp)).toBe(true)
			expect(offer.priceVp).toBeGreaterThan(0)
		}
	})

	it('can include concrete from the rules-backed trade goods list', () => {
		const profile = createNpcSettlementTradeProfile({
			seed: 42,
			regionSetKey: '0,0',
			settlement: settlement('city'),
			tileData: tiles,
			zones,
		})

		expect(profile.offers.some((offer) => offer.good === 'concrete')).toBe(true)
	})

	it('resolves settlement trade objects from the game object registry facade', async () => {
		const game = new Game({
			terrainSeed: 42,
			characterCount: 0,
			settlementGeneration: { settlementCount: 1, minSpacing: 2 },
		})
		games.add(game)
		await game.loaded
		await game.ensureGameplaySectors(['0,0'])

		const profile = game.listSettlementTradeProfiles()[0]
		expect(profile).toBeDefined()
		if (!profile) throw new Error('Expected generated settlement trade profile')

		const object = game.getObject(settlementTradeObjectUid(profile.id))

		expect(object?.uid).toBe(settlementTradeObjectUid(profile.id))
		expect(object?.title).toBe(profile.name)
		expect(object?.position).toEqual(profile.center)
		expect(object?.hoverObject).toBe(game.hex.getTile(profile.center))
	})

	it('keeps streamed settlement trade profiles unique by settlement id', async () => {
		const game = new Game({
			terrainSeed: 42,
			characterCount: 0,
			settlementGeneration: { settlementCount: 2, minSpacing: 2 },
		})
		games.add(game)
		await game.loaded

		await game.ensureGameplaySectors(['5,5'])
		await game.ensureGameplaySectors(['5,5'])

		const ids = game.listSettlementTradeProfiles().map((profile) => profile.id)
		expect(ids.length).toBeGreaterThan(0)
		expect(ids.length).toBe(new Set(ids).size)
	})
})
