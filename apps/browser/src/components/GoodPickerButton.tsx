import { goods as sensoryGoods } from 'engine-pixi/assets/visual-content'
import type { Game } from 'ssh/game'
import type { GoodType } from 'ssh/types/base'
import ComboDropdownPicker, { goodsAddComboIcon } from './ComboDropdownPicker'
import EntityBadge from './EntityBadge'

export interface GoodPickerButtonProps {
	availableGoods: readonly GoodType[]
	game: Game
	onSelect: (good: GoodType) => void
	disabled?: boolean
	title?: string
	ariaLabel?: string
	emptyMessage?: string
	testId?: string
}

const defaultEmptyMessage = 'No goods available'

export default function GoodPickerButton(props: GoodPickerButtonProps) {
	const items = () => props.availableGoods.map((id) => ({ id, label: id }))

	const getSprite = (good: string) => {
		return sensoryGoods[good as keyof typeof sensoryGoods]?.sprites?.[0] || 'default'
	}

	return (
		<ComboDropdownPicker
			mode="icon"
			testId={props.testId}
			triggerIcon={goodsAddComboIcon()}
			disabled={props.disabled}
			title={props.title}
			ariaLabel={props.ariaLabel ?? props.title ?? 'Add good'}
			emptyMessage={props.emptyMessage ?? defaultEmptyMessage}
			items={items()}
			onSelect={(id) => props.onSelect(id as GoodType)}
			renderItem={(item) => (
				<EntityBadge game={props.game} sprite={getSprite(item.id)} text={item.id} />
			)}
		/>
	)
}
