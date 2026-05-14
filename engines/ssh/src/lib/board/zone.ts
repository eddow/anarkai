import { reactive } from 'mutts'
import type { AxialCoord } from 'ssh/utils'
import { AxialKeyMap } from 'ssh/utils/mem'

export type BuiltInZone = 'residential' | 'harvest'
export type Zone = BuiltInZone | string

export interface NamedZoneDefinition {
	readonly id: Zone
	readonly name: string
	readonly color?: string
	readonly builtIn?: boolean
	readonly generated?: boolean
	readonly readonly?: boolean
}

export const ZONES_OBJECT_UID = 'zones'
export const ZONE_UID_PREFIX = 'zone:'

const BUILT_IN_ZONES: NamedZoneDefinition[] = [
	{ id: 'residential', name: 'Residential', color: '#44dd44', builtIn: true },
	{ id: 'harvest', name: 'Harvest', color: '#aa7744', builtIn: true },
]

export function normalizeZoneId(id: string): Zone {
	return id.trim().replace(/\s+/g, '-').toLowerCase()
}

export function zoneObjectUid(zoneId: string): string {
	return `${ZONE_UID_PREFIX}${encodeURIComponent(normalizeZoneId(zoneId))}`
}

export function isZoneObjectUid(uid: string): boolean {
	return uid.startsWith(ZONE_UID_PREFIX)
}

export function zoneIdFromObjectUid(uid: string): Zone | undefined {
	if (!isZoneObjectUid(uid)) return undefined
	const encoded = uid.slice(ZONE_UID_PREFIX.length)
	return encoded ? normalizeZoneId(decodeURIComponent(encoded)) : undefined
}

function centralCoordFrom(coords: AxialCoord[]): AxialCoord | undefined {
	if (coords.length === 0) return undefined
	const center = coords.reduce(
		(acc, coord) => {
			acc.q += coord.q
			acc.r += coord.r
			return acc
		},
		{ q: 0, r: 0 }
	)
	center.q /= coords.length
	center.r /= coords.length
	return [...coords].sort((a, b) => {
		const adq = a.q - center.q
		const adr = a.r - center.r
		const bdq = b.q - center.q
		const bdr = b.r - center.r
		const distance = adq * adq + adr * adr - (bdq * bdq + bdr * bdr)
		if (distance !== 0) return distance
		if (a.q !== b.q) return a.q - b.q
		return a.r - b.r
	})[0]
}

export class ZoneManager {
	private readonly zones = reactive(new AxialKeyMap<Zone>())
	private readonly generatedZones = reactive(new AxialKeyMap<Zone>())
	private readonly definitions = reactive(new Map<Zone, NamedZoneDefinition>())
	private readonly reservationOwners = reactive(new AxialKeyMap<object>())
	private readonly ownerToCoord = new Map<object, AxialCoord>()
	readonly residentialCoords: AxialCoord[] = []

	constructor() {
		this.resetDefinitions()
	}

	private resetDefinitions(): void {
		this.definitions.clear()
		for (const zone of BUILT_IN_ZONES) this.definitions.set(zone.id, zone)
	}

	defineZone(definition: Omit<NamedZoneDefinition, 'id'> & { id: string }): NamedZoneDefinition {
		const id = normalizeZoneId(definition.id)
		const existing = this.definitions.get(id)
		const trimmedName = definition.name.trim()
		const next: NamedZoneDefinition = {
			id,
			name: trimmedName || (existing?.builtIn || definition.builtIn ? existing?.name || id : ''),
			color: definition.color?.trim() || existing?.color,
			builtIn: existing?.builtIn || definition.builtIn,
			generated: existing?.generated || definition.generated,
			readonly: existing?.readonly || definition.readonly,
		}
		this.definitions.set(id, next)
		return next
	}

	getZoneDefinition(id: string | undefined): NamedZoneDefinition | undefined {
		return id ? this.definitions.get(normalizeZoneId(id)) : undefined
	}

	listZoneDefinitions(): NamedZoneDefinition[] {
		return [...this.definitions.values()]
	}

	listCustomZoneDefinitions(): NamedZoneDefinition[] {
		return this.listZoneDefinitions().filter((zone) => !zone.builtIn)
	}

	removeNamedZone(id: string): boolean {
		const zoneId = normalizeZoneId(id)
		const definition = this.definitions.get(zoneId)
		if (!definition || definition.builtIn) return false
		for (const coord of [...this.zones.coords()]) {
			if (this.zones.get(coord) === zoneId) this.zones.delete(coord)
		}
		return this.definitions.delete(zoneId)
	}

	setZone(coord: AxialCoord, zone: Zone): void {
		const zoneId = normalizeZoneId(zone)
		if (!this.definitions.has(zoneId)) {
			this.defineZone({ id: zoneId, name: zoneId })
		}
		this.zones.set(coord, zoneId)
		if (zoneId === 'residential') {
			const dup = this.residentialCoords.some((c) => c.q === coord.q && c.r === coord.r)
			if (!dup) this.residentialCoords.push({ ...coord })
		} else {
			const idx = this.residentialCoords.findIndex((c) => c.q === coord.q && c.r === coord.r)
			if (idx >= 0) this.residentialCoords.splice(idx, 1)
			this.reservationOwners.delete(coord)
			for (const [owner, reserved] of this.ownerToCoord.entries()) {
				if (reserved.q === coord.q && reserved.r === coord.r) {
					this.ownerToCoord.delete(owner)
					break
				}
			}
		}
	}

