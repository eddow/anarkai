import { Tile } from 'ssh/board/tile'
import { StorageAlveolus } from 'ssh/hive/storage'
import { describe, expect, it, vi } from 'vitest'
import { cancelFreightMapPick, freightMapPick, tryConsumeFreightMapPick } from './freight-map-pick'

const makeTile = (position: { q: number; r: number }, content?: unknown): Tile => {
	const raw: Record<string, unknown> = { position }
	if (content !== undefined) raw.content = content
	return Object.setPrototypeOf(raw, Tile.prototype) as Tile
}

const makeFreightBay = (): StorageAlveolus => {
	const raw = Object.create(StorageAlveolus.prototype) as StorageAlveolus
	Object.defineProperty(raw, 'hive', { value: { name: 'H' }, enumerable: true, configurable: true })
	Object.defineProperty(raw, 'name', { value: 'freight_bay', enumerable: true, configurable: true })
	Object.defineProperty(raw, 'action', {
		value: { type: 'road-fret', kind: 'slotted', slots: 4, capacity: 2 },
		enumerable: true,
		configurable: true,
	})
	return raw
}

describe('freight-map-pick', () => {
	it('applies a tile center pick', () => {
		const apply = vi.fn()
		freightMapPick.pending = {
			lineId: 'line-1',
			pickKind: 'center',
			apply,
		}
		const tile = makeTile({ q: 3, r: -1 })
		const ok = tryConsumeFreightMapPick({} as never, tile)
		expect(ok).toBe(true)
		expect(apply).toHaveBeenCalledTimes(1)
		expect(apply.mock.calls[0]?.[0]).toEqual({ kind: 'center', coord: [3, -1] })
		expect(freightMapPick.pending).toBeUndefined()
	})

	it('applies a freight bay pick from storage alveolus content', () => {
		const apply = vi.fn()
		freightMapPick.pending = {
			lineId: 'line-1',
			pickKind: 'bay',
			apply,
		}
		const bay = makeFreightBay()
		const tile = makeTile({ q: 2, r: 4 }, bay)
		const ok = tryConsumeFreightMapPick({} as never, tile)
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
		cancelFreightMapPick()
		expect(freightMapPick.pending).toBeUndefined()
	})
})
