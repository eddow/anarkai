import { css } from '@app/lib/css'
import { InspectorSection } from '@app/ui/anarkai'
import { vehicles as vehicleVisuals } from 'engine-pixi/assets/visual-content'
import { vehicleTextureKey } from 'engine-pixi/renderers/vehicle-visual'
import { effect } from 'mutts'
import type { Tile } from 'ssh/board/tile'
import { createSyntheticFreightLineObject } from 'ssh/freight/freight-line'
import { collectVehicleWorkPicks, type VehicleWorkPick } from 'ssh/freight/vehicle-work'
import { i18nState } from 'ssh/i18n'
import type { Character } from 'ssh/population/character'
import type { VehicleEntity } from 'ssh/population/vehicle/entity'
import {
	isVehicleLineService,
	isVehicleMaintenanceService,
	type WorldVehicleType,
} from 'ssh/population/vehicle/vehicle'
import type { GoodType, JobType } from 'ssh/types/base'
import { axial, toAxialCoord } from 'ssh/utils'
import EntityBadge from './EntityBadge'
import GoodsList from './GoodsList'
import InspectorObjectLink from './InspectorObjectLink'
import LinkedEntityControl from './LinkedEntityControl'
import PropertyGrid from './PropertyGrid'
import PropertyGridRow from './PropertyGridRow'

css`
.vehicle-properties {
	padding: 0;
}

.vehicle-properties__header {
	display: flex;
	align-items: center;
	gap: 0.75rem;
	width: 100%;
	margin-bottom: 1rem;
}

.vehicle-properties__linked-object {
	display: flex;
	align-items: center;
	gap: 0.5rem;
}

.vehicle-properties__service-text {
	font-size: 0.875rem;
	line-height: 1.35;
	color: var(--ak-text-muted);
	min-width: 0;
}

/* Match CharacterProperties ranked-work rows (operator’s job list). */
.vehicle-work__list {
	display: flex;
	flex-direction: column;
	gap: 0.5rem;
}

.vehicle-work__item {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	padding: 0.375rem 0.5rem;
	border: 1px solid color-mix(in srgb, var(--ak-text-muted) 18%, transparent);
	border-radius: 0.5rem;
	background-color: color-mix(in srgb, var(--ak-surface-1) 72%, transparent);
}

.vehicle-work__target-control {
	transform: scale(0.88);
	transform-origin: left center;
}

.vehicle-work__content {
	min-width: 0;
	flex: 1;
	display: flex;
	flex-direction: column;
	gap: 0.15rem;
}

.vehicle-work__item--selected {
	border-color: color-mix(in srgb, var(--ak-accent, #8b5cf6) 50%, transparent);
	background-color: color-mix(in srgb, var(--ak-accent, #8b5cf6) 10%, transparent);
}

.vehicle-work__header {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 0.75rem;
	font-size: 0.75rem;
}

.vehicle-work__type {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.vehicle-work__score {
	flex: none;
	font-family: ui-monospace, monospace;
	color: var(--ak-text-muted);
}

.vehicle-work__meta {
	font-size: 0.6875rem;
	line-height: 1.35;
	color: var(--ak-text-muted);
}
`

interface VehiclePropertiesProps {
	vehicle: VehicleEntity
}

interface VehicleWorkChoice {
	jobKind: JobType
	targetLabel: string
	targetTile: Tile
	urgency: number
	pathLength: number
	score: number
	operatorLabel: string
	jobLabel: string
	scoreText: string
	metaText: string
}

function resolveVehicleSpriteKey(vehicleType: WorldVehicleType): string {
	const fromVisual = vehicleVisuals[vehicleType]?.sprites?.[0]
	return fromVisual ?? vehicleTextureKey(vehicleType)
}

const rankedWorkLimit = 6

function formatPlannerUtility(value: number): string {
	return value.toFixed(2)
}

function workKindLabel(kind: JobType): string {
	return i18nState.translator?.character?.plannerWorkKinds?.[kind] ?? kind
}

