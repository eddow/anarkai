import { markRaw, reactive, toRaw } from 'mutts'
import type { AxialCoord } from 'ssh/utils'
import { AxialKeyMap } from 'ssh/utils/mem'

export type ZoneType = 'passive' | 'harvest' | 'residential' | 'commercial'

export interface ZoneDefinition {
	readonly name?: string
	readonly color?: string
	readonly type: ZoneType
	readonly generated?: boolean
	readonly readonly?: boolean
}

/** Patch shape in GamePatches — includes coords for serialization. */
export interface ZoneDefinitionPatch extends Omit<ZoneDefinition, 'generated' | 'readonly'> {
	readonly coords: ReadonlyArray<readonly [number, number]>
}

// ── Inspector UID helpers (Priority 4) ───────────────────────────

export const ZONES_OBJECT_UID = 'zones'
export const ZONE_UID_PREFIX = 'zone:'

/** Generate a synthetic inspector UID from the zone's array index. */
export function zoneObjectUid(index: number): string {
	return `${ZONE_UID_PREFIX}${index}`
}

// ── Internal helpers ───────────────────────────────────────────────

function slugifyZoneName(name: string | undefined): string | undefined {
	const trimmedName = (name ?? '').trim()
	return trimmedName ? trimmedName.replace(/\s+/g, '-').toLowerCase() : undefined
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

// ── ZoneManager ────────────────────────────────────────────────────

export class ZoneManager {
	private readonly zones = reactive(new AxialKeyMap<ZoneDefinition>())
	private readonly generatedZones = reactive(new AxialKeyMap<ZoneDefinition>())
	private readonly reservationOwners = reactive(new AxialKeyMap<object>())
	private readonly ownerToCoord = new Map<object, AxialCoord>()
	readonly residentialCoords: AxialCoord[] = []

	/** Ordered list of zone definitions. Array index is the zone identity. */
	definitions: ZoneDefinition[] = []

	// ── definition registry ──────────────────────────────────────

	/** Resolve a zone by array index. */
	zoneByIndex(index: number): ZoneDefinition | undefined {
		return this.definitions[index]
	}

	/** Find a named zone by name (case-insensitive, whitespace-normalized). */
	findZoneIndexByName(name: string): number {
		const needle = slugifyZoneName(name) ?? ''
		return this.definitions.findIndex((def) => (def.name ?? '') === needle)
	}

	/** Register a zone definition and return the object for spatial assignment. */
	defineZone(definition: ZoneDefinition): ZoneDefinition {
		// Zone definitions are identity-bearing registry objects. Keep them raw so
		// reactive map storage/retrieval never breaks `===` comparisons.
		const next = markRaw({
			name: slugifyZoneName(definition.name),
			color: definition.color?.trim() || undefined,
			type: definition.type,
			generated: definition.generated,
			readonly: definition.readonly,
		} satisfies ZoneDefinition)
		this.definitions.push(next)
		return next
	}

	/** Prefer an already-registered definition object; otherwise register a raw copy. */
	private ensureRegisteredZone(zone: ZoneDefinition): ZoneDefinition {
		const raw = toRaw(zone) as ZoneDefinition
		const existing = this.definitions.find((def) => toRaw(def) === raw)
		if (existing) return existing
		return this.defineZone(raw)
	}

	/** Mark a registered definition as generated/readonly, preserving object identity. */
	private markGenerated(zone: ZoneDefinition): ZoneDefinition {
		const registered = this.ensureRegisteredZone(zone)
		if (!registered.generated) (registered as { generated?: boolean }).generated = true
		if (!registered.readonly) (registered as { readonly?: boolean }).readonly = true
		return registered
	}

	/**
	 * Find an existing zone definition by type or name, or create a simple typed zone.
	 * Used by tests and harvest assignment helpers.
	 */
	resolveZone(typeOrName: ZoneType | string): ZoneDefinition {
		const needle = String(typeOrName).trim().replace(/\s+/g, '-').toLowerCase()
		const byName = this.definitions.find((def) => (def.name ?? '') === needle)
		if (byName) return byName
		const zoneTypes: ZoneType[] = ['passive', 'harvest', 'residential', 'commercial']
		if ((zoneTypes as string[]).includes(needle)) {
			const byType = this.definitions.find((def) => def.type === needle && !def.name)
			if (byType) return byType
			return this.defineZone({ type: needle as ZoneType })
		}
		return this.defineZone({ name: needle, type: 'passive' })
	}

	listZoneDefinitions(): ZoneDefinition[] {
		return [...this.definitions]
	}

	listCustomZoneDefinitions(): ZoneDefinition[] {
		return this.definitions.filter((zone) => !zone.generated && !zone.readonly)
	}

	/** Remove a named zone by index and clean up its spatial assignments. */
	removeZoneByIndex(index: number): boolean {
		const definition = this.definitions[index]
		if (!definition || definition.readonly) return false
		const target = toRaw(definition)
		for (const coord of [...this.zones.coords()]) {
			const current = this.zones.get(coord)
			if (current && toRaw(current) === target) this.zones.delete(coord)
		}
		this.definitions.splice(index, 1)
		return true
	}

	// ── spatial map ───────────────────────────────────────────────

	setZone(coord: AxialCoord, zone: ZoneDefinition | undefined): void {
		if (!zone) {
			this.removeZone(coord)
			return
		}
		const registered = this.ensureRegisteredZone(zone)
		this.zones.set(coord, registered)
		if (registered.type === 'residential') {
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

	getZone(coord: AxialCoord): ZoneDefinition | undefined {
		const zone = this.zones.get(coord)
		return zone ? (toRaw(zone) as ZoneDefinition) : undefined
	}

	isHarvestableZone(zone: ZoneDefinition | undefined): boolean {
		if (!zone) return false
		return zone.type !== 'passive'
	}

	removeZone(coord: AxialCoord): boolean {
		const zone = this.zones.get(coord)
		if (zone?.type === 'residential') {
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

	// ── generated (settlement-plan) zones ─────────────────────────

	setGeneratedZone(coord: AxialCoord, zone: ZoneDefinition): void {
		if (this.generatedZones.has(coord)) return
		const registered = this.markGenerated(zone)
		this.generatedZones.set(coord, registered)
	}

	getGeneratedZone(coord: AxialCoord): ZoneDefinition | undefined {
		const zone = this.generatedZones.get(coord)
		return zone ? (toRaw(zone) as ZoneDefinition) : undefined
	}

	getEffectiveZone(coord: AxialCoord): ZoneDefinition | undefined {
		return this.getZone(coord) ?? this.getGeneratedZone(coord)
	}

	hasEffectiveZone(coord: AxialCoord): boolean {
		return this.zones.has(coord) || this.generatedZones.has(coord)
	}

	// ── query ─────────────────────────────────────────────────────

	coordsForZone(zone: ZoneDefinition): AxialCoord[] {
		const target = toRaw(zone)
		const out: AxialCoord[] = []
		for (const coord of this.zones.coords()) {
			const current = this.zones.get(coord)
			if (current && toRaw(current) === target) out.push({ q: coord.q, r: coord.r })
		}
		return out
	}

	coordsForGeneratedZone(zone: ZoneDefinition): AxialCoord[] {
		const target = toRaw(zone)
		const out: AxialCoord[] = []
		for (const coord of this.generatedZones.coords()) {
			const current = this.generatedZones.get(coord)
			if (current && toRaw(current) === target) out.push({ q: coord.q, r: coord.r })
		}
		return out
	}

	centralCoordForZone(zone: ZoneDefinition): AxialCoord | undefined {
		return centralCoordFrom(this.coordsForZone(zone))
	}

	// ── lifecycle ─────────────────────────────────────────────────

	clear(): void {
		this.zones.clear()
		this.generatedZones.clear()
		this.definitions.length = 0
		this.reservationOwners.clear()
		this.ownerToCoord.clear()
		this.residentialCoords.length = 0
	}

	// ── residential reservations ──────────────────────────────────

	listUnreservedResidentialCoords(): AxialCoord[] {
		return this.residentialCoords.filter((c) => !this.reservationOwners.has(c))
	}

	tryReserveResidentialAt(owner: object, coord: AxialCoord): boolean {
		if (this.zones.get(coord)?.type !== 'residential') return false
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

	releaseReservation(owner: object): void {
		const coord = this.ownerToCoord.get(owner)
		if (coord) {
			this.reservationOwners.delete(coord)
			this.ownerToCoord.delete(owner)
		}
	}

	getReservation(owner: object): AxialCoord | undefined {
		return this.ownerToCoord.get(owner)
	}

	isReserved(coord: AxialCoord): boolean {
		return this.reservationOwners.has(coord)
	}
}
