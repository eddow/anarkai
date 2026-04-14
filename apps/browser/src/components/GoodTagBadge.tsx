import { css } from '@app/lib/css'
import { goodTagIconUrl } from '@app/lib/good-tag-icons'

css`
.good-tag-badge {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	inline-size: 1.7rem;
	block-size: 1.7rem;
	border-radius: 999px;
	border: 1px solid color-mix(in srgb, var(--ak-text-muted) 18%, transparent);
	background: color-mix(in srgb, var(--ak-surface-panel) 92%, transparent);
	flex: 0 0 auto;
}
.good-tag-badge__image {
	inline-size: 1.1rem;
	block-size: 1.1rem;
	object-fit: contain;
	display: block;
}
`

export interface GoodTagBadgeProps {
	tagId: string
	label: string
	size?: number
}

const GoodTagBadge = (props: GoodTagBadgeProps) => {
	const iconUrl = goodTagIconUrl(props.tagId.trim())
	return (
		<div
			class="good-tag-badge"
			data-testid="good-tag-badge"
			title={props.label}
			aria-label={props.label}
			style={props.size ? `inline-size:${props.size}px;block-size:${props.size}px;` : undefined}
		>
			<img if={iconUrl} class="good-tag-badge__image" src={iconUrl} alt="" />
		</div>
	)
}

export default GoodTagBadge
