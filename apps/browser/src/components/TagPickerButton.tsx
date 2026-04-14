import ComboDropdownPicker, {
	type ComboDropdownItem,
	tagsAddComboIcon,
} from './ComboDropdownPicker'
import GoodTagBadge from './GoodTagBadge'

export interface TagPickerButtonProps {
	pickerItems: readonly { id: string; label: string }[]
	onSelect: (tag: string) => void
	disabled?: boolean
	title?: string
	ariaLabel?: string
	emptyMessage?: string
	testId?: string
}

const TagPickerButton = (props: TagPickerButtonProps) => {
	const items = (): readonly ComboDropdownItem[] =>
		props.pickerItems.map((entry) => ({ id: entry.id, label: entry.label }))

	const renderRow = (item: ComboDropdownItem) => (
		<GoodTagBadge tagId={item.id} label={item.label} size={20} />
	)

	return (
		<ComboDropdownPicker
			mode="icon"
			testId={props.testId}
			triggerIcon={tagsAddComboIcon()}
			disabled={props.disabled}
			title={props.title}
			ariaLabel={props.ariaLabel ?? props.title ?? 'Add tag'}
			emptyMessage={props.emptyMessage}
			items={items()}
			onSelect={(id) => props.onSelect(id)}
			renderItem={renderRow}
		/>
	)
}

export default TagPickerButton
