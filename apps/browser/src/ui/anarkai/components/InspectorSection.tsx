export type InspectorSectionProps = {
	title?: string
	class?: string
	bodyClass?: string
	el?: JSX.IntrinsicElements['section']
	children?: JSX.Children
}

export const InspectorSection = (props: InspectorSectionProps) => {
	return (
		<section {...props.el} class={['ak-inspector-section', props.class, props.el?.class]}>
			<div if={props.title} class="ak-inspector-section__header">
				<h3 class="ak-inspector-section__title">{props.title}</h3>
			</div>
			<div class={['ak-inspector-section__body', props.bodyClass]}>{props.children}</div>
		</section>
	)
}
