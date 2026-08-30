import { css } from '@app/lib/css'
import { activeWorldViewPov } from '@app/lib/globals'
import { document, latch } from '@sursaut/core'
import { effect, reactive } from 'mutts'
import { type AxialCoord, axial } from 'ssh/utils'

css`
.combo-search-picker {
	position: relative;
	display: inline-block;
	width: 100%;
}

.combo-search-picker__field {
	position: relative;
}

.combo-search-picker__input {
	box-sizing: border-box;
	width: 100%;
	min-width: 0;
	padding: 0.35rem 1.5rem 0.35rem 0.5rem;
	border: 1px solid color-mix(in srgb, var(--ak-text-muted) 22%, transparent);
	border-radius: 0.4rem;
	background: var(--ak-surface-panel);
	color: var(--ak-text);
	font: inherit;
	font-size: 0.8rem;
}

.combo-search-picker__input:hover:not(:disabled) {
	border-color: color-mix(in srgb, var(--ak-accent, #8b5cf6) 38%, transparent);
}

.combo-search-picker__input:disabled {
	opacity: 0.55;
	cursor: not-allowed;
}

.combo-search-picker__caret {
	position: absolute;
	top: 50%;
	right: 0.45rem;
	transform: translateY(-50%);
	font-size: 0.65rem;
	color: var(--ak-text-muted);
	line-height: 1;
	pointer-events: none;
}

.combo-search-picker__menu {
	position: fixed;
	z-index: 10001;
	box-sizing: border-box;
	display: flex;
	flex-direction: column;
	gap: 0.3rem;
	background: var(--ak-surface-panel);
	border: 1px solid var(--ak-border);
	box-shadow: 0 4px 12px color-mix(in srgb, var(--ak-text) 18%, transparent);
	border-radius: var(--ak-radius-sm, 4px);
	padding: 0.4rem;
}

.combo-search-picker__list {
	display: flex;
	flex-direction: column;
	gap: 0.3rem;
	max-height: 12rem;
	overflow-y: auto;
}

.combo-search-picker__item {
	display: grid;
	grid-template-columns: minmax(0, 1fr) auto;
	gap: 0.45rem;
	align-items: center;
	width: 100%;
	box-sizing: border-box;
	padding: 0.35rem 0.45rem;
	border: 1px solid color-mix(in srgb, var(--ak-text-muted) 18%, transparent);
	border-radius: 0.4rem;
	background: var(--ak-surface-1);
	color: var(--ak-text);
	font: inherit;
	font-size: 0.78rem;
	text-align: left;
	cursor: pointer;
}

.combo-search-picker__item:disabled {
	opacity: 0.55;
	cursor: not-allowed;
}

.combo-search-picker__item:hover:not(:disabled) {
	border-color: color-mix(in srgb, var(--ak-accent, #8b5cf6) 38%, transparent);
	background: color-mix(in srgb, var(--ak-accent, #8b5cf6) 8%, var(--ak-surface-1));
}

.combo-search-picker__item-main {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.combo-search-picker__item-hint {
	min-width: 0;
	color: var(--ak-text-muted);
	font-size: 0.72rem;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.combo-search-picker__item-distance {
	color: var(--ak-text-muted);
	font-variant-numeric: tabular-nums;
	font-size: 0.72rem;
}

.combo-search-picker__empty {
	padding: 0.4rem 0.45rem;
	color: var(--ak-text-muted);
	font-size: 0.78rem;
}
`

export interface ComboSearchPickerItem {
	readonly id?: string
	readonly label: string
	readonly hint?: string
	readonly coord?: AxialCoord
	readonly disabled?: boolean
}

interface ComboSearchPickerProps<T extends ComboSearchPickerItem> {
	items: readonly T[]
	onSelect: (item: T) => void
	placeholder?: string
	emptyMessage?: string
	testId?: string
	renderItem?: (item: T) => JSX.Element
	/** Text shown on the collapsed trigger button. Defaults to the search placeholder. */
	triggerLabel?: string
	title?: string
	ariaLabel?: string
	disabled?: boolean
}

const normalized = (value: string) => value.trim().toLowerCase()

function itemDistance(item: ComboSearchPickerItem): number | undefined {
	const center = activeWorldViewPov.center
	if (!center || !item.coord) return undefined
	return axial.distance(center, item.coord)
}

