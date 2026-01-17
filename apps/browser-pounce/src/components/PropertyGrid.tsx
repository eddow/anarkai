import type { JSX } from 'pounce-ts'
import { css } from '@app/lib/css'

css`
/* Property Grid Components */
.property-grid-container {
	background-color: rgb(255 255 255);
	border: 1px solid rgb(229 231 235);
	border-radius: 0.5rem;
	overflow: hidden;
	width: 100%;
}

.dark .property-grid-container {
	background-color: rgb(31 41 55);
	border-color: rgb(55 65 81);
}

.property-grid {
	width: 100%;
	border-collapse: collapse;
}

.property-grid tbody tr:hover {
	background-color: rgb(249 250 251);
}

.dark .property-grid tbody tr:hover {
	background-color: rgb(55 65 81);
}
`

interface PropertyGridProps {
	class?: string
	children: JSX.Element | (JSX.Element | null | undefined | false)[]
}

const PropertyGrid = ({ class: className = '', children }: PropertyGridProps) => {
	return (
		<div class={`property-grid-container ${className}`}>
			<table class="property-grid">
				<tbody>{children}</tbody>
			</table>
		</div>
	)
}

export default PropertyGrid

