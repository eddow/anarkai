export type AnarkaiBadgeTone =
	| 'yellow'
	| 'red'
	| 'blue'
	| 'gray'
	| 'green'
	| 'purple'
	| 'indigo'
	| 'pink'

export type BadgeProps = {
	tone?: AnarkaiBadgeTone
	class?: string
	el?: JSX.IntrinsicElements['span']
	children?: JSX.Children
}

export const Badge = (props: BadgeProps) => {
	return (
		<span
			{...props.el}
			class={['ak-badge', `ak-badge--${props.tone ?? 'gray'}`, props.class, props.el?.class]}
		>
			{props.children}
		</span>
	)
}
