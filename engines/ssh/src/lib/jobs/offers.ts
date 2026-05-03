import type { Alveolus } from 'ssh/board/content/alveolus'
import type { Tile } from 'ssh/board/tile'
import type { Character } from 'ssh/population/character'
import type { VehicleEntity } from 'ssh/population/vehicle/entity'
import type { Job, VehicleHopJob, VehicleOffloadJob, ZoneBrowseJob } from 'ssh/types/base'
import { type AxialCoord, axial } from 'ssh/utils'

export interface JobProvider {
	readonly proposedJobs: readonly ProposedJob[]
}

export type VehiclePlannerJob = VehicleHopJob | ZoneBrowseJob | VehicleOffloadJob

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
	targetTile: Tile = alveolus.tile
): AlveolusProposedJob {
	return {
		...job,
		source: { kind: 'alveolus', alveolus },
		targetTile,
	} as AlveolusProposedJob
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

export function proposedVehicleJobIdentityKey(job: VehiclePlannerJob): string {
	switch (job.job) {
		case 'vehicleOffload': {
			const good = job.maintenanceKind === 'loadFromBurden' ? `:${job.looseGood.goodType}` : ''
			return [job.job, job.vehicleUid, job.maintenanceKind, axial.key(job.targetCoord), good].join(
				':'
			)
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
			].join(':')
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
			].join(':')
	}
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
