import type { GoodType } from 'ssh/src/lib/types/base'
import { goods as sensoryGoods } from 'engine-pixi/assets/visual-content'
import { Button } from 'pounce-ui/src'
import { mdiClose } from 'pure-glyf/icons'
import EntityBadge from '../EntityBadge'
import AddGoodButton from './AddGoodButton'
import { css } from '@app/lib/css'
import type { Game } from 'ssh/src/lib/game'

css`
.good-multi-select {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
}

.goods-list {
	display: flex;
	flex-direction: column;
	gap: 0.25rem;
}

.good-row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	background: var(--app-surface-tint);
	border-radius: 4px;
	padding-right: 4px;
}

.row-controls {
	display: flex;
	align-items: center;
	gap: 0.25rem;
}

.remove-btn {
	padding: 2px;
	min-height: auto;
	height: 18px;
	width: 18px;
	opacity: 0.6;
}

.remove-btn:hover {
	opacity: 1;
	color: var(--pico-del-color);
}

.empty-list {
	font-style: italic;
	color: var(--pico-muted-color);
	font-size: 0.8rem;
}

.add-btn-wrapper {
	align-self: flex-start;
}
`

interface GoodMultiSelectProps {
	value: GoodType[]
	availableGoods: GoodType[]
	game: Game
	addTitle?: string
	addLabel?: string
	onAdd: (good: GoodType) => void
	onRemove: (good: GoodType) => void
	onUpdate?: (value: GoodType[]) => void
	children?: any
	renderItemExtra?: (good: GoodType) => any
}

export default function GoodMultiSelect(props: GoodMultiSelectProps) {
	const handleAdd = (good: GoodType) => {
		props.onAdd(good)
		if (props.onUpdate && !props.value.includes(good)) {
			props.onUpdate([...props.value, good])
		}
	}

	const handleRemove = (good: GoodType) => {
		props.onRemove(good)
		if (props.onUpdate) {
			props.onUpdate(props.value.filter(g => g !== good))
		}
	}

	const getSprite = (good: string) => {
		return sensoryGoods[good as keyof typeof sensoryGoods]?.sprites?.[0] || 'default'
	}

	return (
		<div class="good-multi-select">
			{props.value.length > 0 ? (
				<div class="goods-list">
					{props.value.map((gt) => (
						<div class="good-row">
							<EntityBadge game={props.game} sprite={getSprite(gt)} text={gt} />
							<div class="row-controls">
								{props.renderItemExtra?.(gt)}
								<Button
									icon={mdiClose}
									onClick={() => handleRemove(gt)}
									el={{ title: 'Remove', class: 'remove-btn' }}
								/>
							</div>
						</div>
					))}
				</div>
			) : (
				<div class="empty-list">
					{props.children || 'No items selected'}
				</div>
			)}

			<div class="add-btn-wrapper">
				<AddGoodButton
					availableGoods={props.availableGoods}
					game={props.game}
					title={props.addTitle}
					onSelect={handleAdd}
				>
					{props.addLabel || 'Add'}
				</AddGoodButton>
			</div>
		</div>
	)
}
