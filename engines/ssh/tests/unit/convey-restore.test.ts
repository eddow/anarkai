import { describe, expect, it, vi } from 'vitest'
import { restoreSerializedConveyMovements } from '../../src/lib/hive/convey-restore'

describe('convey restore', () => {
	it('restores claimed convey rows using the serialized vehicle and character indexes', () => {
		const vehicle = { name: 'vehicle-1' } as any
		const claimedBy = { name: 'Ada' } as any
		const bay = {
			name: 'bay',
			hive: {
				freightVehicleDockFor: vi.fn(() => ({ kind: 'vehicle-freight-dock', vehicle, bay: {} })),
				restoreSerializedConveyRow: vi.fn(() => ({ ref: 'movement' })),
			},
		} as any
		const game = {
			hex: {
				getTile: vi.fn(() => ({ content: bay })),
				tiles: [],
			},
			vehicles: [vehicle],
			population: [claimedBy],
		} as any
		;(bay as any).hive.freightVehicleDockFor = vi.fn(() => ({
			kind: 'vehicle-freight-dock',
			vehicle,
			bay,
			hive: bay.hive,
		}))

		const rows = [
			{
				goodType: 'wood',
				path: [],
				from: { q: 0, r: 0 },
				provider: { kind: 'vehicleDock', vehicleIndex: 0, bayCoord: [0, 0] },
				demander: { kind: 'vehicleDock', vehicleIndex: 0, bayCoord: [0, 0] },
				claimed: true,
				claimedByCharacterIndex: 0,
				claimedAtMs: 42,
			},
		]
		;(bay as any).hive.restoreSerializedConveyRow = vi.fn(() => ({ ref: 'movement' }))

		const restored = restoreSerializedConveyMovements(game, rows as any)

		expect(restored).toHaveLength(1)
		expect(bay.hive.restoreSerializedConveyRow).toHaveBeenCalledWith(
			expect.objectContaining({ claimed: true, claimedByCharacterIndex: 0 }),
			expect.anything(),
			expect.anything()
		)
	})
})
