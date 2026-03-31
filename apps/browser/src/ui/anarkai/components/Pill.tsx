export type AnarkaiPillTone = 'neutral' | 'demand' | 'provide'

export type PillProps = {
	tone?: AnarkaiPillTone
	class?: string
	el?: JSX.IntrinsicElements['span']
	children?: JSX.Children
}

export const Pill = (props: PillProps) => {
	return (
		<span
			{...props.el}
			class={['ak-pill', `ak-pill--${props.tone ?? 'neutral'}`, props.class, props.el?.class]}
		>
			{props.children}
		</span>
	)
}