function vehicleFreightPathLength(job: VehicleWorkPick['job']): number {
	switch (job.job) {
		case 'vehicleHop':
			return job.path.length + (job.approachPath?.length ?? 0)
		case 'zoneBrowse':
		case 'vehicleOffload':
			return job.path.length
	}
}

function effectiveOperatorForVehicle(vehicle: VehicleEntity | undefined): Character | undefined {
	if (!vehicle) return undefined
	const fromService = vehicle.operator
	if (fromService) return fromService
	const population = vehicle.game.population as Iterable<Character> | undefined
	if (!population?.[Symbol.iterator]) return undefined
	for (const character of population) {
		if (character.operates?.uid === vehicle.uid) return character
	}
	return undefined
}

function describeVehicleWorkTarget(pick: VehicleWorkPick): string {
	const targetCoord = toAxialCoord(pick.targetTile.position)
	const targetLabel = pick.targetTile.title ?? (targetCoord ? axial.key(targetCoord) : '')
	switch (pick.job.job) {
		case 'vehicleOffload': {
			const detail =
				pick.job.maintenanceKind === 'loadFromBurden'
					? pick.job.looseGood.goodType
					: pick.job.maintenanceKind
			return `vehicleOffload ${detail} @ ${pick.job.targetCoord.q},${pick.job.targetCoord.r}`
		}
		case 'vehicleHop':
			return `vehicleHop ${pick.job.lineId}/${pick.job.stopId} @ ${targetLabel}`
		case 'zoneBrowse':
			return `zoneBrowse ${pick.job.zoneBrowseAction}:${pick.job.goodType} @ ${pick.job.targetCoord.q},${pick.job.targetCoord.r}`
	}
}

