import { css } from '@app/lib/css'
import { activeWorldViewPov } from '@app/lib/globals'
import { document, latch } from '@sursaut/core'
import { effect, reactive } from 'mutts'
import { type AxialCoord, axial } from 'ssh/utils'
import InspectorObjectLink from './InspectorObjectLink'
import LinkedEntityControl from './LinkedEntityControl'
import PropertyGridRow from './PropertyGridRow'

css`
.assigned-links-picker {
	display: flex;
	flex-direction: column;
	gap: 0.4rem;
}

.assigned-links-picker__list {
	display: flex;
	flex-direction: column;
	gap: 0.4rem;
}

.assigned-links-picker__row {
	display: flex;
	align-items: center;
	gap: 0.45rem;
	flex-wrap: wrap;
	padding: 0.35rem 0.45rem;
	border: 1px solid color-mix(in srgb, var(--ak-text-muted) 18%, transparent);
	border-radius: 0.4rem;
	background: color-mix(in srgb, var(--ak-surface-1) 78%, transparent);
}

.assigned-links-picker__remove {
	margin-inline-start: auto;
	border: 0;
	background: transparent;
	color: var(--ak-danger, #c44);
	cursor: pointer;
	font-size: 1rem;
	line-height: 1;
}

.assigned-links-picker__empty {
	color: var(--ak-text-muted);
	font-size: 0.78rem;
}

.assigned-links-picker__picker {
	position: relative;
	display: inline-block;
	width: 100%;
}

.assigned-links-picker__picker-field {
	position: relative;
}

.assigned-links-picker__picker-input {
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

.assigned-links-picker__picker-input:hover:not(:disabled) {
	border-color: color-mix(in srgb, var(--ak-accent, #8b5cf6) 38%, transparent);
}

.assigned-links-picker__picker-input:disabled {
	opacity: 0.55;
	cursor: not-allowed;
}

.assigned-links-picker__picker-caret {
	position: absolute;
	top: 50%;
	right: 0.45rem;
	transform: translateY(-50%);
	font-size: 0.65rem;
	color: var(--ak-text-muted);
	line-height: 1;
	pointer-events: none;
}

.assigned-links-picker__picker-menu {
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

.assigned-links-picker__picker-list {
	display: flex;
	flex-direction: column;
	gap: 0.3rem;
	max-height: 12rem;
	overflow-y: auto;
}

.assigned-links-picker__picker-item {
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

.assigned-links-picker__picker-item:disabled {
	opacity: 0.55;
	cursor: not-allowed;
}

.assigned-links-picker__picker-item:hover:not(:disabled) {
	border-color: color-mix(in srgb, var(--ak-accent, #8b5cf6) 38%, transparent);
	background: color-mix(in srgb, var(--ak-accent, #8b5cf6) 8%, var(--ak-surface-1));
}

.assigned-links-picker__picker-item-main {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.assigned-links-picker__picker-item-hint {
	min-width: 0;
	color: var(--ak-text-muted);
	font-size: 0.72rem;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.assigned-links-picker__picker-item-distance {
	color: var(--ak-text-muted);
	font-variant-numeric: tabular-nums;
	font-size: 0.72rem;
}

.assigned-links-picker__picker-empty {
	padding: 0.4rem 0.45rem;
	color: var(--ak-text-muted);
	font-size: 0.78rem;
}
`

export interface AssignedLinksPickerItem {
	readonly id?: string
	readonly label: string
	readonly hint?: string
	readonly coord?: AxialCoord
	readonly disabled?: boolean
}

export interface AssignedLinksPickerProps<L extends object, T extends AssignedLinksPickerItem> {
	/** Already-linked objects, rendered as rows with a remove button. */
	assigned: readonly L[]
	/** Candidate items for the add combo (already-assigned excluded by caller). */
	availableItems: readonly T[]
	onSelect: (item: T) => void
	onRemove: (link: L) => void
	/** Single row label, e.g. "Vehicles" or "Lines". */
	label: string
	filterPlaceholder?: string
	emptyAssigned?: string
	emptyAvailable?: string
	removeLabel?: string
	pickerTestId?: string
	assignedRowTestId?: string
	removeButtonTestId?: string
	disabled?: boolean
}

