import ResourceImage from './ResourceImage'
import type { Game } from '$lib/game'
import { css } from '$lib/css'

css`
.entity-badge {
	display: inline-flex;
	align-items: center;
	gap: 0.25rem;
	padding: 0.25rem 0.5rem;
	border: 1px solid var(--pico-border-color);
	border-radius: var(--pico-border-radius);
	background-color: var(--pico-card-background-color);
}

.entity-badge__qty {
	font-size: 0.875rem;
	font-weight: 600;
	color: var(--pico-color);
}
`

interface EntityBadgeProps {
	game: Game
	sprite: string
	text: string
	qty?: number
	height?: number
}

const EntityBadge = ({ game, sprite, text, qty, height = 20 }: EntityBadgeProps) => {
	return (
		<div class="entity-badge">
			<ResourceImage game={game} sprite={sprite} height={height} alt={text} />
			{qty && <span class="entity-badge__qty">×{qty}</span>}
		</div>
	)
}

export default EntityBadge

