import { gather } from '@sursaut/ui'
import { type RadioButtonProps as BaseRadioButtonProps, radioButtonModel } from '@sursaut/ui/models'
export type RadioButtonProps<Value = unknown> = BaseRadioButtonProps<Value>

export const RadioButton = <Value,>(props: RadioButtonProps<Value>) => {
	const model = radioButtonModel(props)
	const icon = model.icon
	const baseIconStyle =
		icon?.span?.style && typeof icon.span.style === 'object' ? icon.span.style : undefined
	const iconStyle = model.isIconOnly
		? {
				...(baseIconStyle ?? {}),
				order: 0,
				marginInlineEnd: 0,
				marginInlineStart: 0,
				inlineSize: '100%',
				blockSize: '100%',
			}
		: baseIconStyle
	const iconSpan = icon
		? icon.span && typeof icon.span === 'object'
			? { ...icon.span, style: iconStyle }
			: { style: iconStyle }
		: undefined

	return (
		<button
			{...model.button}
			{...props.el}
			class={['ak-control-button', 'ak-radio-button', props.el?.class]}
			data-icon-only={model.isIconOnly ? 'true' : undefined}
		>
			<span if={icon} class="ak-control-button__icon" {...iconSpan}>
				{icon?.element}
			</span>
			<fragment if={model.hasLabel}>{gather(props.children)}</fragment>
		</button>
	)
}
