import { css } from '@app/lib/css'
import type { Game } from 'ssh/game'
import ResourceImage from './ResourceImage'

css`
.entity-badge {
	display: inline-flex;
	align-items: center;
	gap: 0.25rem;
	padding: 0.25rem 0.5rem;
	border: 1px solid var(--ak-border);
	border-radius: var(--ak-radius-sm);
	background-color: color-mix(in srgb, var(--ak-surface-panel) 92%, transparent);
}

.entity-badge__qty {
	font-size: 0.875rem;
	font-weight: 600;
	color: var(--ak-text);
}
`

interface EntityBadgeProps {
	game: Game
	sprite: string
	text: string
	qty?: number
	qtyLabel?: string
	height?: number
}

const EntityBadge = (props: EntityBadgeProps) => {
	const view = {
		get qtyLabel() {
			return props.qtyLabel ?? (props.qty !== undefined ? `×${props.qty}` : undefined)
		},
	}

	return (
		<div class="entity-badge">
			<ResourceImage
				game={props.game}
				sprite={props.sprite}
				height={props.height ?? 20}
				alt={props.text}
			/>
			<span if={view.qtyLabel} class="entity-badge__qty">
				{view.qtyLabel}
			</span>
		</div>
	)
}

export default EntityBadge
