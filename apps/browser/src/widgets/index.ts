import ConfigurationWidget from './configuration'
import GameWidget from './game'
import PaletteInspectorWidget from './palette-inspector-widget'
import SelectionInfoWidget from './selection-info'
import TestWidget from './test'

export const widgets = {
	game: GameWidget,
	configuration: ConfigurationWidget,
	paletteInspector: PaletteInspectorWidget,
	'selection-info': SelectionInfoWidget,
	test: TestWidget,
}

export default widgets