	getZone(coord: AxialCoord): Zone | undefined {
		return this.zones.get(coord)
	}

	setGeneratedZone(coord: AxialCoord, zone: Zone): void {
		if (this.generatedZones.has(coord)) return
		const zoneId = normalizeZoneId(zone)
		if (!this.definitions.has(zoneId)) {
			this.defineZone({ id: zoneId, name: zoneId, generated: true, readonly: true })
		}
		this.generatedZones.set(coord, zoneId)
	}

	getGeneratedZone(coord: AxialCoord): Zone | undefined {
		return this.generatedZones.get(coord)
	}

	getEffectiveZone(coord: AxialCoord): Zone | undefined {
		return this.getZone(coord) ?? this.getGeneratedZone(coord)
	}

	clear(): void {
		this.zones.clear()
		this.generatedZones.clear()
		this.resetDefinitions()
		this.reservationOwners.clear()
		this.ownerToCoord.clear()
		this.residentialCoords.length = 0
	}

	removeZone(coord: AxialCoord): boolean {
		const zone = this.zones.get(coord)
		if (zone === 'residential') {
			const idx = this.residentialCoords.findIndex((c) => c.q === coord.q && c.r === coord.r)
			if (idx >= 0) this.residentialCoords.splice(idx, 1)
			this.reservationOwners.delete(coord)
			for (const [owner, reserved] of this.ownerToCoord.entries()) {
				if (reserved.q === coord.q && reserved.r === coord.r) {
					this.ownerToCoord.delete(owner)
					break
				}
			}
		}
		return this.zones.delete(coord)
	}

	hasZone(coord: AxialCoord): boolean {
		return this.zones.has(coord)
	}

	hasEffectiveZone(coord: AxialCoord): boolean {
		return this.zones.has(coord) || this.generatedZones.has(coord)
	}

	coordsForZone(zone: Zone): AxialCoord[] {
		const zoneId = normalizeZoneId(zone)
		const out: AxialCoord[] = []
		for (const coord of this.zones.coords()) {
			if (this.zones.get(coord) === zoneId) out.push({ q: coord.q, r: coord.r })
		}
		return out
	}

	coordsForGeneratedZone(zone: Zone): AxialCoord[] {
		const zoneId = normalizeZoneId(zone)
		const out: AxialCoord[] = []
		for (const coord of this.generatedZones.coords()) {
			if (this.generatedZones.get(coord) === zoneId) out.push({ q: coord.q, r: coord.r })
		}
		return out
	}

	centralCoordForZone(zone: Zone): AxialCoord | undefined {
		return centralCoordFrom(this.coordsForZone(zone))
	}

	/** Residential tiles nobody has reserved yet (stable list order). */
	listUnreservedResidentialCoords(): AxialCoord[] {
		return this.residentialCoords.filter((c) => !this.reservationOwners.has(c))
	}

	/**
	 * Reserve a specific residential tile if it is free or already held by `owner`.
	 * Returns false if the tile is not residential or held by someone else.
	 */
	tryReserveResidentialAt(owner: object, coord: AxialCoord): boolean {
		if (this.zones.get(coord) !== 'residential') return false
		const mine = this.ownerToCoord.get(owner)
		if (mine && mine.q === coord.q && mine.r === coord.r) return true
		const existingAtCoord = this.reservationOwners.get(coord)
		if (existingAtCoord !== undefined && existingAtCoord !== owner) return false
		const previous = this.ownerToCoord.get(owner)
		if (previous && (previous.q !== coord.q || previous.r !== coord.r)) {
			this.reservationOwners.delete(previous)
		}
		this.reservationOwners.set(coord, owner)
		this.ownerToCoord.set(owner, coord)
		return true
	}

	/** First free residential tile in registration order (legacy). */
	reserveResidential(owner: object): AxialCoord | false {
		for (const coord of this.residentialCoords) {
			if (!this.reservationOwners.has(coord)) {
				this.reservationOwners.set(coord, owner)
				this.ownerToCoord.set(owner, coord)
				return coord
			}
		}
		return false
	}

	/** Release a reservation held by `owner`. */
	releaseReservation(owner: object): void {
		const coord = this.ownerToCoord.get(owner)
		if (coord) {
			this.reservationOwners.delete(coord)
			this.ownerToCoord.delete(owner)
		}
	}

	/** Get the coord reserved by `owner`, if any. */
	getReservation(owner: object): AxialCoord | undefined {
		return this.ownerToCoord.get(owner)
	}

	isReserved(coord: AxialCoord): boolean {
		return this.reservationOwners.has(coord)
	}
}
