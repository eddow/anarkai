import { type ButtonGroupNavOptions, setupButtonGroupNav } from '@sursaut/ui/models'

export type ButtonGroupProps = {
	children?: JSX.Children
	el?: JSX.IntrinsicElements['div']
	orientation?: ButtonGroupNavOptions['orientation']
	trapTab?: ButtonGroupNavOptions['trapTab']
	roleFilter?: ButtonGroupNavOptions['roleFilter']
}

export const ButtonGroup = (props: ButtonGroupProps) => (
	<div
		{...props.el}
		class={['ak-button-group', props.el?.class]}
		role="group"
		use={(element: HTMLElement) =>
			setupButtonGroupNav(element, {
				orientation: props.orientation,
				trapTab: props.trapTab,
				roleFilter: props.roleFilter,
			})
		}
	>
		{props.children}
	</div>
)
