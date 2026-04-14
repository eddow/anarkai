import bulkIconUrl from '../../../../engines/rules/assets/goods-tags/bulk.svg'
import constructionLumberIconUrl from '../../../../engines/rules/assets/goods-tags/construction_lumber.svg'
import constructionStoneIconUrl from '../../../../engines/rules/assets/goods-tags/construction_stone.svg'
import foodIconUrl from '../../../../engines/rules/assets/goods-tags/food.svg'
import pieceIconUrl from '../../../../engines/rules/assets/goods-tags/piece.svg'

export const goodTagIconUrls = {
	food: foodIconUrl,
	piece: pieceIconUrl,
	bulk: bulkIconUrl,
	'construction/lumber': constructionLumberIconUrl,
	'construction/stone': constructionStoneIconUrl,
} as const

export function goodTagIconUrl(tagId: string): string | undefined {
	return goodTagIconUrls[tagId.trim() as keyof typeof goodTagIconUrls]
}
