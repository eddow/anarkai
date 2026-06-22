import { commerce } from 'engine-rules'
import type { FreightLineDefinition, FreightStop } from 'ssh/freight/freight-line'
import {
	computeLineFurtherGoods,
	measureFreightStopNeededGoods,
	measureFreightStopProvidedGoods,
	projectLoadedGoodsAgainstFurtherNeeds,
} from 'ssh/freight/freight-stop-utility'
import type { Game } from 'ssh/game/game'
import type { Vehicle } from 'ssh/population/vehicle/entity'
import type { GoodType } from 'ssh/types/base'

export interface NpcTradeStopTransferResult {
	readonly exported: Partial<Record<GoodType, number>>
	readonly imported: Partial<Record<GoodType, number>>
	readonly creditedVp: number
	readonly spentVp: number
}

export function freightLineMinBalanceAfterBuyVp(
	line: FreightLineDefinition,
	stop?: FreightStop
): number {
	return Math.max(
		0,
		Math.floor(
			stop?.minBalanceAfterBuyVp ??
				line.minBalanceAfterBuyVp ??
				commerce.procurement.bufferPurchaseReserveVp
		)
	)
}

function addCount(
	target: Partial<Record<GoodType, number>>,
	goodType: GoodType,
	quantity: number
): void {
	if (quantity <= 0) return
	target[goodType] = (target[goodType] ?? 0) + quantity
}

export function executeNpcTradeStopTransfer(args: {
	readonly game: Game
	readonly vehicle: Vehicle
	readonly line: FreightLineDefinition
	readonly stop: FreightStop
}): NpcTradeStopTransferResult {
	const { game, vehicle, line, stop } = args
	const out: NpcTradeStopTransferResult = {
		exported: {},
		imported: {},
		creditedVp: 0,
		spentVp: 0,
	}
	if (!('trade' in stop)) return out
	const profile = game.getSettlementTradeProfile(stop.trade.settlementId)
	if (!profile) return out
	const stopIndex = line.stops.indexOf(stop)
	if (stopIndex < 0) return out

	const buyOffers = new Map<GoodType, number>()
	const sellOffers = new Map<GoodType, number>()
	for (const offer of profile.offers) {
		if (offer.direction === 'buy') buyOffers.set(offer.good, offer.priceVp)
		else sellOffers.set(offer.good, offer.priceVp)
	}

	const acceptedHere = measureFreightStopNeededGoods(game, line, stopIndex).perGood
	for (const [goodType, accepted] of Object.entries(acceptedHere) as [GoodType, number][]) {
		const unitPrice = buyOffers.get(goodType)
		if (unitPrice === undefined || accepted <= 0) continue
		const quantity = Math.min(vehicle.storage.available(goodType), accepted)
		if (quantity <= 0) continue
		const removed = vehicle.storage.removeGood(goodType, quantity)
		if (removed <= 0) continue
		const credited = removed * unitPrice
		game.creditVp(credited)
		addCount(out.exported, goodType, removed)
		;(out as { creditedVp: number }).creditedVp += credited
	}

	const providedHere = measureFreightStopProvidedGoods(game, line, stopIndex).perGood
	const further = computeLineFurtherGoods({ game, line, currentStopIndex: stopIndex })
	const projected = projectLoadedGoodsAgainstFurtherNeeds(
		vehicle.storage.stock,
		further.furtherNeededGoods.perGood
	)
	const reserve = freightLineMinBalanceAfterBuyVp(line, stop)
	for (const [goodType, needed] of Object.entries(projected.remainingNeededGoods.perGood) as [
		GoodType,
		number,
	][]) {
		const unitPrice = sellOffers.get(goodType)
		if (unitPrice === undefined || unitPrice <= 0 || needed <= 0) continue
		if ((providedHere[goodType] ?? 0) <= 0) continue
		const room = vehicle.storage.hasRoom(goodType) ?? 0
		const affordable = Math.floor((game.playerAccount.balanceVp - reserve) / unitPrice)
		const quantity = Math.min(needed, room, Math.max(0, affordable))
		if (quantity <= 0) continue
		const totalPrice = quantity * unitPrice
		if (!game.spendVp(totalPrice)) continue
		const stored = vehicle.storage.addGood(goodType, quantity)
		if (stored < quantity) game.creditVp((quantity - stored) * unitPrice)
		if (stored <= 0) continue
		addCount(out.imported, goodType, stored)
		;(out as { spentVp: number }).spentVp += stored * unitPrice
	}

	if (npcTradeStopHasTransfer(out)) {
		game.enqueueNpcTradePresentationChange({
			lineId: line.id,
			stopId: stop.id,
			settlementId: stop.trade.settlementId,
			vehicleUid: vehicle.uid,
			exported: out.exported,
			imported: out.imported,
			creditedVp: out.creditedVp,
			spentVp: out.spentVp,
		})
	}

	return out
}

export function npcTradeStopHasTransfer(result: NpcTradeStopTransferResult): boolean {
	return (
		Object.values(result.exported).some((quantity) => (quantity ?? 0) > 0) ||
		Object.values(result.imported).some((quantity) => (quantity ?? 0) > 0)
	)
}
