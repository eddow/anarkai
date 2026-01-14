import { reactive } from 'mutts'
import type { GoodType } from '@ssh/lib/types/base'
import { goods as sensoryGoods } from 'engine-pixi/assets/visual-content'
import { Button } from 'pounce-ui/src'
import EntityBadge from '../EntityBadge'
import { css } from '@app/lib/css'
import type { Game } from '@ssh/lib/game'

css`
.add-good-wrapper {
	display: inline-block;
}

.floating-menu-overlay {
	position: fixed;
	top: 0;
	left: 0;
	width: 100vw;
	height: 100vh;
	z-index: 9999;
}

.floating-menu {
	position: fixed;
	background: var(--app-bg);
	border: 1px solid var(--pico-muted-border-color);
	box-shadow: 0 4px 6px rgba(0,0,0,0.3);
	min-width: 120px;
	max-height: 200px;
	overflow-y: auto;
	border-radius: 4px;
	padding: 0.25rem;
}

.menu-item {
	padding: 0.25rem;
	cursor: pointer;
	border-radius: 2px;
}

.menu-item:hover {
	background: var(--app-surface-tint);
}

.menu-empty {
	padding: 0.5rem;
	font-size: 0.8rem;
	color: var(--pico-muted-color);
}
`

interface AddGoodButtonProps {
	availableGoods: GoodType[]
	game: Game
	title?: string
	onSelect: (good: GoodType) => void
	children?: any
}

export default function AddGoodButton(props: AddGoodButtonProps) {
	const menuState = reactive({
		show: false,
		x: 0,
		y: 0,
	})

	let buttonWrapper: HTMLElement | undefined

	const openMenu = () => {
		if (!buttonWrapper) return
		const rect = buttonWrapper.getBoundingClientRect()
		menuState.x = rect.left
		menuState.y = rect.bottom
		menuState.show = true
	}

	const handleSelect = (gt: GoodType) => {
		props.onSelect(gt)
		menuState.show = false
	}

	const getSprite = (good: string) => {
		return sensoryGoods[good as keyof typeof sensoryGoods]?.sprites?.[0] || 'default'
	}

	return (
		<div class="add-good-wrapper" use={(el: HTMLElement) => buttonWrapper = el}>
			<Button
				icon="mdi:plus"
				onClick={openMenu}
				el={{ title: props.title || 'Add' }}
			>
				{props.children || 'Add'}
			</Button>

			{menuState.show && (
				<div
					class="floating-menu-overlay"
					onClick={() => menuState.show = false}
				>
					<div
						class="floating-menu"
						style={`top: ${menuState.y}px; left: ${menuState.x}px;`}
						onClick={(e: Event) => e.stopPropagation()}
					>
						{props.availableGoods.length > 0 ? (
							props.availableGoods.map((gt) => (
								<div
									class="menu-item"
									onClick={() => handleSelect(gt)}
								>
									<EntityBadge
										game={props.game}
										sprite={getSprite(gt)}
										text={gt}
									/>
								</div>
							))
						) : (
							<div class="menu-empty">
								No goods available
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	)
}
