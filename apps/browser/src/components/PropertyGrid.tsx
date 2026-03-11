/// <reference types="vite/client" />

import { css } from '@app/lib/css'

css`
/* Property Grid Components */
.property-grid-container {
	background-color: var(--app-bg);
	border: 1px solid var(--app-border);
	border-radius: 0.5rem;
	overflow: hidden;
	width: 100%;
}

.property-grid {
	width: 100%;
	border-collapse: collapse;
}

.property-grid tbody tr:hover {
	background-color: var(--app-surface);
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
