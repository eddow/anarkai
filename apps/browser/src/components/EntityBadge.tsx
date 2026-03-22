import { css } from '@app/lib/css'
import type { Game } from 'ssh/game'
import ResourceImage from './ResourceImage'

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

const EntityBadge = (props: EntityBadgeProps) => {
	return (
		<div class="entity-badge">
			<ResourceImage game={props.game} sprite={props.sprite} height={props.height ?? 20} alt={props.text} />
			<span if={props.qty} class="entity-badge__qty">×{props.qty}</span>
		</div>
	)
}

export default EntityBadge
