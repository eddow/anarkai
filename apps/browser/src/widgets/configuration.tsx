import { css } from '@app/lib/css'
import { getBrowserPalette, getBrowserPaletteConfigurationJson } from '@app/palette/browser-palette'
import {
	AnarkaiPaletteCommandBox,
	AnarkaiPaletteKeyBindingsEditor,
	InspectorSection,
} from '@app/ui/anarkai'
import type { DockviewWidgetProps, DockviewWidgetScope } from '@sursaut/ui/dockview'
import { type Palette, paletteCommandEntries } from '@sursaut/ui/palette'

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

.configuration-widget__keys {
	display: grid;
	gap: 0.75rem;
}
`

const ConfigurationWidget = (props: DockviewWidgetProps, scope: DockviewWidgetScope) => {
	void scope
	props.title = 'Configuration'
	const { commandBox, palette } = getBrowserPalette()
	const keyBindingEntries = () => paletteCommandEntries({ palette: palette as unknown as Palette })

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
					onEditStop={() => console.log(getBrowserPaletteConfigurationJson())}
					title="Configuration command box"
				/>
			</InspectorSection>
			<InspectorSection class="configuration-widget__keys" title="Key Bindings">
				<AnarkaiPaletteKeyBindingsEditor palette={palette} entries={keyBindingEntries} />
			</InspectorSection>
		</div>
	)
}

export default ConfigurationWidget
