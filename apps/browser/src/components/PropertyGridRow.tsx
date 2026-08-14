interface PropertyGridRowProps {
	label?: string
	class?: string
	children: JSX.Element | (JSX.Element | null | undefined | false)[]
}

export default function PropertyGridRow(props: PropertyGridRowProps): JSX.Element {
	return (
		<tr class="ak-property-grid__row">
			<th if={props.label} class="ak-property-grid__label">
				<span class="ak-property-grid__label-text">{props.label}</span>
			</th>
			<td class={['ak-property-grid__value', props.class ?? '']} colSpan={props.label ? 1 : 2}>
				{props.children}
			</td>
		</tr>
	)
}
