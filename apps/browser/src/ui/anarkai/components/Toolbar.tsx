import { setupToolbarNav, type ToolbarNavOptions } from '@sursaut/ui/models'

export type ToolbarProps = {
	children?: JSX.Children
	el?: JSX.IntrinsicElements['div']
	orientation?: ToolbarNavOptions['orientation']
	cycleSegments?: ToolbarNavOptions['cycleSegments']
}

export type ToolbarSpacerProps = {
	if?: boolean
	el?: JSX.IntrinsicElements['div']
}

const ToolbarRoot = (props: ToolbarProps) => (
	<div
		{...props.el}
		class={['ak-toolbar', props.el?.class]}
		role="toolbar"
		use={(element: HTMLElement) =>
			setupToolbarNav(element, {
				orientation: props.orientation,
				cycleSegments: props.cycleSegments,
			})
		}
	>
		{props.children}
	</div>
)

const ToolbarSpacer = (props: ToolbarSpacerProps) => (
	<div
		{...props.el}
		if={props.if ?? true}
		class={['ak-toolbar__spacer', props.el?.class]}
		data-toolbar-spacer=""
		aria-hidden="true"
	/>
)

export const Toolbar = Object.assign(ToolbarRoot, {
	Spacer: ToolbarSpacer,
})
