import { reactive } from 'mutts'
import {
	createDistrictProcurementPolicy,
	type DistrictProcurementPolicy,
	districtProcurementPolicyToPatch,
} from 'ssh/district/procurement'
import type { Game } from 'ssh/game/game'
import type { InspectorSelectableObject } from 'ssh/game/object'
import type { AxialCoord } from 'ssh/utils'
import { axial } from 'ssh/utils'
import type { Position } from 'ssh/utils/position'

export const DEFAULT_DISTRICT_ID = 'default'
export const DISTRICT_UID_PREFIX = 'district:'

export type DistrictKind = 'mixed'

export interface DistrictPatch {
	readonly id: string
	readonly name: string
	readonly kind: DistrictKind
	readonly members?: ReadonlyArray<readonly [number, number]>
	readonly procurementPolicy?: DistrictProcurementPolicy
}

export class District {
	private readonly memberKeys = new Set<string>()
	public procurementPolicy: DistrictProcurementPolicy

	constructor(
		readonly game: Game,
		readonly id: string,
		public name: string,
		public kind: DistrictKind = 'mixed',
		members: Iterable<AxialCoord> = [],
		procurementPolicy: DistrictProcurementPolicy = createDistrictProcurementPolicy(
			game.procurementDefaults
		)
	) {
		this.procurementPolicy = reactive(procurementPolicy)
		for (const coord of members) this.addMember(coord)
	}

	get uid(): string {
		return districtUid(this.id)
	}

	get title(): string {
		return this.name
	}

	get members(): AxialCoord[] {
		return [...this.memberKeys]
			.map((key) => {
				const [q, r] = key.split(',').map(Number)
				return { q: q ?? 0, r: r ?? 0 }
			})
			.sort((left, right) => left.q - right.q || left.r - right.r)
	}

	get memberCount(): number {
		return this.memberKeys.size
	}

	addMember(coord: AxialCoord): void {
		this.memberKeys.add(axial.key(coord))
	}

	toPatch(): DistrictPatch {
		return {
			id: this.id,
			name: this.name,
			kind: this.kind,
			members: this.members.map((coord) => [coord.q, coord.r] as [number, number]),
			procurementPolicy: districtProcurementPolicyToPatch(this.procurementPolicy),
		}
	}
}

export class DistrictObject implements InspectorSelectableObject {
	readonly logs: readonly string[] = []

	constructor(
		readonly game: Game,
		readonly district: District
	) {}

	get uid(): string {
		return this.district.uid
	}

	get title(): string {
		return this.district.title
	}

	get position(): Position | undefined {
		return this.district.members[0]
	}

	get debugInfo(): Record<string, unknown> {
		return {
			id: this.district.id,
			kind: this.district.kind,
			members: this.district.memberCount,
		}
	}
}

export function districtUid(id: string): string {
	return `${DISTRICT_UID_PREFIX}${encodeURIComponent(id)}`
}

export function isDistrictUid(uid: string): boolean {
	return uid.startsWith(DISTRICT_UID_PREFIX)
}

export function districtIdFromUid(uid: string): string | undefined {
	if (!isDistrictUid(uid)) return undefined
	const encoded = uid.slice(DISTRICT_UID_PREFIX.length)
	return encoded ? decodeURIComponent(encoded) : undefined
}

export function defaultDistrict(game: Game): District {
	return new District(game, DEFAULT_DISTRICT_ID, 'Default district')
}
