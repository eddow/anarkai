import CommercialOverviewWidget from './commercial-overview'
import ConfigurationWidget from './configuration'
import GameWidget from './game'
import LinesManagementWidget from './lines-management'
import PaletteInspectorWidget from './palette-inspector-widget'
import PlanManagerWidget from './plan-manager'
import ProjectManagerWidget from './project-manager'
import SaveLoadWidget from './save-load'
import SelectionInfoWidget from './selection-info'

export const widgets = {
	game: GameWidget,
	configuration: ConfigurationWidget,
	linesManagement: LinesManagementWidget,
	planManager: PlanManagerWidget,
	projectManager: ProjectManagerWidget,
	paletteInspector: PaletteInspectorWidget,
	'selection-info': SelectionInfoWidget,
	commercialOverview: CommercialOverviewWidget,
	saveLoad: SaveLoadWidget,
}

export default widgets
