import { css } from '@app/lib/css'
import { Button } from '@app/ui/anarkai'
import { renderAnarkaiIcon } from '@app/ui/anarkai/icons/render-icon'
import { reactive } from 'mutts'
import { tablerOutlinePackage, tablerOutlineTags } from 'pure-glyf/icons'

css`
.combo-picker {
	position: relative;
	display: inline-block;
}

.combo-picker__backdrop {
	position: fixed;
	inset: 0;
	z-index: 10000;
}

.combo-picker__menu {
	position: absolute;
	top: 100%;
	left: 0;
	margin-top: 2px;
	z-index: 10001;
	box-sizing: border-box;
	background: color-mix(in srgb, var(--ak-surface-panel) 96%, transparent);
	border: 1px solid var(--ak-border);
	box-shadow: 0 4px 12px color-mix(in srgb, var(--ak-text) 18%, transparent);
	max-height: 200px;
	overflow-y: auto;
	border-radius: var(--ak-radius-sm, 4px);
	padding: 0.25rem;
}

.combo-picker__item {
	padding: 0.25rem;
	cursor: pointer;
	border-radius: 2px;
}

.combo-picker__item:hover {
	background: var(--app-surface-tint);
}

.combo-picker__empty {
	padding: 0.5rem;
	font-size: 0.8rem;
	color: var(--ak-text-muted);
}

.combo-picker__trigger-icon {
	position: relative;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	inline-size: 1.125rem;
	block-size: 1.125rem;
}

.combo-picker__trigger-icon__plus {
	position: absolute;
	right: -3px;
	bottom: -2px;
	font-size: 0.55rem;
	font-weight: 800;
	line-height: 1;
	color: #22c55e;
	text-shadow: 0 0 1px color-mix(in srgb, var(--ak-surface-panel) 90%, transparent);
	pointer-events: none;
}

.combo-picker__trigger-value {
	display: inline-flex;
	align-items: center;
	gap: 0.35rem;
	padding: 0.25rem 0.45rem;
	border-radius: 0.35rem;
	border: 1px solid color-mix(in srgb, var(--ak-text-muted) 22%, transparent);
	background: color-mix(in srgb, var(--ak-surface-1) 90%, transparent);
	color: var(--ak-text);
	font-size: 0.78rem;
	cursor: pointer;
	font-family: inherit;
}

.combo-picker__trigger-value:disabled {
	opacity: 0.55;
	cursor: not-allowed;
}

.combo-picker__trigger-value-caret {
	font-size: 0.65rem;
	color: var(--ak-text-muted);
	line-height: 1;
}
`

export interface ComboDropdownItem {
	id: string
	label: string
}

export interface ComboDropdownPickerProps {
	mode: 'icon' | 'value'
	/** Icon-only trigger (mode === 'icon') */
	triggerIcon?: JSX.Element
	/** Text trigger label (mode === 'value') */
	valueLabel?: string
	items: readonly ComboDropdownItem[]
	onSelect: (id: string) => void
	disabled?: boolean
	title?: string
	ariaLabel?: string
	emptyMessage?: string
	testId?: string
	renderItem?: (item: ComboDropdownItem) => JSX.Element
	/** When mode is `value`, replaces the text span before the caret (e.g. icon + label). */
	renderValueTrigger?: () => JSX.Element
}

export const goodsAddComboIcon = (): JSX.Element => (
	<span class="combo-picker__trigger-icon" aria-hidden="true">
		{renderAnarkaiIcon(tablerOutlinePackage, { size: 18 })}
		<span class="combo-picker__trigger-icon__plus">+</span>
	</span>
)

export const tagsAddComboIcon = (): JSX.Element => (
	<span class="combo-picker__trigger-icon" aria-hidden="true">
		{renderAnarkaiIcon(tablerOutlineTags, { size: 18 })}
		<span class="combo-picker__trigger-icon__plus">+</span>
	</span>
)

const defaultEmptyMessage = 'No items available'

export default function ComboDropdownPicker(props: ComboDropdownPickerProps) {
	const menuState = reactive({ show: false })

	const label = () => props.ariaLabel ?? props.title ?? 'Choose'
	const empty = () => props.emptyMessage ?? defaultEmptyMessage

	const close = () => {
		menuState.show = false
	}

	const open = (e: MouseEvent) => {
		if (props.disabled) return
		const fromCurrent = e.currentTarget instanceof HTMLElement ? e.currentTarget : null
		const fromTarget = e.target instanceof HTMLElement ? e.target.closest('button') : null
		const trigger = fromCurrent ?? fromTarget
		if (!(trigger instanceof HTMLElement)) return
		menuState.show = true
	}

	const toggle = (e: MouseEvent) => {
		if (menuState.show) {
			close()
			return
		}
		open(e)
	}

	const handleSelect = (id: string) => {
		props.onSelect(id)
		close()
	}

	const renderRow = (item: ComboDropdownItem) => {
		if (props.renderItem) return props.renderItem(item)
		return <span>{item.label}</span>
	}

	const triggerValueLabel = () => props.valueLabel ?? ''

	return (
		<div class="combo-picker" data-testid={props.testId}>
			<Button
				if={props.mode === 'icon'}
				disabled={props.disabled}
				icon={props.triggerIcon}
				ariaLabel={label()}
				onClick={toggle}
				el:title={props.title ?? label()}
			/>
			<button
				if={props.mode === 'value'}
				type="button"
				class="combo-picker__trigger-value"
				disabled={props.disabled}
				title={props.title ?? label()}
				aria-label={label()}
				onClick={toggle}
			>
				{props.renderValueTrigger ? props.renderValueTrigger() : <span>{triggerValueLabel()}</span>}
				<span class="combo-picker__trigger-value-caret" aria-hidden="true">
					▾
				</span>
			</button>

			<div if={menuState.show} class="combo-picker__backdrop" onClick={() => close()} />
			<div
				if={menuState.show}
				class="combo-picker__menu"
				onClick={(e: Event) => e.stopPropagation()}
			>
				<for each={props.items}>
					{(item: ComboDropdownItem) => (
						<div
							class="combo-picker__item menu-item"
							title={item.label}
							aria-label={item.label}
							onClick={() => handleSelect(item.id)}
						>
							{renderRow(item)}
						</div>
					)}
				</for>
				<div if={props.items.length === 0} class="combo-picker__empty menu-empty">
					{empty()}
				</div>
			</div>
		</div>
	)
}
