import { css } from '@app/lib/css'
import { activeWorldViewPov } from '@app/lib/globals'
import { reactive } from 'mutts'
import { type AxialCoord, axial } from 'ssh/utils'

css`
.hard-list-picker {
	display: grid;
	gap: 0.4rem;
	width: 100%;
}

.hard-list-picker__filter {
	box-sizing: border-box;
	width: 100%;
	min-width: 0;
	padding: 0.35rem 0.5rem;
	border: 1px solid color-mix(in srgb, var(--ak-text-muted) 22%, transparent);
	border-radius: 0.4rem;
	background: var(--ak-surface-panel);
	color: var(--ak-text);
	font: inherit;
	font-size: 0.8rem;
}

.hard-list-picker__list {
	display: flex;
	flex-direction: column;
	gap: 0.3rem;
	max-height: 12rem;
	overflow-y: auto;
}

.hard-list-picker__item {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto;
	gap: 0.45rem;
	align-items: center;
	width: 100%;
	box-sizing: border-box;
	padding: 0.35rem 0.45rem;
	border: 1px solid color-mix(in srgb, var(--ak-text-muted) 18%, transparent);
	border-radius: 0.4rem;
	background: color-mix(in srgb, var(--ak-surface-1) 78%, transparent);
	color: var(--ak-text);
	font: inherit;
	font-size: 0.78rem;
	text-align: left;
	cursor: pointer;
}

.hard-list-picker__item:disabled {
	opacity: 0.55;
	cursor: not-allowed;
}

.hard-list-picker__item:hover:not(:disabled) {
	border-color: color-mix(in srgb, var(--ak-accent, #8b5cf6) 38%, transparent);
	background: color-mix(in srgb, var(--ak-accent, #8b5cf6) 8%, var(--ak-surface-1));
}

.hard-list-picker__item-main {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.hard-list-picker__item-hint {
	min-width: 0;
	color: var(--ak-text-muted);
	font-size: 0.72rem;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.hard-list-picker__item-distance {
	color: var(--ak-text-muted);
	font-variant-numeric: tabular-nums;
	font-size: 0.72rem;
}

.hard-list-picker__empty {
	padding: 0.4rem 0.45rem;
	color: var(--ak-text-muted);
	font-size: 0.78rem;
}
`

export interface HardListSearchPickerItem {
	readonly id: string
	readonly label: string
	readonly hint?: string
	readonly coord?: AxialCoord
	readonly disabled?: boolean
}

interface HardListSearchPickerProps {
	items: readonly HardListSearchPickerItem[]
	onSelect: (id: string) => void
	placeholder?: string
	emptyMessage?: string
	testId?: string
	renderItem?: (item: HardListSearchPickerItem) => JSX.Element
}

const normalized = (value: string) => value.trim().toLowerCase()

function itemDistance(item: HardListSearchPickerItem): number | undefined {
	const center = activeWorldViewPov.center
	if (!center || !item.coord) return undefined
	return axial.distance(center, item.coord)
}

export default function HardListSearchPicker(props: HardListSearchPickerProps) {
	const state = reactive({ query: '' })

	const visibleItems = () => {
		const query = normalized(state.query)
		return [...props.items]
			.filter((item) => {
				if (!query) return true
				return [item.id, item.label, item.hint ?? ''].some((part) =>
					normalized(part).includes(query)
				)
			})
			.sort((a, b) => {
				const aDistance = itemDistance(a)
				const bDistance = itemDistance(b)
				if (aDistance !== undefined && bDistance !== undefined && aDistance !== bDistance) {
					return aDistance - bDistance
				}
				if (aDistance !== undefined && bDistance === undefined) return -1
				if (aDistance === undefined && bDistance !== undefined) return 1
				return a.label.localeCompare(b.label)
			})
	}

	const renderRow = (item: HardListSearchPickerItem) =>
		props.renderItem ? (
			props.renderItem(item)
		) : (
			<>
				<span class="hard-list-picker__item-main">{item.label}</span>
				<span if={item.hint} class="hard-list-picker__item-hint">
					{item.hint}
				</span>
			</>
		)

	return (
		<div class="hard-list-picker" data-testid={props.testId}>
			<input
				class="hard-list-picker__filter"
				type="text"
				value={state.query}
				placeholder={props.placeholder ?? 'Filter...'}
				data-testid={props.testId ? `${props.testId}-filter` : undefined}
			/>
			<div class="hard-list-picker__list">
				<for each={visibleItems()}>
					{(item) => {
						const distance = itemDistance(item)
						return (
							<button
								type="button"
								class="hard-list-picker__item"
								disabled={item.disabled}
								title={item.hint ? `${item.label} - ${item.hint}` : item.label}
								onClick={() => {
									if (!item.disabled) props.onSelect(item.id)
								}}
								data-testid={props.testId ? `${props.testId}-item` : undefined}
								data-item-id={item.id}
							>
								<span>{renderRow(item)}</span>
								<span if={distance !== undefined} class="hard-list-picker__item-distance">
									{distance}
								</span>
							</button>
						)
					}}
				</for>
				<div if={visibleItems().length === 0} class="hard-list-picker__empty">
					{props.emptyMessage ?? 'No matches'}
				</div>
			</div>
		</div>
	)
}
