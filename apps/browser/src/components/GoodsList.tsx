import { css } from '@app/lib/css'
import { goods as visualGoods } from 'engine-pixi/assets/visual-content'
import { reactive } from 'mutts'
import type { Game } from 'ssh/game'
import { i18nState } from 'ssh/i18n'
import type { GoodType } from 'ssh/types/base'
import EntityBadge from './EntityBadge'

css`
.goods-list {
	display: flex;
	flex-wrap: wrap;
	gap: 0.5rem;
	align-items: center;
	min-width: 0;
}

.goods-list__item {
	position: relative;
	display: inline-flex;
}

.goods-list__remove {
	position: absolute;
	top: -6px;
	right: -6px;
	width: 14px;
	height: 14px;
	background: var(--pico-del-color);
	color: white;
	border-radius: 50%;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 10px;
	cursor: pointer;
	border: 1px solid rgba(255, 255, 255, 0.5);
	line-height: 1;
	z-index: 10;
}

.goods-list__remove:hover {
	background: red;
}

.goods-dropdown {
	position: relative;
}

.goods-dropdown__trigger {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 2rem;
	height: 2rem;
	border: 1px solid var(--pico-border-color);
	border-radius: var(--pico-border-radius);
	background: var(--pico-card-background-color);
	cursor: pointer;
	color: var(--pico-color);
}

.goods-dropdown__trigger:hover {
	background: var(--pico-secondary-background);
}

.goods-dropdown__menu {
	position: absolute;
	top: 100%;
	left: 0;
	z-index: 100;
	margin-top: 0.25rem;
	padding: 0.5rem;
	background: var(--pico-card-background-color);
	border: 1px solid var(--pico-border-color);
	border-radius: var(--pico-border-radius);
	box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
	display: flex;
	flex-direction: column;
	gap: 0.25rem;
	min-width: 150px;
}

.goods-dropdown__item {
	cursor: pointer;
	padding: 0.25rem;
	border-radius: var(--pico-border-radius);
	display: flex;
	align-items: center;
}

.goods-dropdown__item:hover {
	background: var(--pico-secondary-background);
}
`

/**
 * Props for the GoodsList component.
 */
interface GoodsListProps {
	/**
	 * An ordered list of goods to display.
	 * Supports reactive two-way binding: modifying this array (push/splice) will update the UI.
	 */
	goods: GoodType[]

	/**
	 * Example usage of Game instance for retrieving visual assets logic (if needed deep down)
	 * though mostly used for badge rendering context.
	 */
	game: Game

	/**
	 * Size of the icons in pixels.
	 * @default 20
	 */
	itemSize?: number

	/**
	 * Optional CSS class name for the container.
	 */
	className?: string

	/**
	 * If true, enables the "+" dropdown to add goods and the "x" button to remove them.
	 * @default false
	 */
	editable?: boolean

	/**
	 * Optional render prop to display custom content between the badge and the remove button.
	 * Useful for displaying extra data like IDs or small status indicators.
	 *
	 * @param good The good type being rendered.
	 * @param index The index of the good in the list.
	 */
	renderItemExtra?: (good: GoodType, index: number) => JSX.Element

	/**
	 * Callback to inject extra props into the `EntityBadge` component.
	 * Essential for legacy support where quantity is stored separately from the list.
	 *
	 * @param good The good type.
	 * @param index The index in the list.
	 * @returns Partial props for EntityBadge (e.g., `{ qty: 5 }`).
	 */
	getBadgeProps?: (good: GoodType, index: number) => Partial<{ qty: number; [key: string]: any }>
}