export default function ComboSearchPicker<T extends ComboSearchPickerItem>(
	props: ComboSearchPickerProps<T>
) {
	const state = reactive({
		show: false,
		left: 0,
		top: 0,
		width: 0,
		query: '',
	})
	let field: HTMLInputElement | undefined

	const label = () => props.ariaLabel ?? props.title ?? 'Choose'
	const empty = () => props.emptyMessage ?? 'No matches'

	const close = () => {
		state.show = false
	}

	const syncPopup = () => {
		if (!field) return
		const rect = field.getBoundingClientRect()
		state.left = rect.left
		state.top = rect.bottom + 2
		state.width = rect.width
	}

	const open = () => {
		if (props.disabled || state.show) return
		syncPopup()
		state.query = ''
		state.show = true
	}

	const handleSelect = (item: T) => {
		props.onSelect(item)
		state.query = ''
		close()
	}

	const visibleItems = () => {
		const query = normalized(state.query)
		return [...props.items]
			.filter((item) => {
				if (!query) return true
				return [item.id ?? '', item.label, item.hint ?? ''].some((part) =>
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

	const renderRow = (item: T) =>
		props.renderItem ? (
			props.renderItem(item)
		) : (
			<>
				<span class="combo-search-picker__item-main">{item.label}</span>
				<span if={item.hint} class="combo-search-picker__item-hint">
					{item.hint}
				</span>
			</>
		)

	const inputPlaceholder = () => {
		if (state.show) return props.placeholder ?? 'Filter...'
		return props.triggerLabel ?? props.placeholder ?? label()
	}

	const popupStyle = () => ({
		left: `${state.left}px`,
		top: `${state.top}px`,
		width: `${state.width}px`,
	})

	effect`combo-search-picker-popup`(() => {
		if (!state.show) return
		const host = document.createElement('div')
		// The popup is portaled to <body>, outside the app's themed container.
		// Carry the theme attribute over so the CSS custom properties (--ak-*)
		// resolve with the active theme instead of falling back to :root.
		const themeEl = field?.closest('[data-theme]')
		if (themeEl) host.setAttribute('data-theme', themeEl.getAttribute('data-theme') ?? '')
		document.body.appendChild(host)
		const stopLatch = latch(
			host,
			<div
				class="combo-search-picker__menu"
				style={popupStyle()}
				onClick={(e: Event) => e.stopPropagation()}
			>
				<div class="combo-search-picker__list">
					<for each={visibleItems()}>
						{(item) => {
							const distance = itemDistance(item)
							return (
								<button
									type="button"
									class="combo-search-picker__item"
									disabled={item.disabled}
									title={item.hint ? `${item.label} - ${item.hint}` : item.label}
									onClick={() => {
										if (!item.disabled) handleSelect(item)
									}}
									data-testid={props.testId ? `${props.testId}-item` : undefined}
									data-item-id={item.id}
								>
									<span>{renderRow(item)}</span>
									<span if={distance !== undefined} class="combo-search-picker__item-distance">
										{distance}
									</span>
								</button>
							)
						}}
					</for>
					<div if={visibleItems().length === 0} class="combo-search-picker__empty">
						{empty()}
					</div>
				</div>
			</div>
		)
		const onPointerDown = (event: Event) => {
			const target = event.target instanceof Node ? event.target : null
			if (target && (field?.contains(target) || host.contains(target))) return
			state.show = false
		}
		const onLayout = () => syncPopup()
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return
			state.show = false
			field?.focus()
		}
		document.addEventListener('mousedown', onPointerDown)
		window.addEventListener('resize', onLayout)
		window.addEventListener('scroll', onLayout, true)
		window.addEventListener('keydown', onKey)
		return () => {
			document.removeEventListener('mousedown', onPointerDown)
			window.removeEventListener('resize', onLayout)
			window.removeEventListener('scroll', onLayout, true)
			window.removeEventListener('keydown', onKey)
			stopLatch()
			host.remove()
		}
	})

	return (
		<div class="combo-search-picker" data-testid={props.testId}>
			<div class="combo-search-picker__field">
				<input
					this={field}
					class="combo-search-picker__input"
					type="text"
					value={state.query}
					placeholder={inputPlaceholder()}
					disabled={props.disabled}
					title={props.title ?? label()}
					aria-label={label()}
					aria-haspopup="listbox"
					aria-expanded={state.show ? 'true' : 'false'}
					onClick={open}
					data-testid={props.testId ? `${props.testId}-filter` : undefined}
				/>
				<span class="combo-search-picker__caret" aria-hidden="true">
					▾
				</span>
			</div>
		</div>
	)
}
