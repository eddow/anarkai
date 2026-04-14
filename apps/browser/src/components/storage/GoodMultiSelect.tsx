import { css } from '@app/lib/css'
import { Button } from '@app/ui/anarkai'
import { goods as sensoryGoods } from 'engine-pixi/assets/visual-content'
import { tablerFilledSquareRoundedMinus } from 'pure-glyf/icons'
import type { Game } from 'ssh/game'
import type { GoodType } from 'ssh/types/base'
import EntityBadge from '../EntityBadge'
import GoodPickerButton from '../GoodPickerButton'

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
	padding: 0;
	min-height: auto;
	height: 1.35rem;
	width: 1.35rem;
	border-radius: 999px;
	border-color: color-mix(in srgb, #ef4444 35%, var(--ak-border));
	color: #ef4444;
	background: color-mix(in srgb, #ef4444 10%, var(--ak-surface-panel));
	opacity: 0.85;
}

.remove-btn:hover {
	opacity: 1;
	border-color: color-mix(in srgb, #ef4444 55%, var(--ak-border));
	color: #dc2626;
}

.empty-list {
	font-style: italic;
	color: var(--ak-text-muted);
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
			props.onUpdate(props.value.filter((g) => g !== good))
		}
	}

	const getSprite = (good: string) => {
		return sensoryGoods[good as keyof typeof sensoryGoods]?.sprites?.[0] || 'default'
	}

	return (
		<div class="good-multi-select">
			<div if={props.value.length > 0} class="goods-list">
				<for each={props.value}>
					{(gt: GoodType) => (
						<div class="good-row">
							<EntityBadge game={props.game} sprite={getSprite(gt)} text={gt} />
							<div class="row-controls">
								<div if={props.renderItemExtra}>{props.renderItemExtra?.(gt)}</div>
								<Button
									icon={tablerFilledSquareRoundedMinus}
									ariaLabel="Remove"
									onClick={() => handleRemove(gt)}
									el:title="Remove"
									el:class="remove-btn"
								/>
							</div>
						</div>
					)}
				</for>
			</div>
			<div else class="empty-list">
				{props.children || 'No items selected'}
			</div>

			<div class="add-btn-wrapper">
				<GoodPickerButton
					availableGoods={props.availableGoods}
					game={props.game}
					title={props.addTitle}
					onSelect={handleAdd}
				/>
			</div>
		</div>
	)
}
