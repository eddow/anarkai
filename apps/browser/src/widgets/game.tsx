import { css } from '@app/lib/css'
import { showProps } from '@app/lib/follow-selection'
import { isFreightAddStopAction, tryConsumeFreightMapPick } from '@app/lib/freight-map-pick'
import {
	game,
	hivePlanPlacementState,
	interactionMode,
	isProjectTool,
	mrg,
	projectEditingState,
	projectPreviewState,
	selectionState,
	validateSelectionPanelId,
} from '@app/lib/globals'
import { consumePresentationEvents } from '@app/lib/presentation-events'
import type { DockviewWidgetProps, DockviewWidgetScope } from '@sursaut/ui/dockview'
import { PixiGameRenderer } from 'engine-pixi/renderer'
import type { PlacementPreviewEntry } from 'engine-pixi/renderers/placement-preview-overlay'
import { effect } from 'mutts'
import { UnBuiltLand } from 'ssh/board/content/unbuilt-land'
import { canBuildRoadAcrossBorder, type RoadType, roadBordersForTrace } from 'ssh/board/roads'
import { purpleMarkerTiles } from 'ssh/board/space-connectivity'
import { Tile } from 'ssh/board/tile'
import { traces } from 'ssh/dev/debug'
import type { GamePresentationEvent, InteractiveGameObject } from 'ssh/game'
import { applyHivePlanToolAction, hivePlanCoordKey, hivePlanNeighborOffsets } from 'ssh/hive-plan'
import { stampHivePlanEntries } from 'ssh/project'
import type { AlveolusType } from 'ssh/types/base'
import { toAxialCoord } from 'ssh/utils/position'

css`
	.dockview-widget--game {
		width: 100%;
		height: 100%;
		background-color: var(--app-bg);
	}

	.dockview-widget--game[data-build-action] {
		cursor: crosshair;
	}

	.dockview-widget--game[data-build-action] canvas {
		cursor: crosshair !important;
	}
`

