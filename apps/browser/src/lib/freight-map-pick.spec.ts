import { Tile } from 'ssh/board/tile'
import { SettlementTradeObject } from 'ssh/commerce/settlement-trade'
import { traces } from 'ssh/dev/debug'
import { FreightBayAlveolus } from 'ssh/hive/freight-bay'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	FREIGHT_ADD_STOP_ACTION,
	activateFreightAddStopPick,
	cancelFreightMapPick,
	freightMapPick,
	tryConsumeFreightMapPick,
	tryConsumeFreightMapPickRadiusDrag,
} from './freight-map-pick'
import { interactionMode } from './interactive-state'

const makeTile = (position: { q: number; r: number }, content?: unknown): Tile => {
	const raw: Record<string, unknown> = { position }
	Object.defineProperty(raw, 'content', {
		value: content,
		enumerable: true,
		configurable: true,
	})
	return Object.setPrototypeOf(raw, Tile.prototype) as Tile
}

const makeFreightBay = (): FreightBayAlveolus => {
	const raw = Object.create(FreightBayAlveolus.prototype) as FreightBayAlveolus
	Object.defineProperty(raw, 'hive', { value: { name: 'H' }, enumerable: true, configurable: true })
	Object.defineProperty(raw, 'name', { value: 'freight_bay', enumerable: true, configurable: true })
	Object.defineProperty(raw, 'action', {
		value: { type: 'road-fret' },
		enumerable: true,
		configurable: true,
	})
	return raw
}

const makeGame = (
	zoneId?: string,
	settlementAt?: { coord: { q: number; r: number }; id: string }
) =>
	({
		hex: {
			getTile: (coord: { q: number; r: number }) => makeTile(coord),
			zoneManager: {
				getZone: () => zoneId,
				getZoneDefinition: (id: string | undefined) =>
					id
						? {
								id,
								name: 'Custom zone',
							}
						: undefined,
			},
		},
		getSettlementTradeProfileAtCityHall: (coord: { q: number; r: number }) =>
			settlementAt && coord.q === settlementAt.coord.q && coord.r === settlementAt.coord.r
				? { id: settlementAt.id }
				: undefined,
	}) as never

const makeSettlement = (settlementId = 'settlement-1'): SettlementTradeObject => {
	const raw = Object.create(SettlementTradeObject.prototype) as SettlementTradeObject
	Object.defineProperty(raw, 'profile', {
		value: {
			id: settlementId,
			name: 'Settlement One',
			cityHall: {
				id: `${settlementId}:city-hall`,
				kind: 'city_hall',
				settlementId,
				name: 'Settlement One City Hall',
				position: { q: 5, r: 0 },
			},
			offers: [],
		},
		enumerable: true,
		configurable: true,
	})
	return raw
}

