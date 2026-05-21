import ConfigurationWidget from './configuration'
import GameWidget from './game'
import PaletteInspectorWidget from './palette-inspector-widget'
import SelectionInfoWidget from './selection-info'

export const widgets = {
	game: GameWidget,
	configuration: ConfigurationWidget,
	paletteInspector: PaletteInspectorWidget,
	'selection-info': SelectionInfoWidget,
}

export default widgets
