import type { Advertisement, ExchangePriority, GoodsRelations } from 'ssh/utils/advertisement'

export type HiveAdvertisementSummaryEntry = {
	goodType: string
	advertisement: Advertisement
	priority: ExchangePriority
	types: string[]
}

export type SummaryAdvertiser = {
	name?: string
	action?: unknown
	target?: string
	goodsRelations?: GoodsRelations
}

const priorityValue = (priority: ExchangePriority) => Number(priority[0])

const summaryTypeLabel = (alveolus: SummaryAdvertiser): string | undefined => {
	const actionType =
		alveolus.action &&
		typeof alveolus.action === 'object' &&
		'type' in alveolus.action &&
		typeof alveolus.action.type === 'string'
			? alveolus.action.type
			: undefined
	if (actionType) return actionType
	if (alveolus.name?.startsWith('build.') && alveolus.target) return alveolus.name
	return alveolus.name
}

export const summarizeHiveGoodsRelations = (
	alveoli: Iterable<SummaryAdvertiser>
): HiveAdvertisementSummaryEntry[] => {
	const entries = new Map<string, HiveAdvertisementSummaryEntry>()

	for (const alveolus of alveoli) {
		const typeLabel = summaryTypeLabel(alveolus)
		for (const [goodType, relation] of Object.entries(alveolus.goodsRelations ?? {})) {
			const key = `${goodType}:${relation.advertisement}`
			const current = entries.get(key)

			if (!current) {
				entries.set(key, {
					goodType,
					advertisement: relation.advertisement,
					priority: relation.priority,
					types: typeLabel ? [typeLabel] : [],
				})
				continue
			}

			if (priorityValue(relation.priority) > priorityValue(current.priority)) {
				current.priority = relation.priority
			}
			if (typeLabel && !current.types.includes(typeLabel)) {
				current.types.push(typeLabel)
			}
		}
	}

	return [...entries.values()].sort((a, b) => {
		if (a.goodType !== b.goodType) return a.goodType.localeCompare(b.goodType)
		if (a.advertisement !== b.advertisement) return a.advertisement === 'demand' ? -1 : 1
		return priorityValue(b.priority) - priorityValue(a.priority)
	})
}
