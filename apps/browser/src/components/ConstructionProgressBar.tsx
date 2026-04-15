import { css } from '@app/lib/css'

css`
.construction-progress {
	display: grid;
	gap: 0.35rem;
	min-width: 12rem;
}

.construction-progress__track {
	position: relative;
	height: 0.45rem;
	border-radius: 999px;
	overflow: hidden;
	background: color-mix(in srgb, var(--ak-border) 65%, transparent);
}

.construction-progress__fill {
	position: absolute;
	inset: 0 auto 0 0;
	background:
		linear-gradient(
			90deg,
			color-mix(in srgb, #0ea5e9 72%, var(--ak-text)) 0%,
			color-mix(in srgb, #22c55e 72%, var(--ak-text)) 100%
		);
	border-radius: inherit;
}

.construction-progress__label {
	font-size: 0.8rem;
	color: var(--ak-text-muted);
	font-variant-numeric: tabular-nums;
}
`

interface ConstructionProgressBarProps {
	applied: number
	total: number
	label: string
	testId?: string
}

export default function ConstructionProgressBar(props: ConstructionProgressBarProps) {
	const ratio = props.total > 0 ? Math.max(0, Math.min(1, props.applied / props.total)) : 0
	return (
		<div class="construction-progress" data-testid={props.testId}>
			<div class="construction-progress__track" aria-hidden="true">
				<div class="construction-progress__fill" style={`width:${ratio * 100}%`} />
			</div>
			<span class="construction-progress__label">{props.label}</span>
		</div>
	)
}
