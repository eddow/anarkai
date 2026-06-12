import { reactive } from 'mutts'

export type InspectorSectionProps = {
	title?: string
	class?: string
	bodyClass?: string
	el?: JSX.IntrinsicElements['section']
	children?: JSX.Children
	/** When true, the section body can be toggled collapsed by clicking the header. */
	collapsible?: boolean
	/** Initial collapsed state (only meaningful when collapsible is true). */
	defaultCollapsed?: boolean
}

export const InspectorSection = (props: InspectorSectionProps) => {
	const collapsed = props.collapsible
		? reactive({ value: props.defaultCollapsed ?? false })
		: undefined

	const toggleCollapsed = () => {
		if (collapsed) collapsed.value = !collapsed.value
	}

	return (
		<section {...props.el} class={['ak-inspector-section', props.class, props.el?.class]}>
			<div
				if={props.title || props.collapsible}
				class="ak-inspector-section__header"
				onClick={toggleCollapsed}
				style={props.collapsible ? { cursor: 'pointer' } : undefined}
			>
				<h3 class="ak-inspector-section__title">{props.title}</h3>
				<span
					if={props.collapsible}
					class="ak-inspector-section__collapse-toggle"
					style={{
						transform: collapsed?.value ? 'rotate(-90deg)' : 'rotate(0deg)',
						transition: 'transform 0.15s ease',
						display: 'inline-flex',
						alignItems: 'center',
						fontSize: '0.7rem',
						marginLeft: 'auto',
						opacity: '0.5',
					}}
				>
					▼
				</span>
			</div>
			<div
				if={!collapsed || !collapsed.value}
				class={['ak-inspector-section__body', props.bodyClass]}
			>
				{props.children}
			</div>
		</section>
	)
}
