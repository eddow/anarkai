export type PanelProps = {
	class?: string
	el?: JSX.IntrinsicElements['div']
	children?: JSX.Children
}

export const Panel = (props: PanelProps) => {
	return (
		<div {...props.el} class={['ak-panel', props.class, props.el?.class]}>
			{props.children}
		</div>
	)
}
