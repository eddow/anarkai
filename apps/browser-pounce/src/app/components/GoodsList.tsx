import { goods as goodsCatalog } from '$assets/game-content'
import EntityBadge from './EntityBadge'
import { css } from '$lib/css'
import type { Game } from '$lib/game'
import type { GoodType } from '$lib/types/base'
import { T } from '$lib/i18n'

css`
.goods-list {
	display: flex;
	flex-wrap: wrap;
	gap: 0.5rem;
	align-items: center;
	min-width: 0;
}
`

interface GoodsListProps {
	goods: { [k in GoodType]?: number }
	game: Game
	itemSize?: number
	className?: string
}

const GoodsList = ({ goods, game, itemSize = 20, className = '' }: GoodsListProps) => {
	// Compute a stable, filtered list of entries
	const entries = Object.entries(goods || {})
		.filter(([, qty]) => qty && qty > 0)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)) as [GoodType, number][]

	if (entries.length === 0) return null

	return (
		<div class={`goods-list ${className}`}>
			{entries.map(([good, qty]) => (
				<EntityBadge
					game={game}
					sprite={goodsCatalog[good].sprites[0]}
					text={T.goods?.[good] ?? good}
					qty={qty}
					height={itemSize}
				/>
			))}
		</div>
	)
}

export default GoodsList

