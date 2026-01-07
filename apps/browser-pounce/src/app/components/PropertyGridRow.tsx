import type { JSX } from 'pounce-ts'
import { css } from '$lib/css'

css`
.property-label {
	padding: 0.5rem 0.75rem;
	vertical-align: top;
	width: 40%;
	min-width: 120px;
}

.property-label__text {
	font-weight: 500;
	color: var(--pico-color);
}

.dark .property-label__text {
	color: var(--pico-color);
}

.property-value {
	padding: 0.5rem 0.75rem;
	vertical-align: top;
	width: 60%;
}

.property-grid-row {
	border-bottom: 1px solid rgb(229 231 235);
}

.dark .property-grid-row {
	border-bottom-color: rgb(55 65 81);
}

.property-grid-row:last-child {
	border-bottom: none;
}
`

interface PropertyGridRowProps {
	label?: string
	class?: string
	children: JSX.Element | (JSX.Element | null | undefined | false)[]
}

export default function PropertyGridRow(
	{ label, class: className = '', children }: PropertyGridRowProps
): JSX.Element {
	return (
		<tr class="property-grid-row">
			{label && (
				<th class="property-label">
					<span class="property-label__text">{label}</span>
				</th>
			)}
			<td class={`property-value ${className}`} colSpan={label ? 1 : 2}>
				{children}
			</td>
		</tr>
	)
}