describe('freight-map-pick', () => {
	beforeEach(() => {
		freightMapPick.pending = undefined
		interactionMode.selectedAction = ''
		traces.ui = { assert: vi.fn() } as never
	})

	it('activates add-stop as a board tool', () => {
		const apply = vi.fn()
		activateFreightAddStopPick({ lineId: 'line-1', apply })

		expect(freightMapPick.pending).toMatchObject({ lineId: 'line-1', pickKind: 'add-stop' })
		expect(interactionMode.selectedAction).toBe(FREIGHT_ADD_STOP_ACTION)
	})

	it('applies a tile center pick', () => {
		const apply = vi.fn()
		freightMapPick.pending = {
			lineId: 'line-1',
			pickKind: 'center',
			apply,
		}
		const tile = makeTile({ q: 3, r: -1 })
		const ok = tryConsumeFreightMapPick(makeGame(), tile)
		expect(ok).toBe(true)
		expect(apply).toHaveBeenCalledTimes(1)
		expect(apply.mock.calls[0]?.[0]).toEqual({ kind: 'center', coord: [3, -1] })
		expect(freightMapPick.pending).toBeUndefined()
	})

	it('applies a freight bay pick from freight bay content', () => {
		const apply = vi.fn()
		freightMapPick.pending = {
			lineId: 'line-1',
			pickKind: 'bay',
			apply,
		}
		const bay = makeFreightBay()
		const tile = makeTile({ q: 2, r: 4 }, bay)
		const ok = tryConsumeFreightMapPick(makeGame(), tile)
		expect(ok).toBe(true)
		expect(apply.mock.calls[0]?.[0]?.kind).toBe('bay')
		expect(freightMapPick.pending).toBeUndefined()
	})

	it('clears pending state', () => {
		freightMapPick.pending = {
			lineId: 'line-1',
			pickKind: 'center',
			apply: vi.fn(),
		}
		interactionMode.selectedAction = FREIGHT_ADD_STOP_ACTION
		cancelFreightMapPick()
		expect(freightMapPick.pending).toBeUndefined()
		expect(interactionMode.selectedAction).toBe('')
	})

	it('adds a trade halt from a city hall tile pick', () => {
		const apply = vi.fn()
		activateFreightAddStopPick({ lineId: 'line-1', apply })

		const ok = tryConsumeFreightMapPick(
			makeGame(undefined, { coord: { q: 5, r: 0 }, id: 'settlement-1' }),
			makeTile({ q: 5, r: 0 })
		)
		expect(ok).toBe(true)
		expect(apply.mock.calls[0]?.[0]).toMatchObject({
			trade: { kind: 'settlement', settlementId: 'settlement-1' },
		})
		expect(freightMapPick.pending).toBeUndefined()
	})

	it('clears the add-stop board tool after a successful add', () => {
		const apply = vi.fn()
		activateFreightAddStopPick({ lineId: 'line-1', apply })

		const ok = tryConsumeFreightMapPick(
			makeGame(undefined, { coord: { q: 5, r: 0 }, id: 'settlement-1' }),
			makeTile({ q: 5, r: 0 })
		)

		expect(ok).toBe(true)
		expect(freightMapPick.pending).toBeUndefined()
		expect(interactionMode.selectedAction).toBe('')
	})

	it('keeps the add-stop board tool after a shift add', () => {
		const apply = vi.fn()
		activateFreightAddStopPick({ lineId: 'line-1', apply })

		const ok = tryConsumeFreightMapPick(
			makeGame(undefined, { coord: { q: 5, r: 0 }, id: 'settlement-1' }),
			makeTile({ q: 5, r: 0 }),
			{ shiftKey: true }
		)

		expect(ok).toBe(true)
		expect(freightMapPick.pending).toBeTruthy()
		expect(interactionMode.selectedAction).toBe(FREIGHT_ADD_STOP_ACTION)
	})

	it('does not consume clicks when the add-stop board tool is no longer selected', () => {
		const apply = vi.fn()
		activateFreightAddStopPick({ lineId: 'line-1', apply })
		interactionMode.selectedAction = 'build:storage'

		const ok = tryConsumeFreightMapPick(
			makeGame(undefined, { coord: { q: 5, r: 0 }, id: 'settlement-1' }),
			makeTile({ q: 5, r: 0 })
		)

		expect(ok).toBe(false)
		expect(apply).not.toHaveBeenCalled()
		expect(freightMapPick.pending).toBeUndefined()
		expect(interactionMode.selectedAction).toBe('build:storage')
	})

	it('keeps synthetic settlement object trade halt compatibility', () => {
		const apply = vi.fn()
		activateFreightAddStopPick({ lineId: 'line-1', apply })

		const ok = tryConsumeFreightMapPick(makeGame(), makeSettlement())
		expect(ok).toBe(true)
		expect(apply.mock.calls[0]?.[0]).toMatchObject({
			trade: { kind: 'settlement', settlementId: 'settlement-1' },
		})
		expect(freightMapPick.pending).toBeUndefined()
	})

	it('adds a named-zone halt from a custom-zone tile pick', () => {
		const apply = vi.fn()
		activateFreightAddStopPick({ lineId: 'line-1', apply })

		const ok = tryConsumeFreightMapPick(makeGame('orchard'), makeTile({ q: 1, r: 2 }))
		expect(ok).toBe(true)
		expect(apply.mock.calls[0]?.[0]).toMatchObject({
			zone: { kind: 'named', zoneId: 'orchard' },
		})
		expect(freightMapPick.pending).toBeUndefined()
	})

	it('ordinary add-stop tile clicks are consumed but keep the pick pending', () => {
		const apply = vi.fn()
		activateFreightAddStopPick({ lineId: 'line-1', apply })

		const ok = tryConsumeFreightMapPick(makeGame(), makeTile({ q: 1, r: 2 }))
		expect(ok).toBe(true)
		expect(apply).not.toHaveBeenCalled()
		expect(freightMapPick.pending).toBeTruthy()
	})

	it('adds a radius halt from an add-stop tile drag', () => {
		const apply = vi.fn()
		activateFreightAddStopPick({ lineId: 'line-1', apply })

		const ok = tryConsumeFreightMapPickRadiusDrag({
			game: makeGame(),
			startTile: makeTile({ q: 1, r: 1 }),
			endTile: makeTile({ q: 3, r: 1 }),
		})
		expect(ok).toBe(true)
		expect(apply.mock.calls[0]?.[0]).toMatchObject({
			zone: { kind: 'radius', center: [1, 1], radius: 2 },
		})
		expect(freightMapPick.pending).toBeUndefined()
	})
})
