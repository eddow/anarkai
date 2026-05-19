import type { Alveolus } from 'ssh/board/content/alveolus'
import type { Tile } from 'ssh/board/tile'
import type { Character } from 'ssh/population/character'
import type { VehicleEntity } from 'ssh/population/vehicle/entity'
import type { Job, VehicleHopJob, VehicleOffloadJob, ZoneBrowseJob } from 'ssh/types/base'
import { type AxialCoord, axial, toAxialCoord } from 'ssh/utils'

export interface JobProvider {
	readonly proposedJobs: readonly ProposedJob[]
}

export type VehicleDockConveyJob = Extract<Job, { job: 'convey' }> & {
	readonly vehicleUid: string
}

export type VehiclePlannerJob =
	| VehicleDockConveyJob
	| VehicleHopJob
	| ZoneBrowseJob
	| VehicleOffloadJob

export type AlveolusProposedJob = Job & {
	readonly source: { readonly kind: 'alveolus'; readonly alveolus: Alveolus }
	readonly targetTile: Tile
}

export type TileProposedJob = Job & {
	readonly source: { readonly kind: 'tile'; readonly tile: Tile }
	readonly targetTile: Tile
}

export type VehicleProposedJob = VehiclePlannerJob & {
	readonly source: { readonly kind: 'vehicle'; readonly vehicle: VehicleEntity }
	readonly targetTile: Tile
}

export type ProposedJob = AlveolusProposedJob | TileProposedJob | VehicleProposedJob

export type TailoredJobCandidate =
	| {
			readonly available: true
			readonly proposedJob: ProposedJob
			readonly character: Character
			readonly path: readonly AxialCoord[]
			readonly pathLength: number
			readonly score: number
	  }
	| {
			readonly available: false
			readonly proposedJob: ProposedJob
			readonly character: Character
			readonly blockedReason: string
	  }

export function asAlveolusProposedJob(
	job: Job,
	alveolus: Alveolus,
	targetTile: Tile = targetTileForAlveolusJob(job, alveolus)
): AlveolusProposedJob {
	return {
		...job,
		source: { kind: 'alveolus', alveolus },
		targetTile,
	} as AlveolusProposedJob
}

function targetTileForAlveolusJob(job: Job, alveolus: Alveolus): Tile {
	if ('path' in job && Array.isArray(job.path)) {
		const terminal = job.path.at(-1)
		const coord = terminal ? toAxialCoord(terminal) : undefined
		const tile = coord ? alveolus.game.hex.getTile(coord) : undefined
		if (tile) return tile
	}
	return alveolus.tile
}

export function asTileProposedJob(job: Job, tile: Tile, targetTile: Tile = tile): TileProposedJob {
	return {
		...job,
		source: { kind: 'tile', tile },
		targetTile,
	} as TileProposedJob
}

export function asVehicleProposedJob(
	job: VehiclePlannerJob,
	vehicle: VehicleEntity,
	targetTile: Tile = vehicle.tile
): VehicleProposedJob {
	return {
		...job,
		source: { kind: 'vehicle', vehicle },
		targetTile,
	} as VehicleProposedJob
}

export function proposedJobScore(job: Job, pathLength: number): number {
	return job.urgency / (pathLength + 1)
}

export function proposedVehicleJobIdentityParts(job: VehiclePlannerJob): readonly string[] {
	switch (job.job) {
		case 'convey':
			return [job.job]
		case 'vehicleOffload': {
			const good = job.maintenanceKind === 'loadFromBurden' ? job.looseGood.goodType : ''
			return [job.job, job.vehicleUid, job.maintenanceKind, axial.key(job.targetCoord), good]
		}
		case 'zoneBrowse':
			return [
				job.job,
				job.vehicleUid,
				job.lineId,
				job.stopId,
				job.zoneBrowseAction,
				job.goodType,
				axial.key(job.targetCoord),
			]
		case 'vehicleHop':
			return [
				job.job,
				job.vehicleUid,
				job.lineId,
				job.stopId,
				job.dockEnter ? 'dock' : 'move',
				job.needsBeginService ? 'begin' : 'continue',
				job.zoneBrowseAction ?? '',
				job.goodType ?? '',
				job.targetCoord ? axial.key(job.targetCoord) : '',
			]
	}
}

export function proposedVehicleJobIdentityKey(job: VehiclePlannerJob): string {
	if (job.job === 'vehicleOffload' && job.maintenanceKind === 'loadFromBurden') {
		const [name, vehicleUid, maintenanceKind, targetCoord, goodType] =
			proposedVehicleJobIdentityParts(job)
		return [name, vehicleUid, maintenanceKind, targetCoord, `:${goodType}`].join(':')
	}
	return proposedVehicleJobIdentityParts(job).join(':')
}

export function proposedVehicleJobMatchParts(job: VehiclePlannerJob): readonly string[] {
	if (job.job !== 'vehicleHop') return proposedVehicleJobIdentityParts(job)
	return [...proposedVehicleJobIdentityParts(job), String(job.approachPath?.length ?? 0)]
}

export function executableJob(job: Job): Job {
	const {
		source: _source,
		targetTile: _targetTile,
		...rest
	} = job as Job & {
		source?: unknown
		targetTile?: unknown
	}
	return rest as Job
}
