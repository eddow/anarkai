import { Tile } from 'ssh/board/tile'
import { collectVehicleWorkPicks, type VehicleWorkPick } from 'ssh/freight/vehicle-work'
import type { Game } from 'ssh/game'
import type { Character } from 'ssh/population/character'
import type { Vehicle } from 'ssh/population/vehicle/entity'
import type { Job } from 'ssh/types/base'
import { type AxialCoord, axial, toAxialCoord } from 'ssh/utils'
import { KeyedRevisionedCache } from 'ssh/utils/revisioned-cache'
import { maxWalkTime } from '../../assets/constants'

/** Default cap for `collectTileWorkPicks`; keep in sync with tile inspector. */
export const tileRankedWorkPicksLimitDefault = 6

type TileWorkSource = 'tile' | 'vehicle'

export interface TileWorkPick {
	readonly source: TileWorkSource
	readonly character: Character
	readonly job: Job | VehicleWorkPick['job']
	readonly targetTile: Tile
	readonly vehicle?: Vehicle
	readonly pathLength: number
	readonly urgency: number
	readonly score: number
}

/** Same `urgency / (pathLength + 1)` as planner vehicle-freight scoring (`Character.vehicleFreightApproachPathLength`). */
function scoreJob(job: Job, pathLength: number): number {
	return job.urgency / (pathLength + 1)
}

function roundedKey(coord: AxialCoord): string {
	return axial.key(axial.round(coord))
}

function sameTile(a: Tile, b: Tile): boolean {
	const ac = toAxialCoord(a.position)
	const bc = toAxialCoord(b.position)
	return !!ac && !!bc && roundedKey(ac) === roundedKey(bc)
}

function sameCoord(a: AxialCoord | undefined, b: AxialCoord): boolean {
	return !!a && roundedKey(a) === roundedKey(b)
}

function pathToTile(character: Character, tile: Tile): AxialCoord[] | undefined {
	if (sameTile(character.tile, tile)) return []
	const startAxial = toAxialCoord(character.position)
	if (!startAxial) return undefined
	const start = axial.round(startAxial)
	return (
		character.game.hex.findPathForCharacter(start, tile.position, character, maxWalkTime, false) ??
		undefined
	)
}

const pathToTileCache = new KeyedRevisionedCache<string, AxialCoord[] | undefined>()
const tileWorkPicksCache = new KeyedRevisionedCache<string, TileWorkPick[]>()
const gameCacheIds = new WeakMap<Game, number>()
let nextGameCacheId = 1

function gameCacheId(game: Game): number {
	const existing = gameCacheIds.get(game)
	if (existing !== undefined) return existing
	const next = nextGameCacheId++
	gameCacheIds.set(game, next)
	return next
}

function populationKey(game: Game): string {
	return Array.from(game.population, (character) => character.uid).join(',')
}

function cachedPathToTile(character: Character, tile: Tile): AxialCoord[] | undefined {
	const start = axial.round(toAxialCoord(character.position)!)
	const key = `${gameCacheId(character.game)}:${character.uid}:${tile.uid}:${axial.key(start)}`
	return pathToTileCache.get(key, character.game.workPlanningRevision, () =>
		pathToTile(character, tile)
	)
}

function vehiclePlannerPathLength(job: VehicleWorkPick['job']): number {
	return job.approachPath?.length ?? 0
}

function compareTileWorkPicks(a: TileWorkPick, b: TileWorkPick): number {
	if (b.score !== a.score) return b.score - a.score
	if (b.urgency !== a.urgency) return b.urgency - a.urgency
	if (a.pathLength !== b.pathLength) return a.pathLength - b.pathLength
	const aVehicle = a.vehicle?.uid ?? ''
	const bVehicle = b.vehicle?.uid ?? ''
	if (aVehicle !== bVehicle) return aVehicle.localeCompare(bVehicle)
	return (a.character.title ?? a.character.name).localeCompare(
		b.character.title ?? b.character.name
	)
}

export function collectTileWorkPicks(
	game: Game,
	tile: Tile,
	limit = tileRankedWorkPicksLimitDefault
): TileWorkPick[] {
	if (!(tile instanceof Tile)) return []
	const selectedCoord = toAxialCoord(tile.position)
	if (!selectedCoord) return []
	const key = `${gameCacheId(game)}:${tile.uid}:${limit}:${populationKey(game)}`
	return tileWorkPicksCache.get(key, game.workPlanningRevision, () =>
		collectTileWorkPicksUncached(game, tile, limit, selectedCoord)
	)
}

function collectTileWorkPicksUncached(
	game: Game,
	tile: Tile,
	limit: number,
	selectedCoord: AxialCoord
): TileWorkPick[] {
	const choices: TileWorkPick[] = []
	for (const character of game.population) {
		const directJob = tile.getJob(character)
		if (directJob) {
			const directPath = cachedPathToTile(character, tile)
			if (directPath) {
				const pathLength = directPath.length
				choices.push({
					source: 'tile',
					character,
					job: directJob,
					targetTile: tile,
					pathLength,
					urgency: directJob.urgency,
					score: scoreJob(directJob, pathLength),
				})
			}
		}

		for (const pick of collectVehicleWorkPicks(game, character)) {
			if (!sameCoord(pick.job.targetCoord, selectedCoord)) continue
			const vehicle = pick.job.vehicle
			if (!vehicle) continue
			const pathLength = vehiclePlannerPathLength(pick.job)
			choices.push({
				source: 'vehicle',
				character,
				job: pick.job,
				targetTile: tile,
				vehicle,
				pathLength,
				urgency: pick.job.urgency,
				score: scoreJob(pick.job, pathLength),
			})
		}
	}

	return choices.sort(compareTileWorkPicks).slice(0, limit)
}
