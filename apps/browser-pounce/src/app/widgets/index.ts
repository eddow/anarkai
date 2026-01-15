import ConfigurationWidget from './configuration'
import GameWidget from './game'
import SelectionInfoWidget from './selection-info'
import MultiselectTestWidget from './multiselect-test'

export const widgets = {
	game: GameWidget,
	configuration: ConfigurationWidget,
	'selection-info': SelectionInfoWidget,
	'multiselect-test': MultiselectTestWidget,
}

export default widgets
