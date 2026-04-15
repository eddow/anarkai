import {
	FREIGHT_LINE_ALL_GOOD_TYPES,
	getDefaultGoodTags,
} from 'ssh/freight/goods-selection-policy'

type GoodsTranslator = Record<string, string> | undefined
type TagsTranslator = Record<string, string> | undefined

export function freightInspectorGoodOptions(goods: GoodsTranslator) {
	return FREIGHT_LINE_ALL_GOOD_TYPES.map((id) => ({
		id,
		label: String(goods?.[id] ?? id),
	}))
}

export function freightInspectorTagOptions(goodsTags: TagsTranslator) {
	const tagSet = new Set<string>()
	for (const good of FREIGHT_LINE_ALL_GOOD_TYPES) {
		for (const tag of getDefaultGoodTags(good)) {
			tagSet.add(tag)
		}
	}
	return [...tagSet].sort().map((id) => ({
		id,
		label: String(goodsTags?.[id] ?? id),
	}))
}
