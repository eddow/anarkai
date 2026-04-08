import { ZoneManager } from 'ssh/board/zone'
import { describe, expect, it } from 'vitest'

describe('ZoneManager residential polish', () => {
	it('does not duplicate the same residential coord when setZone is repeated', () => {
		const zm = new ZoneManager()
		const c = { q: -2, r: 0 }
		zm.setZone(c, 'residential')
		zm.setZone(c, 'residential')
		expect(zm.residentialCoords).toHaveLength(1)
		expect(zm.residentialCoords[0]).toEqual(c)
	})

	it('listUnreservedResidentialCoords excludes reserved tiles', () => {
		const zm = new ZoneManager()
		zm.setZone({ q: 0, r: 0 }, 'residential')
		zm.setZone({ q: 1, r: 0 }, 'residential')
		const owner = {}
		expect(zm.listUnreservedResidentialCoords()).toHaveLength(2)
		zm.tryReserveResidentialAt(owner, { q: 0, r: 0 })
		const open = zm.listUnreservedResidentialCoords()
		expect(open).toHaveLength(1)
		expect(open[0]).toMatchObject({ q: 1, r: 0 })
	})

	it('tryReserveResidentialAt refuses another owner on an occupied tile', () => {
		const zm = new ZoneManager()
		zm.setZone({ q: 0, r: 0 }, 'residential')
		const a = {}
		const b = {}
		expect(zm.tryReserveResidentialAt(a, { q: 0, r: 0 })).toBe(true)
		expect(zm.tryReserveResidentialAt(b, { q: 0, r: 0 })).toBe(false)
	})

	it('tryReserveResidentialAt is idempotent for the same owner', () => {
		const zm = new ZoneManager()
		zm.setZone({ q: 0, r: 0 }, 'residential')
		const a = {}
		expect(zm.tryReserveResidentialAt(a, { q: 0, r: 0 })).toBe(true)
		expect(zm.tryReserveResidentialAt(a, { q: 0, r: 0 })).toBe(true)
		expect(zm.getReservation(a)).toMatchObject({ q: 0, r: 0 })
	})

	it('releaseReservation clears owner mapping', () => {
		const zm = new ZoneManager()
		zm.setZone({ q: 0, r: 0 }, 'residential')
		const a = {}
		zm.tryReserveResidentialAt(a, { q: 0, r: 0 })
		zm.releaseReservation(a)
		expect(zm.listUnreservedResidentialCoords()).toHaveLength(1)
	})

	it('removeZone clears both reservation indexes for the removed tile', () => {
		const zm = new ZoneManager()
		const coord = { q: 0, r: 0 }
		const owner = {}
		zm.setZone(coord, 'residential')
		zm.tryReserveResidentialAt(owner, coord)

		expect(zm.getReservation(owner)).toMatchObject(coord)
		zm.removeZone(coord)
		expect(zm.getReservation(owner)).toBeUndefined()
		expect(zm.isReserved(coord)).toBe(false)
	})

	it('tryReserveResidentialAt moves owner to a new tile without leaking the old slot', () => {
		const zm = new ZoneManager()
		zm.setZone({ q: 0, r: 0 }, 'residential')
		zm.setZone({ q: 1, r: 0 }, 'residential')
		const a = {}
		expect(zm.tryReserveResidentialAt(a, { q: 0, r: 0 })).toBe(true)
		expect(zm.tryReserveResidentialAt(a, { q: 1, r: 0 })).toBe(true)
		expect(zm.isReserved({ q: 0, r: 0 })).toBe(false)
		expect(zm.isReserved({ q: 1, r: 0 })).toBe(true)
		expect(zm.getReservation(a)).toMatchObject({ q: 1, r: 0 })
	})
})
