import { isVehicleLineService, isVehicleMaintenanceService } from 'ssh/population/vehicle/vehicle'
import type { Vehicle } from 'ssh/population/vehicle/entity'
import type { TransformAlveolus } from 'ssh/hive/transform'
import type { GoodType } from 'ssh/types'
import { epsilon } from 'ssh/utils/varied'
import { toAxialCoord } from 'ssh/utils/position'
import type { Tile } from './tile'

/**
 * Structured description of one thing blocking a tile, surfaced so the UI can list
 * *what* blocks a burdened alveolus instead of collapsing it to a single string.
 * Built from the same primitives as `Tile.isBurdened` / `Tile.isClear` — no new reactivity.
 */
export type TileBlockingEntry =
	| { kind: 'deposit'; depositType: string; amount: number }
	| { kind: 'loose-good'; goodType: GoodType; count: number; available: number }
	| { kind: 'vehicle'; vehicle: Vehicle; vehicleType: string; docked: boolean }

/**
 * List what blocks a tile: deposit, loose goods grouped by type, and idle /
 * non-docked line-freight vehicles on the hex. Docked line-service vehicles are
 * skipped, mirroring `Tile.isBurdened`.
 */
export function queryTileBlocking(tile: Tile): TileBlockingEntry[] {
	const entries: TileBlockingEntry[] = []
	const coord = toAxialCoord(tile.position)
	const content = tile.board.getTileContent(coord)

	if (content && 'deposit' in content && content.deposit) {
		entries.push({
			kind: 'deposit',
			depositType: content.deposit.name,
			amount: content.deposit.amount,
		})
	}

	const grouped = new Map<GoodType, { count: number; available: number }>()
	for (const good of tile.board.looseGoods.getGoodsAt(coord)) {
		const group = grouped.get(good.goodType) ?? { count: 0, available: 0 }
		group.count += 1
		if (good.available) group.available += 1
		grouped.set(good.goodType, group)
	}
	for (const [goodType, group] of grouped) {
		entries.push({ kind: 'loose-good', goodType, count: group.count, available: group.available })
	}

	for (const vehicle of tile.board.game.vehicles) {
		const worldPosition = vehicle.position
		if (!worldPosition) continue
		const vp = toAxialCoord(worldPosition)
		if (!vp) continue
		if (Math.round(vp.q) !== coord.q || Math.round(vp.r) !== coord.r) continue
		const svc = vehicle.service
		if (isVehicleLineService(svc) && svc.docked) continue
		if (isVehicleLineService(svc) || isVehicleMaintenanceService(svc) || svc === undefined) {
			entries.push({
				kind: 'vehicle',
				vehicle,
				vehicleType: vehicle.vehicleType,
				docked: isVehicleLineService(svc) ? svc.docked : false,
			})
		}
	}

	return entries
}

/** Ordered transform stall reasons, mirroring the browser `transformWorkingWarning` order. */
export type TransformStallReason =
	| 'noOutputRoom'
	| 'productRatioLimit'
	| 'noInputGood'
	| 'noAvailableWork'

/**
 * All reasons a working transform cannot currently work, in display order
 * (output room → ratio limit → input good → no work). Unlike the single-string
 * browser warning, a transform blocked on both input and output reports both.
 * Input availability is checked independently of the output/ratio gates so a
 * full output does not mask a missing input (or vice versa).
 */
export function transformStallReasons(content: TransformAlveolus): TransformStallReason[] {
	if (!content.working || content.canWork) return []
	const reasons: TransformStallReason[] = []
	if (!content.hasOutputRoom) reasons.push('noOutputRoom')
	if (!content.isBelowProductRatioLimit) reasons.push('productRatioLimit')
	const hasLoadableInput = content.consumedGoods.some(
		(goodType) => content.processBuffer(goodType) <= epsilon && content.canLoad(goodType)
	)
	if (content.consumedGoods.length > 0 && !hasLoadableInput) reasons.push('noInputGood')
	if (reasons.length === 0) reasons.push('noAvailableWork')
	return reasons
}
