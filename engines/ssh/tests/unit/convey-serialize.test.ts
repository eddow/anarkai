import { describe, expect, it, vi } from 'vitest'
import { Alveolus } from '../../src/lib/board/content/alveolus'
import { resolveSerializedFreightParty } from '../../src/lib/hive/convey-restore'
import { serializeFreightParty } from '../../src/lib/hive/convey-serialize'

describe('convey serialization', () => {
	it('serializes vehicle docks by vehicle index and restores them from the current game vehicle order', () => {
		const vehicle = { name: 'vehicle-1' } as any
		const bay = Object.create(Alveolus.prototype) as Alveolus
		const dock = {
			kind: 'vehicle-freight-dock',
			vehicle,
			bay,
			tile: { position: { q: 1, r: 2 } },
		} as any
		const hive = { freightVehicleDockFor: vi.fn().mockReturnValue(dock) }
		;(bay as any).hive = hive

		const ref = serializeFreightParty(dock, new Map([[vehicle, 0]]))

		expect(ref).toEqual({ kind: 'vehicleDock', vehicleIndex: 0, bayCoord: [1, 2] })

		const game = {
			hex: {
				getTile: vi.fn(() => ({ content: bay })),
			},
			vehicles: [vehicle],
		} as any

		const restored = resolveSerializedFreightParty(game, ref)
		expect(restored).toBe(dock)
		expect(hive.freightVehicleDockFor).toHaveBeenCalledWith(vehicle)
	})
})
