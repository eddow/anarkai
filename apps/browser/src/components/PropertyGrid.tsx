import { Panel } from '@app/ui/anarkai'

interface PropertyGridProps {
	class?: string
	children: JSX.Element | (JSX.Element | null | undefined | false)[]
}

const PropertyGrid = ({ class: className = '', children }: PropertyGridProps) => {
	return (
		<Panel class={`ak-property-grid ${className}`.trim()}>
			<table class="ak-property-grid__table">
				<tbody>{children}</tbody>
			</table>
		</Panel>
	)
}

export default PropertyGrid
