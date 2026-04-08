import { reactive } from 'mutts'
import type { AxialCoord } from 'ssh/utils'
import { AxialKeyMap } from 'ssh/utils/mem'

export type Zone = 'residential' | 'harvest'

export class ZoneManager {
	private readonly zones = reactive(new AxialKeyMap<Zone>())
	private readonly reservationOwners = reactive(new AxialKeyMap<object>())
	private readonly ownerToCoord = new Map<object, AxialCoord>()
	readonly residentialCoords: AxialCoord[] = []

	setZone(coord: AxialCoord, zone: Zone): void {
		this.zones.set(coord, zone)
		if (zone === 'residential') {
			const dup = this.residentialCoords.some((c) => c.q === coord.q && c.r === coord.r)
			if (!dup) this.residentialCoords.push({ ...coord })
		}
	}

	getZone(coord: AxialCoord): Zone | undefined {
		return this.zones.get(coord)
	}

	clear(): void {
		this.zones.clear()
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
