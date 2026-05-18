import ConfigurationWidget from './configuration'
import DistrictWidget from './district'
import GameWidget from './game'
import PaletteInspectorWidget from './palette-inspector-widget'
import SelectionInfoWidget from './selection-info'

export const widgets = {
	game: GameWidget,
	district: DistrictWidget,
	configuration: ConfigurationWidget,
	paletteInspector: PaletteInspectorWidget,
	'selection-info': SelectionInfoWidget,
}

export default widgets