/**
 * A reactive component dealing with a list of goods.
 *
 * It supports:
 * - Read-only display (default).
 * - "Two-way binding" editing (via `editable={true}`), where the `goods` array is mutated directly.
 * - Custom badge properties (e.g. quantity display) via `getBadgeProps`.
 * - Custom extra content per item via `renderItemExtra`.
 *
 * @example
 * // Basic Read-Only Usage with Quantities
 * <GoodsList
 *   goods={Object.keys(stock)}
 *   game={game}
 *   getBadgeProps={(g) => ({ qty: stock[g] })}
 * />
 *
 * @example
 * // Editable List (Two-Way Binding)
 * <GoodsList
 *   goods={state.selectedGoods}
 *   game={game}
 *   editable={true}
 * />
 *
 * @example
 * // With Custom Extra Content
 * <GoodsList
 *   goods={state.items}
 *   game={game}
 *   renderItemExtra={(good, index) => <span>#{index}</span>}
 * />
 */
const GoodsList = (props: GoodsListProps) => {
	const state = reactive({
		isDropdownOpen: false,
	})

	// Reactive derivation of available goods (exclude those already in list?)
	// User said "selected or not". Assuming unique set behavior usually, but array allows duplicates.
	// "multi-select of goods... selected set" implies Uniqueness?
	// "Record<GoodType...>" implies Uniqueness.
	// I will assume UNIQUE items for now in the dropdown filter.
	const getAvailableGoods = () => {
		const allGoods = Object.keys(visualGoods) as GoodType[]
		const currentSet = new Set(props.goods ?? [])
		return allGoods.filter((g) => !currentSet.has(g))
	}

	const handleAdd = (good: GoodType) => {
		if (props.editable && props.goods) {
			props.goods.push(good)
			state.isDropdownOpen = false
		}
	}

	const handleRemove = (good: GoodType) => {
		if (props.editable && props.goods) {
			const index = props.goods.indexOf(good)
			if (index > -1) {
				props.goods.splice(index, 1)
			}
		}
	}

	return (
		<div class={`goods-list ${props.className ?? ''}`} if={(props.goods?.length ?? 0) > 0 || props.editable}>
			{/* Dropdown for adding goods (only in editable mode) */}
			<div class="goods-dropdown" if={props.editable}>
				<div
					class="goods-dropdown__trigger"
					onClick={() => (state.isDropdownOpen = !state.isDropdownOpen)}
					title="Add Good"
				>
					+
				</div>
				<div class="goods-dropdown__menu" if={state.isDropdownOpen}>
					{/* Using <for> for available goods */}
					<for each={getAvailableGoods()}>
						{(good: GoodType) => (
							<div class="goods-dropdown__item" onClick={() => handleAdd(good)}>
								<EntityBadge
									game={props.game}
									sprite={visualGoods[good]?.sprites?.[0] ?? 'default'}
									text={i18nState.translator?.goods?.[good] ?? good}
									height={props.itemSize ?? 20}
								/>
							</div>
						)}
					</for>

					<div
						style="padding: 0.5rem; font-size: 0.875rem; color: var(--pico-muted-color);"
						if={getAvailableGoods().length === 0}
					>
						No more goods available
					</div>
				</div>
			</div>

			{/* List of selected goods using <for> */}
			<for each={props.goods ?? []}>
				{(good: GoodType) => {
					// Get index manually to be safe if <for> doesn't provide it reliably as 2nd arg
					const index = props.goods?.indexOf(good) ?? -1
					// Get optional badge props
					const badgeProps = props.getBadgeProps ? props.getBadgeProps(good, index) : {}
					return (
						<div class="goods-list__item">
							<EntityBadge
								game={props.game}
								sprite={visualGoods[good]?.sprites?.[0] ?? 'default'}
								text={i18nState.translator?.goods?.[good] ?? good}
								height={props.itemSize ?? 20}
								{...badgeProps}
							/>
							<div if={props.renderItemExtra} style={{ display: 'inline-flex', alignItems: 'center' }}>
								{props.renderItemExtra?.(good, index)}
							</div>
							<div
								class="goods-list__remove"
								onClick={() => handleRemove(good)}
								title="Remove"
								if={props.editable}
							>
								×
							</div>
						</div>
					)
				}}
			</for>
		</div>
	)
}

export default GoodsList
