import type { ZoneDefinition } from 'ssh/board/zone'
import { ZoneManager } from 'ssh/board/zone'
import { describe, expect, it } from 'vitest'

const res = (): ZoneDefinition => ({ type: 'residential' })

describe('ZoneManager residential polish', () => {
	it('does not duplicate the same residential coord when setZone is repeated', () => {
		const zm = new ZoneManager()
		const c = { q: -2, r: 0 }
		const r = res()
		zm.setZone(c, r)
		zm.setZone(c, r)
		expect(zm.residentialCoords).toHaveLength(1)
		expect(zm.residentialCoords[0]).toEqual(c)
	})

	it('listUnreservedResidentialCoords excludes reserved tiles', () => {
		const zm = new ZoneManager()
		const r = res()
		zm.setZone({ q: 0, r: 0 }, r)
		zm.setZone({ q: 1, r: 0 }, r)
		const owner = {}
		expect(zm.listUnreservedResidentialCoords()).toHaveLength(2)
		zm.tryReserveResidentialAt(owner, { q: 0, r: 0 })
		const open = zm.listUnreservedResidentialCoords()
		expect(open).toHaveLength(1)
		expect(open[0]).toMatchObject({ q: 1, r: 0 })
	})

	it('tryReserveResidentialAt refuses another owner on an occupied tile', () => {
		const zm = new ZoneManager()
		zm.setZone({ q: 0, r: 0 }, { type: 'residential' })
		const a = {}
		const b = {}
		expect(zm.tryReserveResidentialAt(a, { q: 0, r: 0 })).toBe(true)
		expect(zm.tryReserveResidentialAt(b, { q: 0, r: 0 })).toBe(false)
	})

	it('tryReserveResidentialAt is idempotent for the same owner', () => {
		const zm = new ZoneManager()
		zm.setZone({ q: 0, r: 0 }, { type: 'residential' })
		const a = {}
		expect(zm.tryReserveResidentialAt(a, { q: 0, r: 0 })).toBe(true)
		expect(zm.tryReserveResidentialAt(a, { q: 0, r: 0 })).toBe(true)
		expect(zm.getReservation(a)).toMatchObject({ q: 0, r: 0 })
	})

	it('releaseReservation clears owner mapping', () => {
		const zm = new ZoneManager()
		zm.setZone({ q: 0, r: 0 }, { type: 'residential' })
		const a = {}
		zm.tryReserveResidentialAt(a, { q: 0, r: 0 })
		zm.releaseReservation(a)
		expect(zm.listUnreservedResidentialCoords()).toHaveLength(1)
	})

	it('removeZone clears both reservation indexes for the removed tile', () => {
		const zm = new ZoneManager()
		const coord = { q: 0, r: 0 }
		const owner = {}
		zm.setZone(coord, { type: 'residential' })
		zm.tryReserveResidentialAt(owner, coord)

		expect(zm.getReservation(owner)).toMatchObject(coord)
		zm.removeZone(coord)
		expect(zm.getReservation(owner)).toBeUndefined()
		expect(zm.isReserved(coord)).toBe(false)
	})

	it('tryReserveResidentialAt moves owner to a new tile without leaking the old slot', () => {
		const zm = new ZoneManager()
		zm.setZone({ q: 0, r: 0 }, { type: 'residential' })
		zm.setZone({ q: 1, r: 0 }, { type: 'residential' })
		const a = {}
		expect(zm.tryReserveResidentialAt(a, { q: 0, r: 0 })).toBe(true)
		expect(zm.tryReserveResidentialAt(a, { q: 1, r: 0 })).toBe(true)
		expect(zm.isReserved({ q: 0, r: 0 })).toBe(false)
		expect(zm.isReserved({ q: 1, r: 0 })).toBe(true)
		expect(zm.getReservation(a)).toMatchObject({ q: 1, r: 0 })
	})

	it('defines custom zones and tracks their tile membership', () => {
		const zm = new ZoneManager()
		const zone = zm.defineZone({ name: 'North Grove', type: 'passive', color: '#4f8cff' })
		expect(zone.name).toBe('north-grove')
		zm.setZone({ q: 2, r: -1 }, zone)
		zm.setZone({ q: 3, r: -1 }, zone)

		expect(zm.getZone({ q: 2, r: -1 })).toBe(zone)
		expect(zm.coordsForZone(zone)).toEqual([
			{ q: 2, r: -1 },
			{ q: 3, r: -1 },
		])
		expect(zm.listCustomZoneDefinitions()).toMatchObject([
			{ name: 'north-grove', color: '#4f8cff' },
		])
	})

	it('chooses a deterministic central coord for custom zones', () => {
		const zm = new ZoneManager()
		const zone = zm.defineZone({ name: 'Market Yard', type: 'passive' })
		zm.setZone({ q: 0, r: 0 }, zone)
		zm.setZone({ q: 2, r: 0 }, zone)
		zm.setZone({ q: 1, r: 0 }, zone)

		expect(zm.centralCoordForZone(zone)).toEqual({ q: 1, r: 0 })
	})

	it('custom zones do not keep residential reservations when replacing a residential tile', () => {
		const zm = new ZoneManager()
		const coord = { q: 0, r: 0 }
		const owner = {}
		zm.setZone(coord, { type: 'residential' })
		expect(zm.tryReserveResidentialAt(owner, coord)).toBe(true)

		const lineZone = zm.defineZone({ name: 'Line zone', type: 'passive' })
		zm.setZone(coord, lineZone)

		expect(zm.getReservation(owner)).toBeUndefined()
		expect(zm.isReserved(coord)).toBe(false)
		expect(zm.residentialCoords).toHaveLength(0)
	})

	it('keeps generated zones under editable zones', () => {
		const zm = new ZoneManager()
		const coord = { q: 5, r: -2 }
		const industrialDef = zm.defineZone({ type: 'passive' })
		zm.setGeneratedZone(coord, industrialDef)

		expect(zm.getZone(coord)).toBeUndefined()
		expect(zm.getGeneratedZone(coord)).toBe(industrialDef)
		expect(zm.getEffectiveZone(coord)).toBe(industrialDef)
		expect(zm.coordsForGeneratedZone(industrialDef)).toEqual([{ q: 5, r: -2 }])

		const h = zm.defineZone({ type: 'harvest' })
		zm.setZone(coord, h)
		expect(zm.getZone(coord)).toBe(h)
		expect(zm.getGeneratedZone(coord)).toBe(industrialDef)
		expect(zm.getEffectiveZone(coord)).toBe(h)
	})

	it('keeps generated system zones out of custom zone listings', () => {
		const zm = new ZoneManager()
		const industrialDef = zm.defineZone({ type: 'passive' })
		zm.setGeneratedZone({ q: 5, r: -2 }, industrialDef)
		const marketZone = zm.defineZone({ name: 'Market Yard', type: 'passive' })

		expect(zm.listZoneDefinitions().map((zone) => zone.name)).toContain(industrialDef.name)
		expect(zm.listCustomZoneDefinitions().map((zone) => zone.name)).toEqual([marketZone.name])
	})
})
