import ConfigurationWidget from './configuration'
import GameWidget from './game'
import LinesManagementWidget from './lines-management'
import PaletteInspectorWidget from './palette-inspector-widget'
import SelectionInfoWidget from './selection-info'

export const widgets = {
	game: GameWidget,
	configuration: ConfigurationWidget,
	linesManagement: LinesManagementWidget,
	paletteInspector: PaletteInspectorWidget,
	'selection-info': SelectionInfoWidget,
}

export default widgets
