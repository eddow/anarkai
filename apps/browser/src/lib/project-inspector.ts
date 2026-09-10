import type { Game } from 'ssh/game'
import type { InspectorSelectableObject } from 'ssh/game/object'
import type { Project } from 'ssh/project'
import { toAxialCoord } from 'ssh/utils/position'

export interface SyntheticProjectObject extends InspectorSelectableObject {
	readonly kind: 'project'
	readonly project: Project
}

export function projectInspectorTitle(project: Project | undefined): string {
	if (!project) return 'Project'
	const name = project.name?.trim()
	return name ? name : 'Project'
}

export function createSyntheticProjectObject(
	game: Game,
	project: Project
): SyntheticProjectObject {
	const first = project.entries[0]
	const tile = first ? game.hex.getTile({ q: first.coord[0], r: first.coord[1] }) : undefined
	const position = tile?.position ?? game.hex.getTile({ q: 0, r: 0 })?.position
	return {
		kind: 'project',
		title: projectInspectorTitle(project),
		game,
		logs: [],
		position,
		hoverObject: tile,
		project,
	}
}

export function resolveProjectTileCoord(project: Project): { q: number; r: number } | undefined {
	const first = project.entries[0]
	if (!first) return undefined
	const coord = toAxialCoord({ q: first.coord[0], r: first.coord[1] } as never)
	return coord ?? { q: first.coord[0], r: first.coord[1] }
}
