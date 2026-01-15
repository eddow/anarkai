import { Button, ButtonGroup } from 'pounce-ui/src'
import { games, registerObjectInfoPanel, selectionState } from '@app/lib/globals'
import { toWorldCoord } from '@ssh/lib/utils/position'

const SelectionHeaderActions = (props: { api: any; group: any }) => {
	const group = props.group
	const activePanel = group.activePanel

	if (!activePanel) return null

	// Check if it's a selection info panel
	// We can check component name or parameters
	// component name for selection info is 'selection-info' (see widgets/index.ts)
	const isSelectionPanel = activePanel.view?.content?.component === 'selection-info' || activePanel.id.startsWith('pinned:') || activePanel.id === 'selection-info'
	// Better check: check if it has 'uid' param which implies it's tracking an object
	const params = activePanel.params || {}
	const uid = params.uid
	const hasPosition = params.hasPosition
	const isPinned = params.isPinned

	if (!isSelectionPanel && !uid) return null

	const game = games.game('GameX')

	const goTo = () => {
		if (!uid) return
		const object = game.getObject(uid)
		if (!object || !object.position) return

		const coord = toWorldCoord(object.position)
		if (!coord) return

		const renderer = game.renderer as any
		if (!renderer || !renderer.world || !renderer.app) return

		const { screen } = renderer.app
		const { world } = renderer
		const scale = world.scale.x

		world.position.x = screen.width / 2 - coord.x * scale
		world.position.y = screen.height / 2 - coord.y * scale
	}

	const pin = () => {
		if (!uid || !props.api) return

		// Register as pinned
		registerObjectInfoPanel(uid, `pinned:${uid}`)

		const dock = props.api // The main api passed to header action
		// Add new pinned panel
		dock.addPanel({
			id: `pinned:${uid}`,
			component: 'selection-info',
			params: { uid, headerRight: 'selection-actions' },
			floating: { width: 300, height: 400 },
			position: { referencePanel: activePanel.id }
		})

		activePanel.close()

		if (selectionState.panelId === activePanel.id) {
			selectionState.panelId = undefined
		}
	}

	return (
		<div style="display: flex; align-items: center; padding-right: 4px;">
			<ButtonGroup>
				{/* Only show GoTo if position is known/relevant */}
				{hasPosition && (
					<Button icon="mdi:eye" aria-label="Go to Object" onClick={goTo} />
				)}

				{!isPinned && (
					<Button icon="mdi:pin" aria-label="Pin Panel" onClick={pin} />
				)}
			</ButtonGroup>
		</div>
	)
}

export default SelectionHeaderActions
