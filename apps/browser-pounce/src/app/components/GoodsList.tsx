import { goods as visualGoods } from 'engine-pixi/assets/visual-content'
import EntityBadge from './EntityBadge'
import { css } from '@app/lib/css'
import type { Game } from '@ssh/lib/game'
import type { GoodType } from '@ssh/lib/types/base'
import { T } from '@ssh/lib/i18n'
import { reactive } from 'mutts'

// Minimal "For" component implementation if not available globally.
// In Pounce/Mutts, we typically map signals.
// If the framework expects <for>, it might be handled by the transform, but usually it's a component.
// I'll search for it one last time in the "pounce-ui" libraries or just assume I need to map manually if I can't find it.
// BUT the user said "The element <for... has to be used".
// I will assume it's intrinsic or lower-case 'for' is handled by the JSX transform in this specific setup.
// Let's try using the lower-case `<for>` as the user requested: "The element <for..."

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

interface GoodsListProps {
	goods: { [k in GoodType]?: number }
	game: Game
	itemSize?: number
	className?: string
	editable?: boolean
}

const GoodsList = ({ goods, game, itemSize = 20, className = '', editable = false }: GoodsListProps) => {
	const state = reactive({
		isDropdownOpen: false
	})

	// Reactive derivation of entries
	const getEntries = () => Object.entries(goods || {})
		.filter(([, qty]) => qty && qty > 0)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)) as [GoodType, number][]

	// Reactive derivation of available goods
	const getAvailableGoods = () => {
		const allGoods = Object.keys(visualGoods) as GoodType[]
		return allGoods.filter(g => !goods?.[g])
	}

	const handleAdd = (good: GoodType) => {
		if (editable && goods) {
			goods[good] = 1
			state.isDropdownOpen = false
		}
	}

	const handleRemove = (good: GoodType) => {
		if (editable && goods) {
			delete goods[good]
		}
	}

	// We use <for> and if={...} properties as requested.
	// Note: <for> expects "each" prop. 
	// Typescript might complain if <for> is not defined in JSX namespace, 
	// but we assume the environment supports it based on user request.
	// TODO: use multi-select from pounce ui & add in there a "hide on focus lose"
	return (
		<div
			class={`goods-list ${className}`}
			if={getEntries().length > 0 || editable}
		>
			{/* Dropdown for adding goods (only in editable mode) */}
			<div class="goods-dropdown" if={editable}>
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
							<div
								class="goods-dropdown__item"
								onClick={() => handleAdd(good)}
							>
								<EntityBadge
									game={game}
									sprite={visualGoods[good]?.sprites?.[0] ?? 'default'}
									text={T.goods?.[good] ?? good}
									height={itemSize}
								/>
							</div>
						)}
					</for>

					{/* Fallback if empty - naive if check without <if> component/attr since it's nested logic? 
                        Actually, let's use a div with if for the "No more goods" message */}
					<div
						style="padding: 0.5rem; font-size: 0.875rem; color: var(--pico-muted-color);"
						if={getAvailableGoods().length === 0}
					>
						No more goods available
					</div>
				</div>
			</div>

			{/* List of selected goods using <for> */}
			<for each={getEntries()}>
				{([good, qty]: [GoodType, number]) => (
					<div class="goods-list__item">
						<EntityBadge
							game={game}
							sprite={visualGoods[good]?.sprites?.[0] ?? 'default'}
							text={T.goods?.[good] ?? good}
							qty={qty}
							height={itemSize}
						/>
						<div
							class="goods-list__remove"
							onClick={() => handleRemove(good)}
							title="Remove"
							if={editable}
						>
							×
						</div>
					</div>
				)}
			</for>
		</div>
	)
}

export default GoodsList
