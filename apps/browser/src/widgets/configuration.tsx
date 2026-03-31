import { css } from '@app/lib/css'
import { getBrowserPalette } from '@app/palette/browser-palette'
import { AnarkaiPaletteCommandBox, InspectorSection } from '@app/ui/anarkai'
import type { DockviewWidgetProps, DockviewWidgetScope } from '@sursaut/ui/dockview'

css`
.configuration-widget {
	display: flex;
	flex-direction: column;
	gap: 0.9rem;
	padding: 1.2rem;
	color: var(--ak-text);
	height: 100%;
	box-sizing: border-box;
}

.configuration-widget__lead {
	margin: 0;
	font-size: 0.92rem;
	line-height: 1.4;
	color: var(--ak-text-muted);
}

.configuration-widget__command {
	display: grid;
	gap: 0.75rem;
}
`

const ConfigurationWidget = (props: DockviewWidgetProps, scope: DockviewWidgetScope) => {
	void scope
	props.title = 'Configuration'
	const { commandBox, palette } = getBrowserPalette()

	return (
		<div class="configuration-widget">
			<p class="configuration-widget__lead">
				Use the command box to drive tools and the pencil button to edit the palette layout.
			</p>
			<InspectorSection class="configuration-widget__command" title="Command Box">
				<AnarkaiPaletteCommandBox
					commandBox={commandBox}
					palette={palette}
					editable
					expanded
					floating={false}
					title="Configuration command box"
				/>
			</InspectorSection>
		</div>
	)
}

export default ConfigurationWidget
