interface PropertyGridRowProps {
	label?: string
	class?: string
	children: JSX.Element | (JSX.Element | null | undefined | false)[]
}

export default function PropertyGridRow({
	label,
	class: className = '',
	children,
}: PropertyGridRowProps): JSX.Element {
	return (
		<tr class="ak-property-grid__row">
			{label && (
				<th class="ak-property-grid__label">
					<span class="ak-property-grid__label-text">{label}</span>
				</th>
			)}
			<td class={['ak-property-grid__value', className]} colSpan={label ? 1 : 2}>
				{children}
			</td>
		</tr>
	)
}