const normalized = (value: string) => value.trim().toLowerCase()

function itemDistance(item: AssignedLinksPickerItem): number | undefined {
	const center = activeWorldViewPov.center
	if (!center || !item.coord) return undefined
	return axial.distance(center, item.coord)
}

/**
 * The one and only 1-n link editor: assigned rows (link + remove) plus a
 * collapsed combo picker to add more. Used for vehicle↔lines on both sides.
 */
export default function AssignedLinksPicker<L extends object, T extends AssignedLinksPickerItem>(
	props: AssignedLinksPickerProps<L, T>
) {
	const state = reactive({
		show: false,
		left: 0,
		top: 0,
		width: 0,
		query: '',
	})
	let field: HTMLInputElement | undefined

	const empty = () => props.emptyAvailable ?? 'Nothing available'

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
		return [...props.availableItems]
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

	const inputPlaceholder = () => {
		if (state.show) return props.filterPlaceholder ?? 'Filter...'
		return props.filterPlaceholder ?? 'Filter...'
	}

	const popupStyle = () => ({
		left: `${state.left}px`,
		top: `${state.top}px`,
		width: `${state.width}px`,
	})

	effect`assigned-links-picker-popup`(() => {
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
				class="assigned-links-picker__picker-menu"
				style={popupStyle()}
				onClick={(e: Event) => e.stopPropagation()}
			>
				<div class="assigned-links-picker__picker-list">
					<for each={visibleItems()}>
						{(item) => {
							const distance = itemDistance(item)
							return (
								<button
									type="button"
									class="assigned-links-picker__picker-item"
									disabled={item.disabled}
									title={item.hint ? `${item.label} - ${item.hint}` : item.label}
									onClick={() => {
										if (!item.disabled) handleSelect(item)
									}}
									data-testid={props.pickerTestId ? `${props.pickerTestId}-item` : undefined}
									data-item-id={item.id}
								>
									<span>
										<span class="assigned-links-picker__picker-item-main">{item.label}</span>
										<span if={item.hint} class="assigned-links-picker__picker-item-hint">
											{item.hint}
										</span>
									</span>
									<span if={distance !== undefined} class="assigned-links-picker__picker-item-distance">
										{distance}
									</span>
								</button>
							)
						}}
					</for>
					<div if={visibleItems().length === 0} class="assigned-links-picker__picker-empty">
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
		<PropertyGridRow label={props.label}>
			<div class="assigned-links-picker">
				<div class="assigned-links-picker__list">
					<for each={props.assigned}>
						{(link) => (
							<div class="assigned-links-picker__row" data-testid={props.assignedRowTestId}>
								<LinkedEntityControl object={link as never} />
								<InspectorObjectLink object={link as never} />
								<button
									type="button"
									class="assigned-links-picker__remove"
									title={props.removeLabel ?? 'Remove'}
									aria-label={props.removeLabel ?? 'Remove'}
									onClick={() => props.onRemove(link)}
									data-testid={props.removeButtonTestId}
								>
									×
								</button>
							</div>
						)}
					</for>
					<div if={props.assigned.length === 0} class="assigned-links-picker__empty">
						{props.emptyAssigned ?? 'None assigned'}
					</div>
				</div>
				<div class="assigned-links-picker__picker" data-testid={props.pickerTestId}>
					<div class="assigned-links-picker__picker-field">
						<input
							this={field}
							class="assigned-links-picker__picker-input"
							type="text"
							value={state.query}
							placeholder={inputPlaceholder()}
							disabled={props.disabled}
							title={props.filterPlaceholder ?? 'Filter...'}
							aria-label={props.filterPlaceholder ?? 'Filter...'}
							aria-haspopup="listbox"
							aria-expanded={state.show ? 'true' : 'false'}
							onClick={open}
							data-testid={props.pickerTestId ? `${props.pickerTestId}-filter` : undefined}
						/>
						<span class="assigned-links-picker__picker-caret" aria-hidden="true">
							▾
						</span>
					</div>
				</div>
			</div>
		</PropertyGridRow>
	)
}
