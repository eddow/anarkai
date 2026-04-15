import type { FreightBayAnchor, FreightLineDefinition, FreightStop } from 'ssh/freight/freight-line'
import { normalizeFreightLineDefinition } from 'ssh/freight/freight-line'
import { migrateV1FiltersToGoodsSelection } from 'ssh/freight/goods-selection-policy'
import type { GoodType } from 'ssh/types/base'

function freightBayAnchor(hiveName: string, coord: readonly [number, number]): FreightBayAnchor {
	return {
		kind: 'alveolus',
		hiveName,
		alveolusType: 'freight_bay',
		coord,
	}
}

/** Gather: zone (load policy) → bay anchor at same tile. */
export function gatherFreightLine(args: {
	readonly id: string
	readonly name: string
	readonly hiveName: string
	readonly coord: readonly [number, number]
	readonly filters: readonly GoodType[]
	readonly radius: number
}): FreightLineDefinition {
	const [q, r] = args.coord
	const loadSelection = migrateV1FiltersToGoodsSelection([...args.filters])
	return normalizeFreightLineDefinition({
		id: args.id,
		name: args.name,
		stops: [
			{
				id: `${args.id}-zone`,
				loadSelection,
				zone: { kind: 'radius', center: [q, r], radius: args.radius },
			},
			{
				id: `${args.id}-unload`,
				anchor: freightBayAnchor(args.hiveName, [q, r]),
			},
		],
	})
}

/** Distribute: bay load → bay unload (optional radius zone on unload). */
export function distributeFreightLine(args: {
	readonly id: string
	readonly name: string
	readonly hiveName: string
	readonly coord: readonly [number, number]
	readonly filters: readonly GoodType[]
	readonly unloadRadius?: number
}): FreightLineDefinition {
	const [q, r] = args.coord
	const loadSelection = migrateV1FiltersToGoodsSelection([...args.filters])
	const anchor = freightBayAnchor(args.hiveName, [q, r])
	const load: FreightStop = {
		id: `${args.id}-load`,
		loadSelection,
		anchor,
	}
	const unload: FreightStop =
		args.unloadRadius === undefined
			? { id: `${args.id}-unload`, anchor }
			: {
					id: `${args.id}-unload`,
					zone: { kind: 'radius', center: [q, r], radius: args.unloadRadius },
				}
	return normalizeFreightLineDefinition({
		id: args.id,
		name: args.name,
		stops: [load, unload],
	})
}
