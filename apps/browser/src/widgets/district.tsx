import DistrictProperties from '@app/components/properties/DistrictProperties'
import type { DockviewWidgetProps } from '@sursaut/ui/dockview'

export default function DistrictWidget(props: DockviewWidgetProps): JSX.Element {
	props.title = 'District'
	return (
		<div class="dockview-widget">
			<DistrictProperties />
		</div>
	)
}