export default function GameWidget(
	props: DockviewWidgetProps<Record<string, never>>,
	scope: DockviewWidgetScope
) {
	const dock = scope?.dockviewApi
	const api = (scope as any).panelApi
	let container: HTMLElement | undefined
	let gameView: PixiGameRenderer | undefined
	const containerId = `game-container-${api?.id ?? Math.random().toString(36).substr(2, 9)}`

	const handleProjectSelection = (object: InteractiveGameObject) => {
		showProps(object, dock)
	}

	const handleBuildingAction = (_event: MouseEvent, object: InteractiveGameObject) => {
		if (!(object instanceof Tile)) return false

		const tile = object
		const action = interactionMode.selectedAction
		// Parse variant from action string: "build:pile.wood.extra" -> alveolusType="pile", variant="wood.extra"
		const raw = action.slice('build:'.length)
		const dotIdx = raw.indexOf('.')
		const alveolusType = (dotIdx >= 0 ? raw.slice(0, dotIdx) : raw) as AlveolusType
		const variant = dotIdx >= 0 ? raw.slice(dotIdx + 1) : undefined
		const success = game.applyBuildAction(tile, alveolusType, variant)
		return Boolean(success)
	}

	const handleZoningAction = (_event: MouseEvent, object: InteractiveGameObject) => {
		if (!(object instanceof Tile)) return false
		const tile = object
		const action = interactionMode.selectedAction
		const zoneType = action.replace('zone:', '')
		return game.applyZoneAction(tile, zoneType)
	}

	const handleZoningDrag = (tiles: Tile[]) => {
		const action = interactionMode.selectedAction
		const zoneType = action.replace('zone:', '')
		for (const tile of tiles) {
			if (tile.canInteract(action)) game.applyZoneAction(tile, zoneType)
		}
	}

	const handleRoadDrag = (tiles: Tile[], roadType: RoadType) => {
		return game.applyRoadTrace(tiles, roadType)
	}

	const handleHivePlanPlacement = (_event: MouseEvent, object: InteractiveGameObject) => {
		if (!(object instanceof Tile)) return false
		const plan = hivePlanPlacementState.plan
		if (!plan) return false
		const anchor = toAxialCoord(object.position)
		if (!anchor) return false
		const preview = game.previewHivePlanPlacement(plan, anchor, hivePlanPlacementState.rotation)
		if (!preview) {
			hivePlanPlacementState.lastMessage = 'Plan is not available.'
			return false
		}
		if (!preview.valid) {
			const blocked = preview.cells.find((cell) => !cell.valid)
			hivePlanPlacementState.lastMessage = blocked?.reason ?? 'Plan does not fit here.'
			return false
		}
		const success = game.applyHivePlanPlacement(plan, anchor, hivePlanPlacementState.rotation)
		hivePlanPlacementState.lastMessage = success ? 'Plan placed.' : 'Plan does not fit here.'
		return success
	}

	/**
	 * Whether a placed alveolus at `coord` collides with the **live board**.
	 * Collides with what already exists on the board — except tiles marked for
	 * demolition in the active project (which are available for construction).
	 * Returns a reason string, or `undefined` when the tile is clear.
	 *
	 * Collisions: missing tile, river channel, water terrain, and an existing
	 * alveolus / dwelling / construction shell / shop (`canInteract(build:)`
	 * false). Deposits / loose goods do NOT block (they need clearing at commit).
	 *
	 * **No cross-plan check**: a planned entry in another project is deliberately
	 * ignored. Plans never check each other — each is validated against the live
	 * board + its own footprint only. A plan made stale by a later board change
	 * is re-checked against the board when re-opened.
	 */
	const entryBlocked = (
		coord: { q: number; r: number },
		alveolusType: AlveolusType
	): string | undefined => {
		const tile = game.hex.getTile(coord)
		if (!tile) return 'missing tile'

		const project = projectEditingState.project
		const key = hivePlanCoordKey(coord)

		// A tile planned for demolition in this plan is available for construction.
		if (project?.demolitions.some((dem) => hivePlanCoordKey(dem) === key)) {
			return undefined
		}

		// Board collision: river / water / existing structure.
		if (tile.hydrology?.isChannel) return 'river'
		const terrain =
			tile.content instanceof UnBuiltLand
				? tile.content.terrain
				: (tile.terrainState?.terrain ?? tile.baseTerrain)
		if (terrain === 'water') return 'water'
		if (!tile.canInteract(`build:${alveolusType}`)) return 'blocked'

		return undefined
	}

	/**
	 * Connectivity refusal for a proposed footprint. Returns the refusal reason plus
	 * the exact purple-marker tiles: `completely-locked` ⇒ the whole footprint;
	 * `partitions-free-space` ⇒ `lockedTiles` (+ walled neighbours); otherwise the
	 * walled neighbours. `used` must include the FULL new walls (draft entries + ghost).
	 */
	const footprintConnectivity = (
		used: ReadonlyArray<{ q: number; r: number }>
	): { reason: string | undefined; purple: ReadonlyArray<{ q: number; r: number }> } => {
		if (used.length === 0) return { reason: undefined, purple: [] }
		return purpleMarkerTiles(game.hex, used)
	}

	/**
	 * Whether a tile needs a demolition: only existing **structures** (alveolus,
	 * dwelling, construction shell, shop) are marked "bulldozed". `UnBuiltLand`
	 * (empty, with a deposit, or with a pending `site`) and zones are NOT marked —
	 * tiles with resources/loose goods are "cleaned" by the existing clearing flow
	 * at commit/construction time, not demolished.
	 */
	const tileNeedsDemolition = (tile: Tile): boolean => {
		const content = tile.content
		if (!content) return false
		return !(content instanceof UnBuiltLand)
	}

	/**
	 * Bulldoze a set of tiles in the active draft: remove any planned entries and
	 * adjacent planned roads, mark tiles with existing **structures** as demolition
	 * todos, and mark existing **board roads** on those tiles' borders as road
	 * demolition todos ("bulldozing a tile = destroying all segments on its borders").
	 */
	const bulldozeTiles = (tiles: Tile[]): boolean => {
		const project = projectEditingState.project
		if (!project || project.stage !== 'draft') return false

		const coordKeys = new Set(
			tiles.map((tile) => {
				const c = toAxialCoord(tile.position)
				return `${c.q},${c.r}`
			})
		)

		const entries = project.entries.filter((entry) => !coordKeys.has(hivePlanCoordKey(entry.coord)))

		// Border coords of every selected tile (6 neighbours each).
		const borderCoordSet = new Set<string>()
		for (const tile of tiles) {
			const c = toAxialCoord(tile.position)
			for (const offset of hivePlanNeighborOffsets) {
				// Border midpoint between (q,r) and (q+oq, r+or).
				borderCoordSet.add(`${c.q + offset.q / 2},${c.r + offset.r / 2}`)
			}
		}
		const roadKey = (coord: readonly [number, number]) => `${coord[0]},${coord[1]}`
		const roads = project.roads.filter((road) => !borderCoordSet.has(roadKey(road.coord)))

		// Tile demolitions: existing structures only.
		const demolitionKeys = new Set(project.demolitions.map((dem) => hivePlanCoordKey(dem)))
		for (const tile of tiles) {
			if (tileNeedsDemolition(tile)) {
				const c = toAxialCoord(tile.position)
				demolitionKeys.add(`${c.q},${c.r}`)
			}
		}
		const demolitions = [...demolitionKeys].map((key) => {
			const [q, r] = key.split(',').map(Number)
			return [q, r] as const
		})

		// Road demolitions: existing board roads on those borders.
		const roadDemolitionKeys = new Set(
			project.roadDemolitions.map((road) => `${road.coord[0]},${road.coord[1]}`)
		)
		for (const key of borderCoordSet) {
			const [q, r] = key.split(',').map(Number)
			if (game.hex.getRoadType({ q, r })) roadDemolitionKeys.add(key)
		}
		const roadDemolitions = [...roadDemolitionKeys].map((key) => {
			const [q, r] = key.split(',').map(Number)
			return { coord: [q, r] as const, type: game.hex.getRoadType({ q, r })! }
		})

		const changed =
			entries.length !== project.entries.length ||
			roads.length !== project.roads.length ||
			demolitions.length !== project.demolitions.length ||
			roadDemolitions.length !== project.roadDemolitions.length
		if (changed) {
			game.projects.updateDraft(project, { entries, roads, demolitions, roadDemolitions })
		}
		return true
	}

	/**
	 * Apply a project-editing tool to a clicked tile: stamp a hive-plan template,
	 * add/replace/remove an alveolus entry (absolute coords), or bulldoze, on the
	 * active draft. The tool is read from the single `interactionMode.selectedAction`
	 * slot. Collisions refuse the placement.
	 */
	const handleProjectEditClick = (object: InteractiveGameObject, action: string): boolean => {
		const project = projectEditingState.project
		if (!project || project.stage !== 'draft' || !(object instanceof Tile)) return false
		const coord = toAxialCoord(object.position)
		if (!coord) return false

		if (action === 'hive') {
			const plan = projectEditingState.hivePlan
			if (!plan) return false
			const stamped = stampHivePlanEntries(
				plan,
				coord,
				projectEditingState.rotation,
				projectEditingState.mirror
			)
			// Whole-hive placement: any collision invalidates the entire stamp.
			if (
				stamped.some((entry) =>
					entryBlocked({ q: entry.coord[0], r: entry.coord[1] }, entry.alveolusType)
				)
			) {
				return false
			}
			// Connectivity refusal (same rule as the ghost): draft entries + stamp.
			if (
				footprintConnectivity([
					...project.entries.map((e) => ({ q: e.coord[0], r: e.coord[1] })),
					...stamped.map((e) => ({ q: e.coord[0], r: e.coord[1] })),
				]).reason
			) {
				return false
			}
			game.projects.updateDraft(project, { entries: [...project.entries, ...stamped] })
			return true
		}

		if (action === 'bulldoze') {
			return bulldozeTiles([object as Tile])
		}

		if (!action.startsWith('build:')) return false
		const raw = action.slice('build:'.length)
		const hashIdx = raw.indexOf('#')
		const alveolusType = (hashIdx >= 0 ? raw.slice(0, hashIdx) : raw) as AlveolusType
		if (entryBlocked(coord, alveolusType)) return false
		if (
			footprintConnectivity([
				...project.entries.map((e) => ({ q: e.coord[0], r: e.coord[1] })),
				coord,
			]).reason
		) {
			return false
		}
		const next = applyHivePlanToolAction(project.entries, action, coord)
		if (!next.changed) return true
		game.projects.updateDraft(project, { entries: next.entries })
		return true
	}

	/**
	 * Apply a project-editing road tool to a dragged tile trace: add the spanned
	 * border coords as road segments (absolute) on the active draft project.
	 */
	const handleProjectRoadDrag = (tiles: Tile[], roadType: RoadType): boolean => {
		const project = projectEditingState.project
		if (!project || project.stage !== 'draft') return false
		if (interactionMode.selectedAction !== `road:${roadType}`) return false

		const borders = roadBordersForTrace(tiles)
		if (borders.length === 0) return false

		// Refuse any border that can't be built (river / water / blocked).
		for (const border of borders) {
			if (!canBuildRoadAcrossBorder(border)) return false
		}

		// Refuse roads that cross one of THIS plan's own alveoli (internal
		// consistency), except a planned freight bay at a trace endpoint (a road
		// terminus, never crossed). Other projects' entries are ignored — plans
		// never cross-check each other.
		const planned = new Map<string, string[]>()
		for (const entry of project.entries) {
			const key = hivePlanCoordKey(entry.coord)
			const list = planned.get(key) ?? []
			list.push(entry.alveolusType)
			planned.set(key, list)
		}
		for (let i = 0; i < tiles.length; i++) {
			const tile = tiles[i]!
			const coord = toAxialCoord(tile.position)
			const types = planned.get(hivePlanCoordKey(coord))
			if (!types || types.length === 0) continue
			const isEndpoint = i === 0 || i === tiles.length - 1
			if (isEndpoint && types.includes('freight_bay')) continue
			return false
		}

		const additions = borders
			.map((border) => toAxialCoord(border.position))
			.filter((coord): coord is { q: number; r: number } => !!coord)
			.map((coord) => ({ coord: [coord.q, coord.r] as const, type: roadType }))

		// Dedup against existing road patches (same coord + type).
		const existing = new Set(
			project.roads.map((road) => `${road.coord[0]},${road.coord[1]}:${road.type}`)
		)
		const merged = [...project.roads]
		for (const road of additions) {
			if (existing.has(`${road.coord[0]},${road.coord[1]}:${road.type}`)) continue
			merged.push(road)
		}
		if (merged.length === project.roads.length) return true
		game.projects.updateDraft(project, { roads: merged })
		return true
	}

	/** Clear the active tool (and its context); called after a one-shot placement. */
	const resetTool = () => {
		interactionMode.selectedAction = ''
		projectEditingState.hivePlan = undefined
		projectEditingState.rotation = 0
		projectEditingState.mirror = false
	}

	const gameEvents = {
		objectClick(event: MouseEvent, object: InteractiveGameObject) {
			if (event.button !== 0) return
			const selectedBeforeFreightPick = selectionState.selectedObject
			if (tryConsumeFreightMapPick(game, object, event)) {
				selectionState.selectedObject = selectedBeforeFreightPick
				return
			}
			const action = interactionMode.selectedAction
			if (isFreightAddStopAction(action)) return

			// Project authoring: build/road/bulldoze/hive route to the active draft project.
			if (projectEditingState.project && isProjectTool(action)) {
				const applied = handleProjectEditClick(object, action)
				if (applied && !event.shiftKey) resetTool()
				return
			}

			if (action.startsWith('build:')) {
				const applied = handleBuildingAction(event, object)
				if (applied && !event.shiftKey) interactionMode.selectedAction = ''
				return
			}
			if (action === 'hive-plan') {
				const applied = handleHivePlanPlacement(event, object)
				if (applied && !event.shiftKey) {
					interactionMode.selectedAction = ''
					hivePlanPlacementState.plan = undefined
				}
				return
			}
			if (action.startsWith('zone:')) {
				const applied = handleZoningAction(event, object)
				if (applied && !event.shiftKey) interactionMode.selectedAction = ''
				return
			}
			handleProjectSelection(object)
		},
		objectDrag(tiles: Tile[], event: unknown) {
			// Project bulldoze over a parallelogram.
			if (projectEditingState.project && interactionMode.selectedAction === 'bulldoze') {
				bulldozeTiles(tiles)
				return
			}
			if (!interactionMode.selectedAction.startsWith('zone:')) return
			handleZoningDrag(tiles)
			const shift =
				event !== null &&
				typeof event === 'object' &&
				'shiftKey' in event &&
				Boolean((event as { shiftKey: boolean }).shiftKey)
			if (!shift) interactionMode.selectedAction = ''
		},
		roadDrag(tiles: Tile[], roadType: RoadType, event: unknown) {
			// Project authoring takes precedence when a road tool + project are active.
			if (projectEditingState.project && isProjectTool(interactionMode.selectedAction)) {
				handleProjectRoadDrag(tiles, roadType)
				return
			}
			if (!interactionMode.selectedAction.startsWith('road:')) return
			const applied = handleRoadDrag(tiles, roadType)
			if (!applied) return
			const shift =
				event !== null &&
				typeof event === 'object' &&
				'shiftKey' in event &&
				Boolean((event as { shiftKey: boolean }).shiftKey)
			if (!shift) interactionMode.selectedAction = ''
		},
		presentationEvents(events: readonly GamePresentationEvent[]) {
			consumePresentationEvents(events)
		},
	}

	props.title = 'Game'

	effect`game:events`(() => {
		game.on(gameEvents)
		return () => game.off(gameEvents)
	})

	effect`game:hive-plan-rotation-keys`(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (interactionMode.selectedAction !== 'hive-plan') return
			if (event.key !== 'r' && event.key !== 'R' && event.key !== 'q' && event.key !== 'Q') return
			event.preventDefault()
			const delta = event.key === 'q' || event.key === 'Q' ? -1 : 1
			hivePlanPlacementState.rotation = (hivePlanPlacementState.rotation + delta + 6) % 6
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	})

	// Rotate/mirror the hive template being stamped into a project.
	effect`game:project-hive-keys`(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (interactionMode.selectedAction !== 'hive') return
			if (event.key === 'm' || event.key === 'M') {
				event.preventDefault()
				projectEditingState.mirror = !projectEditingState.mirror
				return
			}
			if (event.key !== 'r' && event.key !== 'R' && event.key !== 'q' && event.key !== 'Q') return
			event.preventDefault()
			const delta = event.key === 'q' || event.key === 'Q' ? -1 : 1
			projectEditingState.rotation = (projectEditingState.rotation + delta + 6) % 6
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	})

	effect`game:hive-plan-hover-preview`(() => {
		const action = interactionMode.selectedAction
		if (action !== 'hive-plan') {
			game.emit('dragPreviewClear')
			return
		}
		const plan = hivePlanPlacementState.plan
		if (!plan) {
			game.emit('dragPreviewClear')
			return
		}
		const hovered = mrg.hoveredObject
		if (!(hovered instanceof Tile)) {
			game.emit('dragPreviewClear')
			return
		}
		const anchor = toAxialCoord(hovered.position)
		if (!anchor) {
			game.emit('dragPreviewClear')
			return
		}
		const preview = game.previewHivePlanPlacement(plan, anchor, hivePlanPlacementState.rotation)
		if (!preview) {
			game.emit('dragPreviewClear')
			return
		}
		const tiles = preview.cells.map((cell) => cell.tile).filter((tile): tile is Tile => !!tile)
		game.emit('dragPreview', tiles, preview.valid ? '' : 'none')
		hivePlanPlacementState.lastMessage = preview.valid
			? 'Click to place the plan.'
			: (preview.cells.find((cell) => !cell.valid)?.reason ?? 'Plan does not fit here.')
		return () => game.emit('dragPreviewClear')
	})

	// Single placement-preview effect: the persistent footprint of the selected
	// project (always shown while it's previewed/edited) PLUS the hover ghost for
	// the active build/hive tool. One `placementPreview` emit per change avoids
	// the two effects fighting over the overlay (which previously cleared each
	// other, hiding placed footprints and hive ghosts).
	effect`game:placement-preview`(() => {
		const previewedProject = projectPreviewState.active ? projectPreviewState.project : undefined
		const editingProject = projectEditingState.project
		const action = interactionMode.selectedAction

		// Persistent footprint: the previewed project's existing entries + roads
		// (blue; they are already-placed authoring state, not a pending placement,
		// so they never tint red).
		const persistent = previewedProject
			? previewedProject.entries.map((entry) => ({
					coord: [entry.coord[0], entry.coord[1]] as const,
					alveolusType: entry.alveolusType,
					variant: entry.variant,
					blocked: undefined as string | undefined,
					pending: false,
				}))
			: []
		const persistentRoads = previewedProject
			? previewedProject.roads.map((road) => ({
					coord: road.coord,
					type: road.type,
					blocked: undefined as string | undefined,
				}))
			: []
		const persistentDemolitions = previewedProject
			? previewedProject.demolitions.map((coord) => [coord[0], coord[1]] as const)
			: []

		// Hover ghost for an active build/hive tool on the draft being edited.
		let ghost: PlacementPreviewEntry[] = []
		if (
			editingProject &&
			editingProject.stage === 'draft' &&
			isProjectTool(action) &&
			mrg.hoveredObject instanceof Tile
		) {
			const anchor = toAxialCoord(mrg.hoveredObject.position)
			if (anchor) {
				if (action === 'hive' && projectEditingState.hivePlan) {
					const stamped = stampHivePlanEntries(
						projectEditingState.hivePlan,
						anchor,
						projectEditingState.rotation,
						projectEditingState.mirror
					)
					// Whole-hive connectivity: draft entries + ghost are the new walls.
					const used = [
						...editingProject.entries.map((e) => ({ q: e.coord[0], r: e.coord[1] })),
						...stamped.map((e) => ({ q: e.coord[0], r: e.coord[1] })),
					]
					const { reason: connectivityReason, purple: purpleTiles } = footprintConnectivity(used)
					const purpleKeys = new Set(purpleTiles.map((v) => `${v.q},${v.r}`))
					// Connectivity refusal is NOT a collision: the footprint gets `invalid`
					// (pinkish-invalid treatment). Purple markers go on the exact tiles
					// `purpleMarkerTiles` returns: the whole footprint when completely
					// locked, `lockedTiles` on partition, walled neighbours otherwise.
					// A purple marker on a footprint tile overrides its ghost entry;
					// elsewhere it is a separate highlight-only entry (no sprite).
					ghost = [
						...stamped.map((entry) => ({
							coord: [entry.coord[0], entry.coord[1]] as const,
							alveolusType: entry.alveolusType,
							variant: entry.variant,
							blocked: entryBlocked({ q: entry.coord[0], r: entry.coord[1] }, entry.alveolusType),
							invalid: connectivityReason,
							inaccessible: purpleKeys.has(`${entry.coord[0]},${entry.coord[1]}`)
								? connectivityReason
								: undefined,
							pending: true,
						})),
						...purpleTiles
							.filter((v) => !stamped.some((e) => e.coord[0] === v.q && e.coord[1] === v.r))
							.map((v) => ({
								coord: [v.q, v.r] as const,
								inaccessible: connectivityReason,
								pending: true,
							})),
					]
				} else if (action.startsWith('build:')) {
					const raw = action.slice('build:'.length)
					const dotIdx = raw.indexOf('.')
					const alveolusType = (dotIdx >= 0 ? raw.slice(0, dotIdx) : raw) as AlveolusType
					const variant = dotIdx >= 0 ? raw.slice(dotIdx + 1) : undefined
					const used = [
						...projectEditingState.project!.entries.map((e) => ({
							q: e.coord[0],
							r: e.coord[1],
						})),
						anchor,
					]
					const { reason: connectivityReason, purple: purpleTiles } = footprintConnectivity(used)
					const purpleKeys = new Set(purpleTiles.map((v) => `${v.q},${v.r}`))
					ghost = [
						{
							coord: [anchor.q, anchor.r] as const,
							alveolusType,
							variant,
							blocked: entryBlocked(anchor, alveolusType),
							invalid: connectivityReason,
							inaccessible: purpleKeys.has(`${anchor.q},${anchor.r}`)
								? connectivityReason
								: undefined,
							pending: true,
						},
						...purpleTiles
							.filter((v) => !(v.q === anchor.q && v.r === anchor.r))
							.map((v) => ({
								coord: [v.q, v.r] as const,
								inaccessible: connectivityReason,
								pending: true,
							})),
					]
				}
			}
		}

		// Merge, letting the hover ghost annotate/override a persistent entry at
		// the same coord (dedupe by coord, ghost wins).
		const merged = new Map<string, PlacementPreviewEntry>()
		for (const entry of persistent) merged.set(hivePlanCoordKey(entry.coord), entry)
		for (const entry of ghost) merged.set(hivePlanCoordKey(entry.coord), entry)

		if (merged.size === 0 && persistentRoads.length === 0 && persistentDemolitions.length === 0) {
			game.emit('placementPreviewClear')
			return
		}
		game.emit('placementPreview', [...merged.values()], persistentRoads, persistentDemolitions)
		return () => game.emit('placementPreviewClear')
	})

	// Reactive cursor: distinct cursor per active tool.
	effect`game:cursor`(() => {
		const action = interactionMode.selectedAction
		const editingProject = projectEditingState.project
		const canvas = container?.querySelector('canvas') as HTMLCanvasElement | null
		if (editingProject && isProjectTool(action)) {
			container?.setAttribute('data-build-action', '')
			if (canvas) canvas.style.cursor = 'crosshair'
		} else if (action.startsWith('build:')) {
			container?.setAttribute('data-build-action', '')
			if (canvas) canvas.style.cursor = 'crosshair'
		} else if (action.startsWith('zone:')) {
			container?.setAttribute('data-build-action', '')
			if (canvas) canvas.style.cursor = 'crosshair'
		} else if (action.startsWith('road:')) {
			container?.setAttribute('data-build-action', '')
			if (canvas) canvas.style.cursor = 'crosshair'
		} else if (action === 'bulldoze') {
			container?.setAttribute('data-build-action', '')
			if (canvas) canvas.style.cursor = 'not-allowed'
		} else if (action === 'hive-plan') {
			container?.setAttribute('data-build-action', '')
			if (canvas) canvas.style.cursor = 'crosshair'
		} else if (action && action !== '') {
			container?.setAttribute('data-build-action', '')
			if (canvas) canvas.style.cursor = 'crosshair'
		} else {
			container?.removeAttribute('data-build-action')
			if (canvas) canvas.style.cursor = ''
		}
	})

	const initView = (el: HTMLElement) => {
		traces.ui.log?.('game-widget.init-view')
		if (container || gameView) return

		container = el
		let isMounted = true
		let resizeObserver: ResizeObserver | undefined

		const setupResizer = () => {
			if (!container) return
			resizeObserver = new ResizeObserver((entries) => {
				requestAnimationFrame(() => {
					if (!isMounted) return
					for (const entry of entries) {
						if (entry.target === container && gameView?.app?.renderer) {
							const { width, height } = entry.contentRect
							if (width > 0 && height > 0) {
								gameView.resize(width, height)
							}
						}
					}
				})
			})
			resizeObserver.observe(container)
		}

		const fitViewToContentWhenReady = () => {
			const view = gameView
			if (!view) return
			void view.ready.then(() => {
				if (isMounted && gameView === view) view.fitViewToContent()
			})
		}

		// Wait for game to load before creating view to ensure content is ready.
		traces.ui.log?.('game-widget.await-loaded')
		game.loaded
			.then(() => {
				if (!isMounted) return
				traces.ui.log?.('game-widget.loaded')
				if (container && !gameView) {
					try {
						traces.ui.log?.('game-widget.mount-renderer', { containerId })
						gameView = new PixiGameRenderer(game, container)
						traces.ui.log?.('game-widget.renderer-created', { containerId })

						// Fit camera to player content once the renderer finishes its async
						// initialization (a synchronous fit would no-op: world/app are not
						// created until `initialize()` resolves).
						fitViewToContentWhenReady()

						if (dock) validateSelectionPanelId(dock)

						setupResizer()
					} catch (e) {
						traces.ui.error?.('game-widget.renderer-create-failed', { error: e })
					}
				}
			})
			.catch((err) => {
				if (!isMounted) return
				traces.ui.error?.('game-widget.loaded-failed', { error: err })
				// Try to initialize anyway if it's just a gameStart glitch
				if (!game.renderer && container) {
					traces.ui.warn?.('game-widget.emergency-renderer-init')
					try {
						gameView = new PixiGameRenderer(game, container)
						fitViewToContentWhenReady()
						setupResizer()
					} catch (e) {
						traces.ui.error?.('game-widget.emergency-renderer-failed', { error: e })
					}
				}
			})

		return () => {
			isMounted = false
			traces.ui.log?.('game-widget.unmount-renderer', { containerId })
			resizeObserver?.disconnect()
			gameView?.destroy()
			gameView = undefined
			container = undefined
		}
	}

	if (import.meta.hot) {
		import.meta.hot.accept(() => {
			if (gameView) {
				void gameView.reload()
			}
		})
	}

	return <div class="dockview-widget dockview-widget--game" use={initView} />
}
