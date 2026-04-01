import { css } from '@app/lib/css'
import { game } from '@app/lib/globals'
import { PaletteToolbarInspectorPanel } from '@app/palette/palette-inspector'
import type { DockviewWidgetProps, DockviewWidgetScope } from '@sursaut/ui/dockview'

css`
.palette-inspector-widget-host {
	display: flex;
	flex-direction: column;
	min-height: 0;
	height: 100%;
	overflow: auto;
	box-sizing: border-box;
	padding: 0.35rem 0.5rem 0.65rem;
	color: var(--ak-text);
	background: var(--app-bg);
}
`

const PaletteInspectorWidget = (props: DockviewWidgetProps, scope: DockviewWidgetScope) => {
	void scope
	props.title = 'Toolbar item'
	return (
		<div class="palette-inspector-widget-host">
			<PaletteToolbarInspectorPanel clockGame={game} />
		</div>
	)
}

export default PaletteInspectorWidget