const VehicleProperties = (props: VehiclePropertiesProps, scope: { setTitle?: (title: string) => void }) => {
	const computed = {
		get stock() {
			return props.vehicle?.storage?.stock ?? {}
		},
		get operator() {
			return effectiveOperatorForVehicle(props.vehicle)
		},
		get lineServiceObject() {
			const svc = props.vehicle?.service
			if (!isVehicleLineService(svc)) return undefined
			return createSyntheticFreightLineObject(props.vehicle.game, svc.line)
		},
		get serviceSummaryText(): string {
			const v = props.vehicle
			if (!v) return ''
			const svc = v.service
			if (!svc) {
				if (effectiveOperatorForVehicle(v)) {
					return (
						i18nState.translator?.vehicle?.controlledWithoutService ??
						'Controlled (no active service)'
					)
				}
				return i18nState.translator?.vehicle?.idle ?? 'Idle'
			}
			if (isVehicleLineService(svc)) {
				const docked = svc.docked ?
						(i18nState.translator?.vehicle?.docked ?? 'Docked')
					:	(i18nState.translator?.vehicle?.underway ?? 'Underway')
				const stopLabel = i18nState.translator?.line?.stop ?? 'Stop'
				return `${svc.line.name} · ${stopLabel} ${svc.stop.id} · ${docked}`
			}
			if (isVehicleMaintenanceService(svc)) {
				return i18nState.translator?.vehicle?.offloadService ?? 'Offload'
			}
			return ''
		},
		get workChoices() {
			const vehicle = props.vehicle
			if (!vehicle) return []
			const choices: VehicleWorkChoice[] = []
			const population = vehicle.game.population as Iterable<Character> | undefined
			if (!population?.[Symbol.iterator]) return []
			for (const character of population) {
				for (const pick of collectVehicleWorkPicks(vehicle.game, character)) {
					if (pick.job.vehicleUid !== vehicle.uid) continue
					const pathLength = vehicleFreightPathLength(pick.job)
					const score = pick.job.urgency / (pathLength + 1)
					const operatorLabel = character.title ?? character.name
					choices.push({
						jobKind: pick.job.job,
						targetLabel: describeVehicleWorkTarget(pick),
						targetTile: pick.targetTile,
						urgency: pick.job.urgency,
						pathLength,
						score,
						operatorLabel,
						jobLabel: workKindLabel(pick.job.job),
						scoreText: formatPlannerUtility(score),
						metaText: [
							operatorLabel,
							`${i18nState.translator?.character?.plannerWorkUrgency ?? 'urgency'} ${formatPlannerUtility(pick.job.urgency)}`,
							`${i18nState.translator?.character?.plannerWorkPath ?? 'path'} ${pathLength}`,
						]
							.filter(Boolean)
							.join(' · '),
					})
				}
			}
			return choices
				.sort((a, b) => {
					if (b.score !== a.score) return b.score - a.score
					if (b.urgency !== a.urgency) return b.urgency - a.urgency
					if (a.pathLength !== b.pathLength) return a.pathLength - b.pathLength
					return a.targetLabel.localeCompare(b.targetLabel)
				})
				.slice(0, rankedWorkLimit)
		},
	}

	const resolveWorkTarget = (choice: VehicleWorkChoice) => choice.targetTile

	effect`vehicle-properties:title`(() => {
		scope.setTitle?.(props.vehicle?.title ?? 'Object')
	})

	return (
		<>
			<div if={props.vehicle} class="vehicle-properties">
				<div class="vehicle-properties__header">
					<EntityBadge
						game={props.vehicle.game}
						sprite={resolveVehicleSpriteKey(props.vehicle.vehicleType)}
						text={props.vehicle.title}
						height={32}
					/>
				</div>
				<InspectorSection>
					<PropertyGrid>
						<PropertyGridRow
							if={computed.operator}
							label={i18nState.translator?.vehicle?.operator ?? 'Operator'}
						>
							<div class="vehicle-properties__linked-object">
								<LinkedEntityControl object={computed.operator!} />
								<InspectorObjectLink object={computed.operator!} />
							</div>
						</PropertyGridRow>
						<PropertyGridRow label={String(i18nState.translator?.goods ?? '')}>
							<GoodsList
								goods={Object.keys(computed.stock) as GoodType[]}
								game={props.vehicle.game}
								getBadgeProps={(g) => ({ qty: computed.stock[g] })}
							/>
						</PropertyGridRow>
						<PropertyGridRow label={i18nState.translator?.vehicle?.service ?? 'Service'}>
							<div if={computed.lineServiceObject} class="vehicle-properties__linked-object">
								<span class="vehicle-properties__service-text">{computed.serviceSummaryText}</span>
								<LinkedEntityControl object={computed.lineServiceObject!} />
								<InspectorObjectLink object={computed.lineServiceObject!} />
							</div>
							<span else class="vehicle-properties__service-text">{computed.serviceSummaryText}</span>
						</PropertyGridRow>
					</PropertyGrid>
				</InspectorSection>
				<InspectorSection if={computed.workChoices.length > 0}>
					<PropertyGrid>
						<PropertyGridRow
							label={i18nState.translator?.character?.plannerRankedWork ?? 'Ranked work'}
						>
							<div class="vehicle-work__list">
								<for each={computed.workChoices}>
									{(choice) => (
										<div
											class={[
												'vehicle-work__item',
											]}
											data-testid="vehicle-ranked-work"
										>
											<LinkedEntityControl
												if={resolveWorkTarget(choice)}
												object={resolveWorkTarget(choice)!}
												class="vehicle-work__target-control"
											/>
											<div class="vehicle-work__content">
												<div class="vehicle-work__header">
													<span class="vehicle-work__type">{choice.jobLabel}</span>
													<span class="vehicle-work__score">{choice.scoreText}</span>
												</div>
												<div class="vehicle-work__meta">{choice.targetLabel}</div>
												<div class="vehicle-work__meta">{choice.metaText}</div>
											</div>
										</div>
									)}
								</for>
							</div>
						</PropertyGridRow>
					</PropertyGrid>
				</InspectorSection>
			</div>
			<div else />
		</>
	)
}

export default VehicleProperties
